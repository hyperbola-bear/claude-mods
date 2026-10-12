import { expect, test } from 'claude-code/testing'

import { explainContext, parseCommand, reviewContext, reviewText, rewritePrompt } from '../hooks/format.ts'

test('what /code-reference asks for: the last reply, a place, a review, or a question', () => {
  expect(parseCommand('/code-reference')).toEqual({ kind: 'last' })
  expect(parseCommand('  /code-reference  ')).toEqual({ kind: 'last' })
  expect(parseCommand('/code-reference 7')).toEqual({ kind: 'pick', n: 7 })
  expect(parseCommand('/code-reference https://github.com/acme/billing/pull/12')).toEqual({ kind: 'review', target: { kind: 'url', url: 'https://github.com/acme/billing/pull/12' } })
  expect(parseCommand('/code-reference review this PR https://github.com/acme/billing/pull/12')).toEqual({ kind: 'review', target: { kind: 'url', url: 'https://github.com/acme/billing/pull/12' } })
  expect(parseCommand('/code-reference how does x work with y')).toEqual({ kind: 'ask', question: 'how does x work with y' })
  expect(parseCommand('/code-reference:code-reference why')).toEqual({ kind: 'ask', question: 'why' })
  expect(parseCommand('/code-references')).toBe(null)
  expect(parseCommand('explain x, use /code-reference')).toBe(null)
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

test('a review asked with the command: a PR link, review with a number, or review alone for this branch', () => {
  const review = (text: string) => parseCommand(`/code-reference ${text}`)
  expect(review('review')).toEqual({ kind: 'review', target: { kind: 'branch' } })
  expect(review('review this branch')).toEqual({ kind: 'review', target: { kind: 'branch' } })
  expect(review('review pr')).toEqual({ kind: 'review', target: { kind: 'branch' } })
  expect(review('review 418')).toEqual({ kind: 'review', target: { kind: 'number', number: 418 } })
  expect(review('review #418')).toEqual({ kind: 'review', target: { kind: 'number', number: 418 } })
  expect(review('Review PR 418.')).toEqual({ kind: 'review', target: { kind: 'number', number: 418 } })
  // Anything more is a question about code, not a review.
  expect(review('review the retry logic')).toEqual({ kind: 'ask', question: 'review the retry logic' })
  expect(reviewText({ kind: 'url', url: 'https://github.com/acme/billing/pull/12' })).toBe('Review https://github.com/acme/billing/pull/12')
  expect(reviewText({ kind: 'number', number: 418 })).toBe('Review pull request #418')
  expect(reviewText({ kind: 'branch' })).toBe("Review this branch's pull request")
})

test('no words in a prompt ask: only a prompt that starts with the command is read', () => {
  for (const typed of [
    'review https://github.com/acme/billing/pull/12',
    'https://github.com/acme/billing/pull/12',
    'review pr 418',
    'explain how x works with y and use /code-reference',
  ]) expect(parseCommand(typed)).toBe(null)
})
