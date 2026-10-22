import { expect, test } from 'claude-code/testing'

import type { SessionInfo } from '../types'
import { batteryRuns } from '../hooks/battery.ts'
import { cut, line, piece, plain, runs, textOf, underlined, widthOf, wrap } from '../hooks/cells.ts'
import { MODELS } from '../hooks/hud.ts'
import { CARD_ORDER, bandGrid, cardLayout, cardsOf } from '../hooks/panelgrid.ts'
import type { BandView } from '../hooks/panelgrid.ts'
import { EFFORT_COLORS, EFFORT_SHORT_LABELS, EFFORT_STEPS, MODEL_COLORS } from '../hooks/selector.ts'
import { grouped } from '../hooks/sessions.ts'

const NOW = Date.parse('2026-10-22T09:00:00Z')

const session = (title: string, status: SessionInfo['status'], minutesAgo: number, entry: SessionInfo['entry'] = 'cli'): SessionInfo => ({
  sessionId: title.replace(/\W+/g, '-'),
  pid: 100 + minutesAgo,
  status,
  title,
  entry,
  statusAt: NOW - minutesAgo * 60_000,
})

const SESSIONS = grouped(
  [
    session('this one', 'busy', 0, 'app'),
    session('Settle-1804 exploration', 'waiting', 2),
    session('BILLING1-711 refund retry', 'busy', 1),
    session('ask pane mermaid', 'busy', 3, 'app'),
    session('btms payload PR 68', 'idle', 12),
    session('new mods', 'idle', 41, 'app'),
    session('Norway pro-rata', 'idle', 95),
    session('HK bundle products PR', 'idle', 1_700),
  ],
  'this-one',
  NOW,
)

const FIELDS = [
  {
    kind: 'model' as const,
    name: 'MODEL',
    options: MODELS.map(m => ({ id: m.alias, label: m.label, colors: [MODEL_COLORS[m.alias]!], isOn: m.alias === 'opus' })),
    shorter: [MODELS.map(m => m.family)],
  },
  {
    kind: 'effort' as const,
    name: 'EFFORT',
    options: EFFORT_STEPS.map(f => ({ id: f.step, label: f.label, colors: [...EFFORT_COLORS[f.step]], isOn: f.step === 'xhigh' })),
    shorter: EFFORT_SHORT_LABELS,
  },
]

/** Every module on, with something to show in each. */
const VIEW: BandView = {
  isOpen: true,
  view: 'cards',
  columns: 150,
  maxRows: 24,
  lead: null,
  order: CARD_ORDER,
  chip: runs('● 52:10', { color: 'success' }),
  overage: null,
  usedTokens: '1.2M tokens',
  setup: runs('Opus 5.5 · XHigh'),
  setupShort: runs('Opus · XH'),
  keepWarm: 'quiet',
  isPinging: false,
  pickers: { style: 'rail', fields: FIELDS },
  tokens: { total: '1.2M' },
  context: 34,
  contextWindow: '200k',
  cache: { status: runs('● cache 52:10', { color: 'success' }), bar: runs('▰▰▰▰▰▰▰▰▰▱'), detail: '182k cached · hit 94% · 1h' },
  settings: [
    { key: 'sound', label: 'Alert sound', desc: 'Glass at the warning', kind: 'toggle', isOn: true, value: '' },
    { key: 'warnSeconds', label: 'Alert at', desc: 'time left when the alert fires', kind: 'choice', isOn: false, value: '2:00' },
  ],
  handoff: { hasNewest: true, note: 'newest · 2h ago' },
  next: { items: ['Run the tests', 'Commit this and open a PR', 'Add a test for the empty case'], note: null },
  sessions: { list: SESSIONS, now: NOW },
  guesses: [
    { id: 'g1', text: '"Terminal name" = the title Claude gives the session' },
    { id: 'g2', text: '"Done" means finished in the last 8 hours' },
    { id: 'g3', text: 'The diamond means both the tab and the countdown' },
    { id: 'g4', text: 'Only running agents get a character' },
  ],
}

/** The view with one module switched off, as the hooks module hands it then. */
const OFF: Record<string, Partial<BandView>> = {
  cache: { cache: null, chip: [], keepWarm: 'none', overage: null, settings: VIEW.settings.filter(s => s.key === 'selectorStyle') },
  pickers: { pickers: null, setup: [], setupShort: [] },
  tokens: { tokens: null, context: null, contextWindow: null, usedTokens: null },
  handoff: { handoff: null },
  next: { next: null },
  sessions: { sessions: null },
  assume: { guesses: null },
}

const closed = (columns: number, more: Partial<BandView> = {}) => plain(bandGrid({ ...VIEW, isOpen: false, columns, ...more }))[0]

test('the closed row: the least needed piece shortens, then goes, until it fits; last the tab shrinks to its mark', () => {
  expect(closed(160)).toBe('● 1 needs you  ● 52:10  context ▕███▍      ▏ 34%  ● 2 working · ✓ 3 done  ? 4 to check  ✦ 3 next  Opus 5.5 · XHigh  1.2M tokens   ❖ user-hud ▴ ')
  // Tokens go, the model shortens and goes, next steps shorten and go, the guesses shorten.
  expect(closed(100)).toBe('● 1 needs you  ● 52:10  context ▕███▍      ▏ 34%  ● 2 working · ✓ 3 done  ?4   ❖ user-hud ▴ ')
  // The guesses go, the sessions shorten and go, the context drops its label.
  expect(closed(60)).toBe('● 1 needs you  ● 52:10  ▕███▍      ▏ 34%   ❖ user-hud ▴ ')
  // The context goes to its percentage, then goes; the countdown goes.
  expect(closed(46)).toBe('● 1 needs you  ● 52:10  34%   ❖ user-hud ▴ ')
  expect(closed(40)).toBe('● 1 needs you  ● 52:10   ❖ user-hud ▴ ')
  expect(closed(36)).toBe('● 1 needs you   ❖ user-hud ▴ ')
  // Who needs you is the last piece to go.
  expect(closed(20)).toBe('●1   ❖ user-hud ▴ ')
  expect(closed(16)).toBe(' ❖ user-hud ▴ ')
  expect(closed(10)).toBe(' ❖ ')
  expect(closed(2)).toBe(' …')
})

test('the closed row: keep warm, overage and New chat stand between the context and the countdown', () => {
  const urged = { keepWarm: 'urged' as const, overage: '5-hour limit 103%' }
  expect(closed(82, urged)).toBe('● 1 needs you  ● 52:10  ⚠ overage   New chat   34%   w: Keep warm    ❖ user-hud ▴ ')
  expect(closed(79, urged)).toBe('● 1 needs you  ● 52:10  ⚠ overage   New chat    w: Keep warm    ❖ user-hud ▴ ')
  expect(closed(70, urged)).toBe('● 1 needs you  ● 52:10  ⚠ overage   w: Keep warm    ❖ user-hud ▴ ')
  const g = bandGrid({ ...VIEW, isOpen: false, columns: 79, ...urged })
  expect(g.keys).toMatchObject({ w: 'keepwarm', e: 'sessions' })
  expect(textOf(g, 'newchat')).toBe(' New chat ')
  // Quiet, Keep warm stays in the panel; the closed row only offers it once the cache is cooling.
  expect(bandGrid({ ...VIEW, isOpen: false }).keys.w).toBe(undefined)
})

test('the closed row: who needs you opens the Sessions pane, the guesses the panel, next steps the panel too', () => {
  const g = bandGrid({ ...VIEW, isOpen: false, columns: 160 })
  expect(textOf(g, 'sessions')).toBe('● 1 needs you')
  expect(textOf(g, 'assume:review')).toBe('? 4 to check')
  expect(g.hits.filter(h => h.id === 'panel').map(h => textOf({ ...g, hits: [h] }, 'panel'))).toEqual(['✦ 3 next', ' ❖ user-hud ▴ '])
  expect(g.keys).toEqual({ e: 'sessions', a: 'assume:review' })
})

test('the tab’s four diamonds turn yellow only while another session needs you', () => {
  const mark = (v: BandView) => bandGrid(v).rows.flat().find(r => r.text === '❖')
  expect(mark({ ...VIEW, isOpen: false })).toMatchObject({ color: 'warning', bg: 'claude' })
  expect(mark(VIEW)).toMatchObject({ color: 'warning' })
  const calm = { ...SESSIONS, byGroup: { ...SESSIONS.byGroup, needs: [] } }
  expect(mark({ ...VIEW, isOpen: false, sessions: { list: calm, now: NOW } })).toMatchObject({ color: '#fff3ec', bg: 'claude' })
  expect(mark({ ...VIEW, sessions: null })).toMatchObject({ color: '#fff3ec' })
})

/** Where each card's title rule starts: one x per column. */
const ruleColumns = (v: BandView) => {
  const xs = new Set<number>()
  for (const l of plain(bandGrid(v))) for (const m of l.matchAll(/── /g)) if (m.index === 0 || l[m.index - 1] === ' ') xs.add(m.index)
  return [...xs].sort((a, b) => a - b)
}

test('the cards: one column at 60 cells, two at 100, three at 150, two cells between', () => {
  expect([60, 100, 150].map(c => cardLayout(c))).toEqual([
    { width: 60, count: 1, card: 60 },
    { width: 100, count: 2, card: 49 },
    { width: 132, count: 3, card: 42 },
  ])
  expect(ruleColumns({ ...VIEW, columns: 150, maxRows: 40 })).toEqual([0, 44, 88])
  expect(ruleColumns({ ...VIEW, columns: 100, maxRows: 40 })).toEqual([0, 51])
  expect(ruleColumns({ ...VIEW, columns: 60, maxRows: 60 })).toEqual([0])
  for (const columns of [60, 100, 150]) for (const l of plain(bandGrid({ ...VIEW, columns }))) expect(l.length).toBe(Math.min(columns, 132))
})

test('the cards as tiles of one size in rows that line up, handoff in the bottom bar; short, rows fold from the last up', () => {
  const full = plain(bandGrid({ ...VIEW, columns: 100, maxRows: 24 }))
  expect(full.length).toBeLessThanOrEqual(24)
  // Left to right, then the next row: model and cache, context and sessions, guesses and next steps.
  expect(full[0]).toMatch(/^── M O D E L {3}· {3}E F F O R T ─+ {2}── C A C H E ─+$/)
  expect(full[6]).toMatch(/^── C O N T E X T ─+ t: details ─ {2}── S E S S I O N S ─+ e: expand ─$/)
  expect(full[12]).toMatch(/^── C H E C K .*\+1 more ─ {2}── N E X T {3}S T E P S ─+$/)
  // Every tile five rows, a blank row between the rows of tiles.
  expect([full[5], full[11]]).toEqual([' '.repeat(100), ' '.repeat(100)])
  expect(full).toContainEqual(expect.stringMatching(/ {2}● Settle-1804 exploration +2m$/))
  expect(full.some(l => l.includes('H A N D O F F'))).toBe(false)
  expect(full.at(-1)).toMatch(/^⚙ s: Settings {3}✦ h: Write handoff {3}◆ r: Read {3}newest · 2h ago +❖ user-hud ▾ $/)
  const folded = plain(bandGrid({ ...VIEW, columns: 100, maxRows: 12 }))
  expect(folded.length).toBeLessThanOrEqual(12)
  // The first row of tiles stays in full; the rows under it fold, one row a tile, no gap between them.
  expect(folded[0]).toMatch(/^── M O D E L .* {2}── C A C H E ─+$/)
  expect(folded.slice(6, 8)).toEqual([
    expect.stringMatching(/^CONTEXT ▕███▍ {6}▏ 34% +1\.2M {2}SESSIONS +●1 ●2 ✓3 1 asleep$/),
    expect.stringMatching(/^\? 4 to check +a: review {2}✦ 1: Run the tests +2 3$/),
  ])
  expect(folded.some(l => /S E S S I O N S|C O N T E X T|C H E C K|N E X T/.test(l))).toBe(false)
  // Bold where the person is needed.
  const g = bandGrid({ ...VIEW, columns: 100, maxRows: 24 })
  expect(g.rows.flat().find(r => r.text === 'Settle-1804 exploration')?.isBold).toBe(true)
})

test('the bottom bar sheds the handoff note, then the word handoff, then both buttons', () => {
  const bar = (columns: number, more: Partial<BandView> = {}) => plain(bandGrid({ ...VIEW, columns, maxRows: 40, ...more })).at(-1)
  expect(bar(100)).toMatch(/^⚙ s: Settings {3}✦ h: Write handoff {3}◆ r: Read {3}newest · 2h ago +❖ user-hud ▾ $/)
  expect(bar(66)).toMatch(/^⚙ s: Settings {3}✦ h: Write handoff {3}◆ r: Read +❖ user-hud ▾ $/)
  expect(bar(54)).toMatch(/^⚙ s: Settings {3}✦ h: Write {3}◆ r: Read +❖ user-hud ▾ $/)
  expect(bar(40)).toMatch(/^⚙ s: Settings +❖ user-hud ▾ $/)
  expect(bar(100, { handoff: { hasNewest: false, note: 'no notes yet' } })).toMatch(/^⚙ s: Settings {3}✦ h: Write handoff {3}no notes yet +❖ user-hud ▾ $/)
  expect(bar(100, { handoff: null })).toMatch(/^⚙ s: Settings +❖ user-hud ▾ $/)
  expect(bandGrid({ ...VIEW, columns: 100, maxRows: 40 }).keys).toMatchObject({ h: 'handoff', r: 'readhandoff' })
})

test('short of rows the model and effort pickers stay in full: the other rows fold, then the last cards go behind +N more', () => {
  // 8 rows: the pickers in full, the cache folded under them, the rest behind +4 more.
  const g = bandGrid({ ...VIEW, columns: 60, maxRows: 8 })
  const rows = plain(g)
  expect(rows).toHaveLength(8)
  expect(rows[0]).toMatch(/^── M O D E L {3}· {3}E F F O R T ─+$/)
  expect(rows[5]).toBe(' '.repeat(60))
  expect(rows[6]).toMatch(/^● 52:10 ▰+▱ +w: Keep warm $/)
  expect(textOf(g, 'more:context')).toBe(' +4 more ')
  expect(rows.at(-1)).toMatch(/^⚙ s: Settings {2}\+4 more +❖ user-hud ▾ $/)
  expect(g.hits.map(h => h.id)).toContain('pick:model:opus')
  // Two across, the pickers' row stays in full beside the cache; the next row folds.
  const two = plain(bandGrid({ ...VIEW, columns: 100, maxRows: 8 }))
  expect(two[0]).toMatch(/^── M O D E L .* {2}── C A C H E ─+$/)
  expect(two[6]).toMatch(/^CONTEXT ▕.* {2}SESSIONS +●1 ●2 ✓3 1 asleep$/)
  // Only where the pickers cannot fit in full at all do they fold, and the last cards go after them.
  const five = plain(bandGrid({ ...VIEW, columns: 60, maxRows: 5 }))
  expect(five.slice(0, 4)).toEqual([
    expect.stringMatching(/^MODEL Opus 5\.5 · XHigh +m: pick$/),
    expect.stringMatching(/^● 52:10/),
    expect.stringMatching(/^CONTEXT /),
    expect.stringMatching(/^SESSIONS /),
  ])
  expect(five.at(-1)).toMatch(/^⚙ s: Settings {2}\+2 more +❖ user-hud ▾ $/)
  expect(bandGrid({ ...VIEW, columns: 150, maxRows: 24 }).hits.some(h => h.id.startsWith('more:'))).toBe(false)
  expect(cardsOf(VIEW, 42).map(c => c.id)).toEqual(['model', 'cache', 'context', 'sessions', 'assume', 'next'])
  expect(cardsOf({ ...VIEW, lead: 'next' }, 42).map(c => c.id)).toEqual(['next', 'model', 'cache', 'context', 'sessions', 'assume'])
})

test('+N more brings the hidden cards first; the card pressed to the front folds before the pickers do', () => {
  const g = bandGrid({ ...VIEW, columns: 60, maxRows: 8, lead: 'next' })
  const rows = plain(g)
  expect(rows[0]).toMatch(/^✦ 1: Run the tests +2 3$/)
  expect(rows[2]).toMatch(/^── M O D E L /)
  expect(g.hits.map(h => h.id)).toContain('more:cache')
})

test('pressed to the front, the guesses stay in full beside the pickers, so a 12-row band can still mark them', () => {
  const g = bandGrid({ ...VIEW, columns: 100, maxRows: 12, lead: 'assume' })
  const rows = plain(g)
  expect(rows.length).toBeLessThanOrEqual(12)
  expect(rows[0]).toMatch(/^── C H E C K {3}M Y {3}G U E S S E S ─+ \+1 more ─ {2}── N E X T {3}S T E P S ─+$/)
  expect(rows[1]).toMatch(/^✓ ✗ {2}"Terminal name" = the title Claude gives th… {2}✦ 1: Run the tests/)
  expect(g.hits.map(h => h.id)).toEqual(expect.arrayContaining(['assume:right:g1', 'assume:wrong:g1', 'assume:right:g3', 'assume:wrong:g3', 'pick:model:opus']))
  expect(rows[6]).toMatch(/^── M O D E L .* {2}── C A C H E ─+$/)
  expect(rows.at(-1)).toMatch(/^⚙ s: Settings {2}\+2 more /)
  expect(bandGrid({ ...VIEW, columns: 100, maxRows: 12 }).hits.some(h => h.id.startsWith('assume:right'))).toBe(false)
})

test('the model card draws the Rail with the names from 67 cells across, without them down to 27, and the Ladder below', () => {
  const card = (w: number) => plain(cardsOf(VIEW, w).find(c => c.id === 'model')!.full).join('\n')
  expect(card(67)).toMatch(/^MODEL .*Haiku 4\.5/m)
  expect(card(66)).toContain('▔')
  expect(card(66)).not.toMatch(/^MODEL /m)
  expect(card(27)).toContain('▔')
  expect(card(26)).not.toContain('▔')
  expect(card(26)).toMatch(/▄ Haiku 4\.5/)
})

test('the guesses card: each guess with ✓ and ✗ before it, three at most', () => {
  const g = cardsOf(VIEW, 60).find(c => c.id === 'assume')!.full
  expect(plain(g)[0]).toMatch(/^── C H E C K .* \+1 more ─$/)
  expect(plain(g).slice(1)).toEqual([
    expect.stringMatching(/^✓ ✗ {2}"Terminal name" = the title Claude gives the session +$/),
    expect.stringMatching(/^✓ ✗ {2}"Done" means finished in the last 8 hours +$/),
    expect.stringMatching(/^✓ ✗ {2}The diamond means both the tab and the countdown +$/),
  ])
  expect(textOf(g, 'assume:right:g1')).toBe('✓')
  expect(textOf(g, 'assume:wrong:g2')).toBe('✗')
  expect(g.rows[1]!.find(r => r.text === '✓')?.color).toBe('success')
  expect(g.rows[1]!.find(r => r.text === '✗')?.color).toBe('error')
  // With none to check the card keeps its place and its rows, and says so; only the module off takes it away.
  const none = cardsOf({ ...VIEW, guesses: [] }, 60).find(c => c.id === 'assume')!
  expect(plain(none.full)).toEqual([expect.stringMatching(/^── C H E C K /), expect.stringMatching(/^nothing to check +$/), ' '.repeat(0), ' '.repeat(0)])
  expect(plain(none.folded)).toEqual([expect.stringMatching(/^GUESSES nothing to check +$/)])
  expect(cardsOf({ ...VIEW, guesses: null }, 60).some(c => c.id === 'assume')).toBe(false)
})

test('each card keeps its own rows whatever it holds, so filling one moves no other', () => {
  const heights = (v: BandView) => Object.fromEntries(cardsOf(v, 49).map(c => [c.id, c.full.rows.length]))
  const empty: BandView = { ...VIEW, guesses: [], next: { items: [], note: null }, cache: { ...VIEW.cache!, detail: null, bar: [] }, handoff: { hasNewest: false, note: 'no notes yet' } }
  const one = { ...SESSIONS, byGroup: { ...SESSIONS.byGroup, needs: [], working: SESSIONS.byGroup.working.slice(0, 1), done: [] } }
  expect(heights({ ...empty, sessions: { list: one, now: NOW } })).toEqual(heights(VIEW))
  expect(heights(VIEW)).toEqual({ model: 5, cache: 3, context: 3, sessions: 5, assume: 4, next: 4 })
  const a = plain(bandGrid({ ...VIEW, columns: 100, maxRows: 30 }))
  const b = plain(bandGrid({ ...empty, columns: 100, maxRows: 30 }))
  // Where each card's title rule starts, row by row.
  const titles = (rows: string[]) => rows.map(l => [...l.matchAll(/(?<=^| {2})── /g)].map(m => m.index))
  expect(b.length).toBe(a.length)
  expect(titles(b)).toEqual(titles(a))
})

test('s: the settings in place of the cards, a row each, folded into pills when short; s again goes back', () => {
  const g = bandGrid({ ...VIEW, view: 'settings' })
  expect(plain(g)).toContainEqual(expect.stringMatching(/^── S E T T I N G S ─+$/))
  expect(plain(g)).toContainEqual(expect.stringMatching(/^● Alert sound +Glass at the warning +● On $/))
  expect(plain(g).at(-1)).toMatch(/^⚙ s: Back +❖ user-hud ▾ $/)
  expect(g.keys).toEqual({ s: 'settings' })
  const short = plain(bandGrid({ ...VIEW, view: 'settings', maxRows: 3 }))
  expect(short).toHaveLength(2)
  expect(short[0]).toMatch(/^ ● Alert sound {3}2:00 +$/)
  expect(bandGrid(VIEW).keys).toEqual({ s: 'settings', e: 'sessions', t: 'tokens', w: 'keepwarm', h: 'handoff', r: 'readhandoff', 1: 'next:0', 2: 'next:1', 3: 'next:2' })
  expect(bandGrid({ ...VIEW, maxRows: 12, columns: 100 }).keys).toMatchObject({ a: 'assume:review', e: 'sessions' })
  expect(bandGrid({ ...VIEW, maxRows: 5, columns: 60 }).keys).toMatchObject({ m: 'styles' })
  const none = bandGrid({ ...VIEW, settings: [], view: 'settings' })
  expect(none.keys.s).toBe(undefined)
  expect(plain(none).some(l => l.includes('S E S S I O N S'))).toBe(true)
})

test('the layout holds at every width from 28 to 160, with every module on and with each one off', () => {
  const faults: string[] = []
  const variants: [string, Partial<BandView>][] = [['all on', {}], ...Object.entries(OFF).map(([m, off]) => [`${m} off`, off] as [string, Partial<BandView>])]
  for (const [name, off] of variants) {
    for (let columns = 28; columns <= 160; columns += 1) {
      for (const maxRows of [12, 24]) {
        for (const shape of [{ isOpen: false }, { isOpen: true }, { isOpen: true, view: 'settings' as const }]) {
          const v = { ...VIEW, ...off, columns, maxRows, ...shape }
          const g = bandGrid(v)
          const where = `${name}, ${columns}×${maxRows}, ${shape.isOpen ? (shape.view ?? 'cards') : 'closed'}`
          for (const l of plain(g)) if (l.length > columns) faults.push(`${where}: a row of ${l.length}`)
          for (const h of g.hits) if (h.x1 > columns) faults.push(`${where}: ${h.id} ends at ${h.x1}`)
          if (g.rows.length > (shape.isOpen ? maxRows : 1)) faults.push(`${where}: ${g.rows.length} rows`)
          if (!plain(g).at(-1)?.includes('❖')) faults.push(`${where}: no face`)
          if (!g.hits.some(h => h.id === 'panel')) faults.push(`${where}: no tab`)
        }
      }
    }
  }
  expect(faults).toEqual([])
})

test('a card is left out with its module, and so is its hotkey', () => {
  for (const [id, off] of Object.entries({ sessions: OFF.sessions, context: OFF.tokens, model: OFF.pickers, cache: OFF.cache, assume: OFF.assume, next: OFF.next, handoff: OFF.handoff })) {
    const ids = cardsOf({ ...VIEW, ...off }, 42).map(c => c.id)
    expect(ids, id).toEqual(CARD_ORDER.filter(c => c !== id))
  }
  const g = bandGrid({ ...VIEW, ...OFF.tokens, ...OFF.handoff })
  expect(g.keys.t).toBe(undefined)
  expect(g.keys.h).toBe(undefined)
  expect(plain(g).some(l => /C O N T E X T|Write/.test(l))).toBe(false)
})

test('every card folds to exactly one row', () => {
  for (const w of [28, 42, 49, 60]) for (const c of cardsOf(VIEW, w)) expect(c.folded.rows, `${c.id} at ${w}`).toHaveLength(1)
})

test('the context card: the battery and the window, then the total', () => {
  const g = cardsOf(VIEW, 42).find(c => c.id === 'context')!
  expect(plain(g.full)).toEqual([
    expect.stringMatching(/^── C O N T E X T ─+ t: details ─$/),
    expect.stringMatching(/^▕███▍ {6}▏ 34% +of 200k$/),
    expect.stringMatching(/^1\.2M used +$/),
  ])
  expect(g.full.rows[1]![1]).toMatchObject(batteryRuns(34)[1]!)
  expect(plain(cardsOf({ ...VIEW, context: null }, 42).find(c => c.id === 'context')!.full)[1]).toMatch(/^known after a reply/)
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

test('wide: the cards go side by side in fewer rows than one column, every action and hotkey kept', () => {
  const one = bandGrid({ ...VIEW, columns: 60, maxRows: 40 })
  const wide = bandGrid({ ...VIEW, columns: 200, maxRows: 40 })
  expect(wide.rows.length).toBeLessThan(one.rows.length)
  for (const l of plain(wide)) expect(l.length).toBeLessThanOrEqual(200)
  expect(new Set(wide.hits.map(h => h.id))).toEqual(new Set(one.hits.map(h => h.id)))
  expect(wide.keys).toEqual(one.keys)
})

