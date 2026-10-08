// A grid of cells as a `Client`: the rows the hooks module laid out, painted the same on the terminal and the
// desktop, with no native buttons. A click runs the action under the pointer; while the grid has the focus
// its hotkeys run theirs, the arrow keys move along the actions and Return runs the one they rest on. Each
// action is posted to the hooks module, which carries it out.
import type { ClientModule } from 'claude-code'

import { hitAt, order, underlined } from './cells.ts'
import type { CellsProps } from './cells.ts'

type State = { pointed: string | null }

const Cells: ClientModule<CellsProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const pointed = surface.state?.pointed ?? null
  const point = (next: string | null) => {
    if (next !== pointed) surface.setState({ pointed: next })
  }

  surface.onPointer(e => {
    const action = e.type === 'leave' ? null : hitAt(props, e.x, e.y)
    if (e.type === 'down' && e.button === 'left' && action) surface.post({ action })
    else point(action)
  })
  surface.onKey(e => {
    const hotkey = props.keys[e.key]
    if (hotkey && !e.ctrl && !e.meta) return surface.post({ action: hotkey })
    const all = order(props)
    const i = pointed === null ? -1 : all.indexOf(pointed)
    if (e.key === 'right' || e.key === 'down' || e.key === 'tab') point(all[(i + 1) % all.length] ?? null)
    else if (e.key === 'left' || e.key === 'up') point(all[(i - 1 + all.length) % all.length] ?? null)
    else if (e.key === 'return' && pointed) surface.post({ action: pointed })
  })

  return (
    <Box flexDirection="column">
      {underlined(props, pointed).map((row, y) => (
        <Text key={`row-${y}`} wrap="truncate">
          {/* An empty row still takes its row: an empty Text has no height. */}
          {row.length === 0 ? ' ' : null}
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

export default Cells
