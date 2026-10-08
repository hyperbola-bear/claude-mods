// Pure layout of the Tokens pane as one grid of cells: the API's totals, every group's share as a bar, and
// what each group was made of. Bars are runs of coloured cells; labels and numbers stay in text colours.
import type { GroupId, TokenState } from '../types'
import { builder, cut, line, pad, piece, put, runs, wrap } from './cells.ts'
import type { Run } from './cells.ts'
import type { Band } from './panelgrid.ts'
import { apiLine, apiTotal, detailLine, fmt, groupOf, pct, ranked, stack, standingLine, totalUsed } from './tokens.ts'

const SHARE_CELLS = 12

/** Every group's share of the tokens used, in one bar `cells` wide, in the groups' fixed order. */
export function stackedBar(s: TokenState, cells: number): Run[] {
  const r: Run[] = []
  for (const seg of stack(s, cells)) put(r, ' '.repeat(seg.cells), { bg: groupOf(seg.id).color })
  return r
}

function groupRows(s: TokenState, id: GroupId, share: number, width: number): Run[][] {
  const g = s.groups[id]
  const on = Math.round(share * SHARE_CELLS)
  const head: Run[] = []
  put(head, '■', { color: groupOf(id).color })
  put(head, ' ')
  put(head, pad(groupOf(id).label, 18), { isBold: true })
  put(head, pct(share).padStart(5))
  put(head, ' ')
  put(head, ' '.repeat(on), { bg: groupOf(id).color })
  put(head, ' '.repeat(SHARE_CELLS - on), { bg: 'subtle' })
  put(head, ' ')
  const numbers = `${fmt(g.used)} used · ${fmt(g.inContext)} in context · ${g.calls} calls`
  const rows: Run[][] = []
  // Wide, the numbers follow the bar; narrow, they go on a line of their own.
  if (head.reduce((n, x) => n + x.text.length, 0) + numbers.length <= width) {
    put(head, numbers)
    rows.push(head)
  } else {
    rows.push(cut(head, width), cut(runs(`  ${numbers}`), width))
  }
  const detail = detailLine(s, id)
  if (detail) rows.push(cut(runs(`  ${detail}`, { isDim: true }), width))
  return rows
}

export function tokensPaneGrid(s: TokenState, width: number): Band {
  const b = builder()
  const actions = line(width, [piece(' r: Refresh ', { bg: 'subtle' }, 'tokens:refresh'), piece(' x: Reset ', { bg: 'subtle' }, 'tokens:reset')])
  b.add(actions.row, actions.spans)
  b.add([])
  if (totalUsed(s) <= 0) {
    for (const row of wrap('No tokens counted yet: the next request starts the tally.', width, { isDim: true })) b.add(row)
  } else {
    for (const row of wrap(apiLine(s), width)) b.add(row)
    if (s.agents.requests + s.plugins.requests > 0) {
      const of = `Of those: subagents ${fmt(apiTotal(s.agents))} (${s.agents.requests} requests) · plugin model calls ${fmt(apiTotal(s.plugins))} (${s.plugins.requests})`
      for (const row of wrap(of, width, { isDim: true })) b.add(row)
    }
    b.add([])
    b.add(stackedBar(s, Math.max(10, Math.min(width, 100))))
    b.add([])
    for (const g of ranked(s)) for (const row of groupRows(s, g.id, g.share, width)) b.add(row)
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
