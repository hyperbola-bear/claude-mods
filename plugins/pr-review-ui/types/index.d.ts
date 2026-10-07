export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'nit'

/** A `path:line` (or `path:start-end`) reference, the unit the code pane shows. */
export type CodeRef = { path: string; line: number; endLine: number }

/** A point's three parts, as the review standard asks for them. */
export type Fields = { problem: string; impact: string; fix: string }

export type Finding = CodeRef & {
  n: number
  severity: Severity
  /** correctness, security, reliability, performance, data, tests or naming; '' when the heading names none. */
  area: string
  title: string
  body: string
  /** Problem, Impact and Fix; null when the point is written as prose. */
  fields: Fields | null
  /** The suggested change: the lines of the point's ```diff block. */
  suggestion: string[]
  /** The rest of the body as markdown; with no fields, the whole body. */
  rest: string
  /** Where the point's code is: the heading's reference first, then each one its body names, in order. */
  sections: CodeRef[]
}

export type PlanGroup = { label: string; points: number[] }

/** What the review says around its points: the verdict and the PR's title, the lead, the merge plan and the closing words. */
export type ReviewHead = { verdict: string; title: string; intro: string; plan: PlanGroup[]; closing: string }

export type ReviewSource = { kind: 'pr'; url: string; repo: string; number: number } | { kind: 'local'; root: string }

/**
 * One line of code as the pane draws it: old and new line numbers (null on
 * the side it is not on), where it sits in the new file, its kind and text,
 * and the part of a changed line that changed.
 */
export type CodeLine = { o: number | null; n: number | null; p: number; k: ' ' | '+' | '-'; s: string; hot?: [number, number] }

export type Snippet =
  | { kind: 'rows'; rows: CodeLine[]; above: number; below: number; note: string }
  | { kind: 'error'; note: string }

export type PrFileStat = { path: string; adds: number; dels: number }

export type PrMeta = { title: string; head: string; base: string; author: string; additions: number; deletions: number; changedFiles: number }

/** The review folder a PR is checked out into: files at the PR head, HEAD at the merge base. */
export type Worktree = {
  /** The PR it is for; '' with none. */
  url: string
  status: 'idle' | 'preparing' | 'ready' | 'failed'
  path: string
  /** The clone it hangs off: the session's checkout, or a clone under the cache folder. */
  repo: string
  /** What it is doing, or what went wrong. */
  note: string
}

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
  /** Code per code location (refKey), for the code pane and the code under a point. */
  snippets: Record<string, Snippet>
  /** Extra lines of context asked for per code location (refKey). */
  expand: Record<string, { up: number; down: number }>
  /** The PR's changed files, for the code pane's file list. */
  files: PrFileStat[]
  /** The PR's title, branches, author and size, for the review's header. */
  meta: PrMeta | null
  /** The review's verdict line (`ready to merge`, …), for the band of a review with no points. */
  verdict: string
  /** Where the last code location was shown. */
  view: 'browser' | 'ide' | 'pane' | null
  /** One line about what the editor shows when it is not the review worktree; null when nothing to say. */
  ideNote: string | null
  /** Bumped when the code pane opens or closes, so the transcript redraws the code under the point. */
  paneSeq: number
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'pr-review-ui': {
      review: ReviewState
      hasBrowser: boolean
      worktree: Worktree
    }
  }
}
