import { expect, test } from 'claude-code/testing'

import {
  GROUP_IDS,
  addShares,
  attribute,
  attributeAgent,
  attributePlugin,
  attributeRequest,
  capItems,
  contextOf,
  restarted,
  trimmedTo,
  classifyRow,
  commandHead,
  compacted,
  contextWeights,
  emptyTokens,
  hostOf,
  mcpParts,
  ranked,
  stack,
  standingFrom,
  summary,
  totalUsed,
} from '../hooks/tokens.ts'
import type { Attribution, Row } from '../hooks/tokens.ts'

const none = () => undefined

const row = (door: string, origin: Row['origin'], content: Row['message']['content'], extra: Partial<Row['message']> = {}): Row => ({
  door,
  origin,
  message: { type: extra.role === 'assistant' ? 'assistant' : 'user', role: 'user', ...extra, content },
})

const text = (n: number) => ({ type: 'text', text: 'x'.repeat(n) })

test('each tool lands in its group, with the subject it was about', () => {
  expect(attribute('Read', { file_path: '/repo/hooks/register.tsx' })).toEqual({ group: 'files', kind: 'Read', item: 'register.tsx' })
  expect(attribute('Edit', { file_path: 'a/b.ts', old_string: 'x' })).toEqual({ group: 'files', kind: 'Edit', item: 'b.ts' })
  expect(attribute('Grep', { pattern: 'TODO' })).toEqual({ group: 'files', kind: 'Search', item: 'TODO' })
  expect(attribute('Bash', { command: 'cd app && FOO=1 npm test' })).toEqual({ group: 'shell', kind: 'Bash', item: 'npm' })
  expect(attribute('WebFetch', { url: 'https://www.example.com/a?b' })).toEqual({ group: 'web', kind: 'fetch', item: 'example.com' })
  expect(attribute('mcp__linear__create_issue', {})).toEqual({ group: 'mcp', kind: 'linear', item: 'create_issue' })
  expect(attribute('mcp__plugin_ask_docs__search', {})).toEqual({ group: 'mcp', kind: 'plugin_ask_docs', item: 'search' })
  expect(attribute('Skill', { skill: 'pstack:architect' })).toEqual({ group: 'skills', kind: 'skill', item: 'pstack:architect' })
  expect(attribute('Agent', { subagent_type: 'Explore', prompt: 'look' })).toEqual({ group: 'agents', kind: 'Agent', item: 'Explore' })
  expect(attribute('TodoWrite', {})).toEqual({ group: 'other', kind: 'TodoWrite' })
  expect(commandHead('git status')).toBe('git')
  expect(commandHead('/usr/bin/rg foo')).toBe('rg')
  expect(hostOf('https://docs.anthropic.com/x')).toBe('docs.anthropic.com')
  expect(mcpParts('mcp__a__b__c')).toEqual({ server: 'a', tool: 'b__c' })
})

test('rows are filed by door and origin; a tool result lands where its call did', () => {
  const calls = new Map<string, Attribution>()
  const lookup = (id: string) => calls.get(id)

  const prompt = classifyRow(row('prompt', { kind: 'composer' }, [text(400)]), lookup, null)
  expect(prompt.shares).toEqual([{ group: 'chat', kind: 'you', tokens: 100, calls: 1 }])

  const response = classifyRow(
    row('response', { kind: 'model', model: 'claude-opus-5-5' }, [text(80), { type: 'thinking', thinking: 'hm' }, { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'src/a.ts' } }], { role: 'assistant' }),
    lookup,
    null,
  )
  expect(response.shares.map(s => [s.group, s.kind])).toEqual([
    ['chat', 'Claude'],
    ['thinking', 'reasoning'],
    ['files', 'Read'],
  ])
  expect(response.uses).toEqual([{ id: 'tu1', group: 'files', kind: 'Read', item: 'a.ts' }])
  for (const u of response.uses) calls.set(u.id, u)

  const result = classifyRow(row('tool-result', { kind: 'tool', tool: 'Read' }, [{ type: 'tool_result', tool_use_id: 'tu1', content: [text(4000), { type: 'image', source: {} }] }]), lookup, null)
  expect(result.shares).toEqual([{ group: 'files', kind: 'Read', item: 'a.ts', tokens: 1000 + 1600 }])

  // A Skill call's body arrives as a row the tool hands over: it goes to the skill the call named.
  const skill = classifyRow(row('tool-message', { kind: 'tool', tool: 'Skill' }, [text(800)], { isMeta: true }), lookup, 'pstack:tdd')
  expect(skill.shares).toEqual([{ group: 'skills', kind: 'skill', item: 'pstack:tdd', tokens: 200 }])

  const hook = classifyRow(row('hook-context', { kind: 'hook', event: 'SessionStart' }, [text(40)]), lookup, null)
  expect(hook.shares).toEqual([{ group: 'skills', kind: 'hooks', item: 'SessionStart', tokens: 10 }])
  const plugin = classifyRow(row('prompt', { kind: 'plugin', name: 'ask' }, [text(40)]), lookup, null)
  expect(plugin.shares).toEqual([{ group: 'skills', kind: 'plugins', item: 'ask', tokens: 10, calls: 1 }])
  const memory = classifyRow(row('attachment', { kind: 'engine' }, [text(40)], { type: 'attachment', name: 'nested_memory', isMeta: true }), lookup, null)
  expect(memory.shares).toEqual([{ group: 'system', kind: 'memory', item: 'nested_memory', tokens: 10 }])
  const command = classifyRow(row('command', { kind: 'composer' }, [text(0), { type: 'text', text: '<command-name>/goal</command-name> ship it' }]), lookup, null)
  expect(command.shares[0]).toMatchObject({ group: 'skills', kind: 'command', item: 'goal', calls: 1 })

  // No role: no request carries it. A subagent's row: its own conversation, counted by what it spends.
  expect(classifyRow({ door: 'notice', origin: { kind: 'engine' }, message: { type: 'system', content: [text(40)] } }, lookup, null).shares).toEqual([])
  expect(classifyRow({ ...row('prompt', { kind: 'composer' }, [text(40)]), agentId: 'a1' }, lookup, null).shares).toEqual([])
})

test('each request’s real tokens are split across the groups and add up to the API’s totals', () => {
  let s = emptyTokens(0)
  s = { ...s, standing: { system: 20_000, mcp: 5_000 } }
  s = addShares(s, [
    { group: 'chat', kind: 'you', tokens: 1_000, calls: 1 },
    { group: 'files', kind: 'Read', item: 'a.ts', tokens: 9_000 },
  ])
  const weights = contextWeights(s)
  expect(weights.files).toBe(9_000)
  expect(weights.system).toBe(20_000)

  // The request carried 40k: 35k the groups account for, 5k more the system prompt holds.
  const usage = { input_tokens: 2_000, cache_read_input_tokens: 36_000, cache_creation_input_tokens: 2_000, output_tokens: 1_000 }
  s = attributeRequest(s, weights, usage, { answer: 'x'.repeat(400), toolUses: [{ name: 'Bash', input: { command: 'ls' } }] })
  expect(s.groups.files.used).toBe(9_000)
  expect(s.groups.mcp.used).toBe(5_000)
  expect(s.groups.system.used).toBe(25_000)
  expect(s.groups.chat.used).toBe(1_000 + 100)
  expect(s.groups.shell.used).toBeGreaterThan(0)
  expect(s.groups.thinking.used).toBe(1_000 - 100 - s.groups.shell.used)
  expect(Math.round(totalUsed(s))).toBe(41_000)

  // Estimates past the real count are scaled down to it.
  const over = attributeRequest(emptyTokens(0), { ...weights, files: 100_000 }, usage, { answer: '', toolUses: [] })
  expect(Math.round(totalUsed(over))).toBe(41_000)

  // Subagents and plugins are counted whole, under who spent.
  s = attributeAgent(s, usage, 'Explore')
  s = attributePlugin(s, usage, 'ask')
  expect(s.groups.agents.spent).toEqual({ Explore: 41_000 })
  expect(s.groups.skills.spent).toEqual({ ask: 41_000 })
  expect(Math.round(totalUsed(s))).toBe(123_000)
  expect(s.main.requests + s.agents.requests + s.plugins.requests).toBe(3)

  expect(ranked(s).slice(0, 2).map(r => r.id).sort()).toEqual(['agents', 'skills'])
  expect(summary(s)).toContain('123k tokens over 3 requests')
  expect(summary(s)).toContain('Subagents 33%')

  // A compaction leaves nothing the groups added in the context; what they used stays.
  const after = compacted(s)
  expect(GROUP_IDS.every(id => after.groups[id].inContext === 0)).toBe(true)
  expect(totalUsed(after)).toBe(totalUsed(s))
})

test('the stacked bar fills its cells exactly, every group with a share at least one', () => {
  let s = emptyTokens(0)
  const usage = { input_tokens: 0, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 0, output_tokens: 0 }
  s = attributeRequest(s, { ...contextWeights(s), files: 9_000, chat: 900, web: 100 }, usage, { answer: '', toolUses: [] })
  const bar = stack(s, 16)
  expect(bar.reduce((n, b) => n + b.cells, 0)).toBe(16)
  expect(bar.map(b => b.id)).toEqual(['files', 'chat', 'web'])
  expect(bar.every(b => b.cells >= 1)).toBe(true)
  expect(stack(emptyTokens(0), 16)).toEqual([])
})

test('the subjects kept per group are capped, the smallest folded into one', () => {
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}`, i + 1]))
  const kept = capItems(many, 5)
  expect(Object.keys(kept)).toHaveLength(5)
  expect(kept.f29).toBe(30)
  expect(Object.values(kept).reduce((a, b) => a + b, 0)).toBe(Object.values(many).reduce((a, b) => a + b, 0))
})

test('what each request carries is read off the context breakdown', () => {
  const standing = standingFrom({
    categories: [
      { name: 'System prompt', tokens: 9_000, kind: 'used' },
      { name: 'System tools', tokens: 12_000, kind: 'used' },
      { name: 'MCP tools', tokens: 4_000, kind: 'used' },
      { name: 'Messages', tokens: 50_000, kind: 'used' },
      { name: 'Free space', tokens: 100_000, kind: 'free' },
    ],
    mcpTools: [
      { serverName: 'linear', tokens: 3_000, isLoaded: true },
      { serverName: 'notion', tokens: 1_000, isLoaded: true },
      { serverName: 'slack', tokens: 9_000, isLoaded: false },
    ],
    memoryFiles: [{ tokens: 500 }],
    agents: [{ tokens: 300 }],
    skills: { tokens: 1_200 },
  })
  expect(standing).toEqual({ mcp: 4_000, skills: 1_200, agents: 300, system: 9_000 + 12_000 + 4_000 - 4_000 - 1_200 - 300 })
})

test('a delivery is filed by who sent it; listings are left to what every request carries', () => {
  const task = classifyRow(row('delivery', { kind: 'task-notification' }, [text(40)]), none, null)
  expect(task.shares).toEqual([{ group: 'shell', kind: 'background', item: 'notifications', tokens: 10 }])
  const peer = classifyRow(row('delivery', { kind: 'peer' }, [text(40)]), none, null)
  expect(peer.shares[0]).toMatchObject({ group: 'chat', kind: 'messages' })
  const listing = classifyRow(row('attachment', { kind: 'engine' }, [text(4_000)], { type: 'attachment', name: 'skill_listing', isMeta: true }), none, null)
  expect(listing.shares).toEqual([])
})

test('the context is measured from the messages: results by their calls, a skill’s body after its result', () => {
  const held = contextOf([
    { role: 'user', content: [text(400), { type: 'text', text: `<system-reminder>${'r'.repeat(396)}</system-reminder>` }] },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 't'.repeat(80) },
        { type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: 'a.ts' } },
        { type: 'tool_use', id: 's1', name: 'Skill', input: { skill: 'pstack:tdd' } },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'r1', content: 'x'.repeat(8_000) },
        { type: 'tool_result', tool_use_id: 's1', content: 'Launching skill: pstack:tdd' },
        text(2_000),
      ],
    },
    { role: 'user', content: '<command-name>/goal</command-name> ship it' },
  ])
  expect(held.chat).toBe(100)
  expect(held.system).toBe(108)
  expect(held.thinking).toBe(20)
  expect(held.files).toBeGreaterThan(2_000)
  expect(held.skills).toBe(7 + 7 + 500 + 11)
})

test('a periodic measurement trims only the groups the messages measure exactly; Reset keeps the context', () => {
  let s = addShares(emptyTokens(0), [
    { group: 'files', kind: 'Read', tokens: 9_000 },
    { group: 'skills', kind: 'hooks', item: 'PostToolUse', tokens: 500 },
  ])
  const measured = { ...contextOf([]), files: 1_000, system: 500 }
  s = trimmedTo(s, measured)
  expect(s.groups.files.inContext).toBe(1_000)
  expect(s.groups.skills.inContext).toBe(500)
  expect(s.groups.system.inContext).toBe(0)

  const usage = { input_tokens: 0, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 0, output_tokens: 0 }
  s = { ...attributeRequest(s, contextWeights(s), usage, { answer: '', toolUses: [] }), costUsd: 1.5 }
  const fresh = restarted(s, 99)
  expect(totalUsed(fresh)).toBe(0)
  expect(fresh.main.requests).toBe(0)
  expect(fresh.since).toBe(99)
  expect(fresh.groups.files.inContext).toBe(1_000)
  expect(fresh.groups.skills.inContext).toBe(500)
  expect(summary({ ...attributeRequest(fresh, contextWeights(fresh), usage, { answer: '', toolUses: [] }), costUsd: 2 })).toContain('· $0.50')
})
