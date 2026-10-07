import { expect, test } from 'claude-code/testing'

import { clean, ghError } from '../hooks/gh.ts'
import {
  blobUrl,
  changedRanges,
  fitLine,
  hunkRows,
  inDiff,
  isTarget,
  linkify,
  looksLikeReview,
  parseDiff,
  parseFindings,
  parseHead,
  parsePlan,
  parseRef,
  parseSource,
  parseSummary,
  prLineAnchor,
  refLabel,
  reviewContext,
  reviewRequest,
  rowsFromHunks,
  slashReview,
  rowsFromText,
  severityCounts,
  splitHeading,
  splitPath,
  suggestionRows,
  verdictTone,
  windowRows,
} from '../hooks/review.ts'

/** A review as 1.1.0 asked for it: no area, prose bodies. It still parses. */
const OLD = [
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

/** A review in the standard format. */
const NEW = [
  '**PR review:** https://github.com/acme/billing-worker/pull/418',
  '',
  '**Verdict:** changes requested · Stream billing events to S3 through Firehose',
  '',
  'Moves billing events to Firehose. The IAM changes stop the first deploy (1, 2).',
  '',
  '### [1] high · correctness · `infra/iam.tf:42-44` — CreateRole pattern misses the Firehose role',
  '',
  '- **Problem:** The pattern matches `billing-worker`, but the role is `billing-pipe-role`',
  '  (`infra/firehose.tf:13-14`).',
  '- **Impact:** The first apply stops with AccessDenied.',
  '- **Fix:** Match the stack prefix:',
  '',
  '```diff',
  '-      "arn:aws:iam::${var.account_id}:role/*billing-worker*",',
  '+      "arn:aws:iam::${var.account_id}:role/billing-*",',
  '```',
  '',
  '### [2] medium · reliability · `src/sink/firehose.ts:37-39` — `close()` drops the buffer',
  '',
  '- **Problem:** `close()` never flushes (`src/index.ts:11-15`).',
  '- **Impact:** Each deploy loses events.',
  '- **Fix:** Flush first.',
  '',
  'Also worth a test.',
  '',
  '### Summary',
  '',
  '**Before merge:** 1 · **Before production traffic:** 2',
  '',
  'Not ready to merge: the IAM gap stops the first deploy.',
].join('\n')

test('the review header and findings parse; unknown severities are dropped', () => {
  expect(looksLikeReview(OLD)).toBe(true)
  expect(looksLikeReview('### [1] high · `a.ts:1` — no header')).toBe(false)
  expect(parseSource(OLD)).toEqual({ kind: 'pr', url: 'https://github.com/acme/billing/pull/12', repo: 'acme/billing', number: 12 })
  expect(parseSource('**Local review:** /Users/polar/code/svc')).toEqual({ kind: 'local', root: '/Users/polar/code/svc' })
  const f = parseFindings(OLD)
  expect(f.map(x => [x.n, x.severity, x.area, x.path, x.line, x.endLine, x.title])).toEqual([
    [1, 'high', '', 'infra/iam.tf', 42, 44, 'PassRole scoped wrong'],
    [2, 'nit', '', 'src/app.ts', 7, 7, 'Name'],
  ])
  expect(f[0]?.fields).toBe(null)
  expect(f[0]?.rest).toContain('Body one')
  expect(f[0]?.rest).toContain('```hcl')
  expect(f[1]?.body).toBe('Body two.')
})

test('the standard format: area, Problem, Impact and Fix, the suggested change, and the rest', () => {
  const [one, two] = parseFindings(NEW)
  expect([one?.n, one?.severity, one?.area, one?.title]).toEqual([1, 'high', 'correctness', 'CreateRole pattern misses the Firehose role'])
  expect(one?.fields).toEqual({
    problem: 'The pattern matches `billing-worker`, but the role is `billing-pipe-role` (`infra/firehose.tf:13-14`).',
    impact: 'The first apply stops with AccessDenied.',
    fix: 'Match the stack prefix:',
  })
  expect(one?.suggestion).toEqual(['-      "arn:aws:iam::${var.account_id}:role/*billing-worker*",', '+      "arn:aws:iam::${var.account_id}:role/billing-*",'])
  expect(one?.rest).toBe('')
  expect(one?.sections.map(refLabel)).toEqual(['infra/iam.tf:42-44', 'infra/firehose.tf:13-14'])
  expect([two?.area, two?.title, two?.rest]).toEqual(['reliability', '`close()` drops the buffer', 'Also worth a test.'])
  expect(two?.suggestion).toEqual([])
})

test('a heading splits into area, location and title in either order', () => {
  expect(splitHeading(' · security · `a/b.ts:3` — Title here')).toEqual({ ref: { path: 'a/b.ts', line: 3, endLine: 3 }, area: 'security', title: 'Title here' })
  expect(splitHeading(' · `a/b.ts:3-4` — Title')).toEqual({ ref: { path: 'a/b.ts', line: 3, endLine: 4 }, area: '', title: 'Title' })
  expect(splitHeading(' — A title first `a/b.ts:3`')).toEqual({ ref: { path: 'a/b.ts', line: 3, endLine: 3 }, area: '', title: 'A title first' })
  expect(splitHeading(' no ref at all').ref).toBe(null)
})

test('the head: verdict, title, lead, merge plan and closing words', () => {
  const head = parseHead(NEW)
  expect(head.verdict).toBe('changes requested')
  expect(head.title).toBe('Stream billing events to S3 through Firehose')
  expect(head.intro).toBe('Moves billing events to Firehose. The IAM changes stop the first deploy (1, 2).')
  expect(head.plan).toEqual([
    { label: 'Before merge', points: [1] },
    { label: 'Before production traffic', points: [2] },
  ])
  expect(head.closing).toBe('Not ready to merge: the IAM gap stops the first deploy.')
  expect(parseHead(OLD)).toEqual({ verdict: '', title: '', intro: '', plan: [], closing: 'Done.' })
  expect(parsePlan('**Any time:** 3, 4 and 5').plan).toEqual([{ label: 'Any time', points: [3, 4, 5] }])
  expect(verdictTone('changes requested')).toBe('bad')
  expect(verdictTone('ready after nits')).toBe('warn')
  expect(verdictTone('ready to merge')).toBe('good')
})

test('code locations: the heading first, then each ref its body names, never ones in code blocks', () => {
  const f = parseFindings(OLD)
  expect(f[0]?.sections.map(refLabel)).toEqual(['infra/iam.tf:42-44', 'infra/firehose.tf:17'])
  expect(f[1]?.sections.map(refLabel)).toEqual(['src/app.ts:7'])
  const repeat = parseFindings('**PR review:** https://github.com/o/r/pull/1\n### [1] low · `a.ts:3` — t\nSee `a.ts:3` and `b.ts:9-10`, then `b.ts:9-10` again.')
  expect(repeat[0]?.sections.map(refLabel)).toEqual(['a.ts:3', 'b.ts:9-10'])
})

test('summary, severity counts and folder splitting', () => {
  expect(parseSummary(OLD)).toBe('Done.')
  expect(parseSummary('no summary here')).toBe('')
  expect(severityCounts(parseFindings(OLD))).toBe('1 high · 1 nit')
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
  const { text, hrefs } = linkify(OLD, r => `https://x/${r.path}#L${r.line}`)
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

test('diff hunks parse by new path; a removed line that starts with dashes stays a line', () => {
  const files = parseDiff(DIFF)
  expect([...files.keys()]).toEqual(['f.ts'])
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
  expect(rows.filter(r => isTarget(r, { path: 'f.ts', line: 12, endLine: 12 })).map(r => r.s)).toEqual(['c', 'C'])
  expect(changedRanges('  return this.send(batch, n)', '  return this.send(failed, n)')).toEqual([[19, 24], [19, 25]])
  expect(changedRanges('abc', 'xyz')).toBe(null)
  const sug = suggestionRows(['-a = "old"', '+a = "new"', ' b'])
  expect(sug.map(r => [r.k, r.s, r.hot])).toEqual([
    ['-', 'a = "old"', [5, 8]],
    ['+', 'a = "new"', [5, 8]],
    [' ', 'b', undefined],
  ])
})

test('a code line fits its columns: tabs as two spaces, cut with an ellipsis, the changed words kept apart', () => {
  expect(fitLine('\treturn x', undefined, 0)).toEqual(['  return x', '', ''])
  expect(fitLine('abcdefghij', [2, 5], 0)).toEqual(['ab', 'cde', 'fghij'])
  expect(fitLine('abcdefghij', [2, 5], 6)).toEqual(['ab', 'cde…', ''])
  expect(fitLine('abcdefghij', [2, 5], 4)).toEqual(['ab', 'c…', ''])
  expect(fitLine('abcdefghij', undefined, 5)).toEqual(['abcd…', '', ''])
})

test('a window shows the lines around a reference and counts what it hides', () => {
  const rows = rowsFromText(Array.from({ length: 40 }, (_, i) => `l${i + 1}`).join('\n'))
  const win = windowRows(rows, { path: 'a.ts', line: 20, endLine: 21 })
  expect(win.rows.map(r => r.n)).toEqual([15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26])
  expect([win.above, win.below]).toEqual([14, 14])
  const more = windowRows(rows, { path: 'a.ts', line: 20, endLine: 21 }, 5, { up: 10, down: 0 })
  expect([more.rows[0]?.n, more.above]).toEqual([5, 4])
  expect(windowRows(rows, { path: 'a.ts', line: 99, endLine: 99 }).rows).toEqual([])
  const files = parseDiff(DIFF)
  expect(hunkRows(files, { path: 'f.ts', line: 12, endLine: 12 })?.length).toBe(7)
  expect(hunkRows(files, { path: 'f.ts', line: 40, endLine: 40 })).toBe(null)
})

test('gh output is cleaned and its failures read as one line', () => {
  expect(clean('Fix \u001b[31mIAM\u001b[0m\u0007 role')).toBe('Fix [31mIAM[0m role')
  expect(ghError('To get started with GitHub CLI, please run:  gh auth login', 4)).toContain('gh auth login')
  expect(ghError('', 2)).toBe('gh exited with 2')
  expect(ghError('GraphQL: Could not resolve to a PullRequest\nmore', 1)).toBe('GraphQL: Could not resolve to a PullRequest')
})

test('what a typed prompt asks to review: a PR link with review, a link alone, or review pr', () => {
  const url = (u: string) => ({ kind: 'url', url: u })
  expect(reviewRequest('review https://github.com/acme/billing/pull/12')).toEqual(url('https://github.com/acme/billing/pull/12'))
  expect(reviewRequest('can you Review this? https://github.com/acme/billing/pull/12/files#diff-1')).toEqual(url('https://github.com/acme/billing/pull/12'))
  expect(reviewRequest('reviewing https://ghe.acme.io/pay/api/pull/7 now')).toEqual(url('https://ghe.acme.io/pay/api/pull/7'))
  expect(reviewRequest('  https://github.com/acme/billing/pull/12  ')).toEqual(url('https://github.com/acme/billing/pull/12'))
  expect(reviewRequest('look over https://github.com/acme/billing/pull/12')).toEqual(url('https://github.com/acme/billing/pull/12'))
  expect(reviewRequest('review pr')).toEqual({ kind: 'branch' })
  expect(reviewRequest('please review this PR')).toEqual({ kind: 'branch' })
  expect(reviewRequest('PR review please')).toEqual({ kind: 'branch' })
  expect(reviewRequest('review pr 418')).toEqual({ kind: 'number', number: 418 })
  expect(reviewRequest('review PR #418')).toEqual({ kind: 'number', number: 418 })
  expect(reviewRequest('review #418')).toEqual({ kind: 'number', number: 418 })
  expect(reviewRequest('what does https://github.com/acme/billing/pull/12 change?')).toBe(null)
  expect(reviewRequest('review https://github.com/acme/billing/issues/12')).toBe(null)
  expect(reviewRequest('review the prices page')).toBe(null)
  expect(reviewRequest('/pr-review-ui:pr-review https://github.com/acme/billing/pull/12')).toBe(null)
  expect(reviewRequest('! gh pr view 12 # review')).toBe(null)
  expect(slashReview('/pr-review-ui:pr-review https://github.com/acme/billing/pull/12')).toEqual(url('https://github.com/acme/billing/pull/12'))
  expect(slashReview('/pr-review-ui:pr-review 12')).toEqual({ kind: 'number', number: 12 })
  expect(slashReview('/pr-review-ui:pr-review')).toEqual({ kind: 'local' })
  expect(slashReview('/point 2')).toBe(null)
  const ctx = reviewContext('https://github.com/acme/billing/pull/12', '/home/p/.cache/pr-review-ui/review/acme-billing-12-abc1234')
  expect(ctx).toContain('pr-review-ui:pr-review')
  expect(ctx).toContain('### [1] high · correctness')
  expect(ctx).toContain('**Problem:**')
  expect(ctx).toContain('`**PR review:** https://github.com/acme/billing/pull/12`')
  expect(ctx).toContain('/home/p/.cache/pr-review-ui/review/acme-billing-12-abc1234')
  expect(reviewContext('https://github.com/acme/billing/pull/12')).not.toContain('checked out')
})
