import { expect, test } from 'claude-code/testing'

import { plain, textOf } from '../hooks/cells.ts'
import { NOTE_ROWS, handoffPaneGrid, noteRows } from '../hooks/handoffview.ts'
import { addShares, attributeRequest, contextWeights, emptyTokens } from '../hooks/tokens.ts'
import { tokensPaneGrid } from '../hooks/tokenview.ts'

test('a note as cells: headings bold without their hashes, code dim, list items wrapped under their text', () => {
  const rows = noteRows('# Goal\n\nShip it.\n\n```\nnpm test\n```\n- [ ] a long item that has to wrap onto a second line here', 30)
  expect(plain({ rows })).toEqual(['Goal', '', 'Ship it.', '', 'npm test', '- [ ] a long item that', '      has to wrap onto a', '      second line here'])
  expect(rows[0]![0]!.isBold).toBe(true)
  expect(rows[4]![0]!.isDim).toBe(true)
  // A very long note is capped, so the grid stays inside what a surface module may be handed.
  expect(noteRows('x\n'.repeat(1000), 30)).toHaveLength(NOTE_ROWS + 1)
})

test('the Handoff pane: with no note, a way to write one; with notes, where it is and the steps between them', () => {
  const empty = handoffPaneGrid({ files: [], index: 0, text: null, error: null, hasCommand: false }, 0, 60)
  expect(plain(empty)[0]).toMatch(/^No handoff note found in this project\. Press h to write one/)
  expect(textOf(empty, 'handoff')).toBe(' h: Write a handoff ')
  const files = [
    { path: '.claude/handoffs/new.md', mtimeMs: 0 },
    { path: '.claude/handoffs/old.md', mtimeMs: 0 },
  ]
  const g = handoffPaneGrid({ files, index: 0, text: '# New', error: null, hasCommand: true }, 3_600_000, 60)
  expect(plain(g)[0]).toMatch(/^ c: Continue from this   o: Older   r: Rescan /)
  expect(plain(g)[1]).toBe('.claude/handoffs/new.md · 1h ago · 1 of 2')
  expect(g.keys).toEqual({ c: 'handoff:continue', r: 'handoff:rescan', o: 'handoff:older' })
  expect(handoffPaneGrid({ files, index: 1, text: '# Old', error: null, hasCommand: true }, 0, 60).keys.n).toBe('handoff:newer')
})

test('the Tokens pane fits a narrow dock: each group’s numbers move to a line of their own', () => {
  let s = addShares(emptyTokens(0), [{ group: 'files', kind: 'Read', item: 'a.ts', tokens: 9_000 }])
  s = attributeRequest(s, contextWeights(s), { input_tokens: 0, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 0, output_tokens: 0 }, { answer: '', toolUses: [] })
  const wide = plain(tokensPaneGrid(s, 90))
  expect(wide).toContainEqual(expect.stringMatching(/^■ Files {15}90% {14}9k used · 9k in context · 0 calls$/))
  const narrow = plain(tokensPaneGrid(s, 44))
  expect(narrow).toContainEqual(expect.stringMatching(/^■ Files {15}90% {14}$/))
  expect(narrow).toContainEqual('  9k used · 9k in context · 0 calls')
  for (const l of narrow) expect(l.length).toBeLessThanOrEqual(44)
})
