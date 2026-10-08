/** A place in the code: a path (relative to the reply's root, or absolute) and lines in the file as it is now; line 0 is the whole file. */
export type CodeRef = { path: string; line: number; endLine: number }

/** One place a reply links to, numbered 1 to N through the reply in the order the text names them. */
export type Place = CodeRef & {
  n: number
  /** The words that link to it. */
  phrase: string
}

/** Where a reply's code is: a folder on disk (an explanation), or a pull request (a review). */
export type Source = { kind: 'local'; root: string } | { kind: 'pr'; url: string; repo: string; number: number }

/**
 * One line of code as the pane draws it: old and new line numbers (null on
 * the side it is not on), where it sits in the new file, its kind and text,
 * and the part of a changed line that changed.
 */
export type CodeLine = { o: number | null; n: number | null; p: number; k: ' ' | '+' | '-'; s: string; hot?: [number, number] }

/** The code shown for one place: rows around it (with how many lines of the file are left above and below), or why there are none. */
export type CodeView = { kind: 'rows'; rows: CodeLine[]; above: number; below: number; note: string } | { kind: 'error'; note: string }

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

export type RefState = {
  /** The reply whose code shows (a hash of its text); null with none. */
  key: string | null
  source: Source | null
  places: Place[]
  /** The place the pane shows, by index into `places`. */
  current: number
  /** Code per place (refKey). */
  code: Record<string, CodeView>
  /** Extra lines of the file asked for around a place (refKey), past the window first loaded. */
  more: Record<string, number>
  /** The person closed the pane: the code shows under the section instead. */
  isPaneClosed: boolean
  /** Why the GitHub page did not show, for the pane to say; null when nothing to say. */
  browserNote: string | null
  /** The PR's title, branches and author, for a review. */
  meta: PrMeta | null
  /** Replies with no code-reference header that /code-reference asked to draw, by key. */
  adopted: string[]
  /** Bumped when the pane opens or closes, so the reply redraws with or without the code under it. */
  paneSeq: number
}

declare module 'claude-code' {
  interface PluginState {
    'code-reference': {
      ref: RefState
      hasBrowser: boolean
      worktree: Worktree
    }
  }
}
