import { expect, test } from 'claude-code/testing'

import type { CodeView, Place } from '../types'
import { rowsFromText } from '../hooks/code.ts'
import { parseDoc } from '../hooks/doc.ts'
import { boxRows, codeBox, codeRow, codeRows, hitAt, paneRows, replyRows, width, wrap } from '../hooks/layout.ts'
import type { Row } from '../hooks/layout.ts'

const text = (r: Row) => r.map(s => s.t).join('')

const REPLY = [
  '**Code reference:** /work/claude-mods',
  '',
  '## A prompt becomes a review',
  '',
  'Every prompt passes through [a prompt.submit hook](plugins/pr-review-ui/hooks/register.tsx:792-811) before the model sees it. The hook asks [reviewRequest](plugins/pr-review-ui/hooks/review.ts:42-54) whether the words add up to a review, attaches [the review format](plugins/pr-review-ui/hooks/review.ts:69-80) and [starts the worktree checkout](plugins/pr-review-ui/hooks/register.tsx:266-294).',
  '',
  '## Where the code shows',
  '',
  '[showCurrent](plugins/pr-review-ui/hooks/register.tsx:383-409) asks [pickView](plugins/pr-review-ui/hooks/view.ts:46-58).',
].join('\n')

const doc = parseDoc(REPLY, '/work/claude-mods')
if (!doc) throw new Error('the reply did not parse')

test('prose wraps at the width it is given, words whole, links keeping their number', () => {
  for (const w of [30, 51, 86]) {
    const rows = replyRows({ key: 'k', doc, current: 1, inline: null, cols: w }, w, null)
    for (const r of rows) expect(width(r)).toBeLessThanOrEqual(w)
  }
  const rows = wrap([{ t: 'Every prompt passes through ', k: 'text' }, { t: 'a prompt.submit hook', k: 'place', n: 1 }, { t: ' before', k: 'text' }], 30, null, null)
  expect(rows.map(text)).toEqual(['Every prompt passes through a', 'prompt.submit hook¹ before'])
  // The link's words keep its style across the break, and the click lands on it.
  expect(rows[1]?.[0]).toMatchObject({ t: 'prompt.submit hook', u: true, hit: 'place:1' })
  expect(rows[1]?.[1]).toMatchObject({ t: '¹', hit: 'place:1' })
})

test("a section's places are one row of boxes in order: the number in the top edge, file and lines inside", () => {
  const rows = boxRows([1, 2, 3, 4], doc.places, 86, 2, null)
  expect(rows.map(text)).toEqual([
    '╭─ 1 ──────────────────┬─ 2 ─────────────┬─ 3 ─────────────┬─ 4 ──────────────────╮',
    '│ register.tsx:792-811 │ review.ts:42-54 │ review.ts:69-80 │ register.tsx:266-294 │',
    '╰──────────────────────┴─────────────────┴─────────────────┴──────────────────────╯',
  ])
  // The shown place's walls and number take Claude's color; a click anywhere in a box picks it.
  const top = rows[0] ?? []
  expect(top.find(s => s.t === '2')).toMatchObject({ fg: 'claude', b: true })
  expect(hitAt(rows, 30, 1)).toBe('place:2')
  expect(hitAt(rows, 1, 2)).toBe('place:1')
  // Too narrow for one row: they wrap onto more, still in order.
  const narrow = boxRows([1, 2, 3, 4], doc.places, 50, null, null)
  expect(narrow.filter((_, i) => i % 3 === 1).map(text)).toEqual(['│ register.tsx:792-811 │ review.ts:42-54 │', '│ review.ts:69-80 │ register.tsx:266-294 │'])
})

test('the reply: a header line, the prose, a separator, the boxes, and the code under them when the pane is closed', () => {
  const rows = replyRows({ key: 'k', doc, current: 5, inline: null, cols: 88 }, 88, null).map(text)
  expect(rows[0]).toBe('● code-reference · claude-mods · 6 places in the code')
  expect(rows.some(r => r.startsWith('  ─────'))).toBe(true)
  expect(rows.filter(r => r.includes('╭─ 1')).length).toBe(1)
  expect(rows.filter(r => r.includes('╭─ 5')).length).toBe(1)
  const place = doc.places[4] as Place
  const view: CodeView = { kind: 'rows', rows: rowsFromText(Array.from({ length: 420 }, (_, i) => `line ${i + 1}`).join('\n')), above: 0, below: 0, note: 'local' }
  const withCode = replyRows({ key: 'k', doc, current: 5, inline: { place, view, tag: 'local' }, cols: 88 }, 88, null).map(text)
  const at = withCode.findIndex(r => r.includes('5  plugins/pr-review-ui/hooks/register.tsx:383-409'))
  expect(at).toBeGreaterThan(0)
  expect(withCode[at + 3]).toContain('▌383 line 383')
  expect(withCode.some(r => r.includes('open in pane · editor'))).toBe(true)
})

test('a code line: the mark on the place, the number, a + on a changed line, cut to fit', () => {
  const place: Place = { n: 1, path: 'a.ts', line: 2, endLine: 2, phrase: 'x' }
  expect(text(codeRow({ o: 2, n: 2, p: 2, k: ' ', s: 'const a = 1' }, place, 3, 20, false))).toBe('▌  2 const a = 1    ')
  expect(text(codeRow({ o: null, n: 3, p: 3, k: '+', s: 'return a + b + c + d' }, place, 3, 20, true))).toBe('   3 + return a + b…')
  expect(codeRow({ o: null, n: 3, p: 3, k: '+', s: 'x' }, place, 3, 20, true).at(-1)).toMatchObject({ bg: 'diffAdded' })
})

test('the pane: one header line, then code in every other row, the place a little below the top', () => {
  const place = doc.places[0] as Place
  const view: CodeView = { kind: 'rows', rows: rowsFromText(Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join('\n')).slice(671, 932), above: 671, below: 68, note: 'local' }
  const { rows } = paneRows({ place, view, tag: 'local', note: null, isPr: false, empty: '', cols: 66, rows: 40 }, 66, 40, 0)
  expect(rows).toHaveLength(40)
  expect(text(rows[0] ?? [])).toMatch(/^1 {2}….*\/hooks\/register\.tsx:792-811 +local {3}↑ ↓ {3}editor$/)
  expect(text(rows[1] ?? [])).toContain('786 line 786')
  expect(text(rows[7] ?? [])).toContain('▌792 line 792')
  const scrolled = paneRows({ place, view, tag: 'local', note: null, isPr: false, empty: '', cols: 66, rows: 40 }, 66, 40, 10).rows
  expect(text(scrolled[1] ?? [])).toContain('796 line 796')
  const failed = paneRows({ place, view, tag: 'PR #12', note: "The PR page didn't load in terminal-browser.", isPr: true, empty: '', cols: 66, rows: 40 }, 66, 40, 0).rows
  expect(text(failed[0] ?? [])).toContain('editor   github')
  expect(text(failed[1] ?? [])).toMatch(/^! The PR page didn't load in terminal-browser\. +retry$/)
  expect(hitAt(failed, 63, 1)).toBe('retry')
})

test('a long code line folds: the number on its first row only, the rest indented past its own indent', () => {
  const place: Place = { n: 1, path: 'a.md', line: 8, endLine: 8, phrase: 'x' }
  const line = { o: 8, n: 8, p: 8, k: ' ' as const, s: '  - Proposal under consideration: a dispatcher Lambda routes every update event to one execution' }
  const rows = codeRows(line, place, 2, 40, false).map(text)
  expect(rows).toEqual([
    '▌ 8   - Proposal under consideration: a ',
    '▌       dispatcher Lambda routes every  ',
    '▌       update event to one execution   ',
  ])
  // A word longer than a row breaks where the row ends; a short line is one row.
  expect(codeRows({ ...line, s: 'x'.repeat(50) }, null, 2, 30, false).map(text)).toEqual([`  8 ${'x'.repeat(26)}`, `      ${'x'.repeat(24)}`])
  expect(codeRows({ ...line, s: 'short' }, null, 2, 30, false)).toHaveLength(1)
  // An added line keeps its colour on every row it takes, its + on the first.
  const added = codeRows({ ...line, k: '+', n: 9, o: null, s: 'y '.repeat(30) }, null, 2, 30, true)
  expect(added.map(r => text(r).slice(0, 6))).toEqual(['  9 + ', '      ', '      '])
  for (const r of added) expect(r.at(-1)).toMatchObject({ bg: 'diffAdded' })
})

test('the pane folds long lines at every width: each row fits, the numbers count the file, the place stays in view', () => {
  const words = (i: number) => (i % 3 === 0 ? `line ${i} ${'word '.repeat(i % 7 === 0 ? 40 : 12)}` : `line ${i}`)
  const view: CodeView = { kind: 'rows', rows: rowsFromText(Array.from({ length: 120 }, (_, i) => words(i + 1)).join('\n')), above: 0, below: 0, note: 'local' }
  const place: Place = { n: 1, path: 'docs/a.md', line: 60, endLine: 64, phrase: 'x' }
  for (const w of [24, 40, 66, 120]) {
    const props = { place, view, tag: 'local', note: null, isPr: false, empty: '', cols: w, rows: 30 }
    const got = paneRows(props, w, 30, 0)
    expect(got.rows).toHaveLength(30)
    for (const r of got.rows) expect(width(r)).toBeLessThanOrEqual(w)
    const numbers = got.rows.slice(1).map(r => /^.\s*(\d+) /.exec(text(r))?.[1]).filter(Boolean).map(Number)
    for (let i = 1; i < numbers.length; i += 1) expect(numbers[i]).toBe((numbers[i - 1] ?? 0) + 1)
    expect(numbers).toContain(60)
    // The header keeps the place's lines, whatever gives way.
    expect(text(got.rows[0] ?? [])).toContain(':60-64')
    // Scrolled all the way down, the last line shows.
    const end = paneRows(props, w, 30, 10_000)
    expect(end.start).toBe(end.last)
    expect(end.rows.slice(1).some(r => /^.\s*120 /.test(text(r)))).toBe(true)
  }
})

test("the box under a section keeps the place in view when a long line above it folds", () => {
  const place: Place = { n: 1, path: 'README.md', line: 38, endLine: 41, phrase: 'x' }
  const lines = Array.from({ length: 60 }, (_, i) => (i + 1 === 36 ? `long ${'word '.repeat(120)}` : `line ${i + 1}`))
  const view: CodeView = { kind: 'rows', rows: rowsFromText(lines.join('\n')), above: 0, below: 0, note: 'local' }
  const rows = codeBox({ place, view, tag: 'local' }, 66).map(text)
  for (const n of [37, 38, 39, 40, 41]) expect(rows.some(r => new RegExp(`^│ .\\s*${n} line ${n}`).test(r))).toBe(true)
  expect(rows.some(r => r.includes('long word'))).toBe(false)
  for (const r of rows) expect(r.length).toBe(66)
})
