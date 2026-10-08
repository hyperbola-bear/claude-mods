import { expect, test } from 'claude-code/testing'

import { EFFORT_COLORS, EFFORT_STEPS, MODEL_COLORS } from '../hooks/selector.ts'
import { hitAt, order, plain, underlined } from '../hooks/cells.ts'
import { fittedStyle, layout } from '../hooks/selectorgrid.ts'
import type { GridField } from '../hooks/selectorgrid.ts'
import { MODELS } from '../hooks/hud.ts'

const FIELDS: GridField[] = [
  { kind: 'model', name: 'MODEL', options: MODELS.map(m => ({ id: m.alias, label: m.label, colors: [MODEL_COLORS[m.alias]!], isOn: m.alias === 'opus' })) },
  { kind: 'effort', name: 'EFFORT', options: EFFORT_STEPS.map(f => ({ id: f.step, label: f.label, colors: [...EFFORT_COLORS[f.step]], isOn: f.step === 'xhigh' })) },
]

test('every row is exactly as wide as the cells it holds, and every option sits under its label', () => {
  for (const style of ['rail', 'ladder', 'meter'] as const) {
    const g = layout({ style, width: 72, fields: FIELDS })
    for (const row of plain(g)) expect(row.length).toBe(72)
    for (const h of g.hits) {
      const label = FIELDS.flatMap(f => f.options).find(o => h.id.endsWith(`:${o.id}`))!.label
      const rowsOfOption = g.hits.filter(x => x.id === h.id).map(x => plain(g)[x.y]!.slice(x.x0, x.x1))
      expect(rowsOfOption.some(t => t.includes(label)), `${style} ${h.id}`).toBe(true)
    }
  }
})

test('Rail: labels over the bar, a gap between segments, the chosen one solid', () => {
  const g = layout({ style: 'rail', width: 72, fields: FIELDS })
  expect(plain(g)).toHaveLength(4)
  expect(plain(g)[0]).toBe('MODEL      Haiku 4.5      Sonnet 5.5       Opus 5.5        Fable 5.1    ')
  expect(plain(g)[1]).toBe(`        ${'▔'.repeat(15)} ${'▔'.repeat(15)} ${' '.repeat(15)} ${'▔'.repeat(15)} `)
  expect(g.rows[1]!.find(r => r.bg !== '')?.bg).toBe(MODEL_COLORS.opus)
  expect(hitAt(g, 8, 0)).toBe('pick:model:haiku')
  expect(hitAt(g, 23, 1)).toBe(null) // the gap between Haiku and Sonnet
  expect(hitAt(g, 24, 1)).toBe('pick:model:sonnet')
  expect(hitAt(g, 3, 0)).toBe(null) // the field's name
})

test('Ladder: one row a field where it fits, wrapping where it does not', () => {
  expect(plain(layout({ style: 'ladder', width: 72, fields: FIELDS }))).toHaveLength(2)
  // The model row needs 61 cells and the effort row 71: at 64 only the effort row wraps, at 60 both do.
  expect(plain(layout({ style: 'ladder', width: 60, fields: FIELDS }))).toHaveLength(4)
  const narrow = layout({ style: 'ladder', width: 64, fields: FIELDS })
  expect(plain(narrow)).toHaveLength(3)
  expect(plain(narrow)[2]).toMatch(/^ {8}▄{7} Ultracode/)
  expect(hitAt(narrow, 9, 2)).toBe('pick:effort:ultracode')
})

test('Rail and Meter give way to the Ladder where their columns do not fit', () => {
  expect(fittedStyle('rail', 72, FIELDS)).toBe('rail')
  expect(fittedStyle('meter', 66, FIELDS)).toBe('ladder')
  expect(fittedStyle('ladder', 200, FIELDS)).toBe('ladder')
})

test('the arrow keys walk the options in reading order, each once', () => {
  const ids = order(layout({ style: 'meter', width: 72, fields: FIELDS })).map(a => a.split(':')[2])
  expect(ids).toEqual(['haiku', 'sonnet', 'opus', 'fable', 'low', 'medium', 'high', 'xhigh', 'max', 'ultracode'])
})

test('the option under the pointer or the keys is underlined', () => {
  const rows = underlined(layout({ style: 'rail', width: 72, fields: FIELDS }), 'pick:effort:max')
  expect(rows[2]!.filter(r => r.isUnderline).map(r => r.text.trim())).toEqual(['Max'])
  // The bar under it too, where it has cells to mark.
  expect(rows[3]!.some(r => r.isUnderline)).toBe(true)
})
