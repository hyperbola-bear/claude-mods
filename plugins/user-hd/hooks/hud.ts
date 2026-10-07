// Pure corner-panel logic: no `$`, so tests call it directly.
import type { Effort } from '../types'

/** The models the panel offers: the `/model` alias it runs, and the name it shows. */
export const MODELS = [
  { alias: 'haiku', label: 'Haiku 4.5' },
  { alias: 'sonnet', label: 'Sonnet 5.5' },
  { alias: 'opus', label: 'Opus 5.5' },
  { alias: 'fable', label: 'Fable 5.1' },
] as const

export const EFFORTS: readonly { level: Effort; label: string }[] = [
  { level: 'low', label: 'Low' },
  { level: 'medium', label: 'Medium' },
  { level: 'high', label: 'High' },
  { level: 'xhigh', label: 'XHigh' },
  { level: 'max', label: 'Max' },
]

/** Seconds of cache life left when the alert fires: what the Alert at pill cycles through. */
export const WARN_STEPS = [60, 120, 300] as const

/** The panel's alias for a model however `/model` or a request spells it, or null for one it does not offer. */
export function modelAlias(model: string | null): string | null {
  const m = (model ?? '').toLowerCase()
  return MODELS.find(x => m.includes(x.alias))?.alias ?? null
}

/** `Sonnet 5.5` for any spelling of an offered model; the raw name otherwise. */
export function modelLabel(model: string | null): string | null {
  const alias = modelAlias(model)
  return MODELS.find(x => x.alias === alias)?.label ?? model
}

export function asEffort(v: unknown): Effort | null {
  return EFFORTS.find(x => x.level === v)?.level ?? null
}

export const effortLabel = (e: Effort | null) => EFFORTS.find(x => x.level === e)?.label ?? null

export function nextTtl(ttl: 'auto' | '5m' | '1h'): 'auto' | '5m' | '1h' {
  return ttl === 'auto' ? '5m' : ttl === '5m' ? '1h' : 'auto'
}

export function nextWarn(seconds: number): number {
  const i = WARN_STEPS.findIndex(s => s === seconds)
  return (i === -1 ? undefined : WARN_STEPS[(i + 1) % WARN_STEPS.length]) ?? 120
}

/** `── S E T T I N G S ──────…`, `width` cells across. */
export function sectionRule(title: string, width: number): string {
  const head = `── ${title.split('').join(' ')} `
  return head + '─'.repeat(Math.max(2, width - head.length))
}

/** `──────… user-hd ─`, `width` cells across: the panel's bottom edge. */
export function footerRule(title: string, width: number): string {
  const tail = ` ${title} ─`
  return '─'.repeat(Math.max(2, width - tail.length)) + tail
}

/** Ten cells of cache life: `▰▰▰▰▰▰▱▱▱▱`. */
export function lifeBar(remaining: number, total: number, cells = 10): { on: string; off: string } {
  const n = total > 0 ? Math.max(0, Math.min(cells, Math.round((cells * remaining) / total))) : 0
  return { on: '▰'.repeat(n), off: '▱'.repeat(cells - n) }
}
