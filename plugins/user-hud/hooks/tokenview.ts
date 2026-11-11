// Pure layout of the Tokens pane as one grid of cells: the API's totals, every group's share as a bar, and
// each group, when opened, its sub-items. Bars are runs of coloured cells; labels and numbers stay in text colours.
import type { GroupId, TokenState } from '../types'
import { builder, cut, folded, pad, piece, put, runs, wrap } from './cells.ts'
import type { Run } from './cells.ts'
import type { Band } from './panelgrid.ts'
import { apiLine, apiTotal, fmt, groupOf, linesOf, pct, ranked, stack, standingLine, totalUsed } from './tokens.ts'

const SHARE_CELLS = 12
const LINE_NAME = 24

export const groupAction = (id: GroupId) => `tokens:group:${id}`

/** `tokens:group:files` → files; anything else → null. */
export const parseGroupAction = (action: string): string | null => (action.startsWith('tokens:group:') ? action.slice('tokens:group:'.length) : null)

/** Every group's share of the tokens used, in one bar `cells` wide, in the groups' fixed order. */
export function stackedBar(s: TokenState, cells: number): Run[] {
  const r: Run[] = []
  for (const seg of stack(s, cells)) put(r, ' '.repeat(seg.cells), { bg: groupOf(seg.id).color })
  return r
}

type Row = { row: Run[]; spans: { action: string; x0: number; x1: number }[] }

const HEAD = 4 // '▸ ■ '
const PCT = 5
const LINE_NUMBERS = 13 // ' ' + used in 6 + ' ' + share in 5

const widthOf = (row: readonly Run[]) => row.reduce((n, x) => n + x.text.length, 0)

/** A share as its percentage and a bar `cells` wide, the bar left out under two cells. */
function meter(id: GroupId, share: number, cells: number): Run[] {
  const r: Run[] = []
  put(r, pct(share).padStart(PCT))
  if (cells < 2) return r
  const on = Math.round(share * cells)
  put(r, ' ')
  put(r, ' '.repeat(on), { bg: groupOf(id).color })
  put(r, ' '.repeat(cells - on), { bg: 'subtle' })
  return r
}

/** Text that follows `prefix` and wraps under it, each row no wider than `width`. */
const indented = (text: string, prefix: number, width: number, look = {}): Run[][] =>
  wrap(text, Math.max(1, width - prefix), look).map(row => [...runs(' '.repeat(prefix)), ...row])

/** Items joined by ` · `, a new row only between items, each row indented `prefix` and no wider than `width`. */
function packed(items: readonly string[], prefix: number, width: number): Run[][] {
  const lines: string[] = []
  for (const item of items) {
    const last = lines[lines.length - 1]
    if (last !== undefined && prefix + last.length + 3 + item.length <= width) lines[lines.length - 1] = `${last} · ${item}`
    else lines.push(item)
  }
  return lines.flatMap(l => indented(l, prefix, width))
}

/**
 * A group's head, pressed to open or close it, and its sub-items under it while open, most used first.
 * Labels are padded to `labelCells` so the bars line up; the bar takes what the pane has left, up to
 * 12 cells. Where the label alone fills the row, the share and its bar go on the next row; the numbers
 * follow the bar when they fit and otherwise wrap on rows of their own.
 */
function groupRows(s: TokenState, id: GroupId, share: number, width: number, labelCells: number, isOpen: boolean): Row[] {
  const g = s.groups[id]
  const head: Run[] = []
  put(head, isOpen ? '▾ ' : '▸ ')
  put(head, '■', { color: groupOf(id).color })
  put(head, ' ')
  const rows: Row[] = []
  const bar = (left: number) => Math.min(SHARE_CELLS, left - 1)
  if (HEAD + labelCells + PCT <= width) {
    put(head, pad(groupOf(id).label, labelCells), { isBold: true })
    const spans = [{ action: groupAction(id), x0: 0, x1: widthOf(head) }]
    for (const r of meter(id, share, bar(width - widthOf(head) - PCT))) put(head, r.text, r)
    rows.push({ row: head, spans })
  } else {
    put(head, groupOf(id).label, { isBold: true })
    rows.push({ row: cut(head, width), spans: [{ action: groupAction(id), x0: 0, x1: Math.min(width, widthOf(head)) }] })
    rows.push({ row: [...runs('  '), ...meter(id, share, bar(width - 2 - PCT))], spans: [] })
  }
  const numbers = [`${fmt(g.used)} used`, `${fmt(g.inContext)} in context`, `${g.calls} ${g.calls === 1 ? 'call' : 'calls'}`]
  const last = rows[rows.length - 1]!
  if (widthOf(last.row) + 1 + numbers.join(' · ').length <= width) put(last.row, ` ${numbers.join(' · ')}`)
  else {
    if (widthOf(last.row) < width) put(last.row, ' ')
    for (const row of packed(numbers, 2, width)) rows.push({ row, spans: [] })
  }
  if (!isOpen) return rows
  const lines = Object.entries(linesOf(g))
    .filter(([, l]) => l.used > 0 || l.inContext > 0)
    .sort((a, b) => b[1].used - a[1].used || b[1].inContext - a[1].inContext)
  // A sub-item's name gets what the row has after its numbers, up to 24 cells, and at least 6.
  const nameCells = Math.min(LINE_NAME, Math.max(6, width - 4 - LINE_NUMBERS))
  for (const [name, l] of lines) {
    const label = name.length > nameCells ? `${name.slice(0, nameCells - 1)}…` : name
    const numbersOf = `${fmt(l.used).padStart(6)} ${pct(g.used > 0 ? l.used / g.used : 0).padStart(PCT)}`
    const row: Run[] = []
    if (4 + nameCells + LINE_NUMBERS <= width) {
      put(row, `    ${pad(label, nameCells)} ${numbersOf}`)
      rows.push({ row, spans: [] })
    } else {
      // Too narrow for the name and its numbers side by side: the numbers go under the name.
      put(row, `    ${label}`)
      rows.push({ row: cut(row, width), spans: [] }, { row: runs(`      ${numbersOf.trim()}`), spans: [] })
    }
    if (l.inContext > 0) {
      const context = `${fmt(l.inContext)} in context`
      const at = rows[rows.length - 1]!.row
      if (widthOf(at) + 3 + context.length <= width) put(at, `   ${context}`, { isDim: true })
      else for (const r of indented(context, 6, width, { isDim: true })) rows.push({ row: r, spans: [] })
    }
  }
  return rows
}

export function tokensPaneGrid(s: TokenState, width: number, open: readonly GroupId[]): Band {
  const b = builder()
  for (const a of folded([piece(' r: Refresh ', { bg: 'subtle' }, 'tokens:refresh'), piece(' x: Reset ', { bg: 'subtle' }, 'tokens:reset')], width)) b.add(a.row, a.spans)
  b.add([])
  if (totalUsed(s) <= 0) {
    for (const row of wrap('No tokens counted yet: the next request starts the tally.', width, { isDim: true })) b.add(row)
  } else {
    for (const row of wrap(apiLine(s), width)) b.add(row)
    if (s.agents.requests + s.plugins.requests > 0) {
      const of = `Of those: subagents ${fmt(apiTotal(s.agents))} (${s.agents.requests} ${s.agents.requests === 1 ? 'request' : 'requests'}) · plugin model calls ${fmt(apiTotal(s.plugins))} (${s.plugins.requests})`
      for (const row of wrap(of, width, { isDim: true })) b.add(row)
    }
    b.add([])
    b.add(stackedBar(s, Math.max(10, Math.min(width, 100))))
    b.add([])
    const groups = ranked(s)
    // Labels pad to what a full bar leaves, never under the longest shown nor over 18 cells, so the bars line up.
    const longest = Math.max(...groups.map(g => groupOf(g.id).label.length))
    const labelCells = Math.min(18, Math.max(longest, width - HEAD - PCT - 1 - SHARE_CELLS))
    for (const g of groups) for (const r of groupRows(s, g.id, g.share, width, labelCells, open.includes(g.id))) b.add(r.row, r.spans)
  }
  const standing = standingLine(s)
  if (standing) {
    b.add([])
    for (const row of wrap(standing, width, { isDim: true })) b.add(row)
  }
  b.add([])
  const note =
    'used: real API tokens; each request’s input is split by what each group held in the context when it went out, its output by what was written (the rest is thinking). in context and the breakdowns are estimates at about 4 characters a token.'
  for (const row of wrap(note, width, { isDim: true })) b.add(row)
  return { ...b.grid, keys: { r: 'tokens:refresh', x: 'tokens:reset' }, width }
}
