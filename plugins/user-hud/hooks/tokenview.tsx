// The token views: the stacked bar the panel's TOKENS row shows, and the Tokens pane, group by group.
// Bars are coloured Boxes, labels and numbers plain text: each group's colour marks it, never its words.
import type { GroupId, TokenState } from '../types'
import type { Ui } from './ui.ts'
import { apiLine, apiTotal, detailLine, fmt, groupOf, pct, ranked, stack, standingLine, totalUsed } from './tokens.ts'

/** A run of `cells` cells in a colour: a Box, so it fills the same width on every surface. */
function run(ui: Ui, key: string, cells: number, color: string) {
  const { Box, Text } = ui
  return (
    <Box key={key} width={cells} height={1} backgroundColor={color} flexShrink={0} overflow="hidden">
      <Text>{' '.repeat(cells)}</Text>
    </Box>
  )
}

/** Every group's share of the tokens used, in one bar `cells` wide, in the groups' fixed order. */
export function stackedBar(ui: Ui, key: string, s: TokenState, cells: number) {
  const { Box } = ui
  return (
    <Box key={key} flexDirection="row" width={cells} height={1} flexShrink={0}>
      {stack(s, cells).map(seg => run(ui, `${key}-${seg.id}`, seg.cells, groupOf(seg.id).color))}
    </Box>
  )
}

const SHARE_CELLS = 12
/** Below this many columns a group's numbers go on a line of their own. */
const WIDE_COLUMNS = 76

function groupRows(ui: Ui, s: TokenState, id: GroupId, share: number, width: number) {
  const { Box, Text } = ui
  const g = s.groups[id]
  const on = Math.round(share * SHARE_CELLS)
  const detail = detailLine(s, id)
  const numbers = (
    <Text key={`numbers-${id}`} wrap="truncate">
      {fmt(g.used)} used · {fmt(g.inContext)} in context · {g.calls} calls
    </Text>
  )
  const isWide = width >= WIDE_COLUMNS
  return (
    <Box key={`group-${id}`} flexDirection="column">
      <Box flexDirection="row" columnGap={1}>
        <Box width={19} flexShrink={0}>
          <Text wrap="truncate">
            <Text color={groupOf(id).color}>■</Text> <Text bold>{groupOf(id).label}</Text>
          </Text>
        </Box>
        <Box width={5} flexShrink={0} justifyContent="flex-end">
          <Text>{pct(share)}</Text>
        </Box>
        <Box flexDirection="row" width={SHARE_CELLS} flexShrink={0}>
          {on > 0 && run(ui, `share-${id}`, on, groupOf(id).color)}
          {on < SHARE_CELLS && run(ui, `rest-${id}`, SHARE_CELLS - on, 'subtle')}
        </Box>
        {isWide && numbers}
      </Box>
      {!isWide && <Box paddingLeft={2}>{numbers}</Box>}
      {detail && (
        <Box paddingLeft={2}>
          <Text dimColor wrap="truncate">
            {detail}
          </Text>
        </Box>
      )}
    </Box>
  )
}

export type TokenActions = { refresh: () => void; reset: () => void }

export function tokenPane(ui: Ui, s: TokenState, width: number, act: TokenActions) {
  const { Box, Text, Button } = ui
  const groups = ranked(s)
  const standing = standingLine(s)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        <Button key="refresh" label="Refresh" hotkey="r" dimColor onPress={act.refresh} />
        <Button key="reset" label="Reset" hotkey="x" dimColor onPress={act.reset} />
      </Box>
      {totalUsed(s) <= 0 ? (
        <Text dimColor wrap="wrap">
          No tokens counted yet: the next request starts the tally.
        </Text>
      ) : (
        <Box flexDirection="column">
          <Text wrap="wrap">{apiLine(s)}</Text>
          {s.agents.requests + s.plugins.requests > 0 && (
            <Text dimColor wrap="wrap">
              Of those: subagents {fmt(apiTotal(s.agents))} ({s.agents.requests} requests) · plugin model calls {fmt(apiTotal(s.plugins))} ({s.plugins.requests})
            </Text>
          )}
          <Box marginY={1}>{stackedBar(ui, 'pane-bar', s, Math.max(10, Math.min(width, 100)))}</Box>
          {groups.map(g => groupRows(ui, s, g.id, g.share, width))}
        </Box>
      )}
      {standing && (
        <Box marginTop={1}>
          <Text dimColor wrap="wrap">
            {standing}
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor wrap="wrap">
          used: real API tokens; each request's input is split by what each group held in the context when it went out, its output by what was written (the rest is thinking). in context and the breakdowns are estimates at about 4 characters a token.
        </Text>
      </Box>
    </Box>
  )
}
