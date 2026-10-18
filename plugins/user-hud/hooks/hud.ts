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

/**
 * The panel's modules, each switched on or off whole: its part of the panel, its commands and the work
 * behind it. `key` is its /config row.
 */
export const MODULES = [
  { id: 'cache', key: 'cacheModule', desc: 'cache countdown, keep warm, alerts, overage' },
  { id: 'pickers', key: 'pickersModule', desc: 'model and effort pickers' },
  { id: 'tokens', key: 'tokensModule', desc: 'where the tokens go' },
  { id: 'handoff', key: 'handoffModule', desc: 'write and read handoff notes' },
  { id: 'next', key: 'nextModule', desc: 'follow-up prompts after each reply (a short Haiku call)' },
] as const

export type ModuleId = (typeof MODULES)[number]['id']
export type Modules = Record<ModuleId, boolean>

/** Each module on unless its /config row says off. */
export function modulesFrom(o: Record<string, unknown>): Modules {
  return Object.fromEntries(MODULES.map(m => [m.id, o[m.key] !== false])) as Modules
}

export type HudArgs = { kind: 'toggle' } | { kind: 'list' } | { kind: 'set'; id: ModuleId; isOn: boolean } | { kind: 'unknown' }

/** `/hud` toggles the panel, `/hud modules` lists the modules, `/hud <module> on|off` switches one. */
export function parseHudArgs(args: string): HudArgs {
  const words = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { kind: 'toggle' }
  if (words.length === 1 && words[0] === 'modules') return { kind: 'list' }
  const m = MODULES.find(x => x.id === words[0])
  if (m && words.length === 2 && (words[1] === 'on' || words[1] === 'off')) return { kind: 'set', id: m.id, isOn: words[1] === 'on' }
  return { kind: 'unknown' }
}

/** `/hud modules`: one line per module, on or off, then how to switch one. */
export function modulesText(modules: Modules): string {
  const lines = MODULES.map(m => `${modules[m.id] ? '● on ' : '○ off'}  ${m.id.padEnd(8)} ${m.desc}`)
  return [...lines, 'Switch one with /hud <module> on|off, or in /config.'].join('\n')
}

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

export function nextWarn(seconds: number): number {
  const i = WARN_STEPS.findIndex(s => s === seconds)
  return (i === -1 ? undefined : WARN_STEPS[(i + 1) % WARN_STEPS.length]) ?? 120
}

/** `── S E T T I N G S ──────…`, `width` cells across; `── SETTINGS ──` where the spaced title does not fit. */
export function sectionRule(title: string, width: number): string {
  const spaced = `── ${title.split('').join(' ')} `
  const head = spaced.length + 2 <= width ? spaced : `── ${title} `
  return head + '─'.repeat(Math.max(2, width - head.length))
}

/** `──────… user-hud ─`, `width` cells across: the panel's bottom edge. */
export function footerRule(title: string, width: number): string {
  const tail = ` ${title} ─`
  return '─'.repeat(Math.max(2, width - tail.length)) + tail
}

/** Ten cells of cache life: `▰▰▰▰▰▰▱▱▱▱`. */
export function lifeBar(remaining: number, total: number, cells = 10): { on: string; off: string } {
  const n = total > 0 ? Math.max(0, Math.min(cells, Math.round((cells * remaining) / total))) : 0
  return { on: '▰'.repeat(n), off: '▱'.repeat(cells - n) }
}
