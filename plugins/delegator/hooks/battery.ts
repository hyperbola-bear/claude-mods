// The context battery: how full a context window is, as ten cells that fill left to right. The same file
// ships in user-hud and delegator, so both draw it alike.
import { put } from './cells.ts'
import type { Run } from './cells.ts'

export const BATTERY_CELLS = 10

export type BatteryLevel = 'low' | 'mid' | 'high'

export const levelOf = (percent: number): BatteryLevel => (percent <= 50 ? 'low' : percent <= 75 ? 'mid' : 'high')

/** The theme's own green, yellow and red, as the cache countdown draws them. */
export const BATTERY_COLORS: Record<BatteryLevel, string> = { low: 'success', mid: 'warning', high: 'error' }

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

/** `▕███▍      ▏ 34%`: two caps around ten cells on the theme's subtle track, then the percentage. */
export function batteryRuns(percent: number, withPercent = true): Run[] {
  const p = Math.max(0, Math.min(100, percent))
  const color = BATTERY_COLORS[levelOf(Math.round(p))]
  const filled = (p / 100) * BATTERY_CELLS
  const full = Math.floor(filled)
  const eighths = Math.floor((filled - full) * 8)
  const row: Run[] = []
  put(row, '▕', { isDim: true })
  // The fill's own colour as its ground too: the desktop draws a block glyph shorter than its cell but a
  // ground the whole cell high, so a glyph alone would sit thinner than the track beside it.
  put(row, '█'.repeat(full), { color, bg: color })
  if (eighths > 0) put(row, EIGHTHS[eighths]!, { color, bg: 'subtle' })
  put(row, ' '.repeat(BATTERY_CELLS - full - (eighths > 0 ? 1 : 0)), { bg: 'subtle' })
  put(row, '▏', { isDim: true })
  if (withPercent) put(row, ` ${Math.round(p)}%`, { color })
  return row
}
