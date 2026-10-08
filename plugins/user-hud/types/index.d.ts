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
  /** `setting`: promptCacheTtl or its env var; `overage`: unset, and the plan is past a limit; `default`: unset, a subscription's 1h. */
  source: 'setting' | 'overage' | 'default'
}

/** One plan window (`five_hour`, `seven_day`) and how much of it is used, 0 to 100 and past. */
export type PlanLimit = { kind: string; percentUsed: number }

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

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type HudState = {
  /** True while the corner panel is open; only the tab shows otherwise. */
  isOpen: boolean
  /** The main loop's model as `/model` shows it; null before it is known. */
  model: string | null
  /** The effort the last main-thread request carried, or the one picked in the panel; null when unknown. */
  effort: Effort | null
  /** The plan window past its limit while the subscription is on overage; null otherwise. */
  overage: PlanLimit | null
}

declare module 'claude-code' {
  interface PluginState {
    'user-hud': {
      cache: CacheState
      ttl: TtlInfo
      handoff: HandoffState
      hud: HudState
    }
  }
}
