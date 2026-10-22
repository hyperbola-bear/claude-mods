import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { plain } from '../hooks/cells.ts'
import type { CellsProps } from '../hooks/cells.ts'

type Option = { label: string; description: string }
type Asked = { question: string; header: string; options: Option[] }

/** How the stand-in dialog answers: a label or typed text, late, closed by itself while away, or dismissed (null). */
type Reply = string | { answer: string; after: number } | { afk: string } | null

type World = {
  asked: Asked[]
  replies: Reply[]
  launched: Record<string, unknown>[]
  opens: string[]
  configSets: [string, unknown][]
  toasts: string[]
  clock: MockClock
}

const RESOLVED: Record<string, string> = { haiku: 'claude-haiku-4-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', fable: 'claude-fable-5-1' }

/** The world beneath the plugin: the dialog, the spawn itself, panes, config, toasts and the clock. */
function world(on: On): World {
  const w: World = { asked: [], replies: [], launched: [], opens: [], configSets: [], toasts: [], clock: mock.clock(on, { now: Date.parse('2026-10-12T06:00:00Z') }) }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__delegator__${e.name}` } }))
  on('ui.open', ($, e) => {
    w.opens.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('config.set', ($, e) => {
    w.configSets.push([e.key, e.value])
    return { value: e.value }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e) => {
    const q = e.questions[0]
    if (!q) return { deny: 'no question' }
    w.asked.push({ question: q.question, header: q.header, options: q.options.map(o => ({ ...o })) })
    const reply = w.replies.shift()
    if (reply === undefined || reply === null) return { deny: 'The user dismissed the question.' }
    if (typeof reply === 'object' && 'afk' in reply) {
      return { result: { questions: e.questions, answers: { [q.question]: reply.afk }, annotations: {}, afkTimeoutMs: 300_000 } }
    }
    if (typeof reply === 'object') await w.clock.sleep(reply.after)
    const answer = typeof reply === 'object' ? reply.answer : reply
    return { result: { questions: e.questions, answers: { [q.question]: answer }, annotations: {} } }
  })
  on('agent.spawn', ($, e) => {
    w.launched.push({ ...e })
    return { model: e.model ? (RESOLVED[e.model] ?? e.model) : 'claude-opus-5-5', agentId: `agent-${w.launched.length}` }
  })
  return w
}

/** Starts an agent as the Agent tool would; the engine fills what the call leaves out (its id, the parent's model). */
const spawn = ($: Engine, args: { prompt: string; description: string; subagentType: string; model?: string }) => $.agent.spawn(args as never)

const start = ($: Engine) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

const EXPLORE = { prompt: 'Find where the cache tests live and list them.', description: 'inspect cache tests', subagentType: 'Explore' }
const BUILDER = { prompt: 'Add a retry with backoff to fetchPlan in api.ts.', description: 'implement retry', subagentType: 'general-purpose' }

const PANE_PROPS = { title: 'Delegator', isFocused: false, bodyColumns: 70, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }

async function paneLines($: Engine, surface: 'terminal' | 'desktop') {
  const pane = await $.ui.mount({ plugin: 'delegator', surface, component: 'Pane', requestId: 'delegator', props: PANE_PROPS })
  const props = (await pane.find({ type: 'Client', key: 'delegator' }))?.props.props as CellsProps | undefined
  return { pane, props, lines: plain(props ?? { rows: [] }).map(l => l.trimEnd()) }
}

test('Approve launches the agent on the model its task suggests, the task as it was', { options: { askForSteps: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  w.replies.push('Approve')
  const r = await spawn($, EXPLORE)
  expect(r).toMatchObject({ model: 'claude-haiku-4-5' })
  expect(w.asked).toHaveLength(1)
  expect(w.asked[0]?.question).toBe('Launch #1 Explore "inspect cache tests" on Haiku (suggested: lookup)?')
  expect(w.asked[0]?.header).toBe('Delegator')
  expect(w.launched).toHaveLength(1)
  expect(w.launched[0]).toMatchObject({ prompt: EXPLORE.prompt, model: 'haiku' })
  expect(w.opens).toContain('delegator')
  for (const surface of ['terminal', 'desktop'] as const) {
    const { pane, lines } = await paneLines($, surface)
    expect(lines.some(l => / #1 Explore · inspect cache tests +Haiku 4\.5$/.test(l))).toBe(true)
    expect(lines.some(l => l.includes('W A I T I N G'))).toBe(false)
    await pane.unmount()
  }
})

test('each option says what it does, with no preview, so the typed answer row stays', { options: {} }, async ($, on) => {
  const w = world(on)
  await start($)
  w.replies.push('Approve')
  await spawn($, BUILDER)
  const options = w.asked[0]?.options ?? []
  expect(options.map(o => o.label)).toEqual(['Approve', 'Approve all this turn', 'Change model', 'Refuse'])
  expect(options[0]).toEqual({ label: 'Approve', description: 'Launch it as shown (full task in the Delegator pane). Or type below to add a note to its task.' })
  expect(options[3]?.description).toBe('Do not launch it; the caller is told you refused.')
})

test('Change model and a typed note reach the agent exactly as chosen', { options: { askForSteps: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  w.replies.push('Change model', 'Opus', 'only touch api.ts', 'Approve')
  const r = await spawn($, { ...BUILDER, model: 'sonnet' })
  expect(w.asked.map(a => a.question)).toEqual([
    'Launch #1 general-purpose "implement retry" on Sonnet (requested)?',
    'Model for #1 "implement retry"? Now Sonnet.',
    'Launch #1 general-purpose "implement retry" on Opus (your pick)?',
    'Launch #1 general-purpose "implement retry" on Opus (your pick)?',
  ])
  // The model question marks the one it launches on now.
  expect(w.asked[1]?.options.find(o => o.label === 'Sonnet')?.description).toBe('What it launches on now.')
  expect(w.launched[0]).toMatchObject({
    model: 'opus',
    prompt: `${BUILDER.prompt}\n\nNotes from the person who approved this agent:\n- only touch api.ts`,
  })
  expect(r).toMatchObject({ model: 'claude-opus-5-5' })
})

test('Refuse starts nothing and tells the caller', { options: {} }, async ($, on) => {
  const w = world(on)
  await start($)
  w.replies.push('Refuse')
  const r = await spawn($, BUILDER)
  expect(w.launched).toHaveLength(0)
  expect(r.deny).toContain('The person did not approve this agent (refused), so it was not started.')
  const { lines } = await paneLines($, 'terminal')
  expect(lines.some(l => /^✗ #1 general-purpose · implement retry +refused$/.test(l))).toBe(true)
})

test('no answer never launches: a dismissed dialog, and one that closed by itself while the person was away', { options: {} }, async ($, on) => {
  const w = world(on)
  await start($)
  w.replies.push(null)
  expect((await spawn($, EXPLORE)).deny).toContain('no answer')
  w.replies.push({ afk: 'Approve' })
  expect((await spawn($, EXPLORE)).deny).toContain('no answer')
  expect(w.launched).toHaveLength(0)
})

test('Approve all covers the agents waiting and those after, until the main turn ends', { options: {} }, async ($, on) => {
  const w = world(on)
  await start($)
  w.replies.push({ answer: 'Approve all this turn', after: 1000 })
  const first = spawn($, EXPLORE)
  await w.clock.settle()
  // A second agent arrives while the first one's dialog is open: it waits for that answer instead of asking.
  const second = spawn($, BUILDER)
  await w.clock.settle()
  expect(w.asked).toHaveLength(1)
  await w.clock.advance(1000)
  const both = await Promise.all([first, second])
  expect(both).toEqual([expect.objectContaining({ model: 'claude-haiku-4-5' }), expect.objectContaining({ model: 'claude-sonnet-5-5' })])
  expect(w.launched).toHaveLength(2)
  // One later in the same turn launches unasked, on its suggested model.
  await spawn($, BUILDER)
  expect(w.asked).toHaveLength(1)
  expect(w.launched[2]).toMatchObject({ model: 'sonnet' })
  const shown = await paneLines($, 'terminal')
  expect(shown.lines).toContain('Approve all is on until this turn ends.')
  expect(shown.lines.some(l => / #3 general-purpose · implement retry +Sonnet 5\.5$/.test(l))).toBe(true)
  await shown.pane.unmount()
  // A subagent's turn ending is not the main turn's.
  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 's1', reason: 'answer', agentId: 'agent-1' })
  await spawn($, BUILDER)
  expect(w.asked).toHaveLength(1)
  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  w.replies.push('Approve')
  await spawn($, BUILDER)
  expect(w.asked).toHaveLength(2)
  const after = await paneLines($, 'terminal')
  expect(after.lines).not.toContain('Approve all is on until this turn ends.')
})

test('an agent that arrives while another is asked, and gets no Approve all, is asked in turn', { options: {} }, async ($, on) => {
  const w = world(on)
  await start($)
  w.replies.push({ answer: 'Approve', after: 1000 }, 'Refuse')
  const first = spawn($, EXPLORE)
  await w.clock.settle()
  const second = spawn($, BUILDER)
  await w.clock.settle()
  await w.clock.advance(1000)
  const [a, b] = await Promise.all([first, second])
  expect(a).toMatchObject({ model: 'claude-haiku-4-5' })
  expect(b.deny).toContain('refused')
  expect(w.asked.map(q => q.question)).toEqual([
    'Launch #1 Explore "inspect cache tests" on Haiku (suggested: lookup)?',
    'Launch #2 general-purpose "implement retry" on Sonnet (suggested: building)?',
  ])
})

test('the pane shows the agent waiting and its whole task while its dialog is open', { options: {} }, async ($, on) => {
  const w = world(on)
  await start($)
  w.replies.push({ answer: 'Approve', after: 1000 })
  const held = spawn($, BUILDER)
  await w.clock.settle()
  for (const surface of ['terminal', 'desktop'] as const) {
    const { pane, lines } = await paneLines($, surface)
    expect(lines[0]).toMatch(/^DELEGATOR ● gate on +o: Turn off$/)
    expect(lines).toContain('▸ #1 general-purpose · implement retry · Sonnet')
    expect(lines).toContain(BUILDER.prompt)
    await pane.unmount()
  }
  await w.clock.advance(1000)
  await held
})

test('off, agents launch without asking; the pane, /delegator and /config turn it back on', { options: { approveAgents: false, askForSteps: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await spawn($, { ...BUILDER, model: 'haiku' })
  expect(w.asked).toHaveLength(0)
  expect(w.launched[0]).toMatchObject({ model: 'haiku', prompt: BUILDER.prompt })
  const { pane, lines } = await paneLines($, 'terminal')
  expect(lines[0]).toMatch(/^DELEGATOR ○ gate off +o: Turn on$/)
  await pane.key({ key: 'o', in: 'delegator' })
  expect(w.configSets).toEqual([['delegator.approveAgents', true]])
  expect(w.toasts.at(-1)).toBe('Delegator on: every agent Claude starts waits for your approval.')
  w.replies.push('Approve')
  await spawn($, BUILDER)
  expect(w.asked).toHaveLength(1)
  const said = await $.command.run({ command: 'delegator', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
  expect(said.text).toBe('Delegator off: agents launch without asking.')
  expect(w.configSets.at(-1)).toEqual(['delegator.approveAgents', false])
  await spawn($, BUILDER)
  expect(w.asked).toHaveLength(1)
})

test('with suggestions off, an agent with no model named runs on its own default', { options: { suggestModels: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  w.replies.push('Approve')
  await spawn($, EXPLORE)
  expect(w.asked[0]?.question).toBe('Launch #1 Explore "inspect cache tests" on the agent\'s default model?')
  expect(w.launched[0]?.model).toBe(undefined)
})

test('/clear empties the queue and the decisions', { options: {} }, async ($, on) => {
  const w = world(on)
  await start($)
  w.replies.push('Refuse')
  await spawn($, EXPLORE)
  await $.session.end({ reason: 'clear', sessionId: 's1' } as never)
  const { lines } = await paneLines($, 'terminal')
  expect(lines.some(l => l.includes('D O N E'))).toBe(false)
})

test('Approve all also ends when the person sends another prompt', { options: {} }, async ($, on) => {
  const w = world(on)
  await start($)
  w.replies.push('Approve all this turn')
  await spawn($, EXPLORE)
  await spawn($, BUILDER)
  expect(w.asked).toHaveLength(1)
  await $.prompt.submit({ text: 'now something else', origin: { kind: 'composer' } } as never)
  w.replies.push('Approve')
  await spawn($, BUILDER)
  expect(w.asked).toHaveLength(2)
})
