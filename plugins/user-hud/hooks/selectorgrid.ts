// Pure picker layout: every cell of the model and effort pickers, worked out here, so a `Client` paints
// the same grid on the terminal and the desktop and a pointer lands on the option under it.
import type { SelectorStyle } from '../types'
import { columnWidth, ladderCells, meterGlyph, spread } from './selector.ts'

/** One option as the grid draws it: plain data, so it crosses into the surface module. */
export type GridOption = { id: string; label: string; colors: string[]; isOn: boolean }

export type GridKind = 'model' | 'effort'

export type GridField = { kind: GridKind; name: string; options: GridOption[] }

/** What the band hands the surface module: the style, the region's width in cells, and the fields. */
export type GridProps = { style: SelectorStyle; width: number; fields: GridField[] }

/** A run of cells in one look. */
export type Run = { text: string; color: string; bg: string; isDim: boolean; isBold: boolean; isUnderline: boolean }

/** Where an option sits: its row, and its cells from `x0` up to, not including, `x1`. */
export type Hit = { kind: GridKind; id: string; y: number; x0: number; x1: number }

export type Grid = { rows: Run[][]; hits: Hit[] }

export type Pointed = { kind: GridKind; id: string } | null

/** The column the field names sit in. */
export const NAME_WIDTH = 8

const PLAIN: Omit<Run, 'text'> = { color: '', bg: '', isDim: false, isBold: false, isUnderline: false }

/** Adds cells to a row, merging a cell into the run before it when they look alike. */
function put(row: Run[], text: string, look: Partial<Omit<Run, 'text'>> = {}) {
  if (text === '') return
  const run = { ...PLAIN, ...look, text }
  const last = row.at(-1)
  if (last && last.color === run.color && last.bg === run.bg && last.isDim === run.isDim && last.isBold === run.isBold && last.isUnderline === run.isUnderline) {
    last.text += text
  } else {
    row.push(run)
  }
}

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length))

function center(s: string, n: number): string {
  const left = Math.floor((n - s.length) / 2)
  return pad(' '.repeat(Math.max(0, left)) + s, n)
}

const isPointed = (o: GridOption, kind: GridKind, at: Pointed) => at !== null && at.kind === kind && at.id === o.id

/** A label's look: bold when chosen, underlined under the pointer or the keys. */
const labelLook = (o: GridOption, kind: GridKind, at: Pointed) => ({ isBold: o.isOn, isUnderline: isPointed(o, kind, at) })

/** One cell per colour stop spread across `width`, in `glyph`, or solid when `isFilled`. */
function bar(row: Run[], o: GridOption, width: number, glyph: string, isFilled: boolean, isDim: boolean) {
  for (const c of spread(o.colors, width)) {
    if (isFilled) put(row, ' ', { bg: c })
    else put(row, glyph, { color: c, isDim })
  }
}

/** Rail: labels over a segmented bar; the chosen segment solid, the others a thin line in their colours. */
function rail(f: GridField, width: number, y0: number, at: Pointed): Grid {
  const w = columnWidth(width - NAME_WIDTH, f.options.length, f.options.map(o => o.label))
  const labels: Run[] = []
  const bars: Run[] = []
  const hits: Hit[] = []
  put(labels, pad(f.name, NAME_WIDTH), { isDim: true })
  put(bars, ' '.repeat(NAME_WIDTH))
  f.options.forEach((o, i) => {
    if (i > 0) {
      put(labels, ' ')
      put(bars, ' ')
    }
    const x0 = NAME_WIDTH + i * (w + 1)
    put(labels, center(o.label, w), labelLook(o, f.kind, at))
    bar(bars, o, w, '▔', o.isOn, false)
    hits.push({ kind: f.kind, id: o.id, y: y0, x0, x1: x0 + w }, { kind: f.kind, id: o.id, y: y0 + 1, x0, x1: x0 + w })
  })
  return { rows: [labels, bars], hits }
}

/** Meter: bars that rise step by step over the labels, lit up to the chosen step, dim past it. */
function meter(f: GridField, width: number, y0: number, at: Pointed): Grid {
  const w = columnWidth(width - NAME_WIDTH, f.options.length, f.options.map(o => o.label))
  const on = f.options.findIndex(o => o.isOn)
  const bars: Run[] = []
  const labels: Run[] = []
  const hits: Hit[] = []
  put(bars, ' '.repeat(NAME_WIDTH))
  put(labels, pad(f.name, NAME_WIDTH), { isDim: true })
  f.options.forEach((o, i) => {
    if (i > 0) {
      put(bars, ' ')
      put(labels, ' ')
    }
    const x0 = NAME_WIDTH + i * (w + 1)
    bar(bars, o, w, meterGlyph(i, f.options.length), false, on === -1 || i > on)
    put(labels, center(o.label, w), labelLook(o, f.kind, at))
    hits.push({ kind: f.kind, id: o.id, y: y0, x0, x1: x0 + w }, { kind: f.kind, id: o.id, y: y0 + 1, x0, x1: x0 + w })
  })
  return { rows: [bars, labels], hits }
}

/** Ladder: before each label a strip a cell longer per step; full blocks when chosen, half blocks else. Wraps. */
function ladder(f: GridField, width: number, y0: number, at: Pointed): Grid {
  const rows: Run[][] = [[]]
  const hits: Hit[] = []
  put(rows[0]!, pad(f.name, NAME_WIDTH), { isDim: true })
  let x = NAME_WIDTH
  f.options.forEach((o, i) => {
    const cells = spread(o.colors, ladderCells(i, o.colors))
    const span = cells.length + 1 + o.label.length
    if (x > NAME_WIDTH && x + 1 + span > width) {
      rows.push([])
      put(rows.at(-1)!, ' '.repeat(NAME_WIDTH))
      x = NAME_WIDTH
    }
    const row = rows.at(-1)!
    if (x > NAME_WIDTH) {
      put(row, ' ')
      x += 1
    }
    for (const c of cells) put(row, o.isOn ? '█' : '▄', { color: c })
    put(row, ' ')
    put(row, o.label, labelLook(o, f.kind, at))
    hits.push({ kind: f.kind, id: o.id, y: y0 + rows.length - 1, x0: x, x1: x + span })
    x += span
  })
  return { rows, hits }
}

/** Whether Rail's and Meter's columns fit `width`: each at least its longest label, a cell between. */
export function fitsColumns(width: number, labels: readonly string[]): boolean {
  const longest = labels.reduce((m, l) => Math.max(m, l.length), 0)
  return labels.length * longest + (labels.length - 1) <= width - NAME_WIDTH
}

/** The style drawn at `width`: where any field's columns do not fit, Rail and Meter give way to the Ladder for every field. */
export function fittedStyle(style: SelectorStyle, width: number, fields: readonly GridField[]): SelectorStyle {
  return style !== 'ladder' && fields.some(f => !fitsColumns(width, f.options.map(o => o.label))) ? 'ladder' : style
}

/** Every row and option of the pickers in `style` (already fitted), `width` cells across. */
export function layout(props: GridProps, at: Pointed = null): Grid {
  const draw = props.style === 'rail' ? rail : props.style === 'meter' ? meter : ladder
  const rows: Run[][] = []
  const hits: Hit[] = []
  for (const f of props.fields) {
    const g = draw(f, props.width, rows.length, at)
    rows.push(...g.rows)
    hits.push(...g.hits)
  }
  return { rows, hits }
}

/** The option at a cell, or null. */
export const hitAt = (g: Grid, x: number, y: number): Pointed => {
  const h = g.hits.find(hit => hit.y === y && x >= hit.x0 && x < hit.x1)
  return h ? { kind: h.kind, id: h.id } : null
}

/** The options in reading order, once each, for the arrow keys. */
export function order(g: Grid): { kind: GridKind; id: string }[] {
  const seen = new Set<string>()
  return g.hits
    .filter(h => (seen.has(`${h.kind}:${h.id}`) ? false : (seen.add(`${h.kind}:${h.id}`), true)))
    .map(h => ({ kind: h.kind, id: h.id }))
}

/** The rows as plain text, for the tests and for a surface with no colour. */
export const plain = (g: Grid) => g.rows.map(r => r.map(run => run.text).join(''))
