import { expect, test } from 'claude-code/testing'

import type { Role } from '../types'
import { widthOf } from '../hooks/cells.ts'
import { CHARS, PAL, roleOf, spriteRows } from '../hooks/sprites.ts'

const ROLES: Role[] = ['explorer', 'developer', 'architect', 'researcher', 'reviewer', 'clawd']

const cells = (row: ReturnType<typeof spriteRows>[number]) => row.flatMap(r => [...r.text].map(text => ({ text, color: r.color, bg: r.bg })))

test('every character is 3 rows of 8 cells in both frames, each cell two pixels stacked', () => {
  for (const role of ROLES) {
    for (const frame of [0, 1]) {
      const rows = spriteRows(role, frame)
      expect(rows).toHaveLength(3)
      rows.forEach((row, y) => {
        expect(widthOf(row)).toBe(8)
        cells(row).forEach((cell, x) => {
          const px = (line: string | undefined) => {
            const letter = line?.[x]
            return letter === undefined || letter === '.' ? null : PAL[letter]
          }
          const top = px(CHARS[role][frame]?.[y * 2])
          const bottom = px(CHARS[role][frame]?.[y * 2 + 1])
          const want =
            top == null && bottom == null
              ? { text: ' ', color: '', bg: '' }
              : bottom == null
                ? { text: '▀', color: top, bg: '' }
                : top == null
                  ? { text: '▄', color: bottom, bg: '' }
                  : top === bottom
                    ? { text: '█', color: top, bg: '' }
                    : { text: '▀', color: top, bg: bottom }
          expect({ role, frame, x, y, ...cell }).toEqual({ role, frame, x, y, ...want })
        })
      })
    }
  }
})

test('the two frames differ, so a running agent visibly moves; any frame number counts round the two', () => {
  for (const role of ROLES) {
    expect(spriteRows(role, 1)).not.toEqual(spriteRows(role, 0))
    expect(spriteRows(role, 7)).toEqual(spriteRows(role, 1))
  }
  // The explorer's hat brim over its first column: no pixel above, hat colour below.
  expect(cells(spriteRows('explorer', 0)[0]!)[0]).toEqual({ text: '▄', color: '#c9b07a', bg: '' })
})

test('which character an agent is: reviewers by type or task first, then the agent types', () => {
  expect(roleOf('Explore', 'find the cache tests')).toBe('explorer')
  expect(roleOf('Plan', 'plan the rollout')).toBe('architect')
  expect(roleOf('claude-code-guide', 'how hooks load')).toBe('researcher')
  expect(roleOf('general-purpose', 'implement retry')).toBe('developer')
  expect(roleOf('claude', 'implement retry')).toBe('developer')
  expect(roleOf('pstack:poteto-agent', 'port the panel')).toBe('developer')
  expect(roleOf('statusline-setup', 'set the status line')).toBe('clawd')
  expect(roleOf('pstack:comment-sicko', 'tidy the comments')).toBe('reviewer')
  expect(roleOf('code-reviewer', 'look at the diff')).toBe('reviewer')
  // The task's words win over its type.
  expect(roleOf('Explore', 'audit the auth flow')).toBe('reviewer')
  expect(roleOf('general-purpose', 'security pass on the API')).toBe('reviewer')
  expect(roleOf('Plan', 'Review the plan')).toBe('reviewer')
})
