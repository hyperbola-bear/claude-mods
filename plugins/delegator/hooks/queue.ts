// Pure delegator logic: no `$`, so tests call it directly. Which model a task suggests, how an agent is
// asked about, what an answer means, and the pane's grid.
import type { AgentKind, Decision, DelegatorState, ModelAlias, Pending, Suggestion } from '../types'
import { builder, line, piece, runs, wrap } from './cells.ts'
import type { Grid, Run } from './cells.ts'

export const EMPTY: DelegatorState = { pending: [], recent: [], approveAllTurn: false }

/** Decisions the pane keeps. */
export const RECENT_KEPT = 8

/** The chip beside every question the delegator asks: how its own dialogs are told apart. */
export const HEADER = 'Delegator'

/** Rows of a task the pane shows before it says how many more there are. */
export const TASK_ROWS = 40

export const MODELS: readonly { alias: ModelAlias; label: string }[] = [
  { alias: 'haiku', label: 'Haiku' },
  { alias: 'sonnet', label: 'Sonnet' },
  { alias: 'opus', label: 'Opus' },
  { alias: 'fable', label: 'Fable' },
]

// ---------- the suggested model ----------

/** Agent types made for lookups, and the one made for planning. */
const LOOKUP_AGENTS = new Set(['Explore', 'claude-code-guide', 'statusline-setup'])
const PLANNING_AGENTS = new Set(['Plan'])

const HARD = /\b(architect\w*|design\w*|root.cause|security|audit\w*|threat|tradeoffs?|trade-offs?)\b/i
const BUILD = /\b(implement\w*|fix\w*|writ\w*|build\w*|add\w*|refactor\w*|updat\w*|review\w*|debug\w*|migrat\w*|port\w*|chang\w*)\b/i
const LOOKUP = /\b(find\w*|search\w*|list\w*|locat\w*|grep\w*|look\w* up|summar\w*|count\w*|check\w*|read\w*|inspect\w*|explor\w*|scan\w*)\b/i

/** Past this many characters a task is no quick lookup, whatever its words. */
const LONG_TASK = 6000

/**
 * The model a task's complexity calls for: Haiku for lookups, Sonnet for building, Opus for design and
 * deep analysis. Read off the agent type, then the short description, then the start of the task.
 */
export function suggestModel(a: { subagentType: string; description: string; prompt: string }): Suggestion {
  if (PLANNING_AGENTS.has(a.subagentType)) return { model: 'opus', reason: 'planning' }
  const long = a.prompt.length > LONG_TASK
  if (LOOKUP_AGENTS.has(a.subagentType) && !long) return { model: 'haiku', reason: 'lookup' }
  for (const text of [a.description, a.prompt.slice(0, 400)]) {
    if (HARD.test(text)) return { model: 'opus', reason: 'design or analysis' }
    if (BUILD.test(text)) return { model: 'sonnet', reason: 'building' }
    if (LOOKUP.test(text) && !long) return { model: 'haiku', reason: 'lookup' }
  }
  return { model: 'sonnet', reason: long ? 'long task' : 'general task' }
}

// ---------- the queue ----------

/** What the delegator reads off an `agent.spawn`. */
export type SpawnFacts = {
  description: string
  subagentType: string
  prompt: string
  model?: string
  parentModel: string
  parentAgentId?: string
  fork: boolean
  isTeammate?: true
  workflow?: unknown
}

export function kindOf(e: Pick<SpawnFacts, 'fork' | 'isTeammate' | 'workflow'>): AgentKind {
  if (e.workflow !== undefined) return 'workflow'
  if (e.fork) return 'fork'
  return e.isTeammate ? 'teammate' : 'agent'
}

/** Whether the person may change this agent's model. */
export const canPickModel = (kind: AgentKind) => kind === 'agent' || kind === 'teammate'

/** Whether the person may add to this agent's task. */
export const canEditTask = (kind: AgentKind) => kind !== 'workflow'

/**
 * A held agent: the model it launches on is the caller's request, else (where models can be picked and
 * suggestions are on) the suggestion, else the agent's own default.
 */
export function makePending(e: SpawnFacts, n: number, suggests: boolean): Pending {
  const kind = kindOf(e)
  const suggestion = suggests && canPickModel(kind) ? suggestModel(e) : null
  const requested = e.model ?? null
  return {
    n,
    description: e.description,
    subagentType: e.subagentType,
    prompt: e.prompt,
    notes: [],
    requested,
    model: canPickModel(kind) ? (requested ?? suggestion?.model ?? null) : requested,
    suggestion,
    parentModel: e.parentModel,
    kind,
    isNested: e.parentAgentId !== undefined,
  }
}

/** The task the agent is given: the caller's, then the person's notes. */
export function taskOf(p: Pick<Pending, 'prompt' | 'notes'>): string {
  if (p.notes.length === 0) return p.prompt
  return `${p.prompt}\n\nNotes from the person who approved this agent:\n${p.notes.map(n => `- ${n}`).join('\n')}`
}

/** A model as people say it: `Haiku`, `Opus 5.5` for a full id, the id itself otherwise. */
export function modelName(model: string): string {
  const alias = MODELS.find(m => m.alias === model.toLowerCase())
  if (alias) return alias.label
  const id = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[1m\])?$/.exec(model)
  const [, name = '', major = '', minor] = id ?? []
  if (!id || name === '') return model
  const family = name.charAt(0).toUpperCase() + name.slice(1)
  return minor ? `${family} ${major}.${minor}` : `${family} ${major}`
}

/** Where the agent's model comes from, in a few words. */
export function modelPhrase(p: Pending): string {
  if (p.kind === 'fork') return `the parent's model (${modelName(p.parentModel)})`
  if (p.model === null) return "the agent's default model"
  const name = modelName(p.model)
  if (p.requested !== null && p.model === p.requested) return `${name} (requested)`
  if (p.suggestion && p.model === p.suggestion.model) return `${name} (suggested: ${p.suggestion.reason})`
  return `${name} (your pick)`
}

const quoted = (s: string) => `"${s.length > 60 ? `${s.slice(0, 59)}…` : s}"`

/** The question the dialog asks; its number keeps it apart from every other one open. */
export function question(p: Pending): string {
  const who = p.isNested ? ' (from a subagent)' : ''
  if (p.kind === 'workflow') return `Launch #${p.n} workflow agent ${quoted(p.description)}${who}?`
  return `Launch #${p.n} ${p.subagentType} ${quoted(p.description)}${who} on ${modelPhrase(p)}?`
}

export const APPROVE = 'Approve'
export const APPROVE_ALL = 'Approve all this turn'
export const CHANGE_MODEL = 'Change model'
export const REFUSE = 'Refuse'

export function optionsOf(p: Pending): string[] {
  return canPickModel(p.kind) ? [APPROVE, APPROVE_ALL, CHANGE_MODEL, REFUSE] : [APPROVE, APPROVE_ALL, REFUSE]
}

/**
 * The line under each option, which `$.ui.ask` leaves empty. No preview: a dialog with one drops its typed
 * answer row, which is how a note is added; the pane shows the full task instead.
 */
export function optionDetail(p: Pending, label: string): { description: string } {
  const typing = canEditTask(p.kind) ? ' Or type below to add a note to its task.' : ''
  if (label === APPROVE) return { description: `Launch it as shown (full task in the Delegator pane).${typing}` }
  if (label === APPROVE_ALL) return { description: 'Launch this and every agent until this turn ends, unasked.' }
  if (label === CHANGE_MODEL) return { description: 'Pick Haiku, Sonnet, Opus or Fable, then decide.' }
  if (label === REFUSE) return { description: 'Do not launch it; the caller is told you refused.' }
  return { description: '' }
}

export type MainAnswer = { kind: 'approve' | 'approveAll' | 'model' | 'refuse' } | { kind: 'note'; text: string } | { kind: 'unknown' }

/** What an answer to the main question asks for: a label, or text typed under Other (a note for the task). */
export function parseMain(answer: string, p: Pending): MainAnswer {
  const a = answer.trim()
  if (a === APPROVE) return { kind: 'approve' }
  if (a === APPROVE_ALL) return { kind: 'approveAll' }
  if (a === CHANGE_MODEL && canPickModel(p.kind)) return { kind: 'model' }
  if (a === REFUSE) return { kind: 'refuse' }
  if (a !== '' && canEditTask(p.kind)) return { kind: 'note', text: a }
  return { kind: 'unknown' }
}

export function modelQuestion(p: Pending): string {
  return `Model for #${p.n} ${quoted(p.description)}? Now ${p.model === null ? "the agent's default" : modelName(p.model)}.`
}

export const modelOptions = (): string[] => MODELS.map(m => m.label)

/**
 * The model an answer names: an alias or its label, a full `claude-` id, or `default` / `inherit` for the
 * agent's own (null). Undefined when it names none, so the model stays.
 */
export function parseModel(answer: string): string | null | undefined {
  const a = answer.trim()
  const alias = MODELS.find(m => m.label.toLowerCase() === a.toLowerCase() || m.alias === a.toLowerCase())
  if (alias) return alias.alias
  if (/^(default|inherit)$/i.test(a)) return null
  if (/^claude-[a-z0-9.-]+(\[1m\])?$/i.test(a)) return a
  return undefined
}

export function decided(p: Pending, outcome: Decision['outcome'], model: string | null, at: number, reason?: string): Decision {
  return { n: p.n, description: p.description, subagentType: p.subagentType, outcome, model, at, ...(reason ? { reason } : {}) }
}

/** The state with a decision made on `n`: out of the queue, at the head of the recent ones. */
export function settle(s: DelegatorState, n: number, d: Decision): DelegatorState {
  return { ...s, pending: s.pending.filter(p => p.n !== n), recent: [d, ...s.recent].slice(0, RECENT_KEPT) }
}

// ---------- the pane ----------

const divider = (label: string, width: number): Run[] => {
  const head = `── ${label.split('').join(' ')} `
  return runs(head + '─'.repeat(Math.max(0, width - head.length)), { isDim: true })
}

/** The task as rows: its own line breaks kept, each line wrapped, capped at `max` rows. */
export function taskRows(task: string, width: number, max = TASK_ROWS): Run[][] {
  const rows: Run[][] = []
  for (const para of task.split('\n')) {
    if (para.trim() === '') rows.push([])
    else rows.push(...wrap(para, width))
  }
  if (rows.length <= max) return rows
  return [...rows.slice(0, max - 1), runs(`… ${rows.length - max + 1} more lines`, { isDim: true })]
}

const pendingLine = (p: Pending) =>
  `#${p.n} ${p.subagentType} · ${p.description} · ${p.kind === 'fork' ? 'parent model' : p.model === null ? 'agent default' : modelName(p.model)}`

const OUTCOME: Record<Decision['outcome'], { mark: string; color: string; label: string }> = {
  approved: { mark: '✓', color: 'success', label: 'approved' },
  auto: { mark: '◆', color: 'success', label: 'auto-approved' },
  refused: { mark: '✗', color: 'error', label: 'refused' },
}

/** The pane: on or off, the agents waiting, the first one's full task, and the decisions made. */
export function paneGrid(s: DelegatorState, width: number, isOn: boolean): Grid & { keys: Record<string, string> } {
  const b = builder()
  const head = line(
    width,
    [piece('DELEGATOR', { isBold: true }), isOn ? piece('● on', { color: 'success' }) : piece('○ off', { isDim: true })],
    [piece(isOn ? ' Turn off ' : ' Turn on ', { bg: 'subtle' }, 'toggle')],
  )
  b.add(head.row, head.spans)
  if (s.approveAllTurn) b.add(runs('Approve all is on until this turn ends.', { color: 'warning' }))
  b.add(divider('PENDING', width))
  if (s.pending.length === 0) {
    const idle = isOn ? 'No agent waiting. Each agent Claude starts waits here for your approval.' : 'Off: agents launch without asking.'
    for (const row of wrap(idle, width, { isDim: true })) b.add(row)
  }
  s.pending.forEach((p, i) => {
    const row = line(width, [piece(i === 0 ? '▸' : ' ', { color: 'warning' }), piece(pendingLine(p), { isBold: i === 0 })])
    b.add(row.row)
  })
  const first = s.pending[0]
  if (first) {
    b.add(divider(`TASK #${first.n}`, width))
    for (const row of taskRows(taskOf(first), width)) b.add(row)
  }
  if (s.recent.length > 0) {
    b.add(divider('RECENT', width))
    for (const d of s.recent) {
      const o = OUTCOME[d.outcome]
      const what = `#${d.n} ${d.subagentType} · ${d.description} · ${d.outcome === 'refused' ? (d.reason ?? o.label) : `${o.label} on ${d.model ? modelName(d.model) : 'its default'}`}`
      b.add(line(width, [piece(o.mark, { color: o.color }), piece(what, { isDim: d.outcome === 'refused' })]).row)
    }
  }
  return { ...b.grid, keys: { o: 'toggle' } }
}
