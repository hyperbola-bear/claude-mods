import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { plain } from '../hooks/cells.ts'
import type { CellsProps } from '../hooks/cells.ts'
import { STEP_ASK } from '../hooks/queue.ts'
import type { Usage } from '../hooks/runs.ts'

type World = {
  launched: Record<string, unknown>[]
  opens: string[]
  /** Each period of a `$.clock.every` timer: how a test sees the animation's timer run. */
  periods: number
  clock: MockClock
  models: string[]
  usages: (Usage & { model: string })[]
  /** What another plugin draws above the prompt, if any. */
  otherBand: string | null
}

function world(on: On): World {
  // Above the mocked clock, so it sees each period before the clock answers it.
  on('clock.every', { ms: 650 }, ($, e, next) => {
    w.periods += 1
    return next(e)
  })
  const w: World = { launched: [], opens: [], periods: 0, clock: mock.clock(on, { now: Date.parse('2026-10-22T09:00:00Z') }), models: [], usages: [], otherBand: null }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  // The engine's own drawing above the prompt, which the band leaves out rather than nest.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    if (w.otherBand === null) return { type: 'engine', ref: 0 } as never
    const { Text } = $.ui.resolve(e)
    return Text({ children: w.otherBand } as never)
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__delegator__${e.name}` } }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.open', ($, e) => {
    w.opens.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('agent.spawn', ($, e) => {
    w.launched.push({ ...e })
    // A workflow agent run remotely has no loop here, so no id to report on.
    if (e.workflow !== undefined) return { model: 'claude-opus-5-5' }
    return { model: w.models.shift() ?? 'claude-opus-5-5', agentId: `agent-${w.launched.length}` }
  })
  on('turn.step', async function* () {
    return { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: w.usages.shift() ?? null } as never
  })
  return w
}

const start = ($: Engine) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

const spawn = ($: Engine, args: { prompt: string; description: string; subagentType: string; model?: string }) => $.agent.spawn(args as never)

const BUILDER = { prompt: 'Add a retry with backoff to fetchPlan in api.ts.', description: 'implement retry', subagentType: 'general-purpose' }
const EXPLORE = { prompt: 'Find where the cache tests live.', description: 'inspect cache tests', subagentType: 'Explore' }

async function step($: Engine, w: World, agentId: string, usage: Usage, model = 'claude-opus-5-5') {
  w.usages.push({ model, ...usage })
  const stream = ($.turn.step as (e: unknown) => AsyncIterable<unknown>)({ turnId: 't', index: 0, model, messageCount: 1, agentId })
  for await (const _ of stream) void _
}

const end = ($: Engine, agentId: string, reason: 'answer' | 'error') =>
  ($.turn.complete as (e: unknown) => Promise<unknown>)({ answer: 'done', durationMs: 10, isAborted: false, turnId: 't', reason, agentId })

const PANE = { title: 'Delegator', isFocused: false, bodyColumns: 80, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} }
const BAND = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} }

/** The first running agent's character: the first 8 cells of the 3 rows under the RUNNING divider, each with its look. */
function character(props: CellsProps | undefined): string[] {
  const rows = props?.rows ?? []
  const at = rows.findIndex(r => r.map(x => x.text).join('').includes('R U N N I N G'))
  return rows.slice(at + 1, at + 4).map(row => {
    const cells = row.flatMap(run => [...run.text].map(ch => `${ch}${run.color}/${run.bg}`))
    return cells.slice(0, 8).join(' ')
  })
}

async function pane($: Engine, surface: 'terminal' | 'desktop' = 'terminal') {
  const ui = await $.ui.mount({ plugin: 'delegator', surface, component: 'Pane', requestId: 'delegator', props: PANE })
  const props = (await ui.find({ type: 'Client', key: 'delegator' }))?.props.props as CellsProps | undefined
  await ui.unmount()
  return { props, lines: plain(props ?? { rows: [] }).map(l => l.trimEnd()) }
}

const STEP_ONE: Usage = { input_tokens: 10_000, output_tokens: 5_000, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 15_000 }
const STEP_TWO: Usage = { input_tokens: 2_000, output_tokens: 3_000, cache_read_input_tokens: 80_000, cache_creation_input_tokens: 5_000 }

test('each agent is tracked from its model requests to its end: tokens add up, context is the last request, cost from its model', { options: { approveAgents: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  w.models.push('claude-opus-5-5', 'gpt-x')
  await spawn($, BUILDER)
  await spawn($, EXPLORE)
  await step($, w, 'agent-1', STEP_ONE)
  await step($, w, 'agent-1', STEP_TWO)
  await step($, w, 'agent-2', STEP_ONE, 'gpt-x')
  await w.clock.advance(65_000)
  let { lines } = await pane($)
  expect(lines[1]).toMatch(/^2 running · ≈\$0\.34 · 350k tokens · 1m 05s +c: hide done$/)
  // Opus 5.5 at $4, $20, $0.20 and $5 per million: (10k×4 + 5k×20 + 100k×0.2 + 15k×5 + 2k×4 + 3k×20 + 80k×0.2 + 5k×5) / 1M = $0.344.
  // 220k tokens in all; the last request held 90k of a 1M window, not the first one's 130k.
  expect(lines.some(l => l.endsWith(' ▕▉         ▏ 9%  220k  ≈$0.34  1m 05s'))).toBe(true)
  // No price for a model the table does not know.
  expect(lines.some(l => l.endsWith(' ▕█▎        ▏ 13%  130k  ≈$0.00  1m 05s'))).toBe(true)
  await end($, 'agent-1', 'answer')
  await w.clock.advance(10_000)
  await end($, 'agent-2', 'error')
  ;({ lines } = await pane($))
  expect(lines.some(l => /^✓ #1 general-purpose · implement retry +220k · 1m 05s$/.test(l))).toBe(true)
  expect(lines.some(l => /^✗ #2 Explore · inspect cache tests +130k · 1m 15s$/.test(l))).toBe(true)
  expect(lines.some(l => l.includes('R U N N I N G'))).toBe(false)
})

test('an agent whose model requests went unseen takes its turn\'s sum when it ends', { options: { approveAgents: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await spawn($, BUILDER)
  await ($.turn.complete as (e: unknown) => Promise<unknown>)({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't', reason: 'answer', agentId: 'agent-1', usage: { model: 'claude-opus-5-5', ...STEP_ONE } })
  const { lines } = await pane($)
  expect(lines[1]).toMatch(/^0 running · ≈\$0\.23 · 130k tokens · 0s/)
  expect(w.launched).toHaveLength(1)
})

test('an agent the gate approves keeps the number the queue gave it, past one it refused', { options: {} }, async ($, on) => {
  world(on)
  const answers = ['Approve', 'Refuse', 'Approve']
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
    const q = e.questions[0]!
    return { result: { questions: e.questions, answers: { [q.question]: answers.shift() ?? 'Refuse' }, annotations: {} } }
  })
  await start($)
  await spawn($, EXPLORE)
  await spawn($, { ...BUILDER, description: 'rewrite the tests' })
  await spawn($, BUILDER)
  const { lines } = await pane($)
  expect(lines.some(l => / #1 Explore · inspect cache tests +Opus 5\.5$/.test(l))).toBe(true)
  expect(lines.some(l => /^✗ #2 general-purpose · rewrite the tests +refused$/.test(l))).toBe(true)
  expect(lines.some(l => / #3 general-purpose · implement retry +Opus 5\.5$/.test(l))).toBe(true)
})

test('a workflow agent with no loop to report on is not shown as running', { options: { approveAgents: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await $.agent.spawn({ ...BUILDER, workflow: { runId: 'wf_1', agentIndex: 1 } } as never)
  expect(w.launched).toHaveLength(1)
  const { lines } = await pane($)
  expect(lines.some(l => l.includes('R U N N I N G'))).toBe(false)
  expect(w.periods).toBe(0)
})

test('an agent reports its steps; a step from outside any agent it tracks is ignored', { options: { approveAgents: false } }, async ($, on) => {
  world(on)
  await start($)
  await spawn($, BUILDER)
  expect((await pane($)).lines.some(l => l.endsWith(' no steps reported'))).toBe(true)
  const STEP = 'mcp__delegator__step'
  expect(await $.tool.call({ tool: STEP, agentId: 'agent-1', done: 0, total: 5 } as never)).toMatchObject({ result: 'ok' })
  expect(await $.tool.call({ tool: STEP, agentId: 'agent-1', done: 2, note: 'reading the retry code' } as never)).toMatchObject({ result: 'ok' })
  expect((await pane($)).lines.some(l => l.endsWith(' 2/5 reading the retry code'))).toBe(true)
  expect(await $.tool.call({ tool: STEP, done: 1 } as never)).toMatchObject({ result: expect.stringMatching(/^ignored/) })
  expect(await $.tool.call({ tool: STEP, agentId: 'agent-9', done: 1 } as never)).toMatchObject({ result: expect.stringMatching(/^ignored/) })
  expect((await pane($)).lines.some(l => l.endsWith(' 2/5 reading the retry code'))).toBe(true)
})

test('the step ask goes after the task, once', { options: { approveAgents: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await spawn($, BUILDER)
  expect(w.launched[0]?.prompt).toBe(`${BUILDER.prompt}\n\n${STEP_ASK}`)
  await spawn($, { ...BUILDER, prompt: `${BUILDER.prompt} Report with mcp__delegator__step.` })
  expect(w.launched[1]?.prompt).toBe(`${BUILDER.prompt} Report with mcp__delegator__step.`)
})

test('with the row off, the task launches as written', { options: { approveAgents: false, askForSteps: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await spawn($, BUILDER)
  expect(w.launched[0]?.prompt).toBe(BUILDER.prompt)
})

test('the step ask follows the person\'s notes', { options: {} }, async ($, on) => {
  const w = world(on)
  const answers = ['keep it small', 'Approve']
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
    const q = e.questions[0]!
    return { result: { questions: e.questions, answers: { [q.question]: answers.shift() ?? 'Refuse' }, annotations: {} } }
  })
  await start($)
  await spawn($, BUILDER)
  expect(w.launched[0]?.prompt).toBe(`${BUILDER.prompt}\n\nNotes from the person who approved this agent:\n- keep it small\n\n${STEP_ASK}`)
})

test('while an agent waits, its task in the pane is the one it launches with, the step ask included', { options: {} }, async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e) => {
    await w.clock.sleep(1000)
    const q = e.questions[0]!
    return { result: { questions: e.questions, answers: { [q.question]: 'Approve' }, annotations: {} } }
  })
  await start($)
  const held = spawn($, BUILDER)
  await w.clock.settle()
  const { lines } = await pane($)
  const at = lines.findIndex(l => l.includes('T A S K'))
  expect(lines.slice(at + 1, at + 4)).toEqual([BUILDER.prompt, '', STEP_ASK.slice(0, STEP_ASK.lastIndexOf(' ', 80))])
  await w.clock.advance(1000)
  await held
  expect(w.launched[0]?.prompt).toBe(`${BUILDER.prompt}\n\n${STEP_ASK}`)
})

const PROGRESS = 'mcp__delegator__progress'
const PLAN = {
  tool: PROGRESS,
  title: 'Ship the retry',
  phase: 'delegate',
  total: 3,
  tasks: [
    { title: 'implement retry', tier: 'careful' },
    { title: 'write the tests', tier: 'light', after: [1] },
    { title: 'update the docs', tier: 'light', after: [2] },
  ],
}

async function band($: Engine, surface: 'terminal' | 'desktop' = 'terminal') {
  const ui = await $.ui.mount({ plugin: 'delegator', surface, component: 'AbovePrompt', props: BAND })
  const props = (await ui.find({ type: 'Client', key: 'delegator-band' }))?.props.props as CellsProps | undefined
  return { ui, props, line: props ? plain(props)[0] : undefined }
}

test('the band shows a reported flow until it finishes; the pane lists the tasks no agent has taken', { options: { approveAgents: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  expect((await band($)).props).toBe(undefined)
  expect(await $.tool.call(PLAN as never)).toMatchObject({ result: 'ok: Ship the retry · delegate, 0/3 accepted' })
  await spawn($, BUILDER)
  await $.tool.call({ tool: PROGRESS, done: 1 } as never)
  const shown = await band($)
  expect(shown.line).toBe(`${' '.repeat(44)}Ship the retry · delegate  ▰▱▱ 1/3 accepted  ● 1 agent ▸`)
  await shown.ui.pointer({ type: 'down', x: 99, y: 0, button: 'left', in: 'delegator-band' })
  expect(w.opens).toEqual(['delegator'])
  await shown.ui.unmount()
  const { lines } = await pane($)
  expect(lines).toContain('Ship the retry · delegate')
  expect(lines.some(l => /^◷ 2\. write the tests +after #1$/.test(l))).toBe(true)
  expect(lines.some(l => /^◷ 3\. update the docs +after 2$/.test(l))).toBe(true)
  expect(lines.some(l => l.includes('1. implement retry'))).toBe(false)
  await $.tool.call({ tool: PROGRESS, finished: true } as never)
  expect((await band($)).props).toBe(undefined)
})

test('progress from a subagent is ignored', { options: { approveAgents: false } }, async ($, on) => {
  world(on)
  await start($)
  await $.tool.call(PLAN as never)
  const hijack = await $.tool.call({ tool: PROGRESS, agentId: 'agent-1', title: 'Hijacked', finished: true } as never)
  expect(hijack).toMatchObject({ result: 'ignored: only the main session reports the flow' })
  expect((await band($)).line).toMatch(/Ship the retry · delegate  ▱▱▱ 0\/3 accepted  ● 0 agents ▸$/)
})

test('the band sits over what the other plugins draw above the prompt', { options: {} }, async ($, on) => {
  const w = world(on)
  w.otherBand = 'other band'
  await start($)
  await $.tool.call(PLAN as never)
  const { ui, props } = await band($)
  expect(props).toBeDefined()
  // The flow's row first, the other plugin's drawing under it.
  const tree = (await ui.drawn()) as unknown as { children: { type: string; children?: unknown[] }[] }
  expect(tree.children.map(c => c.type)).toEqual(['Client', 'Text'])
  expect(tree.children[1]?.children).toEqual(['other band'])
})

test('the characters move every 650 ms while an agent runs, and the timer stops when none does', { options: { approveAgents: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await spawn($, EXPLORE)
  const ui = await $.ui.mount({ plugin: 'delegator', surface: 'terminal', component: 'Pane', requestId: 'delegator', props: PANE })
  const shown = async () => character((await ui.find({ type: 'Client', key: 'delegator' }))?.props.props as CellsProps | undefined)
  const before = await shown()
  await w.clock.advance(650)
  expect(w.periods).toBeGreaterThan(0)
  expect(await shown()).not.toEqual(before)
  await w.clock.advance(650)
  expect(await shown()).toEqual(before)
  await ui.unmount()
  await end($, 'agent-1', 'answer')
  const counted = w.periods
  await w.clock.advance(6500)
  expect(w.periods).toBe(counted)
})

test('with Animate the characters off, no timer starts and the characters stand still', { options: { approveAgents: false, animateCharacters: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await spawn($, EXPLORE)
  const before = character((await pane($)).props)
  await w.clock.advance(6500)
  expect(w.periods).toBe(0)
  expect(character((await pane($)).props)).toEqual(before)
})

test('the terminal and the desktop draw the same cells, the pane and the band', { options: { approveAgents: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await $.tool.call(PLAN as never)
  await spawn($, BUILDER)
  await spawn($, EXPLORE)
  await step($, w, 'agent-1', STEP_ONE)
  await $.tool.call({ tool: 'mcp__delegator__step', agentId: 'agent-1', done: 1, total: 4, note: 'reading' } as never)
  await end($, 'agent-2', 'answer')
  await w.clock.advance(30_000)
  const terminal = await pane($, 'terminal')
  const desktop = await pane($, 'desktop')
  expect(terminal.props).toBeDefined()
  expect(desktop.props).toEqual(terminal.props)
  expect((await band($, 'desktop')).props).toEqual((await band($, 'terminal')).props)
})

test('/clear empties what it tracks along with the queue', { options: { approveAgents: false } }, async ($, on) => {
  world(on)
  await start($)
  await $.tool.call(PLAN as never)
  await spawn($, BUILDER)
  await $.session.end({ reason: 'clear', sessionId: 's1' } as never)
  const { lines } = await pane($)
  expect(lines[1]).toMatch(/^0 running · ≈\$0\.00 · 0 tokens · 0s/)
  expect((await band($)).props).toBe(undefined)
  // Numbering starts again.
  await spawn($, EXPLORE)
  expect((await pane($)).lines.some(l => / #1 Explore · inspect cache tests/.test(l))).toBe(true)
})

test('an agent approved after a long wait is tracked, though other hooks wrote what it tracks meanwhile', { options: {} }, async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e) => {
    await w.clock.sleep(5000)
    const q = e.questions[0]!
    return { result: { questions: e.questions, answers: { [q.question]: 'Approve' }, annotations: {} } }
  })
  await start($)
  const first = spawn($, BUILDER)
  await w.clock.settle()
  await $.tool.call(PLAN as never)
  await $.tool.call({ tool: PROGRESS, done: 1 } as never)
  const second = spawn($, EXPLORE)
  await w.clock.settle()
  await w.clock.advance(12_000)
  await Promise.all([first, second])
  const { lines } = await pane($)
  expect(lines.some(l => / #1 general-purpose · implement retry +Opus 5\.5$/.test(l))).toBe(true)
  expect(lines.some(l => / #2 Explore · inspect cache tests +Opus 5\.5$/.test(l))).toBe(true)
})

test('c in the pane hides the agents done and shows them again', { options: { approveAgents: false } }, async ($, on) => {
  world(on)
  await start($)
  await spawn($, BUILDER)
  await end($, 'agent-1', 'answer')
  const ui = await $.ui.mount({ plugin: 'delegator', surface: 'terminal', component: 'Pane', requestId: 'delegator', props: PANE })
  const shown = async () => plain(((await ui.find({ type: 'Client', key: 'delegator' }))?.props.props as CellsProps | undefined) ?? { rows: [] }).map(l => l.trimEnd())
  expect((await shown()).some(l => l.includes('D O N E'))).toBe(true)
  await ui.key({ key: 'c', in: 'delegator' })
  const hidden = await shown()
  expect(hidden.some(l => l.includes('D O N E'))).toBe(false)
  expect(hidden[1]).toMatch(/c: show done$/)
  await ui.key({ key: 'c', in: 'delegator' })
  expect((await shown()).some(l => l.includes('D O N E'))).toBe(true)
})
