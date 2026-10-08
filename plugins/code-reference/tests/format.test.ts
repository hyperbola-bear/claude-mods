import { expect, test } from 'claude-code/testing'

import { explainContext, mentionsCommand, parseCommand, reviewContext, reviewRequest, rewritePrompt } from '../hooks/format.ts'

test('what /code-reference asks for: the last reply, a place, a review, or a question', () => {
  expect(parseCommand('/code-reference')).toEqual({ kind: 'last' })
  expect(parseCommand('  /code-reference  ')).toEqual({ kind: 'last' })
  expect(parseCommand('/code-reference 7')).toEqual({ kind: 'pick', n: 7 })
  expect(parseCommand('/code-reference https://github.com/acme/billing/pull/12')).toEqual({ kind: 'review', url: 'https://github.com/acme/billing/pull/12' })
  expect(parseCommand('/code-reference review this PR https://github.com/acme/billing/pull/12')).toEqual({ kind: 'review', url: 'https://github.com/acme/billing/pull/12' })
  expect(parseCommand('/code-reference how does x work with y')).toEqual({ kind: 'ask', question: 'how does x work with y' })
  expect(parseCommand('/code-reference:code-reference why')).toEqual({ kind: 'ask', question: 'why' })
  expect(parseCommand('/code-references')).toBe(null)
  expect(parseCommand('explain x, use /code-reference')).toBe(null)
  expect(mentionsCommand('explain how x works with y and use /code-reference')).toBe(true)
  expect(mentionsCommand('(/code-reference) explain x')).toBe(true)
  expect(mentionsCommand('/code-reference x')).toBe(false)
  expect(mentionsCommand('see docs/code-reference.md')).toBe(false)
})

test('the format the model is handed: the header, sections, every place linked, no severity', () => {
  const ctx = explainContext('/work/repo')
  expect(ctx).toContain('`**Code reference:** /work/repo`')
  expect(ctx).toContain('`[the retry loop](src/worker/retry.ts:40-62)`')
  expect(ctx).toContain('No severity tags')
  const review = reviewContext('https://github.com/acme/billing/pull/12', '/home/p/.cache/code-reference/review/acme-billing-12-abc1234')
  expect(review).toContain('`**Code reference:** https://github.com/acme/billing/pull/12`')
  expect(review).toContain('whether it is ready to merge')
  expect(review).toContain('/home/p/.cache/code-reference/review/acme-billing-12-abc1234')
  expect(review).not.toMatch(/high|medium|\[1\]/)
  expect(reviewContext('https://github.com/acme/billing/pull/12')).not.toContain('checked out')
  expect(rewritePrompt('/work/repo')).toContain('**Code reference:** /work/repo')
})

test('what a typed prompt asks to review: a PR link with review, a link alone, or review pr', () => {
  const url = (u: string) => ({ kind: 'url', url: u })
  expect(reviewRequest('review https://github.com/acme/billing/pull/12')).toEqual(url('https://github.com/acme/billing/pull/12'))
  expect(reviewRequest('can you Review this? https://github.com/acme/billing/pull/12/files#diff-1')).toEqual(url('https://github.com/acme/billing/pull/12'))
  expect(reviewRequest('  https://github.com/acme/billing/pull/12  ')).toEqual(url('https://github.com/acme/billing/pull/12'))
  expect(reviewRequest('look over https://github.com/acme/billing/pull/12')).toEqual(url('https://github.com/acme/billing/pull/12'))
  expect(reviewRequest('review pr')).toEqual({ kind: 'branch' })
  expect(reviewRequest('PR review please')).toEqual({ kind: 'branch' })
  expect(reviewRequest('review pr 418')).toEqual({ kind: 'number', number: 418 })
  expect(reviewRequest('review #418')).toEqual({ kind: 'number', number: 418 })
  expect(reviewRequest('what does https://github.com/acme/billing/pull/12 change?')).toBe(null)
  expect(reviewRequest('review the prices page')).toBe(null)
  expect(reviewRequest('/code-reference https://github.com/acme/billing/pull/12')).toBe(null)
  expect(reviewRequest('! gh pr view 12 # review')).toBe(null)
})
