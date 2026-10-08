// The model and effort pickers in the three styles. Each is drawn from coloured Box and Text and plain
// Buttons alone, one tree for every surface: the colour, the bars and the gaps between the steps are the
// plugin's own, so the terminal and the desktop draw the same picture.
import type { BoxProps, ButtonProps, ElementConstructor, TextProps } from 'claude-code'

import type { SelectorStyle } from '../types'
import { columnWidth, ladderCells, meterGlyph, spread } from './selector.ts'

export type Ui = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
}

export type PickerOption = {
  /** The Button's key (`model-opus`); the bars beside it are keyed from it. */
  key: string
  label: string
  /** One colour, or several to spread across the option's bar. */
  colors: readonly string[]
  isOn: boolean
  onPress: () => void
}

/**
 * One row of `glyph` in `color`, as wide as its Box: written twice as long and clipped, so a proportional
 * font, whose glyphs may be narrower than a cell, still fills it.
 */
function glyphRun(ui: Ui, key: string, glyph: string, color: string, width: number, isDim: boolean) {
  const { Box, Text } = ui
  return (
    <Box key={key} flexGrow={1} height={1} overflow="hidden">
      <Text color={color} dimColor={isDim}>
        {glyph.repeat(Math.max(1, width) * 2)}
      </Text>
    </Box>
  )
}

/** A bar `width` cells wide whose colours are spread across it in equal runs: filled, it is solid; else a line of `glyph`. */
function bar(ui: Ui, key: string, o: PickerOption, width: number, look: { glyph: string; isFilled: boolean; isDim: boolean }) {
  const { Box } = ui
  const runs = Math.min(o.colors.length, width)
  const colors = spread(o.colors, runs)
  return (
    <Box key={key} flexDirection="row" width={width} height={1} overflow="hidden">
      {colors.map((c, j) =>
        look.isFilled ? (
          <Box key={`${key}-${j}`} flexGrow={1} height={1} backgroundColor={c} />
        ) : (
          glyphRun(ui, `${key}-${j}`, look.glyph, c, Math.ceil(width / runs), look.isDim)
        ),
      )}
    </Box>
  )
}

function label(ui: Ui, o: PickerOption, width: number) {
  const { Box, Button } = ui
  return (
    <Box key={`lbl-${o.key}`} width={width} justifyContent="center">
      <Button key={o.key} plain label={o.label} onPress={o.onPress} />
    </Box>
  )
}

/**
 * Rail: the labels over a segmented bar, one segment per step and a one-cell gap between them; the
 * chosen step's segment is solid, the others a thin line in their own colour, so the whole ramp shows.
 */
function rail(ui: Ui, options: readonly PickerOption[], width: number) {
  const { Box } = ui
  const w = columnWidth(width, options.length, options.map(o => o.label))
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={1}>
        {options.map(o => label(ui, o, w))}
      </Box>
      <Box flexDirection="row" columnGap={1}>
        {options.map(o => bar(ui, `rail-${o.key}`, o, w, { glyph: '▔', isFilled: o.isOn, isDim: false }))}
      </Box>
    </Box>
  )
}

/**
 * Meter: a bar over each label that rises step by step, like a signal meter; every step up to the
 * chosen one is lit in its colours, the ones past it dim.
 */
function meter(ui: Ui, options: readonly PickerOption[], width: number) {
  const { Box } = ui
  const w = columnWidth(width, options.length, options.map(o => o.label))
  const on = options.findIndex(o => o.isOn)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={1} alignItems="flex-end">
        {options.map((o, i) => bar(ui, `meter-${o.key}`, o, w, { glyph: meterGlyph(i, options.length), isFilled: false, isDim: on === -1 || i > on }))}
      </Box>
      <Box flexDirection="row" columnGap={1}>
        {options.map(o => label(ui, o, w))}
      </Box>
    </Box>
  )
}

/**
 * Ladder: one row; before each label a strip that grows a cell per step up, in the step's colours; the
 * chosen step's strip is full blocks, the others half ones.
 */
function ladder(ui: Ui, options: readonly PickerOption[]) {
  const { Box, Text, Button } = ui
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      {options.map((o, i) => {
        const cells = spread(o.colors, ladderCells(i, o.colors))
        return (
          <Box key={`step-${o.key}`} flexDirection="row" columnGap={1} flexShrink={0}>
            <Text>
              {cells.map((c, j) => (
                <Text key={`ladder-${o.key}-${j}`} color={c} bold={o.isOn}>
                  {o.isOn ? '█' : '▄'}
                </Text>
              ))}
            </Text>
            <Button key={o.key} plain label={o.label} onPress={o.onPress} />
          </Box>
        )
      })}
    </Box>
  )
}

/** Whether a two-row style's columns fit `width`: each at least its label, a one-cell gap between. */
const fitsColumns = (width: number, labels: readonly string[]) =>
  labels.length * labels.reduce((m, l) => Math.max(m, l.length), 0) + (labels.length - 1) <= width

/**
 * The style the pickers are drawn in at `width`: where any picker's columns do not fit, Rail and Meter
 * fall back to the Ladder, which wraps, for every picker at once so they stay alike.
 */
export const styleAt = (style: SelectorStyle, width: number, labelSets: readonly (readonly string[])[]): SelectorStyle =>
  style !== 'ladder' && labelSets.some(labels => !fitsColumns(width, labels)) ? 'ladder' : style

/** Rows the Ladder wraps to at `width`: each step its strip, a space and its label, one cell between steps. */
export function ladderRows(width: number, options: readonly PickerOption[]): number {
  let rows = 1
  let used = 0
  options.forEach((o, i) => {
    const w = ladderCells(i, o.colors) + 1 + o.label.length
    if (used > 0 && used + 1 + w > width) {
      rows += 1
      used = w
    } else {
      used += (used > 0 ? 1 : 0) + w
    }
  })
  return rows
}

/** Rows a picker takes in a style at `width`: a bar and a row of labels, or the Ladder's, which may wrap. */
export const pickerRows = (style: SelectorStyle, width: number, options: readonly PickerOption[]) =>
  style === 'ladder' ? ladderRows(width, options) : 2

/** Draws one picker in `style`, already fitted to `width` by `styleAt`. */
export function picker(ui: Ui, style: SelectorStyle, options: readonly PickerOption[], width: number) {
  if (style === 'rail') return rail(ui, options, width)
  if (style === 'meter') return meter(ui, options, width)
  return ladder(ui, options)
}

/** A label in one colour per letter, spread from `colors`: the effort's own ramp, the rainbow for Ultracode. */
export function tinted(ui: Ui, key: string, text: string, colors: readonly string[]) {
  const { Text } = ui
  const letters = [...text]
  const cs = spread(colors, letters.length)
  return (
    <Text key={key}>
      {letters.map((ch, i) => (
        <Text key={`${key}-${i}`} color={cs[i]}>
          {ch}
        </Text>
      ))}
    </Text>
  )
}
