import { expect, test } from 'claude-code/testing'

import { BATTERY_CELLS, BATTERY_COLORS, batteryRuns, levelOf } from '../hooks/battery.ts'
import { widthOf } from '../hooks/cells.ts'

const text = (p: number, withPercent = true) => batteryRuns(p, withPercent).map(r => r.text).join('')

test('the level turns at 50% and 75%', () => {
  expect([0, 50, 51, 75, 76, 100].map(levelOf)).toEqual(['low', 'low', 'mid', 'mid', 'high', 'high'])
})

test('always two caps around ten cells, whatever the percentage', () => {
  for (const p of [-5, 0, 1, 12, 34, 37, 50, 99, 100, 140]) expect(widthOf(batteryRuns(p, false))).toBe(BATTERY_CELLS + 2)
})

test('it fills in eighths of a cell', () => {
  expect(text(0, false)).toBe('▕          ▏')
  expect(text(34, false)).toBe('▕███▍      ▏')
  expect(text(37, false)).toBe('▕███▋      ▏')
  expect(text(100, false)).toBe('▕██████████▏')
})

test('the fill and the percentage share the level colour; the track is the subtle ground', () => {
  const at = (p: number) => batteryRuns(p)
  expect(at(34).find(r => r.text.startsWith('█'))?.color).toBe(BATTERY_COLORS.low)
  expect(at(68).at(-1)).toMatchObject({ text: ' 68%', color: BATTERY_COLORS.mid })
  expect(at(92).at(-1)).toMatchObject({ text: ' 92%', color: BATTERY_COLORS.high })
  expect(at(34).filter(r => r.text.trim() === '').every(r => r.bg === 'subtle')).toBe(true)
})
