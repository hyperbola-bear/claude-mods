export type CacheTtl = '5m' | '1h'

export type CacheState = {
  /** When the last main-thread request (or keep-warm ping) read or wrote the cache. */
  lastHitAt: number | null
  /** Token counts of that request, as the API reported them. */
  inputTokens: number
  readTokens: number
  writeTokens: number
  model: string | null
  /** The lastHitAt the 2-minute alert already fired for, so it fires once per stretch. */
  alertedFor: number | null
  /** True while a model turn runs on the main thread. */
  isWorking: boolean
  /** True while a keep-warm ping is in flight. */
  isPinging: boolean
  /** Automatic pings made since the person last sent a prompt. */
  autoPings: number
  /** One line about the last ping, for /cache. */
  lastPing: string | null
  /** Why the cache was reset (compaction, model switch, clear), shown until the next request. */
  resetReason: string | null
}

export type TtlInfo = {
  ttl: CacheTtl
  source: 'setting' | 'learned' | 'assumed'
}

export type HandoffFile = { path: string; mtimeMs: number }

export type HandoffState = {
  files: HandoffFile[]
  /** Index into `files` the pane shows. */
  index: number
  text: string | null
  error: string | null
  /** True when a `/handoff` command exists (yours); false means the built-in prompt is used. */
  hasCommand: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'user-hd': {
      cache: CacheState
      ttl: TtlInfo
      handoff: HandoffState
    }
  }
}
