// Pure prompt-cache logic: no `$`, so tests call it directly.
import type { CacheState, CacheTtl, PlanLimit, TtlInfo } from '../types'

export const TTL_MS: Record<CacheTtl, number> = { '5m': 5 * 60_000, '1h': 60 * 60_000 }

export type Usage = {
  input_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export const EMPTY_CACHE: CacheState = {
  lastHitAt: null,
  inputTokens: 0,
  readTokens: 0,
  writeTokens: 0,
  model: null,
  alertedFor: null,
  isWorking: false,
  isPinging: false,
  autoPings: 0,
  lastPing: null,
  resetReason: null,
}

/** Tokens the request was answered over: uncached, read and written together. */
export const promptTokens = (c: Pick<CacheState, 'inputTokens' | 'readTokens' | 'writeTokens'>) =>
  c.inputTokens + c.readTokens + c.writeTokens

/** Tokens sitting in the cache after the request: what it read plus what it wrote. */
export const cachedTokens = (c: Pick<CacheState, 'readTokens' | 'writeTokens'>) => c.readTokens + c.writeTokens

/** Share of the prompt served from the cache, 0 to 100; null before any request. */
export function hitRate(c: Pick<CacheState, 'inputTokens' | 'readTokens' | 'writeTokens'>): number | null {
  const total = promptTokens(c)
  return total > 0 ? Math.round((c.readTokens / total) * 100) : null
}

/** Milliseconds of cache life left; null when nothing is cached yet. Negative once expired. */
export function remainingMs(lastHitAt: number | null, ttl: CacheTtl, now: number): number | null {
  return lastHitAt === null ? null : lastHitAt + TTL_MS[ttl] - now
}

export type Level = 'live' | 'warm' | 'cooling' | 'cold' | 'none'

export function level(remaining: number | null, warnMs: number, isWorking: boolean): Level {
  if (remaining === null) return 'none'
  if (isWorking) return 'live'
  if (remaining <= 0) return 'cold'
  return remaining <= warnMs ? 'cooling' : 'warm'
}

/** 3:07, or 52:10 for a 1h cache; rounds up so 0:00 only shows once it has expired. */
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

/** Fire the keep-warm alert once per cache stretch, only while idle and inside the window. */
export function shouldAlert(c: CacheState, remaining: number | null, warnMs: number): boolean {
  return (
    remaining !== null &&
    remaining > 0 &&
    remaining <= warnMs &&
    !c.isWorking &&
    !c.isPinging &&
    c.alertedFor !== c.lastHitAt
  )
}

export const AUTO_PING_AT_MS = 30_000

export function shouldAutoPing(
  c: CacheState,
  remaining: number | null,
  opts: { autoKeepWarm: boolean; maxAutoPings: number; warnMs: number },
): boolean {
  return (
    opts.autoKeepWarm &&
    remaining !== null &&
    remaining > 0 &&
    remaining <= Math.min(AUTO_PING_AT_MS, opts.warnMs) &&
    !c.isWorking &&
    !c.isPinging &&
    c.autoPings < opts.maxAutoPings
  )
}

/**
 * The lifetime Claude Code gives the main conversation's cache. An explicit
 * `promptCacheTtl` (or CLAUDE_CODE_PROMPT_CACHE_TTL) wins, overage included;
 * unset, a subscription gets 1h, and 5m while it is on overage.
 */
export function cacheTtlFor(setting: unknown, isOverage: boolean): TtlInfo {
  if (setting === '5m' || setting === '1h') return { ttl: setting, source: 'setting' }
  return isOverage ? { ttl: '5m', source: 'overage' } : { ttl: '1h', source: 'default' }
}

/** The plan window past its limit, the furthest over first: from there the subscription runs on overage. */
export function overageOf(limits: readonly PlanLimit[]): PlanLimit | null {
  const over = limits.filter(l => (l.kind === 'five_hour' || l.kind === 'seven_day') && l.percentUsed >= 100)
  return [...over].sort((a, b) => b.percentUsed - a.percentUsed)[0] ?? null
}

export function limitLabel(l: PlanLimit): string {
  const name = l.kind === 'five_hour' ? '5-hour' : l.kind === 'seven_day' ? 'weekly' : l.kind
  return `${name} limit ${Math.round(l.percentUsed)}%`
}

/** The state after a main-thread request (or a ping) that the API answered. */
export function afterRequest(c: CacheState, at: number, usage: Usage, model: string | null): CacheState {
  const touched = usage.cache_read_input_tokens + usage.cache_creation_input_tokens > 0
  return {
    ...c,
    lastHitAt: touched ? at : c.lastHitAt,
    inputTokens: usage.input_tokens,
    readTokens: usage.cache_read_input_tokens,
    writeTokens: usage.cache_creation_input_tokens,
    model: model ?? c.model,
    resetReason: touched ? null : c.resetReason,
  }
}

export const KEEP_WARM_PROMPT =
  'Keep-alive ping sent by the user-hud plugin to refresh the prompt cache. Reply with only the word: ok'

export function pingSummary(usage: Usage): { line: string; isWarm: boolean } {
  const read = usage.cache_read_input_tokens
  const wrote = usage.cache_creation_input_tokens
  if (read > 0) return { line: `Cache refreshed: read ${fmtTokens(read)} tokens from the cache.`, isWarm: true }
  if (wrote > 0) return { line: `Cache had already expired; the ping re-wrote ${fmtTokens(wrote)} tokens.`, isWarm: true }
  return { line: 'Ping answered but touched no cache (caching may be off for this model or provider).', isWarm: false }
}
