// The pickers as a `Client`: one grid of cells, painted from the layout, the same on the terminal and the
// desktop. No native buttons: a click picks the option under the pointer, the arrow keys move along the
// options and Return picks; each pick is posted to the hooks module, which runs /model or /effort.
import type { ClientModule } from 'claude-code'

import { hitAt, layout, order } from './selectorgrid.ts'
import type { GridProps, Pointed } from './selectorgrid.ts'

type State = { pointed: Pointed }

const samePointed = (a: Pointed, b: Pointed) => (a === null ? b === null : b !== null && a.kind === b.kind && a.id === b.id)

const SelectorGrid: ClientModule<GridProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const pointed = surface.state?.pointed ?? null
  const grid = layout(props, pointed)
  const point = (next: Pointed) => {
    if (!samePointed(next, pointed)) surface.setState({ pointed: next })
  }

  surface.onPointer(e => {
    const hit = e.type === 'leave' ? null : hitAt(grid, e.x, e.y)
    if (e.type === 'down' && e.button === 'left' && hit) surface.post({ kind: hit.kind, id: hit.id })
    else point(hit)
  })
  surface.onKey(e => {
    const all = order(grid)
    const i = all.findIndex(o => samePointed(o, pointed))
    if (e.key === 'right' || e.key === 'down' || e.key === 'tab') point(all[(i + 1) % all.length] ?? null)
    else if (e.key === 'left' || e.key === 'up') point(all[(i - 1 + all.length) % all.length] ?? null)
    else if (e.key === 'return' && pointed) surface.post({ kind: pointed.kind, id: pointed.id })
  })

  return (
    <Box flexDirection="column">
      {grid.rows.map((row, y) => (
        <Text key={`row-${y}`} wrap="truncate">
          {row.map((run, i) => (
            <Text
              key={`run-${y}-${i}`}
              color={run.color || undefined}
              backgroundColor={run.bg || undefined}
              dimColor={run.isDim}
              bold={run.isBold}
              underline={run.isUnderline}
            >
              {run.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  )
}

export default SelectorGrid
