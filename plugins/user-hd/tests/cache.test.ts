import { expect, test } from 'claude-code/testing'

import {
  EMPTY_CACHE,
  afterRequest,
  fmtClock,
  fmtTokens,
  hitRate,
  learnsOneHour,
  level,
  pingSummary,
  remainingMs,
  shouldAlert,
  shouldAutoPing,
} from '../hooks/cache.ts'

const usage = (read: number, write: number, input = 10) => ({
  input_tokens: input,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
})

test('countdown math and formatting', () => {
  expect(remainingMs(null, '5m', 0)).toBe(null)
  expect(remainingMs(1_000, '5m', 1_000)).toBe(300_000)
  expect(remainingMs(0, '1h', 600_000)).toBe(3_000_000)
  expect(fmtClock(187_000)).toBe('3:07')
  expect(fmtClock(1)).toBe('0:01')
  expect(fmtClock(-5)).toBe('0:00')
  expect(fmtTokens(950)).toBe('950')
  expect(fmtTokens(182_400)).toBe('182k')
  expect(fmtTokens(1_250_000)).toBe('1.3M')
})

test('levels: live while working, cooling inside the warning window, cold after', () => {
  expect(level(null, 120_000, false)).toBe('none')
  expect(level(200_000, 120_000, true)).toBe('live')
  expect(level(200_000, 120_000, false)).toBe('warm')
  expect(level(120_000, 120_000, false)).toBe('cooling')
  expect(level(0, 120_000, false)).toBe('cold')
})

test('hit rate is the share of the prompt read from cache', () => {
  expect(hitRate(EMPTY_CACHE)).toBe(null)
  expect(hitRate({ inputTokens: 50, readTokens: 900, writeTokens: 50 })).toBe(90)
})

test('the alert fires once per cache stretch, only when idle and inside the window', () => {
  const c = { ...EMPTY_CACHE, lastHitAt: 1000 }
  expect(shouldAlert(c, 119_000, 120_000)).toBe(true)
  expect(shouldAlert(c, 121_000, 120_000)).toBe(false)
  expect(shouldAlert(c, -1, 120_000)).toBe(false)
  expect(shouldAlert({ ...c, isWorking: true }, 60_000, 120_000)).toBe(false)
  expect(shouldAlert({ ...c, alertedFor: 1000 }, 60_000, 120_000)).toBe(false)
  // a fresh request moves lastHitAt, which re-arms the alert
  expect(shouldAlert({ ...c, alertedFor: 1000, lastHitAt: 5000 }, 60_000, 120_000)).toBe(true)
})

test('auto keep-warm is off by default, capped, and waits for the last 30 seconds', () => {
  const c = { ...EMPTY_CACHE, lastHitAt: 1 }
  const on = { autoKeepWarm: true, maxAutoPings: 2, warnMs: 120_000 }
  expect(shouldAutoPing(c, 20_000, { ...on, autoKeepWarm: false })).toBe(false)
  expect(shouldAutoPing(c, 60_000, on)).toBe(false)
  expect(shouldAutoPing(c, 20_000, on)).toBe(true)
  expect(shouldAutoPing({ ...c, autoPings: 2 }, 20_000, on)).toBe(false)
  expect(shouldAutoPing({ ...c, isPinging: true }, 20_000, on)).toBe(false)
})

test('a cache hit after more than five idle minutes means a one-hour cache', () => {
  expect(learnsOneHour(6 * 60_000, 100_000, 90_000)).toBe(true)
  expect(learnsOneHour(4 * 60_000, 100_000, 90_000)).toBe(false)
  expect(learnsOneHour(6 * 60_000, 100_000, 0)).toBe(false)
  expect(learnsOneHour(70 * 60_000, 100_000, 90_000)).toBe(false)
})

test('a request that touched the cache resets the clock; one that did not leaves it', () => {
  const c = { ...EMPTY_CACHE, lastHitAt: 10, resetReason: 'compacted' }
  expect(afterRequest(c, 99, usage(500, 20), 'opus').lastHitAt).toBe(99)
  expect(afterRequest(c, 99, usage(500, 20), 'opus').resetReason).toBe(null)
  expect(afterRequest(c, 99, usage(0, 0), null).lastHitAt).toBe(10)
})

test('ping summaries', () => {
  expect(pingSummary(usage(180_000, 0))).toEqual({ line: 'Cache refreshed: read 180k tokens from the cache.', isWarm: true })
  expect(pingSummary(usage(0, 50_000)).line).toContain('re-wrote 50k')
  expect(pingSummary(usage(0, 0)).isWarm).toBe(false)
})

