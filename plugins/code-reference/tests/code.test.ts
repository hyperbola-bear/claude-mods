import { expect, test } from 'claude-code/testing'

import { blobUrl, changeNote, changedRanges, hunkRows, inDiff, parseDiff, prLineAnchor, refLabel, rowsFromHunks, rowsFromText, windowRows } from '../hooks/code.ts'
import { clean, ghError } from '../hooks/gh.ts'
import { isTarget } from '../hooks/layout.ts'

const DIFF = [
  'diff --git a/f.ts b/f.ts',
  '--- a/f.ts',
  '+++ b/f.ts',
  '@@ -10,6 +10,7 @@',
  ' a',
  ' b',
  '-c',
  '+C',
  '+D',
  ' e',
  ' f',
  'diff --git a/gone.ts b/gone.ts',
  '--- a/gone.ts',
  '+++ /dev/null',
  '@@ -1,1 +0,0 @@',
  '-x',
].join('\n')

test('diff hunks parse by new path; a removed line that starts with dashes stays a line', () => {
  expect([...parseDiff(DIFF).keys()]).toEqual(['f.ts'])
  const odd = parseDiff(['diff --git a/n.md b/n.md', '--- a/n.md', '+++ b/n.md', '@@ -1,2 +1,2 @@', '--- a rule', '+++ a heading', ' same'].join('\n'))
  expect(odd.get('n.md')?.[0]?.lines).toEqual(['--- a rule', '+++ a heading', ' same'])
})

test('code rows number both sides, place removed lines, and mark the changed words', () => {
  const rows = rowsFromHunks(parseDiff(DIFF).get('f.ts') ?? [])
  expect(rows.map(r => [r.o, r.n, r.p, r.k, r.s])).toEqual([
    [10, 10, 10, ' ', 'a'],
    [11, 11, 11, ' ', 'b'],
    [12, null, 12, '-', 'c'],
    [null, 12, 12, '+', 'C'],
    [null, 13, 13, '+', 'D'],
    [13, 14, 14, ' ', 'e'],
    [14, 15, 15, ' ', 'f'],
  ])
  expect(rows.filter(r => isTarget(r, { n: 1, path: 'f.ts', line: 12, endLine: 12, phrase: '' })).map(r => r.s)).toEqual(['c', 'C'])
  expect(changedRanges('  return this.send(batch, n)', '  return this.send(failed, n)')).toEqual([[19, 24], [19, 25]])
  expect(changedRanges('abc', 'xyz')).toBe(null)
  expect(changeNote(rows, false)).toBe('uncommitted edits')
  expect(changeNote(rows, true)).toBe('changed in the PR')
  expect(changeNote(rowsFromText('a\nb'), false)).toBe('local')
})

test('a window holds the lines around a place, a whole-file place from the top, and counts what it leaves out', () => {
  const rows = rowsFromText(Array.from({ length: 40 }, (_, i) => `l${i + 1}`).join('\n'))
  const win = windowRows(rows, { path: 'a.ts', line: 20, endLine: 21 }, 5)
  expect(win.rows.map(r => r.n)).toEqual([15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26])
  expect([win.above, win.below]).toEqual([14, 14])
  expect(windowRows(rows, { path: 'a.ts', line: 20, endLine: 21 }, 5, 10).rows[0]?.n).toBe(5)
  expect(windowRows(rows, { path: 'a.ts', line: 0, endLine: 0 }, 5).rows.map(r => r.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  expect(windowRows(rows, { path: 'a.ts', line: 99, endLine: 99 }, 5).rows).toEqual([])
  const files = parseDiff(DIFF)
  expect(hunkRows(files, { path: 'f.ts', line: 12, endLine: 12 })?.length).toBe(7)
  expect(hunkRows(files, { path: 'f.ts', line: 40, endLine: 40 })).toBe(null)
  expect(inDiff(files, { path: 'f.ts', line: 12, endLine: 13 })).toBe(true)
  expect(refLabel({ path: 'f.ts', line: 0, endLine: 0 })).toBe('f.ts')
})

test("GitHub's addresses: the Files tab anchor, or the file at the head", async () => {
  expect(await prLineAnchor('https://github.com/a/b/pull/1', { path: 'f.ts', line: 12, endLine: 13 })).toMatch(/^https:\/\/github\.com\/a\/b\/pull\/1\/files#diff-[0-9a-f]{64}R12-R13$/)
  expect(blobUrl('https://github.com/a/b/pull/1', 'a/b', 'abc', { path: 'd i/f.ts', line: 3, endLine: 3 })).toBe('https://github.com/a/b/blob/abc/d%20i/f.ts#L3')
})

test('gh output is cleaned and its failures read as one line', () => {
  expect(clean('Fix \u001b[31mIAM\u001b[0m\u0007 role')).toBe('Fix [31mIAM[0m role')
  expect(ghError('To get started with GitHub CLI, please run:  gh auth login', 4)).toContain('gh auth login')
  expect(ghError('', 2)).toBe('gh exited with 2')
})
