// Reading a pull request without depending on one tool: the GitHub CLI, then
// a GitHub MCP server when one is connected, then plain git, which reads
// refs/pull/<n>/head with the git credentials already set up. The hooks
// module hands in how to reach each. No `$` here.
import { clean } from './gh.ts'
import { remoteFor } from './view.ts'
import { PR_FIELDS, parsePrInfo } from './worktree.ts'
import type { PrInfo, Run } from './worktree.ts'

export type GithubIo = {
  /** gh with these arguments (in `cwd`): its output, or why it failed. */
  gh: (args: string[], cwd?: string) => Promise<{ isOk: true; out: string } | { isOk: false; err: string }>
  /** A tool of a connected GitHub MCP server, by its own name (`get_pull_request`): the text it answered, or null with no such tool. */
  mcp: (name: string, args: Record<string, unknown>) => Promise<string | null>
  git: Run
}

/** Which PR: a URL, a number in the session's repository, or the session's branch. */
export type PrTarget = { kind: 'url'; url: string } | { kind: 'number'; number: number } | { kind: 'branch' }

export type PrRead = { isOk: true; info: PrInfo; via: 'gh' | 'mcp' | 'git' } | { isOk: false; note: string }

const URL_PARTS = /^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/pull\/(\d+)/

/** `github.com` and `acme/billing` from a remote's URL, https or ssh. */
export function repoOfRemote(url: string): { host: string; repo: string } | null {
  const m = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/i.exec(url.trim())
  return m && m[1] && m[2] ? { host: m[1], repo: m[2] } : null
}

/** A PR as the GitHub REST API (and so the GitHub MCP server) describes it. */
export function parseApiPr(json: string): PrInfo | null {
  let o: Record<string, unknown>
  try {
    o = JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
  const head = (o.head ?? {}) as Record<string, unknown>
  const base = (o.base ?? {}) as Record<string, unknown>
  const user = (o.user ?? {}) as Record<string, unknown>
  return parsePrInfo(
    JSON.stringify({
      url: o.html_url,
      number: o.number,
      title: o.title,
      headRefOid: head.sha,
      headRefName: head.ref,
      baseRefName: base.ref,
      author: { login: user.login },
      additions: o.additions,
      deletions: o.deletions,
      changedFiles: o.changed_files,
    }),
  )
}

/** A PR from git alone: its head from refs/pull/<n>/head, its base the remote's default branch, no title. */
async function viaGit(git: Run, root: string, host: string, repo: string, number: number): Promise<PrInfo | null> {
  let remote = `https://${host}/${repo}`
  if (root) {
    const remotes = await git(['git', '-C', root, 'remote', '-v'])
    const name = remotes.isOk ? remoteFor(remotes.out, repo) : null
    if (name) remote = name
  }
  const cwd = root ? ['-C', root] : []
  const head = await git(['git', ...cwd, 'ls-remote', remote, `refs/pull/${number}/head`], 60_000)
  const sha = head.isOk ? (head.out.trim().split(/\s+/)[0] ?? '') : ''
  if (!/^[0-9a-f]{7,64}$/i.test(sha)) return null
  const sym = await git(['git', ...cwd, 'ls-remote', '--symref', remote, 'HEAD'], 60_000)
  const baseName = (sym.isOk ? /ref:\s+refs\/heads\/(\S+)\s+HEAD/.exec(sym.out)?.[1] : undefined) ?? 'main'
  return parsePrInfo(JSON.stringify({ url: `https://${host}/${repo}/pull/${number}`, number, title: '', headRefOid: sha, headRefName: '', baseRefName: baseName, author: {} }))
}

/** The session repository's GitHub host and name, from its remotes (origin first). */
async function sessionRepo(git: Run, root: string): Promise<{ host: string; repo: string } | null> {
  if (!root) return null
  const remotes = await git(['git', '-C', root, 'remote', '-v'])
  if (!remotes.isOk) return null
  const lines = remotes.out.split('\n').filter(l => l.includes('(fetch)'))
  const origin = lines.find(l => l.startsWith('origin')) ?? lines[0]
  const url = origin?.trim().split(/\s+/)[1]
  return url ? repoOfRemote(url) : null
}

/**
 * Reads a PR: with gh when it answers, else through a GitHub MCP server's
 * get_pull_request, else with git. Each step that fails says why, and the
 * last answer names them all when none worked.
 */
export async function readPr(io: GithubIo, target: PrTarget, root: string): Promise<PrRead> {
  const why: string[] = []
  const arg = target.kind === 'url' ? [target.url] : target.kind === 'number' ? [String(target.number)] : []
  const viaGh = await io.gh(['pr', 'view', ...arg, '--json', PR_FIELDS], root || undefined)
  if (viaGh.isOk) {
    const info = parsePrInfo(viaGh.out)
    if (info) return { isOk: true, info, via: 'gh' }
  } else why.push(`gh: ${viaGh.err}`)
  let where: { host: string; repo: string; number: number } | null = null
  if (target.kind === 'url') {
    const m = URL_PARTS.exec(target.url)
    if (m && m[1] && m[2] && m[3]) where = { host: m[1], repo: m[2], number: Number(m[3]) }
  } else if (target.kind === 'number') {
    const own = await sessionRepo(io.git, root)
    if (own) where = { ...own, number: target.number }
  }
  if (!where) return { isOk: false, note: target.kind === 'branch' ? 'finding the PR of this branch needs gh' : `no GitHub repository found (${why.join('; ')})` }
  const [owner, name] = where.repo.split('/')
  const fromMcp = await io.mcp('get_pull_request', { owner, repo: name, pullNumber: where.number })
  if (fromMcp !== null) {
    const info = parseApiPr(fromMcp)
    if (info) return { isOk: true, info, via: 'mcp' }
    why.push('the GitHub MCP server did not describe the PR')
  }
  const fromGit = await viaGit(io.git, root, where.host, where.repo, where.number)
  if (fromGit) return { isOk: true, info: fromGit, via: 'git' }
  why.push('git could not read refs/pull/' + where.number + '/head')
  return { isOk: false, note: clean(why.join('; '), 300) }
}

/**
 * A file at the PR head from GitHub, for when no copy is on disk: through gh's
 * API, else the MCP server's get_file_contents. Null when neither answers.
 */
export async function readGithubFile(io: GithubIo, host: string, repo: string, sha: string, path: string): Promise<string | null> {
  const enc = path.split('/').map(encodeURIComponent).join('/')
  const hostArgs = host && host !== 'github.com' ? ['--hostname', host] : []
  const viaGh = await io.gh(['api', ...hostArgs, '-H', 'Accept: application/vnd.github.raw', `repos/${repo}/contents/${enc}?ref=${sha}`])
  if (viaGh.isOk) return viaGh.out
  const [owner, name] = repo.split('/')
  const text = await io.mcp('get_file_contents', { owner, repo: name, path, ref: sha })
  if (text === null) return null
  // The server answers the raw text, or the API's JSON with the content in base64.
  try {
    const o = JSON.parse(text) as { content?: unknown; encoding?: unknown }
    if (typeof o.content === 'string') {
      if (o.encoding !== 'base64') return o.content
      return new TextDecoder().decode(Uint8Array.from(atob(o.content.replace(/\s+/g, '')), c => c.charCodeAt(0)))
    }
  } catch {
    // not JSON: the file itself
  }
  return text
}
