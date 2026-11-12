import { expect, test } from 'claude-code/testing'

import { fileLinks, isCodeReference, parseDoc, parseRef, sourceOf } from '../hooks/doc.ts'
import type { Block } from '../hooks/doc.ts'

const ROOT = '/work/repo'

const REPLY = [
  `**Code reference:** ${ROOT}`,
  '',
  'pr-review-ui does its work at three moments.',
  '',
  '## A prompt becomes a review',
  '',
  'Every prompt passes through [a `prompt.submit` hook](hooks/register.tsx:792-811) before the model sees it.',
  'The hook asks [`reviewRequest`](hooks/review.ts:42-54) whether it is a review, and [the hook](hooks/register.tsx:792-811) again.',
  '',
  '## Reading the reply',
  '',
  '[The `turn.step` hook](hooks/register.tsx:814-818) checks the reply, then `hooks/review.ts:92` matches.',
  '',
  '- one [item](hooks/a.ts:1)',
  '- two, see [the docs](https://example.com/docs)',
  '',
  '```ts',
  'const x = [not a link](hooks/b.ts:2)',
  '```',
].join('\n')

const kinds = (blocks: readonly Block[]) => blocks.map(b => b.kind)

test('a reply is its header, its blocks, and the places it links to, numbered 1 to N in order', () => {
  expect(isCodeReference(REPLY)).toBe(true)
  expect(isCodeReference('Some reply\n**Code reference:** /x')).toBe(false)
  const doc = parseDoc(REPLY, '/elsewhere')
  expect(doc?.target).toBe(ROOT)
  expect(doc?.places.map(p => [p.n, p.path, p.line, p.endLine, p.phrase])).toEqual([
    [1, 'hooks/register.tsx', 792, 811, 'a prompt.submit hook'],
    [2, 'hooks/review.ts', 42, 54, 'reviewRequest'],
    [3, 'hooks/register.tsx', 814, 818, 'The turn.step hook'],
    [4, 'hooks/review.ts', 92, 92, 'hooks/review.ts:92'],
    [5, 'hooks/a.ts', 1, 1, 'item'],
  ])
  expect(kinds(doc?.blocks ?? [])).toEqual(['para', 'heading', 'para', 'places', 'heading', 'para', 'item', 'item', 'fence', 'places'])
  const rows = (doc?.blocks ?? []).filter(b => b.kind === 'places').map(b => (b.kind === 'places' ? b.ns : []))
  // A place named twice in one section keeps its number and its one box.
  expect(rows).toEqual([[1, 2], [3, 4, 5]])
})

test('links: places by path and lines, web pages as links out, code blocks left alone', () => {
  const doc = parseDoc(REPLY, ROOT)
  const runs = (doc?.blocks ?? []).flatMap(b => ('inl' in b ? b.inl : []))
  expect(runs.find(r => r.k === 'url')).toEqual({ t: 'the docs', k: 'url', href: 'https://example.com/docs' })
  expect(runs.filter(r => r.k === 'place').map(r => r.n)).toEqual([1, 2, 1, 3, 4, 5])
  const fence = doc?.blocks.find(b => b.kind === 'fence')
  expect(fence).toEqual({ kind: 'fence', lang: 'ts', lines: ['const x = [not a link](hooks/b.ts:2)'] })
})

test('with no headings each paragraph or list is a section of its own; a reply naming no place and with no header is not one', () => {
  const doc = parseDoc('First [a](a.ts:1) and [b](b.ts:2).\n\nThen [c](c.ts:3).\n\nNothing here.', ROOT)
  expect(kinds(doc?.blocks ?? [])).toEqual(['para', 'places', 'para', 'places', 'para'])
  expect(doc?.places.map(p => p.n)).toEqual([1, 2, 3])
  expect(doc?.target).toBe('')
  expect(parseDoc('Just prose, `a.ts` and `ratio 3:2`.', ROOT)).toBe(null)
  expect(parseDoc('The rows come from `fono_vat.go:44-46`.', ROOT)).toBe(null)
})

test('targets: ranges, #L anchors, whole files, absolute paths under the root', () => {
  expect(parseRef('src/a.ts:12-30', ROOT)).toEqual({ path: 'src/a.ts', line: 12, endLine: 30 })
  expect(parseRef('./src/a.ts:12', ROOT)).toEqual({ path: 'src/a.ts', line: 12, endLine: 12 })
  expect(parseRef('src/a.ts#L5-L9', ROOT)).toEqual({ path: 'src/a.ts', line: 5, endLine: 9 })
  expect(parseRef('src/a.ts', ROOT)).toEqual({ path: 'src/a.ts', line: 0, endLine: 0 })
  expect(parseRef('src/a.ts', ROOT, true)).toBe(null)
  // A backticked file name with no folder names no file: a session's folder can hold many.
  expect(parseRef('fono_vat.go:44-46', ROOT, true)).toBe(null)
  expect(parseRef('fono_vat.go:44-46', ROOT)).toEqual({ path: 'fono_vat.go', line: 44, endLine: 46 })
  expect(parseRef(`${ROOT}/src/a.ts:3`, ROOT)).toEqual({ path: 'src/a.ts', line: 3, endLine: 3 })
  expect(parseRef('/etc/hosts:3', ROOT)).toEqual({ path: '/etc/hosts', line: 3, endLine: 3 })
  expect(parseRef('https://github.com/a/b', ROOT)).toBe(null)
  expect(parseRef('ratio', ROOT)).toBe(null)
})

test('the header names a folder or a pull request', () => {
  expect(sourceOf('/work/repo/', '/x')).toEqual({ kind: 'local', root: '/work/repo' })
  expect(sourceOf('https://github.com/acme/billing/pull/12', '/x')).toEqual({ kind: 'pr', url: 'https://github.com/acme/billing/pull/12', repo: 'acme/billing', number: 12 })
  expect(sourceOf('', '/x')).toEqual({ kind: 'local', root: '/x' })
  expect(sourceOf('', '')).toBe(null)
})

test("a terminal's links to places are file URLs that open in the editor at the line", () => {
  const text = [
    'See [the retry loop](/work/repo/src/retry.ts:40-62), [the doc](docs/adr/0005-plan.md#L8-L23) and [the file](/tmp/scratch/a.md).',
    '[a page](https://example.com/x) and [a section](#usage) stay as they are.',
    '```md',
    '[not a link](/work/repo/src/b.ts:2)',
    '```',
  ].join('\n')
  expect(fileLinks(text, ROOT).split('\n')).toEqual([
    'See [the retry loop](file:///work/repo/src/retry.ts#40), [the doc](file:///work/repo/docs/adr/0005-plan.md#8) and [the file](file:///tmp/scratch/a.md).',
    '[a page](https://example.com/x) and [a section](#usage) stay as they are.',
    '```md',
    '[not a link](/work/repo/src/b.ts:2)',
    '```',
  ])
  // A relative path with no folder to resolve it against is left alone.
  expect(fileLinks('[x](src/a.ts:3)', '')).toBe('[x](src/a.ts:3)')
})
