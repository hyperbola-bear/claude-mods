import { expect, test } from 'claude-code/testing'

import { cut, line, piece, plain, runs, textOf, underlined, widthOf, wrap } from '../hooks/cells.ts'
import { bandGrid } from '../hooks/panelgrid.ts'
import type { BandView } from '../hooks/panelgrid.ts'
import { EFFORT_COLORS, EFFORT_STEPS, MODEL_COLORS } from '../hooks/selector.ts'
import { MODELS } from '../hooks/hud.ts'

const VIEW: BandView = {
  isOpen: true,
  width: 72,
  maxWidth: 110,
  maxRows: 40,
  chip: runs('◆ 52:10', { color: 'success' }),
  overage: null,
  usedTokens: '1.2M tokens',
  setup: runs('Opus 5.5 · XHigh'),
  keepWarm: 'quiet',
  isPinging: false,
  pickers: {
    style: 'rail',
    width: 72,
    fields: [
      { kind: 'model', name: 'MODEL', options: MODELS.map(m => ({ id: m.alias, label: m.label, colors: [MODEL_COLORS[m.alias]!], isOn: m.alias === 'opus' })) },
      { kind: 'effort', name: 'EFFORT', options: EFFORT_STEPS.map(f => ({ id: f.step, label: f.label, colors: [...EFFORT_COLORS[f.step]], isOn: f.step === 'xhigh' })) },
    ],
  },
  tokens: { segments: [{ color: '#3987e5', cells: 10 }, { color: '#d95926', cells: 6 }], total: '1.2M', leaders: ['Files 62%', 'Chat 38%'] },
  cache: runs('◆ cache 52:10 ▰▰▰▰▰▰▰▰▱▱ 182k cached · hit 94% · 1h'),
  settings: [
    { key: 'sound', label: 'Alert sound', desc: 'Glass at the warning', kind: 'toggle', isOn: true, value: '' },
    { key: 'warnSeconds', label: 'Alert at', desc: 'time left when the alert fires', kind: 'choice', isOn: false, value: '2:00' },
  ],
  handoff: { hasNewest: true, note: 'newest · 2h ago' },
}

test('the open panel: every row as wide as the panel, the tab against its right edge', () => {
  const g = bandGrid(VIEW)
  for (const l of plain(g)) expect(l.length).toBe(72)
  expect(plain(g).at(-1)).toMatch(/ ◆ user-hud ▾ $/)
  expect(plain(g)).toContainEqual(expect.stringMatching(/^TOKENS {2} {16} 1\.2M · Files 62% · Chat 38% +t: Details$/))
  expect(plain(g)).toContainEqual(expect.stringMatching(/^● Alert sound +Glass at the warning +● On $/))
  expect(plain(g)).toContainEqual(expect.stringMatching(/^✦ h: Write handoff   ◆ r: Read handoff   newest · 2h ago +$/))
  expect(textOf(g, 'set:warnSeconds')).toBe(' 2:00 ')
  expect(textOf(g, 'keepwarm')).toBe(' w: Keep warm ')
  expect(g.keys).toEqual({ h: 'handoff', t: 'tokens', r: 'readhandoff', w: 'keepwarm' })
})

test('short of rows the dividers go first, then the settings fold onto one line', () => {
  const full = bandGrid(VIEW)
  expect(plain(full).filter(l => /^── |─ user-hud ─$/.test(l))).toHaveLength(4)
  const tight = bandGrid({ ...VIEW, maxRows: full.rows.length - 1 })
  expect(plain(tight).filter(l => /^── /.test(l))).toEqual([expect.stringMatching(/^── S E T T I N G S/)])
  const compact = bandGrid({ ...VIEW, maxRows: 10 })
  expect(plain(compact).some(l => /S E T T I N G S/.test(l))).toBe(false)
  expect(plain(compact)).toContainEqual(expect.stringMatching(/^ ● Alert sound {3}2:00 +$/))
  expect(compact.hits.map(h => h.id)).toContain('set:sound')
})

test('the closed row: the cache, tokens, model and effort beside the tab; the least needed go first when narrow', () => {
  const closed = { ...VIEW, isOpen: false }
  expect(plain(bandGrid(closed))).toEqual(['◆ 52:10  1.2M tokens  Opus 5.5 · XHigh   ◆ user-hud ▴ '])
  expect(plain(bandGrid({ ...closed, maxWidth: 45 }))).toEqual(['◆ 52:10  Opus 5.5 · XHigh   ◆ user-hud ▴ '])
  expect(plain(bandGrid({ ...closed, maxWidth: 20 }))).toEqual([' ◆ user-hud ▴ '])
  // Cooling, Keep warm comes out beside the tab, with its hotkey.
  const cooling = bandGrid({ ...closed, keepWarm: 'urged' })
  expect(textOf(cooling, 'keepwarm')).toBe(' w: Keep warm ')
  expect(cooling.keys).toEqual({ w: 'keepwarm' })
  expect(bandGrid(closed).keys).toEqual({})
})

test('a row: left pieces cut to fit, right pieces against the edge, each action where it is drawn', () => {
  const l = line(20, [piece('a long left side that does not fit')], [piece('[go]', {}, 'go')])
  expect(plain({ rows: [l.row] })).toEqual(['a long left si… [go]'])
  expect(widthOf(l.row)).toBe(20)
  expect(l.spans).toEqual([{ action: 'go', x0: 16, x1: 20 }])
  expect(plain({ rows: [cut(runs('abcdef'), 4)] })).toEqual(['abc…'])
  expect(plain({ rows: wrap('one two three four', 9) })).toEqual(['one two', 'three', 'four'])
})

test('the action under the pointer is underlined, its spaces left plain', () => {
  const l = line(12, [piece(' Go ', { bg: 'subtle' }, 'go')])
  const rows = underlined({ rows: [l.row], hits: [{ id: 'go', y: 0, ...l.spans[0]! }] }, 'go')
  expect(rows[0]!.filter(r => r.isUnderline).map(r => r.text)).toEqual(['Go'])
})
