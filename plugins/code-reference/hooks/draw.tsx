// Rows of spans as Text: one Text per row, cut at the edge, never wrapped by
// the surface, so every surface shows the rows the mod laid out.
import type { ElementTable } from 'claude-code'

import type { Row } from './layout.ts'

export function drawRows({ Box, Text }: Pick<ElementTable, 'Box' | 'Text'>, rows: readonly Row[]) {
  return (
    <Box flexDirection="column">
      {rows.map((row, i) => (
        <Text key={`r${i}`} wrap="truncate-end">
          {row.length === 0
            ? ' '
            : row.map((s, j) => (
                <Text key={`s${j}`} color={s.fg} backgroundColor={s.bg} bold={s.b} dimColor={s.d} underline={s.u} italic={s.i}>
                  {s.t}
                </Text>
              ))}
        </Text>
      ))}
    </Box>
  )
}
