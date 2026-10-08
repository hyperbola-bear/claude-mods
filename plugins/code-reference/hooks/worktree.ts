// The review worktree: the PR's head checked out in a folder of its own, its
// HEAD moved back to where the PR branched, so the PR reads as uncommitted
// edits: in git diff, in the code pane, and in any editor's change marks.
// The person's own checkout is never touched.
import type { CodeLine, PrMeta } from '../types'
import { clean } from './gh.ts'
import { parseDiff, rowsFromHunks, rowsFromText } from './code.ts'
import { cacheDirs, remoteFor } from './view.ts'

export type RunResult = { isOk: true; out: string } | { isOk: false; err: string }
/** Runs a command by its argument vector; the hooks module builds it. */
export type Run = (argv: string[], timeoutMs?: number) => Promise<RunResult>

/** A failed command's first line of standard error, as one clean line. */
export const failure = (stderr: string, argv: readonly string[], exitCode: number): string =>
  clean(stderr.split('\n').find(l => l.trim()) ?? '', 200) || `${argv[0]} exited with ${exitCode}`

export type PrInfo = { url: string; host: string; repo: string; number: number; headSha: string; base: string; meta: PrMeta }

/** The fields `gh pr view --json` is asked for. */
export const PR_FIELDS = 'url,number,title,headRefOid,headRefName,baseRefName,author,additions,deletions,changedFiles'

export function parsePrInfo(json: string): PrInfo | null {
  try {
    const o = JSON.parse(json) as Record<string, unknown>
    const m = /^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(String(o.url ?? ''))
    const sha = String(o.headRefOid ?? '')
    if (!m || !m[1] || !m[2] || !m[3] || !/^[0-9a-f]{7,64}$/i.test(sha)) return null
    const base = String(o.baseRefName ?? '') || 'main'
    const author = (o.author as { login?: unknown } | undefined)?.login
    return {
      url: m[0],
      host: m[1],
      repo: m[2],
      number: Number(m[3]),
      headSha: sha,
      base,
      meta: {
        title: clean(o.title, 200),
        head: clean(o.headRefName, 120),
        base: clean(base, 120),
        author: clean(author, 60),
        additions: Number(o.additions ?? 0) || 0,
        deletions: Number(o.deletions ?? 0) || 0,
        changedFiles: Number(o.changedFiles ?? 0) || 0,
      },
    }
  } catch {
    return null
  }
}

export type Prepared = { isOk: true; path: string; repo: string } | { isOk: false; note: string }

/**
 * Makes (or finds) the review worktree of a PR head. The clone it hangs off is
 * the session's checkout when that is the PR's repository, else a clone under
 * the cache folder made once (no checkout; a full clone, because Claude Code
 * runs git with lazy fetching off, which a blobless clone needs). The PR's refs are
 * fetched under refs/code-reference/, so no branch of the person's is touched.
 * Without gh the clone is made with plain git.
 */
export async function prepareWorktree(
  run: Run,
  exists: (path: string) => Promise<boolean>,
  opts: { gh: string | null; home: string; root: string; info: PrInfo },
): Promise<Prepared> {
  const { info } = opts
  let repo = ''
  let remote = 'origin'
  if (opts.root) {
    const remotes = await run(['git', '-C', opts.root, 'remote', '-v'])
    const name = remotes.isOk ? remoteFor(remotes.out, info.repo) : null
    const top = name ? await run(['git', '-C', opts.root, 'rev-parse', '--show-toplevel']) : null
    if (name && top?.isOk) {
      repo = top.out.trim()
      remote = name
    }
  }
  if (!repo) {
    repo = cacheDirs(opts.home, info.host, info.repo, info.number, info.headSha).clone
    if (!(await exists(`${repo}/.git`))) {
      const url = `https://${info.host}/${info.repo}`
      const cloned = await run(opts.gh ? [opts.gh, 'repo', 'clone', url, repo, '--', '--no-checkout'] : ['git', 'clone', '--no-checkout', '--quiet', url, repo], 600_000)
      if (!cloned.isOk) return { isOk: false, note: `could not clone ${info.repo}: ${cloned.err}` }
    }
  }
  const ns = `refs/code-reference/${info.number}`
  const fetched = await run(['git', '-C', repo, 'fetch', '--no-tags', '--quiet', remote, `+refs/pull/${info.number}/head:${ns}/head`, `+refs/heads/${info.base}:${ns}/base`], 600_000)
  if (!fetched.isOk) return { isOk: false, note: `could not fetch the PR: ${fetched.err}` }
  const head = await run(['git', '-C', repo, 'rev-parse', `${ns}/head`])
  const sha = head.isOk ? head.out.trim() : info.headSha
  const mergeBase = await run(['git', '-C', repo, 'merge-base', `${ns}/head`, `${ns}/base`])
  if (!mergeBase.isOk) return { isOk: false, note: `no common commit with ${info.base}: ${mergeBase.err}` }
  const base = mergeBase.out.trim()
  const dirs = cacheDirs(opts.home, info.host, info.repo, info.number, sha)
  const dir = dirs.worktree
  if (await exists(dir)) {
    const at = await run(['git', '-C', dir, 'rev-parse', 'HEAD'])
    if (at.isOk && at.out.trim() === base) return { isOk: true, path: dir, repo }
    await run(['git', '-C', repo, 'worktree', 'remove', '--force', dir])
  }
  await run(['git', '-C', repo, 'worktree', 'prune'])
  const added = await run(['git', '-C', repo, 'worktree', 'add', '--detach', '--quiet', dir, sha], 600_000)
  if (!added.isOk) return { isOk: false, note: `could not make the worktree: ${added.err}` }
  const reset = await run(['git', '-C', dir, 'reset', '--quiet', '--mixed', base])
  if (!reset.isOk) return { isOk: false, note: `could not move the worktree to the merge base: ${reset.err}` }
  // Files the PR adds show as added, not untracked.
  await run(['git', '-C', dir, 'add', '--intent-to-add', '.'])
  // Older heads of the same PR go.
  const list = await run(['git', '-C', repo, 'worktree', 'list', '--porcelain'])
  if (list.isOk) {
    for (const line of list.out.split('\n')) {
      const path = line.startsWith('worktree ') ? line.slice(9).trim() : ''
      if (path.startsWith(dirs.prefix) && path !== dir) await run(['git', '-C', repo, 'worktree', 'remove', '--force', path])
    }
  }
  return { isOk: true, path: dir, repo }
}

/** Removes a review worktree; the fetched commits stay for the next review. */
export async function removeWorktree(run: Run, repo: string, path: string): Promise<boolean> {
  return (await run(['git', '-C', repo, 'worktree', 'remove', '--force', path])).isOk
}

/**
 * A file's lines as rows, against HEAD of `root`: in a review worktree, the
 * PR's whole change to it; in the session's checkout, the uncommitted one. A
 * file the diff does not touch, or one outside a git repository, reads as
 * every line unchanged. An absolute `path` is read where it is.
 */
export async function fileRows(run: Run, read: (path: string) => Promise<string | null>, root: string, path: string): Promise<CodeLine[] | null> {
  if (root && !path.startsWith('/')) {
    const diff = await run(['git', '-C', root, 'diff', '--no-color', '--no-ext-diff', '-U100000', 'HEAD', '--', path])
    if (diff.isOk && diff.out.trim()) {
      const hunks = parseDiff(diff.out).get(path)
      if (hunks && hunks.length > 0) return rowsFromHunks(hunks)
    }
  }
  const text = await read(path.startsWith('/') ? path : `${root.replace(/\/$/, '')}/${path}`)
  return text === null ? null : rowsFromText(text)
}
