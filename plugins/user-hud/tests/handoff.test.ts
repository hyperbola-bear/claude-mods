import { expect, test } from 'claude-code/testing'

import { handoffTarget, isHandoffName, newest } from '../hooks/handoff.ts'

test('handoff notes are found by name, newest first', () => {
  expect(isHandoffName('.', 'HANDOFF.md')).toBe(true)
  expect(isHandoffName('.', 'README.md')).toBe(false)
  expect(isHandoffName('.claude/handoffs', '2026-10-07.md')).toBe(true)
  expect(isHandoffName('.claude/handoffs', 'notes.txt')).toBe(false)
  expect(newest([{ path: 'a', mtimeMs: 1 }, { path: 'b', mtimeMs: 3 }, { path: 'a', mtimeMs: 1 }]).map(f => f.path)).toEqual(['b', 'a'])
  expect(handoffTarget(Date.UTC(2026, 9, 7, 6, 5))).toMatch(/^\.claude\/handoffs\/2026-10-07-\d{4}\.md$/)
})
