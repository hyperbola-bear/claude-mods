// Pure picker layout: every cell of the model and effort pickers in a style, and the cells each option
// covers, its action `pick:<kind>:<id>`.
import type { SelectorStyle } from '../types'
import { builder, pad, put, widthOf } from './cells.ts'
import type { Grid, Run } from './cells.ts'
import { columnWidth, ladderCells, meterGlyph, spread } from './selector.ts'

/** One option as the grid draws it. */
export type GridOption = { id: string; label: string; colors: string[]; isOn: boolean }

export type GridKind = 'model' | 'effort'

export type GridField = { kind: GridKind; name: string; options: GridOption[] }

export type PickerProps = { style: SelectorStyle; width: number; fields: GridField[] }

/** The column the field names sit in. */
export const NAME_WIDTH = 8

export const pickAction = (kind: GridKind, id: string) => `pick:${kind}:${id}`

/** `pick:model:opus` → model, opus; anything else → null. */
export function parsePick(action: string): { kind: GridKind; id: string } | null {
  const m = /^pick:(model|effort):(.+)$/.exec(action)
  return m ? { kind: m[1] as GridKind, id: m[2]! } : null
}

function center(s: string, n: number): string {
  const left = Math.floor((n - s.length) / 2)
  return pad(' '.repeat(Math.max(0, left)) + s, n)
}

/** One cell per colour stop spread across `width`, in `glyph`, or solid when `isFilled`. */
function bar(row: Run[], o: GridOption, width: number, glyph: string, isFilled: boolean, isDim: boolean) {
  for (const c of spread(o.colors, width)) {
    if (isFilled) put(row, ' ', { bg: c })
    else put(row, glyph, { color: c, isDim })
  }
}

type Spans = { action: string; x0: number; x1: number }[]

/** Rail and Meter: a row of labels and a row of bars, one column per step, a cell between. */
function columns(f: GridField, width: number, isMeter: boolean): Grid {
  const w = columnWidth(width - NAME_WIDTH, f.options.length, f.options.map(o => o.label))
  const on = f.options.findIndex(o => o.isOn)
  const labels: Run[] = []
  const bars: Run[] = []
  const spans: Spans = []
  put(labels, pad(f.name, NAME_WIDTH), { isDim: true })
  put(bars, ' '.repeat(NAME_WIDTH))
  f.options.forEach((o, i) => {
    if (i > 0) {
      put(labels, ' ')
      put(bars, ' ')
    }
    const x0 = NAME_WIDTH + i * (w + 1)
    put(labels, center(o.label, w), { isBold: o.isOn })
    // Rail: the chosen segment solid, the others a thin line. Meter: bars rising, lit up to the chosen step.
    if (isMeter) bar(bars, o, w, meterGlyph(i, f.options.length), false, on === -1 || i > on)
    else bar(bars, o, w, '▔', o.isOn, false)
    spans.push({ action: pickAction(f.kind, o.id), x0, x1: x0 + w })
  })
  const b = builder()
  // The Meter's bars stand over its labels; the Rail's bar runs under them.
  b.add(isMeter ? bars : labels, spans)
  b.add(isMeter ? labels : bars, spans)
  return b.grid
}

/** Ladder: before each label a strip a cell longer per step; full blocks when chosen, half blocks else. Wraps. */
function ladder(f: GridField, width: number): Grid {
  const b = builder()
  let row: Run[] = []
  let spans: Spans = []
  put(row, pad(f.name, NAME_WIDTH), { isDim: true })
  let x = NAME_WIDTH
  f.options.forEach((o, i) => {
    const cells = spread(o.colors, ladderCells(i, o.colors))
    const span = cells.length + 1 + o.label.length
    if (x > NAME_WIDTH && x + 1 + span > width) {
      b.add(row, spans)
      row = []
      spans = []
      put(row, ' '.repeat(NAME_WIDTH))
      x = NAME_WIDTH
    }
    if (x > NAME_WIDTH) {
      put(row, ' ')
      x += 1
    }
    for (const c of cells) put(row, o.isOn ? '█' : '▄', { color: c })
    put(row, ' ')
    put(row, o.label, { isBold: o.isOn })
    spans.push({ action: pickAction(f.kind, o.id), x0: x, x1: x + span })
    x += span
  })
  b.add(row, spans)
  return b.grid
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
export function layout(props: PickerProps): Grid {
  const b = builder()
  for (const f of props.fields) b.append(props.style === 'ladder' ? ladder(f, props.width) : columns(f, props.width, props.style === 'meter'))
  // Every row as wide as the region, so the grid is a clean rectangle on any surface.
  for (const row of b.grid.rows) put(row, ' '.repeat(Math.max(0, props.width - widthOf(row))))
  return b.grid
}
