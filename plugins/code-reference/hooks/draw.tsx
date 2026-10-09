// Rows of spans as Text: one Text per row, cut at the edge, never wrapped by
// the surface, so every surface shows the rows the mod laid out.
//
// A Client's tree is held to 100,000 characters serialized or the instance
// unmounts, and each span drawn as its own Text costs its text plus about 50
// characters of wrapper. So the rows are planned before they are drawn:
// neighbouring spans that look the same become one, a span with no look is a
// bare string, a row of one look puts it on the row itself, and when that still
// comes to more than the budget, code rows lose their syntax colours from the
// bottom up (a diff's backgrounds and the place marks stay) until it fits.
// Past even that, the rows that do not fit are left out and the last one says
// how many.
import type { ElementTable } from 'claude-code'

import type { Row, Span } from './layout.ts'

/** What a Client tree may come to, with room under the engine's 100,000 for what this count misses. */
export const BUDGET = 90_000

type Look = { color?: string; backgroundColor?: string; bold?: true; dimColor?: true; underline?: true; italic?: true }
/** A row ready to draw: its own look, and runs that are a bare string or a look of their own. */
export type PlannedRow = { look: Look; runs: (string | { look: Look; t: string })[] }
export type Plan = { rows: PlannedRow[]; cost: number; isCoarse: boolean; left: number }

const lookOf = (s: Span): Look => {
  const l: Look = {}
  if (s.fg) l.color = s.fg
  if (s.bg) l.backgroundColor = s.bg
  if (s.b) l.bold = true
  if (s.d) l.dimColor = true
  if (s.u) l.underline = true
  if (s.i) l.italic = true
  return l
}
/** The look a coarse row keeps: everything but a syntax colour. */
const coarseOf = (s: Span): Look => {
  const l = lookOf(s)
  if (s.soft) delete l.color
  return l
}
const keyOf = (l: Look) => `${l.color ?? ''}|${l.backgroundColor ?? ''}|${l.bold ? 1 : 0}${l.dimColor ? 1 : 0}${l.underline ? 1 : 0}${l.italic ? 1 : 0}`
const isPlain = (l: Look) => keyOf(l) === '||0000'

// What the engine serializes, counted the way it writes it.
const textCost = (t: string) => JSON.stringify(t).length + 1
const elemCost = (props: Look & { wrap?: string }, inner: number) => JSON.stringify({ type: 'Text', props, children: [] }).length + inner + 1
const ROW_WRAP = 'truncate-end'

const isBlank = (t: string) => /^\s*$/.test(t)
/** The most common value among the runs, or undefined when there is none. */
function commonest(values: (string | undefined)[]): string | undefined {
  const n = new Map<string, number>()
  for (const v of values) if (v !== undefined) n.set(v, (n.get(v) ?? 0) + 1)
  let best: string | undefined
  for (const [v, c] of n) if (best === undefined || c > (n.get(best) ?? 0)) best = v
  return best
}

function planRow(row: Row, coarse: boolean): { row: PlannedRow; cost: number } {
  // A blank run shows only its background and underline: what colours or
  // weighs its glyphs is dropped, so it joins its neighbours.
  const spans = row
    .filter(s => s.t !== '')
    .map(s => {
      const look = coarse ? coarseOf(s) : lookOf(s)
      if (!isBlank(s.t)) return { look, t: s.t }
      const kept: Look = {}
      if (look.backgroundColor) kept.backgroundColor = look.backgroundColor
      if (look.underline) kept.underline = true
      return { look: kept, t: s.t }
    })
  // What the row's own Text can carry for its runs, as a nested Text inherits
  // it unless it sets its own: the commonest colour, when every run that
  // shows a glyph names one; the commonest background, when every run has one.
  const color = spans.every(s => s.look.color !== undefined || isBlank(s.t)) ? commonest(spans.map(s => s.look.color)) : undefined
  const bg = spans.length > 0 && spans.every(s => s.look.backgroundColor !== undefined) ? commonest(spans.map(s => s.look.backgroundColor)) : undefined
  const rowLook: Look = {}
  if (color) rowLook.color = color
  if (bg) rowLook.backgroundColor = bg
  const merged: { look: Look; t: string }[] = []
  for (const s of spans) {
    const look = { ...s.look }
    if (color && look.color === color) delete look.color
    if (bg && look.backgroundColor === bg) delete look.backgroundColor
    const last = merged[merged.length - 1]
    if (last && keyOf(last.look) === keyOf(look)) last.t += s.t
    else merged.push({ look, t: s.t })
  }
  if (merged.length === 0) merged.push({ look: {}, t: ' ' })
  return finish(rowLook, merged)
}

/** The row's Text: one run takes its look onto the row, else each run is a bare string or a Text of its own. */
function finish(rowLook: Look, merged: { look: Look; t: string }[]): { row: PlannedRow; cost: number } {
  if (merged.length === 1) {
    const only = merged[0] as { look: Look; t: string }
    const look = { ...rowLook, ...only.look }
    return { row: { look, runs: [only.t] }, cost: elemCost({ ...look, wrap: ROW_WRAP }, textCost(only.t)) }
  }
  let inner = 0
  const runs = merged.map(m => {
    if (isPlain(m.look)) {
      inner += textCost(m.t)
      return m.t
    }
    inner += elemCost(m.look, textCost(m.t))
    return m
  })
  return { row: { look: rowLook, runs }, cost: elemCost({ ...rowLook, wrap: ROW_WRAP }, inner) }
}

/** The rows as they will be drawn, and what they come to, kept within `budget`. */
export function planRows(rows: readonly Row[], budget = BUDGET): Plan {
  const ROOT = JSON.stringify({ type: 'Box', props: { flexDirection: 'column' }, children: [] }).length
  const fine = rows.map(r => planRow(r, false))
  let cost = ROOT + fine.reduce((n, p) => n + p.cost, 0)
  if (cost <= budget) return { rows: fine.map(p => p.row), cost, isCoarse: false, left: 0 }
  // Drop the syntax colours from the bottom up, so the code above keeps its
  // colours and the change comes at one place.
  const planned = fine.slice()
  for (let i = rows.length - 1; i >= 0 && cost > budget; i--) {
    const row = rows[i] as Row
    const was = planned[i]
    if (!was || !row.some(s => s.soft)) continue
    const now = planRow(row, true)
    if (now.cost >= was.cost) continue
    cost += now.cost - was.cost
    planned[i] = now
  }
  if (cost <= budget) return { rows: planned.map(p => p.row), cost, isCoarse: true, left: 0 }
  // Still too much: draw the rows that fit, and say how many are left out.
  const NOTE = 120
  const kept: PlannedRow[] = []
  let used = ROOT + NOTE
  for (const p of planned) {
    if (used + p.cost > budget) break
    kept.push(p.row)
    used += p.cost
  }
  const left = rows.length - kept.length
  kept.push({ look: { dimColor: true }, runs: [`  … ${left} more ${left === 1 ? 'row' : 'rows'}, too long to draw here`] })
  return { rows: kept, cost: used, isCoarse: true, left }
}

export function drawRows({ Box, Text }: Pick<ElementTable, 'Box' | 'Text'>, rows: readonly Row[], budget = BUDGET) {
  const plan = planRows(rows, budget)
  return (
    <Box flexDirection="column">
      {plan.rows.map(row => (
        <Text wrap="truncate-end" {...row.look}>
          {row.runs.map(r => (typeof r === 'string' ? r : <Text {...r.look}>{r.t}</Text>))}
        </Text>
      ))}
    </Box>
  )
}
