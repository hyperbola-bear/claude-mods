/**
 * delegator: every subagent Claude starts waits for your approval first.
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
 * - The Delegator pane lists the agents waiting, the first one's full task and
 *   the recent decisions, drawn as one grid of cells, the same on the terminal
 *   and the desktop. Its Turn off (o) and `/delegator on|off` flip the gate.
 * - Nothing launches unapproved: a dismissed or interrupted dialog, a headless
 *   run, a dialog that closed by itself while you were away, and the hook
 *   failing all refuse the agent.
 *
 * Reaches: ui.ask (the dialogs), tool.call of AskUserQuestion (only its own
 * dialogs: the line under each option, and whether it closed by itself),
 * config.set (its own row), ui.open (its pane), clock (the wait for another
 * agent's answer).
 */
import type { AgentSpawnResult, BoxProps, ButtonProps, ClientProps, ElementConstructor, EngineInterface, Register, TextProps } from 'claude-code'

import type { DelegatorState, Pending } from '../types'
import type { CellsProps, Grid } from './cells.ts'
import {
  EMPTY,
  HEADER,
  canEditTask,
  canPickModel,
  decided,
  makePending,
  modelName,
  modelOptions,
  modelQuestion,
  optionDetail,
  optionsOf,
  paneGrid,
  parseMain,
  parseModel,
  question,
  settle,
  taskOf,
} from './queue.ts'
import type { SpawnFacts } from './queue.ts'

const PANE = 'delegator'

/** How long an agent that arrives while another's dialog is open waits for that answer before asking its own. */
const FOLLOW_WAIT_MS = 6000

type Cfg = { isOn: boolean; suggests: boolean }

export function readCfg(o: Record<string, unknown>): Cfg {
  const b = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  return { isOn: b(o.approveAgents, true), suggests: b(o.suggestModels, true) }
}

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

function wake() {
  const woken = waiters
  waiters = []
  for (const w of woken) w()
}

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

/** Launches the agent with the task and model as they stand, and records the model the engine resolved. */
async function launch(
  $: EngineInterface,
  e: SpawnFacts & Record<string, unknown>,
  p: Pending,
  next: (e: never) => Promise<AgentSpawnResult>,
  outcome: 'approved' | 'auto',
): Promise<AgentSpawnResult> {
  let edited: Record<string, unknown> = e
  if (p.kind !== 'workflow') {
    if (canEditTask(p.kind) && p.notes.length > 0) edited = { ...edited, prompt: taskOf(p) }
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

function paneElement(ui: Ui, surface: string, grid: Grid & { keys: Record<string, string> }, width: number, onAction: (a: string) => void) {
  if ((surface === 'terminal' || surface === 'desktop') && !gridFaults.has(surface) && ui.Client) {
    const props: CellsProps = { rows: grid.rows, hits: grid.hits, keys: grid.keys }
    return <ui.Client key="delegator" module="./cellsclient.tsx" props={props} width={width} height={grid.rows.length} />
  }
  const { Box, Text, Button } = ui
  return (
    <Box key="delegator" flexDirection="column">
      {grid.rows.map((row, y) => (
        <Text key={`row-${y}`} wrap="truncate">
          {row.length === 0 ? ' ' : null}
          {row.map((run, i) => (
            <Text key={`run-${y}-${i}`} color={run.color || undefined} backgroundColor={run.bg || undefined} dimColor={run.isDim} bold={run.isBold}>
              {run.text}
            </Text>
          ))}
        </Text>
      ))}
      <Button label="Turn on/off" hotkey="o" onPress={() => onAction('toggle')} />
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

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'delegator', description: 'Show the subagents waiting for approval; /delegator on or off turns the gate on or off' })
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    if (!cfg.isOn) return next(e)
    const n = 1 + Math.max(0, ...view.pending.map(p => p.n), ...view.recent.map(d => d.n))
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

  // Approve all lasts until the main turn it was chosen in ends, or the person sends another prompt
  // (agents a command starts run outside any turn).
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && view.approveAllTurn) setView($, s => ({ ...s, approveAllTurn: false }))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind === 'composer' && view.approveAllTurn) setView($, s => ({ ...s, approveAllTurn: false }))
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') setView($, () => EMPTY)
    return next(e)
  })

  on('command.run', { command: 'delegator' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') return { text: await setOn($, arg === 'on') }
    await $.ui.open({ id: PANE, title: 'Delegator' }).catch(() => {})
    const s = view
    const state = cfg.isOn ? 'on: every agent Claude starts waits for your approval' : 'off: agents launch without asking'
    const waiting = s.pending.length > 0 ? ` ${s.pending.length} waiting.` : ''
    return { text: `Delegator ${state}.${waiting} /delegator ${cfg.isOn ? 'off' : 'on'} to turn it ${cfg.isOn ? 'off' : 'on'}.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui: Ui = $.ui.resolve(e)
    const width = Math.max(40, e.props.bodyColumns)
    const grid = paneGrid(view, width, cfg.isOn)
    return paneElement(ui, e.surface, grid, width, a => void runAction($, a))
  })

  on('ui.message', async ($, e, next) => {
    if (e.module.endsWith('cellsclient.tsx')) await runAction($, (e.data as { action?: unknown } | null)?.action).catch(() => {})
    return next(e)
  })

  // Where the grid fails to draw, that surface gets text rows and a button from then on.
  on('ui.fault', async ($, e, next) => {
    if (e.module.endsWith('cellsclient.tsx') && !gridFaults.has(e.surface)) {
      gridFaults.add(e.surface)
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })
}

async function runAction($: EngineInterface, action: unknown) {
  if (action === 'toggle') $.ui.toast(await setOn($, !cfg.isOn))
}

