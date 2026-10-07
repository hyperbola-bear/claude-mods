// Pure view logic: where the code shows (browser, IDE or pane), how to open
// an IDE at a line, and the rows the code pane draws. No `$` here.
import type { CodeRef, PrFileStat, Snippet } from '../types'
import type { Hunk } from './review.ts'

export type View = 'browser' | 'ide' | 'pane'
export type Ide = 'vscode' | 'jetbrains'

/** What the terminal Claude Code runs in says about itself. */
export type TermEnv = {
  termProgram?: string
  term?: string
  tmux?: string
  terminalEmulator?: string
  kittyWindow?: string
  bundleId?: string
}

/** The IDE whose built-in terminal this is, if any. */
export function ideOf(env: TermEnv): Ide | null {
  if (env.termProgram === 'vscode') return 'vscode' // VS Code, and forks such as Cursor
  if (env.terminalEmulator?.startsWith('JetBrains') || env.bundleId?.startsWith('com.jetbrains.') || env.bundleId === 'com.google.android.studio') return 'jetbrains'
  return null
}

/** Whether the terminal can draw terminal-browser's page: Ghostty or kitty, with no tmux in between. */
export function canDrawImages(env: TermEnv): boolean {
  if (env.tmux) return false
  const isGhostty = env.termProgram === 'ghostty' || env.term === 'xterm-ghostty'
  const isKitty = env.term === 'xterm-kitty' || Boolean(env.kittyWindow)
  return isGhostty || isKitty
}

/**
 * Where a code location shows. `auto` follows the terminal: the editor when
 * Claude Code runs in an IDE's terminal, terminal-browser in Ghostty or kitty
 * (when installed and the review is a PR), the code pane everywhere else,
 * including the desktop app.
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

/** The commands to try, in order, to open `file` at `line` in the IDE. */
export function ideCommands(
  ide: Ide | null,
  file: string,
  line: number,
  opts: { command?: string; askpassNode?: string; bundleId?: string },
): string[][] {
  const out: string[][] = []
  const custom = opts.command?.trim()
  if (custom) {
    out.push(JETBRAINS_NAME.test(custom) ? [custom, '--line', String(line), file] : [custom, '-r', '-g', `${file}:${line}`])
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
  return out
}

/** Where a read-only copy of a file at the PR head goes, under the temp folder. */
export function headCopyPath(tmp: string, repo: string, number: number, sha: string, path: string): string {
  return `${tmp.replace(/\/$/, '')}/pr-review-ui/${repo.replace(/[^\w.-]+/g, '-')}-${number}-${sha.slice(0, 7)}/${path}`
}

/** Whether a git remote URL is the PR's repository (https or ssh, with or without .git). */
export function sameRepo(remote: string, repo: string): boolean {
  const m = /[/:]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(remote.trim())
  return Boolean(m?.[1]) && m?.[1]?.toLowerCase() === repo.toLowerCase()
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

export type CodeRow = { oldNo: string; newNo: string; mark: '+' | '-' | ' '; text: string; isTarget: boolean }

/** The rows the code pane draws for a snippet, the reference's lines marked. */
export function codeRows(snippet: Snippet, ref: CodeRef): CodeRow[] {
  if (snippet.kind === 'error') return []
  const lines = snippet.code.split('\n')
  const inRef = (n: number) => n >= ref.line && n <= ref.endLine
  if (snippet.kind === 'source') {
    return lines.map((text, i) => {
      const n = snippet.startLine + i
      return { oldNo: '', newNo: String(n), mark: ' ', text, isTarget: inRef(n) }
    })
  }
  const head = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(lines[0] ?? '')
  let oldNo = Number(head?.[1] ?? 1)
  let newNo = Number(head?.[2] ?? 1)
  const rows: CodeRow[] = []
  for (const raw of lines.slice(head ? 1 : 0)) {
    const mark = raw[0] === '+' || raw[0] === '-' ? raw[0] : ' '
    const text = raw.slice(1)
    if (mark === '-') {
      rows.push({ oldNo: String(oldNo), newNo: '', mark, text, isTarget: inRef(newNo) })
      oldNo += 1
    } else {
      rows.push({ oldNo: mark === '+' ? '' : String(oldNo), newNo: String(newNo), mark, text, isTarget: inRef(newNo) })
      if (mark !== '+') oldNo += 1
      newNo += 1
    }
  }
  return rows
}

/** `repository/mixed_order_fetcher.go:51-72`: the last two path segments and the lines, short enough to sit in a row. */
export function shortRef(r: CodeRef): string {
  const tail = r.path.split('/').slice(-2).join('/')
  return `${tail}:${r.line}${r.endLine > r.line ? `-${r.endLine}` : ''}`
}
