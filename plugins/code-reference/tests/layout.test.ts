import { expect, test } from 'claude-code/testing'

import type { CodeView, Place } from '../types'
import { rowsFromText } from '../hooks/code.ts'
import { parseDoc } from '../hooks/doc.ts'
import { boxRows, codeRow, hitAt, paneRows, replyRows, width, wrap } from '../hooks/layout.ts'
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
