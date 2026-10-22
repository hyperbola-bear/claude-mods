import { expect, test } from 'claude-code/testing'

import { EFFORT_COLORS, EFFORT_SHORT_LABELS, EFFORT_STEPS, MODEL_COLORS } from '../hooks/selector.ts'
import { hitAt, order, plain, underlined } from '../hooks/cells.ts'
import type { Grid } from '../hooks/cells.ts'
import { fittedStyle, layout, pickAction } from '../hooks/selectorgrid.ts'
import type { GridField } from '../hooks/selectorgrid.ts'
import { MODELS } from '../hooks/hud.ts'

const FIELDS: GridField[] = [
  {
    kind: 'model',
    name: 'MODEL',
    options: MODELS.map(m => ({ id: m.alias, label: m.label, colors: [MODEL_COLORS[m.alias]!], isOn: m.alias === 'opus' })),
    shorter: [MODELS.map(m => m.family)],
  },
  {
    kind: 'effort',
    name: 'EFFORT',
    options: EFFORT_STEPS.map(f => ({ id: f.step, label: f.label, colors: [...EFFORT_COLORS[f.step]], isOn: f.step === 'xhigh' })),
    shorter: EFFORT_SHORT_LABELS,
  },
]

const ORDER = ['haiku', 'sonnet', 'opus', 'fable', 'low', 'medium', 'high', 'xhigh', 'max', 'ultracode']

/** The label each option of a field draws: the letters inside its own cells, on whichever row holds them. */
const drawnLabels = (g: Grid, f: GridField) =>
  f.options.map(o =>
    g.hits
      .filter(h => h.id === pickAction(f.kind, o.id))
      .map(h => plain(g)[h.y]!.slice(h.x0, h.x1).trim())
      .find(t => /\w/.test(t)),
  )

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

test('Ladder too narrow for the names beside it: each name on a row of its own, every field alike', () => {
  const rows = plain(layout({ style: 'ladder', width: 22, fields: FIELDS }))
  expect(rows.filter(r => /^(MODEL|EFFORT) *$/.test(r))).toHaveLength(2)
  expect(rows.some(r => /^ /.test(r))).toBe(false)
  for (const r of rows) expect(r).toHaveLength(22)
})

test('Rail and Meter give way to the Ladder only where a field fits none of its label sets', () => {
  expect(fittedStyle('rail', 72, FIELDS)).toBe('rail')
  expect(fittedStyle('meter', 66, FIELDS)).toBe('meter')
  expect(fittedStyle('ladder', 200, FIELDS)).toBe('ladder')
  for (const style of ['rail', 'meter'] as const) {
    expect(fittedStyle(style, 27, FIELDS), `${style} at 27`).toBe(style)
    // The models by family need four columns of 6, a cell between.
    expect(fittedStyle(style, 26, FIELDS), `${style} at 26`).toBe('ladder')
    expect(plain(layout({ style, width: 26, fields: FIELDS }))).toEqual(plain(layout({ style: 'ladder', width: 26, fields: FIELDS })))
  }
})

const NARROW = [
  { w: 34, model: ['Haiku', 'Sonnet', 'Opus', 'Fable'], effort: ['Low', 'Med', 'High', 'XHi', 'Max', 'Ult'] },
  { w: 38, model: ['Haiku', 'Sonnet', 'Opus', 'Fable'], effort: ['Low', 'Med', 'High', 'XHigh', 'Max', 'Ultra'] },
  { w: 39, model: ['Haiku', 'Sonnet', 'Opus', 'Fable'], effort: ['Low', 'Med', 'High', 'XHigh', 'Max', 'Ultra'] },
  { w: 42, model: ['Haiku', 'Sonnet', 'Opus', 'Fable'], effort: ['Low', 'Medium', 'High', 'XHigh', 'Max', 'Ultra'] },
  { w: 49, model: ['Haiku 4.5', 'Sonnet 5.5', 'Opus 5.5', 'Fable 5.1'], effort: ['Low', 'Medium', 'High', 'XHigh', 'Max', 'Ultra'] },
  { w: 60, model: ['Haiku 4.5', 'Sonnet 5.5', 'Opus 5.5', 'Fable 5.1'], effort: ['Low', 'Medium', 'High', 'XHigh', 'Max', 'Ultracode'] },
]

test('at every card width Rail and Meter keep their style, each option under the longest labels that fit', () => {
  for (const { w, model, effort } of NARROW) {
    for (const style of ['rail', 'meter'] as const) {
      expect(fittedStyle(style, w, FIELDS), `${style} at ${w}`).toBe(style)
      const g = layout({ style, width: w, fields: FIELDS })
      for (const row of plain(g)) expect(row.length, `${style} at ${w}`).toBe(w)
      expect(drawnLabels(g, FIELDS[0]!), `${style} at ${w}`).toEqual(model)
      expect(drawnLabels(g, FIELDS[1]!), `${style} at ${w}`).toEqual(effort)
      expect(order(g).map(a => a.split(':')[2]), `${style} at ${w}`).toEqual(ORDER)
    }
  }
})

test('the names take a column only from 67 cells across, where every field fits its full labels beside them', () => {
  const rail = (w: number) => plain(layout({ style: 'rail', width: w, fields: FIELDS }))
  expect(rail(34)[0]!.trim().split(/ +/)).toEqual(['Haiku', 'Sonnet', 'Opus', 'Fable'])
  expect(rail(34)[2]!.trim().split(/ +/)).toEqual(['Low', 'Med', 'High', 'XHi', 'Max', 'Ult'])
  expect(rail(42)[0]!.trim().split(/ +/)).toEqual(['Haiku', 'Sonnet', 'Opus', 'Fable'])
  expect(rail(42)[2]!.trim().split(/ +/)).toEqual(['Low', 'Medium', 'High', 'XHigh', 'Max', 'Ultra'])
  for (let w = 27; w < 67; w++) {
    for (const style of ['rail', 'meter'] as const) {
      expect(plain(layout({ style, width: w, fields: FIELDS })).some(r => /MODEL|EFFORT/.test(r)), `${style} at ${w}`).toBe(false)
    }
  }
  expect(rail(67)[0]).toMatch(/^MODEL {3}.*Haiku 4\.5/)
  expect(rail(67)[2]).toMatch(/^EFFORT {2}.*Ultracode/)
})

test('every field’s label sets give one label per option, each set’s longest shorter than the one before', () => {
  for (const f of FIELDS) {
    const sets = [f.options.map(o => o.label), ...(f.shorter ?? [])]
    for (const set of sets) expect(set, f.kind).toHaveLength(f.options.length)
    const longest = sets.map(set => Math.max(...set.map(l => l.length)))
    for (let i = 1; i < longest.length; i++) expect(longest[i]!, `${f.kind} set ${i}`).toBeLessThan(longest[i - 1]!)
  }
})

test('the arrow keys walk the options in reading order, each once', () => {
  const ids = order(layout({ style: 'meter', width: 72, fields: FIELDS })).map(a => a.split(':')[2])
  expect(ids).toEqual(ORDER)
})

test('the option under the pointer or the keys is underlined', () => {
  const rows = underlined(layout({ style: 'rail', width: 72, fields: FIELDS }), 'pick:effort:max')
  expect(rows[2]!.filter(r => r.isUnderline).map(r => r.text.trim())).toEqual(['Max'])
  // The bar under it too, where it has cells to mark.
  expect(rows[3]!.some(r => r.isUnderline)).toBe(true)
})
