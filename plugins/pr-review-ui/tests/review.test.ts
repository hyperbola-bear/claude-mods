import { expect, test } from 'claude-code/testing'

import { clean, ghError } from '../hooks/gh.ts'
import { reviewContext, reviewRequest, blobUrl, diffSnippet, inDiff, linkify, looksLikeReview, parseDiff, parseFindings, parseRef, parseSource, parseSummary, prLineAnchor, refLabel, severityCounts, sourceSnippet, splitPath, trimHunk } from '../hooks/review.ts'

const REVIEW = [
  '**PR review:** https://github.com/acme/billing/pull/12',
  '',
  '### [1] high · `infra/iam.tf:42-44` — PassRole scoped wrong',
  'Body one, see `infra/firehose.tf:17`.',
  '```hcl',
  'resource "x" { a = `not/a.ref:9` }',
  '```',
  '### [2] nit · src/app.ts:7 — Name',
  'Body two.',
  '### [3] banana · `x.ts:1` — not a severity',
  '### Summary',
  'Done.',
].join('\n')

test('the review header and findings parse; unknown severities are dropped', () => {
  expect(looksLikeReview(REVIEW)).toBe(true)
  expect(looksLikeReview('### [1] high · `a.ts:1` — no header')).toBe(false)
  expect(parseSource(REVIEW)).toEqual({ kind: 'pr', url: 'https://github.com/acme/billing/pull/12', repo: 'acme/billing', number: 12 })
  expect(parseSource('**Local review:** /Users/polar/code/svc')).toEqual({ kind: 'local', root: '/Users/polar/code/svc' })
  const f = parseFindings(REVIEW)
  expect(f.map(x => [x.n, x.severity, x.path, x.line, x.endLine, x.title])).toEqual([
    [1, 'high', 'infra/iam.tf', 42, 44, 'PassRole scoped wrong'],
    [2, 'nit', 'src/app.ts', 7, 7, 'Name'],
  ])
  expect(f[0]?.body).toContain('Body one')
  expect(f[1]?.body).toBe('Body two.')
})

test('code locations: the heading first, then each ref its body names, never ones in code blocks', () => {
  const f = parseFindings(REVIEW)
  expect(f[0]?.sections.map(refLabel)).toEqual(['infra/iam.tf:42-44', 'infra/firehose.tf:17'])
  expect(f[1]?.sections.map(refLabel)).toEqual(['src/app.ts:7'])
  const repeat = parseFindings('**PR review:** https://github.com/o/r/pull/1\n### [1] low · `a.ts:3` — t\nSee `a.ts:3` and `b.ts:9-10`, then `b.ts:9-10` again.')
  expect(repeat[0]?.sections.map(refLabel)).toEqual(['a.ts:3', 'b.ts:9-10'])
})

test('summary, severity counts and folder splitting', () => {
  expect(parseSummary(REVIEW)).toBe('Done.')
  expect(parseSummary('no summary here')).toBe('')
  expect(severityCounts(parseFindings(REVIEW))).toBe('1 high · 1 nit')
  expect(splitPath('infra/modules/iam.tf')).toEqual({ dir: 'infra/modules/', file: 'iam.tf' })
  expect(splitPath('Makefile')).toEqual({ dir: '', file: 'Makefile' })
})

test('GitHub URLs: the Files tab when the diff shows the lines, the file at the head otherwise', async () => {
  const files = parseDiff(DIFF)
  expect(inDiff(files, { path: 'f.ts', line: 12, endLine: 13 })).toBe(true)
  expect(inDiff(files, { path: 'f.ts', line: 30, endLine: 30 })).toBe(false)
  expect(inDiff(files, { path: 'x.ts', line: 1, endLine: 1 })).toBe(false)
  expect(await prLineAnchor('https://github.com/o/r/pull/9', { path: 'f.ts', line: 12, endLine: 13 })).toMatch(/^https:\/\/github\.com\/o\/r\/pull\/9\/files#diff-[0-9a-f]{64}R12-R13$/)
  expect(blobUrl('https://ghe.acme.io/o/r/pull/9', 'o/r', 'abc', { path: 'dir/a b.ts', line: 4, endLine: 4 })).toBe('https://ghe.acme.io/o/r/blob/abc/dir/a%20b.ts#L4')
  expect(blobUrl('https://github.com/o/r/pull/9', 'o/r', 'abc', { path: 'a.ts', line: 4, endLine: 6 })).toBe('https://github.com/o/r/blob/abc/a.ts#L4-L6')
})

test('refs: ranges, ./ prefixes, and plain prose left alone', () => {
  expect(parseRef('`./a/b.go:10-12`')).toEqual({ path: 'a/b.go', line: 10, endLine: 12 })
  expect(parseRef('`Makefile.am:3`')).toEqual({ path: 'Makefile.am', line: 3, endLine: 3 })
  expect(parseRef('ratio 3:2')).toBe(null)
})

test('linkify turns backticked refs into links, outside code fences only', () => {
  const { text, hrefs } = linkify(REVIEW, r => `https://x/${r.path}#L${r.line}`)
  expect(text).toContain('[infra/iam.tf:42-44](https://x/infra/iam.tf#L42)')
  expect(text).toContain('[infra/firehose.tf:17](https://x/infra/firehose.tf#L17)')
  expect(text).toContain('`not/a.ref:9`')
  expect(text).toContain('### [2] nit · src/app.ts:7') // not backticked: left as written
  expect(hrefs.get('https://x/infra/firehose.tf#L17')).toEqual({ path: 'infra/firehose.tf', line: 17, endLine: 17 })
})

const DIFF = [
  'diff --git a/f.ts b/f.ts',
  '--- a/f.ts',
  '+++ b/f.ts',
  '@@ -10,5 +10,6 @@',
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

test('diff hunks parse by new path, and trimming keeps a valid header', () => {
  const files = parseDiff(DIFF)
  expect([...files.keys()]).toEqual(['f.ts'])
  const h = files.get('f.ts')?.[0]
  expect(h).toBeTruthy()
  if (!h) return
  expect(trimHunk(h, 12, 13)).toBe('@@ -12,1 +12,2 @@\n-c\n+C\n+D')
  expect(trimHunk(h, 99, 100)).toBe(null)
  expect(diffSnippet(files, { path: 'f.ts', line: 12, endLine: 12 })?.kind).toBe('diff')
  expect(diffSnippet(files, { path: 'f.ts', line: 40, endLine: 40 })).toBe(null)
  expect(diffSnippet(files, { path: 'other.ts', line: 1, endLine: 1 })).toBe(null)
})

test('source windows are numbered from their first line', () => {
  const text = Array.from({ length: 30 }, (_, i) => `l${i + 1}`).join('\n')
  const s = sourceSnippet(text, { path: 'a.ts', line: 20, endLine: 21 }, 'head')
  expect(s.kind === 'source' && s.startLine).toBe(14)
  expect(s.kind === 'source' && s.code.split('\n')).toEqual(['l14', 'l15', 'l16', 'l17', 'l18', 'l19', 'l20', 'l21', 'l22', 'l23', 'l24', 'l25', 'l26', 'l27'])
  expect(sourceSnippet(text, { path: 'a.ts', line: 99, endLine: 99 }, 'head').kind).toBe('error')
})

test('gh output is cleaned and its failures read as one line', () => {
  expect(clean('Fix \u001b[31mIAM\u001b[0m\u0007 role')).toBe('Fix [31mIAM[0m role')
  expect(ghError('To get started with GitHub CLI, please run:  gh auth login', 4)).toContain('gh auth login')
  expect(ghError('', 2)).toBe('gh exited with 2')
  expect(ghError('GraphQL: Could not resolve to a PullRequest\nmore', 1)).toBe('GraphQL: Could not resolve to a PullRequest')
})

test('a prompt that says review and holds a PR link asks for a review of that PR', () => {
  expect(reviewRequest('review https://github.com/acme/billing/pull/12')).toBe('https://github.com/acme/billing/pull/12')
  expect(reviewRequest('can you Review this? https://github.com/acme/billing/pull/12/files#diff-1')).toBe('https://github.com/acme/billing/pull/12')
  expect(reviewRequest('reviewing https://ghe.acme.io/pay/api/pull/7 now')).toBe('https://ghe.acme.io/pay/api/pull/7')
  expect(reviewRequest('what does https://github.com/acme/billing/pull/12 change?')).toBe(null)
  expect(reviewRequest('review https://github.com/acme/billing/issues/12')).toBe(null)
  expect(reviewRequest('/pr-review-ui:pr-review https://github.com/acme/billing/pull/12')).toBe(null)
  const ctx = reviewContext('https://github.com/acme/billing/pull/12')
  expect(ctx).toContain('pr-review-ui:pr-review')
  expect(ctx).toContain('### [1] high')
  expect(ctx).toContain('`**PR review:** https://github.com/acme/billing/pull/12`')
})
