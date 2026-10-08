// Pure picker logic: the colours and steps of the model and effort pickers, and the three ways to draw them.
//
// Every colour is a hex string a Text or Box paints, the same on every surface, so the terminal and the
// desktop draw the same picture; Buttons stay plain labels, since a desktop draws its own button either way.
import type { Effort, SelectorStyle } from '../types'

/**
 * Haiku → Fable: blue (orange's complement) to orange, a straight line through OKLab from
 * oklch(0.64 0.16 252) to oklch(0.72 0.18 52), the middle steps kept above chroma 0.1 so they stay colours.
 * The more capable the model, the more orange.
 */
export const MODEL_COLORS: Record<string, string> = {
  haiku: '#358fe9',
  sonnet: '#8a8fd4',
  opus: '#d88a6a',
  fable: '#f97d14',
}

export type EffortStep = Effort | 'ultracode'

/**
 * Low → Ultracode: each step spans more of the spectrum, more saturated. Low is one muted grey, Medium
 * red to orange, then yellow, green and blue join, and Ultracode is the whole rainbow at full chroma
 * (OKLCH hues 29, 55, 95, 145, 200, 255, 305; chroma 0.02, 0.08, 0.11, 0.14, 0.16, 0.19).
 */
export const EFFORT_COLORS: Record<EffortStep, readonly string[]> = {
  low: ['#8a939f'],
  medium: ['#b5776d', '#c99471'],
  high: ['#c36e62', '#d68e5c', '#e1ca74'],
  xhigh: ['#d06456', '#e38742', '#e7c952', '#67bb6b'],
  max: ['#d95c4d', '#eb822a', '#ebc831', '#5bbe62', '#3986e4'],
  ultracode: ['#e54e3f', '#f17e08', '#eec804', '#43c251', '#11c2ca', '#1d84f5', '#9b5ad9'],
}

export const EFFORT_STEPS: readonly { step: EffortStep; label: string }[] = [
  { step: 'low', label: 'Low' },
  { step: 'medium', label: 'Medium' },
  { step: 'high', label: 'High' },
  { step: 'xhigh', label: 'XHigh' },
  { step: 'max', label: 'Max' },
  { step: 'ultracode', label: 'Ultracode' },
]

export const SELECTOR_STYLES: readonly { style: SelectorStyle; label: string; rows: number }[] = [
  { style: 'rail', label: 'Rail', rows: 2 },
  { style: 'ladder', label: 'Ladder', rows: 1 },
  { style: 'meter', label: 'Meter', rows: 2 },
]

export function asStyle(v: unknown): SelectorStyle {
  return SELECTOR_STYLES.find(s => s.style === v)?.style ?? 'rail'
}

export const nextStyle = (s: SelectorStyle): SelectorStyle => {
  const i = SELECTOR_STYLES.findIndex(x => x.style === s)
  return SELECTOR_STYLES[(i + 1) % SELECTOR_STYLES.length]?.style ?? 'rail'
}

export const styleLabel = (s: SelectorStyle) => SELECTOR_STYLES.find(x => x.style === s)?.label ?? s

/** Rows one picker takes in a style. */
export const styleRows = (s: SelectorStyle) => SELECTOR_STYLES.find(x => x.style === s)?.rows ?? 1

/** `n` colours for `n` cells, the stops spread evenly across them in order. */
export function spread(colors: readonly string[], n: number): string[] {
  if (n <= 0 || colors.length === 0) return []
  return Array.from({ length: n }, (_, i) => colors[Math.min(colors.length - 1, Math.floor((i * colors.length) / n))]!)
}

/** The step a picker shows as chosen: Ultracode while it is on, else the effort level. */
export const effortStep = (effort: Effort | null, ultracode: boolean): EffortStep | null => (ultracode ? 'ultracode' : effort)

/**
 * The Ladder's strip before an option: one cell more per step up, so the strip grows with the model's
 * or the effort's reach; Ultracode shows every colour of its rainbow.
 */
export const ladderCells = (index: number, colors: readonly string[]) => Math.max(index + 1, colors.length)

/** Lower-block glyphs, lowest to full: the Meter's bars rise through them. */
export const BAR_GLYPHS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const

/** The Meter's bar for option `index` of `n`: a quarter height for the first, full for the last. */
export function meterGlyph(index: number, n: number): string {
  const lo = 2
  const at = n <= 1 ? BAR_GLYPHS.length - 1 : Math.round(lo + ((BAR_GLYPHS.length - 1 - lo) * index) / (n - 1))
  return BAR_GLYPHS[at] ?? '█'
}

/**
 * Equal columns for `n` options across `width` cells with a one-cell gap between them (the separation),
 * never narrower than the longest label so a label does not wrap.
 */
export function columnWidth(width: number, n: number, labels: readonly string[]): number {
  const longest = labels.reduce((m, l) => Math.max(m, l.length), 0)
  return Math.max(longest, Math.floor((width - (n - 1)) / Math.max(1, n)))
}

/** Parses `/effort` arguments into what they change: a level (which turns ultracode off) or ultracode on or off. */
export function parseEffortArgs(args: string): { effort?: Effort; ultracode?: boolean } {
  const [word, onOff] = args.trim().toLowerCase().split(/\s+/)
  if (word === 'ultracode') return onOff === 'off' ? { ultracode: false } : { ultracode: true }
  const level = word === 'med' ? 'medium' : word
  if (level === 'low' || level === 'medium' || level === 'high' || level === 'xhigh' || level === 'max') return { effort: level, ultracode: false }
  return {}
}

/** What `/effort ultracode` answered, read for whether it took: it refuses where dynamic workflows are off. */
export function ultracodeTook(reply: string | undefined): boolean {
  if (!reply) return true
  return !/needs|isn.t available|not available|cannot|can't|unknown|invalid|valid options|failed|refused|not applied/i.test(reply)
}
