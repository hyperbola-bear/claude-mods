import { expect, test } from 'claude-code/testing'

import { ladderRows } from '../hooks/pickers.tsx'
import {
  EFFORT_COLORS,
  EFFORT_STEPS,
  MODEL_COLORS,
  asStyle,
  columnWidth,
  effortStep,
  ladderCells,
  meterGlyph,
  nextStyle,
  parseEffortArgs,
  spread,
  ultracodeTook,
} from '../hooks/selector.ts'
import { MODELS } from '../hooks/hud.ts'

/** Hue in degrees and saturation 0 to 1 of a `#rrggbb`, for checking a ramp's direction. */
function hsl(hex: string): { h: number; s: number } {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const l = (max + min) / 2
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  const h = d === 0 ? 0 : max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4)
  return { h: (h + 360) % 360, s }
}

test('the model ramp runs from blue, orange’s complement, to orange as the models get more capable', () => {
  const ramp = MODELS.map(m => MODEL_COLORS[m.alias]!)
  expect(ramp).toHaveLength(4)
  const [first, , , last] = ramp.map(hsl)
  expect(first!.h).toBeGreaterThan(195)
  expect(first!.h).toBeLessThan(235)
  expect(last!.h).toBeGreaterThan(20)
  expect(last!.h).toBeLessThan(40)
  // Every step is further from blue: the red channel only rises, the blue one only falls.
  const red = ramp.map(c => parseInt(c.slice(1, 3), 16))
  const blue = ramp.map(c => parseInt(c.slice(5, 7), 16))
  expect([...red].sort((a, b) => a - b)).toEqual(red)
  expect([...blue].sort((a, b) => b - a)).toEqual(blue)
})

test('effort runs from one grey to the full rainbow at Ultracode', () => {
  expect(EFFORT_STEPS.map(s => s.step)).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'])
  const counts = EFFORT_STEPS.map(s => EFFORT_COLORS[s.step].length)
  expect(counts).toEqual([1, 2, 3, 4, 5, 7])
  expect(hsl(EFFORT_COLORS.low[0]!).s).toBeLessThan(0.15)
  // Saturation climbs step by step; Ultracode spans the spectrum, red to violet.
  const sat = EFFORT_STEPS.map(s => Math.max(...EFFORT_COLORS[s.step].map(c => hsl(c).s)))
  expect([...sat].sort((a, b) => a - b)).toEqual(sat)
  const hues = EFFORT_COLORS.ultracode.map(c => hsl(c).h)
  expect(hues[0]).toBeLessThan(15)
  expect(hues.at(-1)).toBeGreaterThan(260)
})

test('a colour list spreads across any number of cells, in order', () => {
  expect(spread(['a', 'b'], 4)).toEqual(['a', 'a', 'b', 'b'])
  expect(spread(['a', 'b', 'c'], 2)).toEqual(['a', 'b'])
  expect(spread(['a'], 3)).toEqual(['a', 'a', 'a'])
  expect(spread([], 3)).toEqual([])
})

test('the Ladder grows a cell per step; the Meter rises to full', () => {
  expect([0, 1, 2, 3].map(i => ladderCells(i, ['#000']))).toEqual([1, 2, 3, 4])
  expect(ladderCells(5, EFFORT_COLORS.ultracode)).toBe(7)
  expect(meterGlyph(0, 4)).toBe('▃')
  expect(meterGlyph(3, 4)).toBe('█')
  expect(meterGlyph(5, 6)).toBe('█')
})

test('columns share the width with a one-cell gap, never narrower than a label', () => {
  expect(columnWidth(64, 4, ['Haiku 4.5', 'Sonnet 5.5'])).toBe(15)
  expect(columnWidth(64, 6, ['Ultracode'])).toBe(9)
  expect(columnWidth(20, 4, ['Sonnet 5.5'])).toBe(10)
})

test('styles cycle Rail, Ladder, Meter; an unknown one reads as Rail', () => {
  expect([nextStyle('rail'), nextStyle('ladder'), nextStyle('meter')]).toEqual(['ladder', 'meter', 'rail'])
  expect(asStyle('meter')).toBe('meter')
  expect(asStyle('fancy')).toBe('rail')
})

test('/effort arguments: a level turns ultracode off, ultracode on and off toggle it', () => {
  expect(parseEffortArgs('high')).toEqual({ effort: 'high', ultracode: false })
  expect(parseEffortArgs('med')).toEqual({ effort: 'medium', ultracode: false })
  expect(parseEffortArgs('ultracode')).toEqual({ ultracode: true })
  expect(parseEffortArgs('ultracode on')).toEqual({ ultracode: true })
  expect(parseEffortArgs('ultracode off')).toEqual({ ultracode: false })
  expect(parseEffortArgs('auto')).toEqual({})
  expect(effortStep('xhigh', true)).toBe('ultracode')
  expect(effortStep('high', false)).toBe('high')
  expect(ultracodeTook('Ultracode on (this session only): Claude may run workflows. Effort stays high')).toBe(true)
  expect(ultracodeTook('Ultracode needs dynamic workflows enabled (see /config).')).toBe(false)
  expect(ultracodeTook("Ultracode isn't available on Haiku 4.5")).toBe(false)
  expect(ultracodeTook("Can't turn ultracode on: needs dynamic workflows")).toBe(false)
  expect(ultracodeTook(undefined)).toBe(true)
})

test('the Ladder wraps where its steps do not fit, and says how many rows it takes', () => {
  const effort = EFFORT_STEPS.map(f => ({ key: f.step, label: f.label, colors: EFFORT_COLORS[f.step], isOn: false, onPress: () => {} }))
  // Strips 1+2+3+4+5+7, labels 30, a space in each step and one between: 63 cells.
  expect(ladderRows(64, effort)).toBe(1)
  expect(ladderRows(62, effort)).toBe(2)
  expect(ladderRows(30, effort)).toBe(3)
})
