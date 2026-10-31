import { expect, test } from 'claude-code/testing'

import { CALM_MS, RETRY_MS, nextRetry } from '../hooks/retry.ts'

test('a failed grid is tried again, later each time, and then left alone', () => {
  let last
  const waits = []
  for (let i = 0; i < RETRY_MS.length + 1; i++) {
    const r = nextRetry(last, 1000 + i)
    waits.push(r.wait)
    last = r.retries
  }
  expect(waits).toEqual([...RETRY_MS, null])
})

test('a grid that held for a while starts its tries over', () => {
  const first = nextRetry(undefined, 0)
  expect(nextRetry(first.retries, CALM_MS - 1).wait).toBe(RETRY_MS[1])
  expect(nextRetry(first.retries, CALM_MS).wait).toBe(RETRY_MS[0])
})
