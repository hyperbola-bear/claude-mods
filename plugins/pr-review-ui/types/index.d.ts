export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'nit'

/** A `path:line` (or `path:start-end`) reference, the unit the code pane shows. */
export type CodeRef = { path: string; line: number; endLine: number }

export type Finding = CodeRef & {
  n: number
  severity: Severity
  title: string
  body: string
  /** Where the point's code is: the heading's reference first, then each one its body names, in order. */
  sections: CodeRef[]
}

export type ReviewSource = { kind: 'pr'; url: string; repo: string; number: number } | { kind: 'local'; root: string }

export type Snippet =
  | { kind: 'diff'; code: string; path: string; note: string }
  | { kind: 'source'; code: string; path: string; startLine: number; note: string }
  | { kind: 'error'; note: string }

export type PrFileStat = { path: string; adds: number; dels: number }

export type ReviewState = {
  /** Identifies the review message (a hash of its text); null with no review. */
  key: string | null
  source: ReviewSource | null
  findings: Finding[]
  /** The point being reviewed, by index. */
  current: number
  /** Which of its code locations the code view shows. */
  section: number
  /** GitHub URLs worked out per code location (refKey), for the browser. */
  urls: Record<string, string>
  /** Code fetched per code location (refKey), for the code pane. */
  snippets: Record<string, Snippet>
  /** The PR's changed files, for the code pane's file list. */
  files: PrFileStat[]
  /** Where the last code location was shown. */
  view: 'browser' | 'ide' | 'pane' | null
  /** One line about what the editor shows (a PR-head copy, your checkout); null when nothing to say. */
  ideNote: string | null
  /** True when the editor shows a PR-head copy because the checkout is on another commit of the same repo. */
  canCheckout: boolean
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'pr-review-ui': {
      review: ReviewState
      hasBrowser: boolean
    }
  }
}
