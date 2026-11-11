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
  const wide = plain(tokensPaneGrid(s, 90, []))
  expect(wide).toContainEqual(expect.stringMatching(/^▸ ■ Files {15}90% {14}9k used · 9k in context · 0 calls$/))
  const narrow = plain(tokensPaneGrid(s, 44, []))
  expect(narrow).toContainEqual(expect.stringMatching(/^▸ ■ Files {15}90% {14}$/))
  expect(narrow).toContainEqual('  9k used · 9k in context · 0 calls')
  for (const l of narrow) expect(l.length).toBeLessThanOrEqual(44)
})

test('the Tokens pane fits a side pane: names, bars and numbers shrink or wrap, none cut off', () => {
  let s = addShares(emptyTokens(0), [
    { group: 'files', kind: 'Read', item: 'a-very-long-file-name-for-the-pane.ts', tokens: 6_000 },
    { group: 'skills', kind: 'Skill', item: 'review', tokens: 3_000 },
  ])
  s = attributeRequest(s, contextWeights(s), { input_tokens: 0, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 0, output_tokens: 0 }, { answer: '', toolUses: [] })
  for (const width of [20, 24, 28, 31, 36, 40]) {
    const rows = plain(tokensPaneGrid(s, width, ['files']))
    for (const l of rows) expect(l.length, `${width}: ${l}`).toBeLessThanOrEqual(width)
    // The label is whole; its share follows on the same row, or on the next where the label fills the row.
    const at = rows.findIndex(l => l.startsWith('▸ ■ Skills'))
    expect(`${rows[at]} ${rows[at + 1]}`, `${width}`).toMatch(/^▸ ■ Skills & plugins +\d+%/)
    // The numbers wrap rather than end in an ellipsis.
    expect(rows.join(' '), `${width}`).toMatch(/0\s+calls/)
    expect(rows.filter(l => /used|in context|calls/.test(l)).some(l => l.endsWith('…')), `${width}`).toBe(false)
  }
  // From 28 cells a group's bar still draws, a few cells wide.
  const g = tokensPaneGrid(s, 28, [])
  const head = g.rows.find(r => r.map(x => x.text).join('').startsWith('▸ ■ Files'))!
  expect(head.filter(run => run.bg !== undefined).reduce((n, run) => n + run.text.length, 0)).toBeGreaterThanOrEqual(2)
})

test('the Tokens pane: a group opens to its sub-items, each with what it used, its share of the group and its context', () => {
  let s = addShares(emptyTokens(0), [
    { group: 'files', kind: 'Read', item: 'a.ts', tokens: 6_000 },
    { group: 'files', kind: 'Read', item: 'b.ts', tokens: 3_000 },
  ])
  s = attributeRequest(s, contextWeights(s), { input_tokens: 0, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 0, output_tokens: 0 }, { answer: '', toolUses: [] })
  const closed = tokensPaneGrid(s, 90, [])
  expect(textOf(closed, 'tokens:group:files')).toMatch(/^▸ ■ Files/)
  expect(plain(closed).some(l => /a\.ts/.test(l))).toBe(false)
  const open = tokensPaneGrid(s, 90, ['files'])
  expect(textOf(open, 'tokens:group:files')).toMatch(/^▾ ■ Files/)
  const rows = plain(open)
  const head = rows.findIndex(l => l.startsWith('▾ ■ Files'))
  expect(rows[head + 1]).toMatch(/^ {4}a\.ts +6k +67% +6k in context$/)
  expect(rows[head + 2]).toMatch(/^ {4}b\.ts +3k +33% +3k in context$/)
  for (const l of plain(tokensPaneGrid(s, 44, ['files']))) expect(l.length).toBeLessThanOrEqual(44)
})

test('the Handoff pane fits a side pane: no row wider than the pane, its buttons whole', () => {
  const files = [
    { path: '.claude/handoffs/2026-11-10-adaptive-panes.md', mtimeMs: 0 },
    { path: '.claude/handoffs/old.md', mtimeMs: 0 },
  ]
  for (const width of [20, 24, 28, 31, 40, 60]) {
    for (const g of [
      handoffPaneGrid({ files: [], index: 0, text: null, error: null, hasCommand: false }, 0, width),
      handoffPaneGrid({ files, index: 0, text: '# Goal\n\nShip the adaptive panes, then check them on the desktop.', error: null, hasCommand: true }, 3_600_000, width),
    ]) {
      for (const l of plain(g)) expect(l.length, `${width}: ${l}`).toBeLessThanOrEqual(width)
      for (const h of g.hits) expect(h.x1, `${width}: ${h.id}`).toBeLessThanOrEqual(width)
      for (const id of new Set(g.hits.map(h => h.id))) expect(textOf(g, id), `${width}: ${id}`).not.toMatch(/…$/)
    }
  }
})
