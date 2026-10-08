/**
 * An exchange the person sent to the main chat:
 * - `sent`: added to the main chat, which has not sent a request holding it yet;
 * - `seen`: a main turn that began after it was added has ended, so a fork of the main chat holds it.
 */
export type SentState = 'sent' | 'seen'

export type Exchange = {
  id: number
  q: string
  /** The answer's markdown, mermaid blocks included; null while it is being answered. */
  a: string | null
  /** fork: over the main chat's transcript; live: a plain completion before the first turn; error: no answer. */
  kind?: 'fork' | 'live' | 'error'
  /** Asked for a picture (draw mode, /draw, or a question that starts "draw"). */
  isDraw: boolean
  askedAt: number
  ms?: number
  /** What the answer cost, or why there was none. */
  note?: string
  /** Sent to the main chat by the person; absent while it stays in the pane. */
  sent?: SentState
}

declare module 'claude-code' {
  interface PluginState {
    ask: {
      exchanges: Exchange[]
      /** Every question asks for a picture while on. */
      isDraw: boolean
    }
  }
}
