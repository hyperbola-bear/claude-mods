import { expect, test } from 'claude-code/testing'

import type { SessionInfo } from '../types'
import { DONE_MS, ageOf, clip, groupOf, grouped, jumpUrl, livePids, parseSessionFile, parseTitles, titleOf } from '../hooks/sessions.ts'
import { sessionsPaneGrid } from '../hooks/sessionsview.ts'

const NOW = Date.parse('2026-10-22T09:00:00Z')

const info = (sessionId: string, status: SessionInfo['status'], statusAt: number): SessionInfo => ({ sessionId, pid: 1, status, title: sessionId, entry: 'cli', hostId: null, cwd: null, statusAt })

test('a session is filed by what it needs from you: waiting needs you, busy works, idle is done for 8 hours, then asleep', () => {
  expect(groupOf({ status: 'waiting', statusAt: 0 }, NOW)).toBe('needs')
  expect(groupOf({ status: 'busy', statusAt: 0 }, NOW)).toBe('working')
  expect(groupOf({ status: 'idle', statusAt: NOW - DONE_MS }, NOW)).toBe('done')
  expect(groupOf({ status: 'idle', statusAt: NOW - DONE_MS - 1 }, NOW)).toBe('asleep')
})

test('every session in its group, the newest first; this one apart', () => {
  const s = grouped([info('old', 'idle', NOW - 60_000), info('me', 'busy', NOW), info('new', 'idle', NOW - 1_000), info('w', 'waiting', NOW - 5)], 'me', NOW)
  expect(s.self?.sessionId).toBe('me')
  expect(s.byGroup.done.map(x => x.sessionId)).toEqual(['new', 'old'])
  expect(s.byGroup.needs.map(x => x.sessionId)).toEqual(['w'])
  expect(s.byGroup.working).toEqual([])
  expect(s.readAt).toBe(NOW)
})

test('a status file is read for what the panel uses; one broken, or without a pid or an id, is none', () => {
  const f = parseSessionFile(
    JSON.stringify({ pid: 12738, sessionId: 'e7696d37-1df4', status: 'idle', name: ' BILLING1-709 ', nameSource: 'user', entrypoint: 'claude-desktop', cwd: '/work/billing', statusUpdatedAt: 5 }),
  )
  expect(f).toEqual({ pid: 12738, sessionId: 'e7696d37-1df4', status: 'idle', name: 'BILLING1-709', isUserName: true, entry: 'app', hostId: null, cwd: '/work/billing', statusAt: 5 })
  expect(parseSessionFile(JSON.stringify({ pid: 1, sessionId: 'a', status: 'thinking', entrypoint: 'cli' }))).toMatchObject({ status: 'idle', entry: 'cli', name: null, statusAt: 0 })
  for (const text of ['{', 'null', '[]', '{"sessionId":"a"}', '{"pid":-1,"sessionId":"a"}', '{"pid":1,"sessionId":"../../etc"}']) expect(parseSessionFile(text), text).toBe(null)
  // The folder goes on command lines when the jump looks for the session's tab: only an absolute one, on one line.
  for (const cwd of ['work', '/a\nb', 7]) expect(parseSessionFile(JSON.stringify({ pid: 1, sessionId: 'a', cwd }))?.cwd, String(cwd)).toBe(null)
})

test('the title: the person’s own name, then the custom title, then the AI title, then the name; 30 characters at most', () => {
  const f = (name: string | null, isUserName: boolean) => ({ pid: 1, sessionId: 'a', status: 'idle' as const, name, isUserName, entry: 'cli' as const, hostId: null, cwd: null, statusAt: 0 })
  const both = { custom: 'Custom', ai: 'AI' }
  expect(titleOf(f('Mine', true), both)).toBe('Mine')
  expect(titleOf(f('pd-billing-1d', false), both)).toBe('Custom')
  expect(titleOf(f('pd-billing-1d', false), { ai: 'AI' })).toBe('AI')
  expect(titleOf(f('pd-billing-1d', false), undefined)).toBe('pd-billing-1d')
  expect(titleOf(f(null, false), undefined)).toBe('untitled session')
  expect(clip('x'.repeat(30))).toBe('x'.repeat(30))
  expect(clip('x'.repeat(31))).toBe(`${'x'.repeat(29)}…`)
  expect(titleOf(f('a'.repeat(40), true), undefined)).toHaveLength(30)
})

test('the transcripts’ titles, the last of each kind; the pids ps printed', () => {
  const rows = [
    '{"type":"ai-title","aiTitle":"First AI","sessionId":"a"}',
    '{"type":"custom-title","customTitle":"Mine","sessionId":"a"}',
    'not json',
    '{"type":"ai-title","aiTitle":"Other","sessionId":"b"}',
    '{"type":"ai-title","aiTitle":"Sneaky","sessionId":"../x"}',
  ].join('\n')
  expect([...parseTitles(rows)]).toEqual([
    ['a', { ai: 'First AI', custom: 'Mine' }],
    ['b', { ai: 'Other' }],
  ])
  expect([...livePids('  101\n 2202\n\n')]).toEqual([101, 2202])
})

test('how long ago, in the largest whole unit', () => {
  expect([0, 59_000, 60_000, 59 * 60_000, 3_600_000, 23 * 3_600_000, 86_400_000, 5 * 86_400_000].map(ms => ageOf(NOW - ms, NOW))).toEqual(['now', 'now', '1m', '59m', '1h', '23h', '1d', '5d'])
})

test('a desktop session keeps the app’s id for its deep link; a terminal’s, or one not shaped like it, has none', () => {
  const file = (hostSessionId: unknown) => parseSessionFile(JSON.stringify({ pid: 1, sessionId: 'a', entrypoint: 'claude-desktop', hostSessionId }))?.hostId
  expect(file('local_4c4432ad-2706')).toBe('local_4c4432ad-2706')
  for (const bad of [undefined, 'session_01', 'local_a&b=c', `local_${'x'.repeat(65)}`, 7]) expect(file(bad), String(bad)).toBe(null)
  expect(jumpUrl('local_4c4432ad-2706')).toBe('claude://code/continue?session=local_4c4432ad-2706')
})

test('in the Sessions pane every other session’s row jumps to it, a terminal’s too; this one’s does not', () => {
  const app = { ...info('app', 'waiting', NOW), entry: 'app' as const, hostId: 'local_app' }
  const me = { ...info('me', 'busy', NOW), entry: 'app' as const, hostId: 'local_me' }
  const g = sessionsPaneGrid(grouped([app, info('cli', 'busy', NOW), me], 'me', NOW), NOW, 60, false)
  const jumps = g.hits.filter(h => h.id.startsWith('session:'))
  expect([...new Set(jumps.map(h => h.id))]).toEqual(['session:app', 'session:cli'])
  // The whole row: the dot, the title, where it runs and how long ago.
  expect(jumps.filter(h => h.id === 'session:cli')).toHaveLength(4)
})

test('in a pane too narrow for a title, the cut title still jumps: every cell of the row is pressable', () => {
  const app = { ...info('app', 'idle', NOW - 60_000), title: 'Job app tracker workflow evaluation', entry: 'app' as const, hostId: 'local_app' }
  const g = sessionsPaneGrid(grouped([app], 'me', NOW), NOW, 30, false)
  const y = g.rows.findIndex(r => r.map(x => x.text).join('').includes('Job app'))
  const text = g.rows[y]!.map(x => x.text).join('')
  expect(text).toContain('…')
  // Each cell from the dot to the age is under the jump, the cut title included.
  const covered = new Set(g.hits.filter(h => h.y === y && h.id === 'session:app').flatMap(h => Array.from({ length: h.x1 - h.x0 }, (_, i) => h.x0 + i)))
  const title = text.indexOf('Job app')
  expect([title, title + 5, text.indexOf('…')].every(x => covered.has(x))).toBe(true)
})
