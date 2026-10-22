/**
 * delegator: every subagent Claude starts waits for your approval first, then shows in a pane as it runs.
 *
 * - Each `agent.spawn` is held in the engine's own question dialog: Approve,
 *   Approve all this turn, Change model, or Refuse; text typed under Other is
 *   added to the agent's task as a note. The dialog is the hold because a `$`
 *   call stops the hook's clock: a pane's button would leave the hook to run
 *   out its budget, and a failed guard lets the agent start.
 * - The model it launches on is the caller's request, else the one the task's
 *   complexity suggests (Haiku for lookups, Sonnet for building, Opus for
 *   design and analysis), else the agent's own default. Forks always run on the
 *   parent's model; a workflow's agents can only be approved or refused.
 * - Every agent that launches, approved or with the gate off, is tracked on the
 *   number the queue gave it: its context, tokens and estimated cost from each
 *   model request (`turn.step`), its end (`turn.complete`), and the steps it
 *   reports through the `step` tool. An orchestrating session reports its plan
 *   through `progress`; while that flow runs, a band above the prompt shows it.
 * - The Delegator pane lists the agents waiting with the first one's full task,
 *   each running agent as its character beside its context battery, tokens,
 *   cost, time and steps, the agents done, and the flow's tasks still planned,
 *   drawn as one grid of cells, the same on the terminal and the desktop. Its
 *   Turn off (o) and `/delegator on|off` flip the gate; c hides the agents done.
 * - Nothing launches unapproved: a dismissed or interrupted dialog, a headless
 *   run, a dialog that closed by itself while you were away, and the hook
 *   failing all refuse the agent.
 *
 * Reaches: ui.ask (the dialogs), tool.call of AskUserQuestion (only its own
 * dialogs: the line under each option, and whether it closed by itself),
 * tool.register (its step and progress tools), config.set (its own row),
 * ui.open (its pane), state (what it tracks of the agents), clock (the wait
 * for another agent's answer, and the characters' frames).
 */
import { atom, read, update } from 'claude-code'
import type { AgentSpawnResult, BoxProps, ButtonProps, ClientProps, ElementConstructor, EngineInterface, Register, TextProps, Timer } from 'claude-code'

import type { AgentRun, DelegatorState, Pending, Tracking } from '../types'
import type { CellsProps } from './cells.ts'
import { bandGrid, paneGrid } from './pane.ts'
import type { CellsGrid } from './pane.ts'
import {
  EMPTY,
  HEADER,
  canPickModel,
  decided,
  kindOf,
  launchTask,
  makePending,
  modelName,
  modelOptions,
  modelQuestion,
  optionDetail,
  optionsOf,
  parseMain,
  parseModel,
  question,
  settle,
} from './queue.ts'
import type { SpawnFacts } from './queue.ts'
import { NO_TRACKING, addRun, endRun, reportFlow, reportSteps, startRun, stepRun } from './runs.ts'

const PANE = 'delegator'

/** How long an agent that arrives while another's dialog is open waits for that answer before asking its own. */
const FOLLOW_WAIT_MS = 6000

const FRAME_MS = 650

type Cfg = { isOn: boolean; suggests: boolean; animates: boolean; asksSteps: boolean }

export function readCfg(o: Record<string, unknown>): Cfg {
  const b = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  return {
    isOn: b(o.approveAgents, true),
    suggests: b(o.suggestModels, true),
    animates: b(o.animateCharacters, true),
    asksSteps: b(o.askForSteps, true),
  }
}

// Held by the host, so a reload (each /config change is one) keeps the agents it tracks. Every change goes
// through `update`, which writes again on a miss, so hooks running at once keep each other's changes.
const tracking = atom({ plugin: 'delegator', key: 'tracking' } as const, NO_TRACKING)
// The characters' frame: only the pane reads it, so a tick redraws the pane and not the band.
const frameA = atom({ plugin: 'delegator', key: 'frame' } as const, 0)

type Ui = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Client?: ElementConstructor<ClientProps>
}

// Module state: set by register(); lost on a reload. The queue lives here, not in `$.state`: every hook
// running at once shares the module, while a `$.state` read inside one dispatch does not see another's write.
let view: DelegatorState = EMPTY
let options: Record<string, unknown> = {}
let cfg: Cfg = readCfg({})
/** The questions open now, each with its agent: how the tool.call hook knows its own dialogs. */
const asking = new Map<string, Pending>()
/** Questions whose dialog closed by itself while the person was away. */
const afk = new Set<string>()
/** Agents waiting for another's answer, woken by any decision. */
let waiters: (() => void)[] = []
const gridFaults = new Set<string>()
let ticker: Timer | null = null

function wake() {
  const woken = waiters
  waiters = []
  for (const w of woken) w()
}

const isRunning = (runs: readonly AgentRun[]) => runs.some(r => r.status === 'running')

function stopTicker() {
  ticker?.cancel()
  ticker = null
}

/** Moves the characters while any agent runs and the row allows it; no timer otherwise. */
function animate($: EngineInterface, runs: readonly AgentRun[]) {
  if (cfg.animates && isRunning(runs) && ticker === null) ticker = $.clock.every(FRAME_MS, () => void tick($))
  else if (!(cfg.animates && isRunning(runs))) stopTicker()
}

// Checks again before each frame: two changes that settle out of order could have started it after the last agent ended.
async function tick($: EngineInterface) {
  if (!isRunning((await read($, tracking)).runs)) return stopTicker()
  await update($, frameA, f => f + 1)
}

/** Changes what it tracks (the pane and the band read it, so they redraw) and starts or stops the animation. */
async function track($: EngineInterface, change: (t: Tracking) => Tracking): Promise<Tracking> {
  const t = await update($, tracking, change)
  animate($, t.runs)
  return t
}

/** Whether an agent is asked to report its steps: the row on, and no resumed run, whose task the engine keeps. */
const asksSteps = (e: SpawnFacts) => cfg.asksSteps && e.resume === undefined

const newRun = (e: SpawnFacts, n: number, agentId: string, model: string, at: number): AgentRun =>
  startRun({ n, agentId, type: e.subagentType, description: e.description, model, at })

/** Changes the queue and redraws the pane. */
function setView($: EngineInterface, change: (s: DelegatorState) => DelegatorState) {
  view = change(view)
  $.ui.invalidate('ui.render')
}

/** The agent as it stands now, the person's edits included. */
const current = (p: Pending): Pending => view.pending.find(x => x.n === p.n) ?? p

function edit($: EngineInterface, n: number, change: (p: Pending) => Pending) {
  setView($, s => ({ ...s, pending: s.pending.map(p => (p.n === n ? change(p) : p)) }))
}

/** Asks one of its own questions; null when nobody answered (dismissed, interrupted, headless, or away). */
async function ask($: EngineInterface, q: string, p: Pending, labels: string[]): Promise<string | null> {
  asking.set(q, p)
  try {
    const answer = await $.ui.ask(q, { header: HEADER, options: labels })
    return afk.delete(q) ? null : answer
  } catch {
    return null
  } finally {
    asking.delete(q)
  }
}

/** Launches the agent with the task and model as they stand, records the model the engine resolved, and tracks it. */
async function launch(
  $: EngineInterface,
  e: SpawnFacts & Record<string, unknown>,
  p: Pending,
  next: (e: never) => Promise<AgentSpawnResult>,
  outcome: 'approved' | 'auto',
): Promise<AgentSpawnResult> {
  let edited: Record<string, unknown> = e
  if (p.kind !== 'workflow') {
    const task = launchTask(p, asksSteps(e))
    if (task !== e.prompt) edited = { ...edited, prompt: task }
    if (canPickModel(p.kind) && p.model !== null) edited = { ...edited, model: p.model }
    if (canPickModel(p.kind) && p.model === null && edited.model !== undefined) {
      const { model: _, ...rest } = edited
      edited = rest
    }
  }
  const r = await next(edited as never)
  const at = await $.clock.now()
  setView($, s => settle(s, p.n, decided(p, r.deny === undefined ? outcome : 'refused', r.deny === undefined ? r.model : null, at, r.deny)))
  wake()
  // An agent with no id started no loop (a hook answered in its place, or it runs remotely): nothing would report on it.
  const agentId = r.agentId
  if (agentId !== undefined) await track($, t => ({ ...t, runs: addRun(t.runs, newRun(e, p.n, agentId, r.model, at)) }))
  return r
}

async function refuse($: EngineInterface, p: Pending, reason: string): Promise<AgentSpawnResult> {
  const at = await $.clock.now()
  setView($, s => settle(s, p.n, decided(p, 'refused', null, at, reason)))
  wake()
  return {
    deny: `The person did not approve this agent (${reason}), so it was not started. Do not start it again unless they ask; carry on without it or ask them what they want.`,
  }
}

/** Writes its own /config row; the engine reloads the module with it, and this applies it at once. */
async function setOn($: EngineInterface, isOn: boolean): Promise<string> {
  const r = await $.config.set({ key: 'delegator.approveAgents', value: isOn }).catch(err => ({ deny: String(err).slice(0, 120) }))
  if (r.deny !== undefined) return `Could not turn the delegator ${isOn ? 'on' : 'off'}: ${r.deny}`
  options = { ...options, approveAgents: isOn }
  cfg = readCfg(options)
  $.ui.invalidate('ui.render')
  const held = view.pending.length
  if (isOn) return 'Delegator on: every agent Claude starts waits for your approval.'
  return held > 0
    ? `Delegator off: new agents launch without asking. The ${held} already waiting still need an answer in their dialogs.`
    : 'Delegator off: agents launch without asking.'
}

/** Where the grid cannot be painted (VS Code, mobile, a surface where it failed), its actions as buttons. */
type Fallback = { action: string; label: string; hotkey?: string }

const PANE_BUTTONS: readonly Fallback[] = [
  { action: 'toggle', label: 'Turn on/off', hotkey: 'o' },
  { action: 'done', label: 'Show/hide done', hotkey: 'c' },
]
const BAND_BUTTONS: readonly Fallback[] = [{ action: 'open', label: 'Agents' }]

function cellsElement(ui: Ui, surface: string, key: string, grid: CellsGrid, width: number, buttons: readonly Fallback[], onAction: (a: string) => void) {
  if ((surface === 'terminal' || surface === 'desktop') && !gridFaults.has(surface) && ui.Client) {
    const props: CellsProps = { rows: grid.rows, hits: grid.hits, keys: grid.keys }
    return <ui.Client key={key} module="./cellsclient.tsx" props={props} width={width} height={grid.rows.length} />
  }
  const { Box, Text, Button } = ui
  return (
    <Box key={key} flexDirection="column">
      {grid.rows.map((row, y) => (
        <Text key={`${key}-row-${y}`} wrap="truncate">
          {row.length === 0 ? ' ' : null}
          {row.map((run, i) => (
            <Text key={`${key}-run-${y}-${i}`} color={run.color || undefined} backgroundColor={run.bg || undefined} dimColor={run.isDim} bold={run.isBold}>
              {run.text}
            </Text>
          ))}
        </Text>
      ))}
      {buttons.map(b => (
        <Button key={`${key}-${b.action}`} label={b.label} hotkey={b.hotkey} onPress={() => onAction(b.action)} />
      ))}
    </Box>
  )
}

export const register: Register = (on, given) => {
  options = { ...((given ?? {}) as Record<string, unknown>) }
  cfg = readCfg(options)
  view = EMPTY
  asking.clear()
  afk.clear()
  waiters = []
  gridFaults.clear()
  ticker = null

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'delegator', description: 'Show the subagents waiting for approval and running; /delegator on or off turns the gate on or off' })
    await $.tool.register({
      name: 'step',
      description:
        "For a subagent: report progress on your own task to the person's Delegator pane. " +
        'Right after reading your task, call it with `total` (your plan in 3 to 8 steps) and `done: 0`; ' +
        'call it again with `done` and a few-word `note` as each step finishes. Cheap and silent: it only draws your progress.',
      inputSchema: {
        type: 'object',
        properties: {
          done: { type: 'integer', minimum: 0, description: 'Steps finished so far.' },
          total: { type: 'integer', minimum: 1, description: 'Steps planned; may change if the plan changes.' },
          note: { type: 'string', description: 'The step in progress, a few words.' },
        },
        required: ['done'],
      },
      // In every agent's tool list, not behind ToolSearch: an agent does not go looking for it.
      isDeferred: false,
    })
    await $.tool.register({
      name: 'progress',
      description:
        "For the main session orchestrating subagents: report the plan's progress to the band above the prompt and the Delegator pane. " +
        'Call it after presenting the plan (title, total, tasks, phase "delegate"), each time a task is accepted (done), ' +
        'when switching phase or re-planning (tasks), and once at the end with finished: true. Fields left out keep their value. ' +
        'A call from a subagent is ignored (agents report with `step`).',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short name of the overall task, a few words.' },
          total: { type: 'integer', minimum: 0, description: 'Number of planned worker tasks.' },
          done: { type: 'integer', minimum: 0, description: 'Number of tasks accepted after review.' },
          phase: { type: 'string', enum: ['plan', 'design', 'delegate', 'review', 'close'] },
          finished: { type: 'boolean', description: 'True once the flow is closed.' },
          tasks: {
            type: 'array',
            description:
              'The planned worker tasks in order, numbered from 1. Each title must equal the Agent tool `description` the task will be launched with, so the pane can match agents to tasks.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'A few words; reused verbatim as the Agent description.' },
                tier: { type: 'string', enum: ['fable', 'heavy', 'careful', 'medium', 'light'] },
                after: { type: 'array', items: { type: 'integer' }, description: 'Numbers of the tasks this one waits for.' },
              },
              required: ['title'],
            },
          },
        },
      },
    })
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    // With the gate off the agent launches first and takes its number as it is tracked, so nothing here can hold it.
    if (!cfg.isOn) {
      const task = launchTask({ prompt: e.prompt, notes: [], kind: kindOf(e) }, asksSteps(e))
      const r = await next(task === e.prompt ? e : { ...e, prompt: task })
      const agentId = r.agentId
      if (agentId !== undefined) {
        const at = await $.clock.now()
        await track($, t => ({ ...t, issued: t.issued + 1, runs: addRun(t.runs, newRun(e, t.issued + 1, agentId, r.model, at)) }))
      }
      return r
    }
    const { issued: n } = await update($, tracking, t => ({ ...t, issued: t.issued + 1 }))
    const item = makePending(e, n, cfg.suggests)
    const isAuto = view.approveAllTurn
    if (!isAuto) setView($, s => ({ ...s, pending: [...s.pending, item] }))
    if (isAuto) return launch($, e, item, next, 'auto')
    await $.ui.open({ id: PANE, title: 'Delegator' }).catch(() => {})

    // Another agent's dialog is open: wait a moment for that answer, so Approve all there covers this one unasked.
    const wait = Math.min(FOLLOW_WAIT_MS, next.budget.remainingMs - 3000)
    if (asking.size > 0 && wait > 0) await Promise.race([new Promise<void>(r => waiters.push(r)), $.clock.sleep(wait)])
    if (view.approveAllTurn) return launch($, e, current(item), next, 'auto')

    for (;;) {
      const p = current(item)
      const answer = await ask($, question(p), p, optionsOf(p))
      if (answer === null) return refuse($, p, 'no answer: the dialog was dismissed or interrupted, or no one could be asked')
      const a = parseMain(answer, p)
      if (a.kind === 'approve') return launch($, e, p, next, 'approved')
      if (a.kind === 'approveAll') {
        setView($, s => ({ ...s, approveAllTurn: true }))
        return launch($, e, p, next, 'approved')
      }
      if (a.kind === 'refuse') return refuse($, p, 'refused')
      if (a.kind === 'note') edit($, p.n, x => ({ ...x, notes: [...x.notes, a.text] }))
      if (a.kind === 'model') {
        const picked = await ask($, modelQuestion(p), p, modelOptions())
        const model = picked === null ? undefined : parseModel(picked)
        if (model !== undefined) edit($, p.n, x => ({ ...x, model }))
      }
    }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'The delegator failed before this agent was approved, so it was not started.' }))

  // Its own dialogs only: a line under each option, the full task beside Approve, and whether it closed by itself.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const q = e.questions[0]
    const p = q && q.header === HEADER ? asking.get(q.question) : undefined
    if (!q || !p) return next(e)
    const isMain = q.question === question(p)
    const options = q.options.map(o => {
      if (isMain) return { ...o, ...optionDetail(p, o.label) }
      const isNow = p.model !== null && modelName(p.model) === o.label
      return { ...o, description: isNow ? 'What it launches on now.' : '' }
    })
    const r = await next({ ...e, questions: [{ ...q, options }, ...e.questions.slice(1)] })
    const closed = r.result as { afkTimeoutMs?: number } | undefined
    if (closed?.afkTimeoutMs !== undefined) afk.add(q.question)
    return r
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const agentId = e.agentId
    const usage = result.usage
    if (agentId === undefined || usage === null || !(await isTracked($, agentId))) return result
    await track($, t => ({ ...t, runs: stepRun(t.runs, agentId, usage, e.model) }))
    return result
  })

  // Approve all lasts until the main turn it was chosen in ends, or the person sends another prompt
  // (agents a command starts run outside any turn).
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && view.approveAllTurn) setView($, s => ({ ...s, approveAllTurn: false }))
    const agentId = e.agentId
    if (agentId !== undefined && (await isTracked($, agentId))) {
      const at = await $.clock.now()
      await track($, t => ({ ...t, runs: endRun(t.runs, agentId, e.reason, e.usage, at) }))
    }
    return next(e)
  })

  on('tool.call', { tool: 'mcp__delegator__step' }, async ($, e) => {
    const agentId = e.agentId
    if (agentId === undefined) return { result: 'ignored: only a subagent reports its steps' }
    let isMatched = false
    await track($, t => {
      const runs = reportSteps(t.runs, agentId, e)
      isMatched = runs !== null
      return runs === null ? t : { ...t, runs }
    })
    return { result: isMatched ? 'ok' : `ignored: the Delegator has no agent ${agentId}` }
  })

  on('tool.call', { tool: 'mcp__delegator__progress' }, async ($, e) => {
    if (e.agentId !== undefined) return { result: 'ignored: only the main session reports the flow' }
    const t = await track($, x => reportFlow(x, e))
    const f = t.flow
    return { result: f ? `ok: ${f.title} · ${f.isFinished ? 'finished' : f.phase}, ${f.done}/${f.total} accepted` : 'ok' }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind === 'composer' && view.approveAllTurn) setView($, s => ({ ...s, approveAllTurn: false }))
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      setView($, () => EMPTY)
      await track($, () => NO_TRACKING)
    }
    return next(e)
  })

  on('command.run', { command: 'delegator' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') return { text: await setOn($, arg === 'on') }
    await $.ui.open({ id: PANE, title: 'Delegator' }).catch(() => {})
    const s = view
    const runs = (await read($, tracking)).runs.filter(r => r.status === 'running').length
    const state = cfg.isOn ? 'on: every agent Claude starts waits for your approval' : 'off: agents launch without asking'
    const waiting = s.pending.length > 0 ? ` ${s.pending.length} waiting.` : ''
    const running = runs > 0 ? ` ${runs} running.` : ''
    return { text: `Delegator ${state}.${waiting}${running} /delegator ${cfg.isOn ? 'off' : 'on'} to turn it ${cfg.isOn ? 'off' : 'on'}.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui: Ui = $.ui.resolve(e)
    const width = Math.max(40, e.props.bodyColumns)
    const grid = paneGrid(view, await read($, tracking), width, cfg.isOn, { at: await $.clock.now(), frame: await read($, frameA), asksSteps: cfg.asksSteps })
    return cellsElement(ui, e.surface, 'delegator', grid, width, PANE_BUTTONS, a => void runAction($, a))
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const t = await read($, tracking)
    const flow = t.flow
    if (flow === null || flow.isFinished || e.props.hasSurvey) return next(e)
    // The engine's own drawing ({ type: 'engine' }) is never nested: the desktop drops a band that nests it.
    const drawn = await next(e).catch(() => null)
    const below = drawn?.type === 'engine' ? null : drawn
    const ui: Ui = $.ui.resolve(e)
    const width = Math.max(20, e.props.bodyColumns)
    const band = bandGrid(flow, t.runs.filter(r => r.status === 'running').length, width)
    return (
      <ui.Box flexDirection="column" flexGrow={1}>
        {cellsElement(ui, e.surface, 'delegator-band', band, width, BAND_BUTTONS, a => void runAction($, a))}
        {below}
      </ui.Box>
    )
  })

  on('ui.message', async ($, e, next) => {
    if (e.module.endsWith('cellsclient.tsx')) await runAction($, (e.data as { action?: unknown } | null)?.action).catch(() => {})
    return next(e)
  })

  // Where the grid fails to draw, that surface gets text rows and buttons from then on.
  on('ui.fault', async ($, e, next) => {
    if (e.module.endsWith('cellsclient.tsx') && !gridFaults.has(e.surface)) {
      gridFaults.add(e.surface)
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })
}

async function isTracked($: EngineInterface, agentId: string): Promise<boolean> {
  return (await read($, tracking)).runs.some(r => r.agentId === agentId)
}

async function runAction($: EngineInterface, action: unknown) {
  if (action === 'toggle') $.ui.toast(await setOn($, !cfg.isOn))
  if (action === 'done') await track($, t => ({ ...t, isDoneHidden: !t.isDoneHidden }))
  if (action === 'open') await $.ui.open({ id: PANE, title: 'Delegator' })
}

