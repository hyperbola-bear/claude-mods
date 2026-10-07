// Pure view logic: where the code shows (browser, IDE or pane), how to open
// an editor at a line, and where the review worktree lives. No `$` here.
import type { CodeRef, PrFileStat } from '../types'
import type { Hunk } from './review.ts'

export type View = 'browser' | 'ide' | 'pane'
export type Ide = 'vscode' | 'jetbrains' | 'zed' | 'nvim'

/** What the terminal Claude Code runs in says about itself. */
export type TermEnv = {
  termProgram?: string
  term?: string
  tmux?: string
  terminalEmulator?: string
  kittyWindow?: string
  bundleId?: string
  /** `$NVIM`: the socket of the Neovim whose :terminal this is. */
  nvim?: string
}

/** The editor whose built-in terminal this is, if any. Neovim first: it may itself run in another editor's terminal. */
export function ideOf(env: TermEnv): Ide | null {
  if (env.nvim) return 'nvim'
  if (env.termProgram === 'vscode') return 'vscode' // VS Code, and forks such as Cursor
  if (env.termProgram === 'zed') return 'zed'
  if (env.terminalEmulator?.startsWith('JetBrains') || env.bundleId?.startsWith('com.jetbrains.') || env.bundleId === 'com.google.android.studio') return 'jetbrains'
  return null
}

export const IDE_NAME: Record<Ide, string> = { vscode: 'VS Code', jetbrains: 'the IDE', zed: 'Zed', nvim: 'Neovim' }

/** Whether the terminal can draw terminal-browser's page: Ghostty or kitty, with no tmux in between. */
export function canDrawImages(env: TermEnv): boolean {
  if (env.tmux) return false
  const isGhostty = env.termProgram === 'ghostty' || env.term === 'xterm-ghostty'
  const isKitty = env.term === 'xterm-kitty' || Boolean(env.kittyWindow)
  return isGhostty || isKitty
}

/**
 * Where a code location shows. `auto` follows the terminal: the editor when
 * Claude Code runs in an editor's terminal, terminal-browser in Ghostty or
 * kitty (when installed and the review is a PR), the code pane everywhere
 * else, including the desktop app.
 */
export function pickView(
  setting: 'auto' | View,
  env: TermEnv,
  facts: { isTerminal: boolean; hasBrowser: boolean; isPr: boolean; hasIdeCommand: boolean },
): View {
  if (setting === 'pane') return 'pane'
  if (setting === 'browser') return facts.isPr ? 'browser' : 'pane'
  if (setting === 'ide') return 'ide'
  if (!facts.isTerminal) return 'pane'
  if (ideOf(env) || facts.hasIdeCommand) return 'ide'
  if (facts.isPr && facts.hasBrowser && canDrawImages(env)) return 'browser'
  return 'pane'
}

/**
 * VS Code's own command line, found from the path its terminal exports for
 * git (`…/Visual Studio Code.app/Contents/Frameworks/…`), so no `code` on the
 * PATH is needed. Works for Insiders and forks laid out the same way.
 */
export function vscodeCliFrom(askpassNode: string | undefined): string | null {
  const m = /^(.*?\.app)\/Contents\//.exec(askpassNode ?? '')
  return m?.[1] ? `${m[1]}/Contents/Resources/app/bin/code` : null
}

const JETBRAINS_NAME = /idea|goland|pycharm|webstorm|rider|clion|phpstorm|rubymine|datagrip|studio|fleet/i

/** A string as a Vim single-quoted literal holds it. */
const vimQuoted = (s: string) => `'${s.replace(/'/g, "''")}'`

/**
 * What Neovim runs to show `file` at `line` in the window beside its
 * terminal: the previous window, or a new split when the terminal is alone.
 */
export function nvimOpenExpr(file: string, line: number): string {
  return `execute('if winnr(''$'') == 1 | vsplit | else | wincmd p | endif | edit +${line} ' . fnameescape(${vimQuoted(file)}))`
}

/** The commands to try, in order, to open `file` at `line` in the editor. */
export function ideCommands(
  ide: Ide | null,
  file: string,
  line: number,
  opts: { command?: string; askpassNode?: string; bundleId?: string; nvim?: string },
): string[][] {
  const out: string[][] = []
  const custom = opts.command?.trim()
  if (custom) {
    if (JETBRAINS_NAME.test(custom)) out.push([custom, '--line', String(line), file])
    else if (/(^|\/)zed$/.test(custom)) out.push([custom, `${file}:${line}`])
    else out.push([custom, '-r', '-g', `${file}:${line}`])
  }
  if (ide === 'vscode') {
    // The running app's own command line first, so Cursor opens Cursor even with VS Code's `code` on the PATH.
    const bundled = vscodeCliFrom(opts.askpassNode)
    if (bundled) out.push([bundled, '-r', '-g', `${file}:${line}`])
    out.push(['code', '-r', '-g', `${file}:${line}`])
  }
  if (ide === 'jetbrains') {
    if (opts.bundleId) out.push(['open', '-nb', opts.bundleId, '--args', '--line', String(line), file])
    out.push(['idea', '--line', String(line), file])
  }
  if (ide === 'zed') out.push(['zed', `${file}:${line}`])
  if (ide === 'nvim' && opts.nvim) out.push(['nvim', '--server', opts.nvim, '--remote-expr', nvimOpenExpr(file, line)])
  return out
}

/** Where a read-only copy of a file at the PR head goes, under the temp folder: the fallback when no worktree can be made. */
export function headCopyPath(tmp: string, repo: string, number: number, sha: string, path: string): string {
  return `${tmp.replace(/\/$/, '')}/pr-review-ui/${repo.replace(/[^\w.-]+/g, '-')}-${number}-${sha.slice(0, 7)}/${path}`
}

/** Whether a git remote URL is the PR's repository (https or ssh, with or without .git). */
export function sameRepo(remote: string, repo: string): boolean {
  const m = /[/:]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(remote.trim())
  return Boolean(m?.[1]) && m?.[1]?.toLowerCase() === repo.toLowerCase()
}

/** The remote of `git remote -v` that is the PR's repository (`upstream` when `origin` is a fork), if any. */
export function remoteFor(remotes: string, repo: string): string | null {
  for (const line of remotes.split('\n')) {
    const [name, url, kind] = line.trim().split(/\s+/)
    if (name && url && kind !== '(push)' && sameRepo(url, repo)) return name
  }
  return null
}

/**
 * The cache folders: a clone of the repository, made once when the session's
 * folder is some other repository, and the review worktree of one PR head.
 */
export function cacheDirs(home: string, host: string, repo: string, number: number, sha: string): { clone: string; worktree: string; prefix: string } {
  const base = `${home.replace(/\/$/, '')}/.cache/pr-review-ui`
  const name = `${repo.replace(/[^\w.-]+/g, '-')}-${number}`
  return { clone: `${base}/repos/${host}/${repo}`, worktree: `${base}/review/${name}-${sha.slice(0, 7)}`, prefix: `${base}/review/${name}-` }
}

/** The PR's files with their added and removed line counts, from its diff. */
export function prFiles(files: Map<string, Hunk[]>): PrFileStat[] {
  return [...files.entries()].map(([path, hunks]) => {
    let adds = 0
    let dels = 0
    for (const h of hunks) {
      for (const l of h.lines) {
        if (l.startsWith('+')) adds += 1
        else if (l.startsWith('-')) dels += 1
      }
    }
    return { path, adds, dels }
  })
}

/** `repository/mixed_order_fetcher.go:51-72`: the last two path segments and the lines, short enough to sit in a row. */
export function shortRef(r: CodeRef): string {
  const tail = r.path.split('/').slice(-2).join('/')
  return `${tail}:${r.line}${r.endLine > r.line ? `-${r.endLine}` : ''}`
}

/** The width from which a pane opened unasked docks beside the transcript. */
export const PANE_FLOOR = 144
