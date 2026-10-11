import { expect, test } from 'claude-code/testing'

import { plain } from '../hooks/cells.ts'
import {
  APPROVE,
  APPROVE_ALL,
  CHANGE_MODEL,
  EMPTY,
  REFUSE,
  TASK_ROWS,
  decided,
  makePending,
  modelName,
  optionsOf,
  paneGrid,
  parseMain,
  parseModel,
  question,
  settle,
  suggestModel,
  taskOf,
  taskRows,
} from '../hooks/queue.ts'
import type { SpawnFacts } from '../hooks/queue.ts'

const spawn = (over: Partial<SpawnFacts> = {}): SpawnFacts => ({
  description: 'inspect cache tests',
  subagentType: 'Explore',
  prompt: 'Find where the cache tests live and list them.',
  parentModel: 'claude-opus-5-5',
  fork: false,
  ...over,
})

test('the suggested model follows the task: Haiku for lookups, Sonnet for building, Opus for design', () => {
  expect(suggestModel(spawn())).toEqual({ model: 'haiku', reason: 'lookup' })
  expect(suggestModel(spawn({ subagentType: 'Plan', description: 'plan the rollout' })).model).toBe('opus')
  expect(suggestModel(spawn({ subagentType: 'general-purpose', description: 'implement the retry' })).model).toBe('sonnet')
  expect(suggestModel(spawn({ subagentType: 'general-purpose', description: 'design the cache architecture' })).model).toBe('opus')
  expect(suggestModel(spawn({ subagentType: 'general-purpose', description: 'search for callers' })).model).toBe('haiku')
  // Words in the description win over the task's; with none there, the start of the task decides.
  expect(suggestModel(spawn({ subagentType: 'general-purpose', description: 'callers', prompt: 'Fix the flaky test in cache.ts' })).model).toBe('sonnet')
  expect(suggestModel(spawn({ subagentType: 'general-purpose', description: 'misc', prompt: 'Hello' }))).toEqual({ model: 'sonnet', reason: 'general task' })
  // A very long task is no quick lookup, even for Explore.
  expect(suggestModel(spawn({ prompt: 'x '.repeat(4000) })).model).toBe('sonnet')
})

test('a held agent launches on the request, else the suggestion, else its default; forks and workflows keep theirs', () => {
  expect(makePending(spawn(), 1, true)).toMatchObject({ model: 'haiku', requested: null, kind: 'agent', isNested: false })
  expect(makePending(spawn({ model: 'opus' }), 1, true)).toMatchObject({ model: 'opus', requested: 'opus' })
  expect(makePending(spawn(), 1, false)).toMatchObject({ model: null, suggestion: null })
  expect(makePending(spawn({ fork: true, subagentType: 'fork' }), 1, true)).toMatchObject({ kind: 'fork', model: null, suggestion: null })
  expect(makePending(spawn({ workflow: { runId: 'wf_1', agentIndex: 1 } }), 1, true)).toMatchObject({ kind: 'workflow', suggestion: null })
  expect(makePending(spawn({ isTeammate: true }), 1, true)).toMatchObject({ kind: 'teammate', model: 'haiku' })
  expect(makePending(spawn({ parentAgentId: 'agent-7' }), 1, true).isNested).toBe(true)
})

test('the question names the agent, its number and where its model comes from', () => {
  expect(question(makePending(spawn(), 3, true))).toBe('Launch #3 Explore "inspect cache tests" on Haiku (suggested: lookup)?')
  expect(question(makePending(spawn({ model: 'sonnet' }), 4, true))).toBe('Launch #4 Explore "inspect cache tests" on Sonnet (requested)?')
  expect(question({ ...makePending(spawn(), 5, true), model: 'opus' })).toBe('Launch #5 Explore "inspect cache tests" on Opus (your pick)?')
  expect(question(makePending(spawn(), 6, false))).toBe('Launch #6 Explore "inspect cache tests" on the agent\'s default model?')
  expect(question(makePending(spawn({ fork: true, subagentType: 'fork' }), 7, true))).toBe('Launch #7 fork "inspect cache tests" on the parent\'s model (Opus 5.5)?')
  expect(question(makePending(spawn({ workflow: { runId: 'wf_1', agentIndex: 2 }, parentAgentId: 'a1' }), 8, true))).toBe(
    'Launch #8 workflow agent "inspect cache tests" (from a subagent)?',
  )
})

test('Change model is offered only where a model can be picked', () => {
  expect(optionsOf(makePending(spawn(), 1, true))).toEqual([APPROVE, APPROVE_ALL, CHANGE_MODEL, REFUSE])
  expect(optionsOf(makePending(spawn({ fork: true }), 1, true))).toEqual([APPROVE, APPROVE_ALL, REFUSE])
  expect(optionsOf(makePending(spawn({ workflow: {} }), 1, true))).toEqual([APPROVE, APPROVE_ALL, REFUSE])
})

test('an answer is a label, or typed text: a note for the task, never for a workflow agent', () => {
  const p = makePending(spawn(), 1, true)
  expect(parseMain('Approve', p)).toEqual({ kind: 'approve' })
  expect(parseMain('Approve all this turn', p)).toEqual({ kind: 'approveAll' })
  expect(parseMain('Change model', p)).toEqual({ kind: 'model' })
  expect(parseMain('Refuse', p)).toEqual({ kind: 'refuse' })
  expect(parseMain('  only look in tests/  ', p)).toEqual({ kind: 'note', text: 'only look in tests/' })
  expect(parseMain('', p)).toEqual({ kind: 'unknown' })
  expect(parseMain('Change model', makePending(spawn({ fork: true }), 1, true))).toEqual({ kind: 'note', text: 'Change model' })
  expect(parseMain('do it differently', makePending(spawn({ workflow: {} }), 1, true))).toEqual({ kind: 'unknown' })
})

test('a model answer: a label, an alias, a full id, or default; anything else keeps the model', () => {
  expect(parseModel('Sonnet')).toBe('sonnet')
  expect(parseModel('fable')).toBe('fable')
  expect(parseModel('claude-haiku-4-5')).toBe('claude-haiku-4-5')
  expect(parseModel('default')).toBe(null)
  expect(parseModel('something cheap')).toBe(undefined)
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(modelName('sonnet')).toBe('Sonnet')
  expect(modelName('gpt-x')).toBe('gpt-x')
})

test('notes go after the task, under a heading that says whose they are', () => {
  const p = { ...makePending(spawn(), 1, true), notes: ['only tests/', 'skip snapshots'] }
  expect(taskOf(p)).toBe('Find where the cache tests live and list them.\n\nNotes from the person who approved this agent:\n- only tests/\n- skip snapshots')
  expect(taskOf(makePending(spawn(), 1, true))).toBe('Find where the cache tests live and list them.')
})

test('a long task keeps its line breaks and is capped, saying how many lines are left', () => {
  const rows = taskRows(Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n'), 40)
  expect(rows).toHaveLength(TASK_ROWS)
  expect(plain({ rows }).at(-1)).toBe('… 21 more lines')
  expect(plain({ rows: taskRows('a\n\nb', 40) })).toEqual(['a', '', 'b'])
})

test('the pane: on or off, the agents waiting, the first one\'s task, the decisions made', () => {
  const a = makePending(spawn(), 1, true)
  const b = makePending(spawn({ subagentType: 'general-purpose', description: 'implement retry', model: 'sonnet' }), 2, true)
  let s = { ...EMPTY, pending: [a, b] }
  let lines = plain(paneGrid(s, 70, true)).map(l => l.trimEnd())
  expect(lines[0]).toMatch(/^DELEGATOR ● on +Turn off$/)
  expect(lines).toContain('▸ #1 Explore · inspect cache tests · Haiku')
  expect(lines).toContain('  #2 general-purpose · implement retry · Sonnet')
  expect(lines.some(l => /^── T A S K +# 1 ─/.test(l))).toBe(true)
  expect(lines).toContain('Find where the cache tests live and list them.')
  s = settle(s, 1, decided(a, 'approved', 'claude-haiku-4-5', 0))
  s = settle(s, 2, decided(b, 'refused', null, 0, 'refused'))
  lines = plain(paneGrid(s, 70, false)).map(l => l.trimEnd())
  expect(lines[0]).toMatch(/^DELEGATOR ○ off +Turn on$/)
  expect(lines).toContain('Off: agents launch without asking.')
  expect(lines).toContain('✗ #2 general-purpose · implement retry · refused')
  expect(lines).toContain('✓ #1 Explore · inspect cache tests · approved on Haiku 4.5')
  expect(paneGrid(s, 70, true).hits.map(h => h.id)).toEqual(['toggle'])
})
