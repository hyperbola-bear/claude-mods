// Pure picker layout: every cell of the model and effort pickers in a style, and the cells each option
// covers, its action `pick:<kind>:<id>`.
import type { SelectorStyle } from '../types'
import { builder, pad, put, runs, widthOf } from './cells.ts'
import type { Grid, Run } from './cells.ts'
import { columnWidth, ladderCells, meterGlyph, spread } from './selector.ts'

/** One option as the grid draws it. */
export type GridOption = { id: string; label: string; colors: string[]; isOn: boolean }

export type GridKind = 'model' | 'effort'

/** A picker: its options, and `shorter` label sets for narrow widths, longest first, one label per option in order. */
export type GridField = { kind: GridKind; name: string; options: GridOption[]; shorter?: readonly (readonly string[])[] }

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

/** Rail and Meter: a row of labels and a row of bars, one column per step, a cell between, after `nameWidth` cells of name. */
function columns(f: GridField, set: readonly string[], nameWidth: number, width: number, isMeter: boolean): Grid {
  const w = columnWidth(width - nameWidth, f.options.length, set)
  const on = f.options.findIndex(o => o.isOn)
  const labels: Run[] = []
  const bars: Run[] = []
  const spans: Spans = []
  put(labels, pad(f.name, nameWidth), { isDim: true })
  put(bars, ' '.repeat(nameWidth))
  f.options.forEach((o, i) => {
    if (i > 0) {
      put(labels, ' ')
      put(bars, ' ')
    }
    const x0 = nameWidth + i * (w + 1)
    put(labels, center(set[i]!, w), { isBold: o.isOn })
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

const strips = (f: GridField) => f.options.map((o, i) => spread(o.colors, ladderCells(i, o.colors)))

/** The Ladder's widest step: its strip, a space, its label. */
const widestStep = (f: GridField) => Math.max(0, ...strips(f).map((cells, i) => cells.length + 1 + f.options[i]!.label.length))

/**
 * Ladder: before each label a strip a cell longer per step; full blocks when chosen, half blocks else. Wraps.
 * With no `indent`, the name takes a row of its own and the steps start at the left edge.
 */
function ladder(f: GridField, width: number, indent: number): Grid {
  const b = builder()
  const steps = strips(f)
  if (indent === 0) b.add(runs(f.name, { isDim: true }))
  let row: Run[] = []
  let spans: Spans = []
  if (indent > 0) put(row, pad(f.name, NAME_WIDTH), { isDim: true })
  let x = indent
  f.options.forEach((o, i) => {
    const cells = steps[i]!
    const span = cells.length + 1 + o.label.length
    if (x > indent && x + 1 + span > width) {
      b.add(row, spans)
      row = []
      spans = []
      put(row, ' '.repeat(indent))
      x = indent
    }
    if (x > indent) {
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

/** Whether equal columns, each at least the longest of `labels`, a cell between, fit `width`. */
function fits(labels: readonly string[], width: number): boolean {
  const longest = labels.reduce((m, l) => Math.max(m, l.length), 0)
  return labels.length * longest + (labels.length - 1) <= width
}

const fullLabels = (f: GridField) => f.options.map(o => o.label)

/**
 * How Rail and Meter draw at `width`: the names' column beside full labels where every field fits them; else no
 * names, and each field's longest label set that fits. Null where some field fits none: the Ladder draws instead.
 */
function columnPlan(width: number, fields: readonly GridField[]): { nameWidth: number; labels: (readonly string[])[] } | null {
  const full = fields.map(fullLabels)
  if (full.every(set => fits(set, width - NAME_WIDTH))) return { nameWidth: NAME_WIDTH, labels: full }
  const labels = fields.map(f => [fullLabels(f), ...(f.shorter ?? [])].find(set => fits(set, width)))
  return labels.every((set): set is readonly string[] => set !== undefined) ? { nameWidth: 0, labels } : null
}

/** The style drawn at `width`: where any field fits none of its label sets, Rail and Meter give way to the Ladder for every field. */
export function fittedStyle(style: SelectorStyle, width: number, fields: readonly GridField[]): SelectorStyle {
  return style !== 'ladder' && columnPlan(width, fields) === null ? 'ladder' : style
}

/** Every row and option of the pickers in `style`, `width` cells across; Rail and Meter as `columnPlan` fits them, the Ladder where it cannot. */
export function layout(props: PickerProps): Grid {
  const b = builder()
  const plan = props.style === 'ladder' ? null : columnPlan(props.width, props.fields)
  // Every field's Ladder keeps the names' column, or none does: too narrow for the widest step beside it.
  const indent = props.fields.every(f => NAME_WIDTH + widestStep(f) <= props.width) ? NAME_WIDTH : 0
  props.fields.forEach((f, i) =>
    b.append(plan ? columns(f, plan.labels[i]!, plan.nameWidth, props.width, props.style === 'meter') : ladder(f, props.width, indent)),
  )
  // Every row as wide as the region, so the grid is a clean rectangle on any surface.
  for (const row of b.grid.rows) put(row, ' '.repeat(Math.max(0, props.width - widthOf(row))))
  return b.grid
}
