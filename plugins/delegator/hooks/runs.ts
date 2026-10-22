// The agents that launched: what the engine reports of each (its model requests and its end), what it
// reports of itself (its steps), the flow an orchestrating session reports, and an estimate of the cost.
// Pure: no `$`, so tests call it directly.
import type { AgentRun, Flow, Phase, PlannedTask, Tracking } from '../types'
import { roleOf } from './sprites.ts'

export const RUNS_KEPT = 200

export const NO_TRACKING: Tracking = { issued: 0, runs: [], flow: null, isDoneHidden: false }

/** One request's tokens, or a turn's summed, as the engine spells them. */
export type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

type Price = [input: number, output: number, cacheRead: number, cacheWrite: number]

// USD per million tokens. The first row that matches a model id wins, so a release sits above its family.
// The engine reports one cache-write count with no split by lifetime: writes are priced at the 5-minute rate
// (1.25x input), which is what Claude Code writes for a subagent; only its main thread writes 1-hour cache.
const PRICES: [RegExp, Price][] = [
  [/(fable|mythos)-5-1/, [10, 50, 0.25, 12.5]],
  [/fable|mythos/, [10, 50, 1, 12.5]],
  [/opus-5-5/, [4, 20, 0.2, 5]],
  [/opus/, [5, 25, 0.5, 6.25]],
  [/sonnet-5-5/, [2, 10, 0.1, 2.5]],
  [/sonnet-5/, [2, 10, 0.2, 2.5]],
  [/sonnet/, [3, 15, 0.3, 3.75]],
  [/haiku-5-5/, [0.1, 0.5, 0.01, 0.125]],
  [/haiku/, [1, 5, 0.1, 1.25]],
]

/** Haiku 5.5 is priced by prompt length: a request whose prompt (input and cache together) passes this pays HAIKU_LONG. */
const HAIKU_LONG_PROMPT = 100_000
const HAIKU_LONG: Price = [0.5, 2.5, 0.05, 0.625]

const priceOf = (model: string, prompt: number): Price | null => {
  const id = model.toLowerCase()
  if (prompt > HAIKU_LONG_PROMPT && /haiku-5-5/.test(id)) return HAIKU_LONG
  return PRICES.find(([re]) => re.test(id))?.[1] ?? null
}

/**
 * What `u` costs on `model`, in USD; 0 for a model the table does not know. `isRequest` says `u` is one
 * model request, the unit a prompt-length price is set by; a turn's sum is priced at the ordinary prices.
 */
export function costOf(model: string, u: Usage, isRequest: boolean): number {
  const prompt = isRequest ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : 0
  const price = priceOf(model, prompt)
  if (price === null) return 0
  const [i, o, r, w] = price
  return (u.input_tokens * i + u.output_tokens * o + u.cache_read_input_tokens * r + u.cache_creation_input_tokens * w) / 1e6
}

/** Haiku 4.5 and the Claude 3 models have a 200K window; the rest, Haiku 5.5 included, 1M. */
export const windowOf = (model: string): number => (/haiku-4|claude-3/i.test(model) ? 200_000 : 1_000_000)

const tokensOf = (u: Usage) => u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

export function startRun(a: { n: number; agentId: string; type: string; description: string; model: string; at: number }): AgentRun {
  return {
    n: a.n,
    agentId: a.agentId,
    type: a.type,
    description: a.description,
    role: roleOf(a.type, a.description),
    model: a.model,
    status: 'running',
    startedAt: a.at,
    contextTokens: 0,
    contextMax: windowOf(a.model),
    tokens: 0,
    costUsd: 0,
  }
}

/** The runs with `run` in place of any under its id, the newest RUNS_KEPT kept. */
export const addRun = (runs: readonly AgentRun[], run: AgentRun): AgentRun[] => [...runs.filter(r => r.agentId !== run.agentId), run].slice(-RUNS_KEPT)

const mapAgent = (runs: readonly AgentRun[], agentId: string, change: (r: AgentRun) => AgentRun): AgentRun[] =>
  runs.map(r => (r.agentId === agentId ? change(r) : r))

/**
 * One model request of agent `agentId`: its context is what that request held, its tokens and cost add up.
 * A request means it runs again: a teammate wakes between turns.
 */
export function stepRun(runs: readonly AgentRun[], agentId: string, usage: Usage & { model?: string }, requested: string): AgentRun[] {
  const model = usage.model || requested
  return mapAgent(runs, agentId, ({ endedAt: _, ...r }) => ({
    ...r,
    model,
    status: 'running',
    contextTokens: tokensOf(usage),
    contextMax: windowOf(model),
    tokens: r.tokens + tokensOf(usage),
    costUsd: r.costUsd + costOf(model, usage, true),
  }))
}

/** Agent `agentId`'s turn ended: done on an answer, failed otherwise. A run none of whose requests was seen takes the turn's sum. */
export function endRun(runs: readonly AgentRun[], agentId: string, reason: string, usage: (Usage & { model?: string }) | undefined, at: number): AgentRun[] {
  return mapAgent(runs, agentId, r => {
    const status = reason === 'answer' ? 'done' : 'failed'
    if (r.tokens > 0 || usage === undefined) return { ...r, status, endedAt: at }
    const model = usage.model || r.model
    return { ...r, status, endedAt: at, model, tokens: tokensOf(usage), costUsd: costOf(model, usage, false) }
  })
}

const MAX_NOTE = 80

const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : undefined)

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s)

/** The steps agent `agentId` reported through the `step` tool; null when no run is the agent's. */
export function reportSteps(runs: readonly AgentRun[], agentId: string, input: Record<string, unknown>): AgentRun[] | null {
  if (!runs.some(r => r.agentId === agentId)) return null
  return mapAgent(runs, agentId, r => {
    const total = int(input.total) ?? r.steps?.total ?? 0
    const done = int(input.done) ?? r.steps?.done ?? 0
    const note = typeof input.note === 'string' && input.note.trim() !== '' ? clip(input.note.trim(), MAX_NOTE) : undefined
    return { ...r, steps: { done: total > 0 ? Math.min(total, done) : done, total, ...(note === undefined ? {} : { note }) } }
  })
}

export const PHASES: readonly Phase[] = ['plan', 'design', 'delegate', 'review', 'close']
export const TIERS: readonly string[] = ['fable', 'heavy', 'careful', 'medium', 'light']

// The tool's schema is advice to the model, not a check: what a call may ask the pane and the band to draw is bounded here.
const MAX_TASKS = 200
const MAX_AFTER = 20
const MAX_TITLE = 120

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v.trim() : undefined)

const titleOf = (input: Record<string, unknown>) => {
  const t = str(input.title)
  return t ? clip(t, MAX_TITLE) : undefined
}

/** A report with a new title, or the first after a finished flow, starts a new flow. */
export const isNewFlow = (prev: Flow | null, input: Record<string, unknown>): boolean => {
  const title = titleOf(input)
  return prev === null || prev.isFinished || (title !== undefined && title !== prev.title)
}

/** Only a known tier is kept. */
const tierName = (v: unknown): string => {
  const t = (str(v) ?? '').replace(/^savvy-/, '').toLowerCase()
  return TIERS.includes(t) ? t : ''
}

function tasksOf(v: unknown): PlannedTask[] | undefined {
  if (!Array.isArray(v)) return undefined
  const tasks: PlannedTask[] = []
  for (const t of v as unknown[]) {
    const task = (typeof t === 'object' && t !== null ? t : {}) as Record<string, unknown>
    const title = str(task.title)
    if (!title) continue
    const after = (Array.isArray(task.after) ? (task.after as unknown[]) : []).filter((n): n is number => Number.isInteger(n) && (n as number) > 0)
    tasks.push({ title, tier: tierName(task.tier), after: after.slice(0, MAX_AFTER) })
    if (tasks.length === MAX_TASKS) break
  }
  return tasks
}

/** The flow after a `progress` report: fields left out keep their value; a new title starts the counts over. */
export function mergeFlow(prev: Flow | null, input: Record<string, unknown>): Flow {
  const base: Flow = isNewFlow(prev, input) || prev === null ? { title: 'flow', phase: 'plan', done: 0, total: 0, isFinished: false, tasks: [] } : prev
  const reported = tasksOf(input.tasks)
  const tasks = reported ?? base.tasks
  const total = Math.min(MAX_TASKS, int(input.total) ?? (reported ? tasks.length : base.total))
  const done = Math.min(total || Infinity, int(input.done) ?? base.done)
  const phase = PHASES.find(p => p === input.phase) ?? base.phase
  const isFinished = input.finished === true
  return { title: titleOf(input) ?? base.title, phase: isFinished ? 'close' : phase, done, total, isFinished, tasks }
}

/** A `progress` report: the flow merged; a new flow under a title of its own starts with only the agents still running. */
export function reportFlow(t: Tracking, input: Record<string, unknown>): Tracking {
  const runs = isNewFlow(t.flow, input) && titleOf(input) !== undefined ? t.runs.filter(r => r.status === 'running') : t.runs
  return { ...t, runs, flow: mergeFlow(t.flow, input) }
}

const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** The run that took planned task `k` (from 1): the newest launched with the task's title as its description. */
export function runOfTask(flow: Flow, runs: readonly AgentRun[], k: number): AgentRun | undefined {
  const t = flow.tasks[k - 1]
  return t ? [...runs].reverse().find(r => norm(r.description) === norm(t.title)) : undefined
}

/** The flow's tasks no agent has taken yet, each with its number in the plan; none once the flow is finished. */
export function plannedOf(flow: Flow | null, runs: readonly AgentRun[]): (PlannedTask & { k: number })[] {
  if (flow === null || flow.isFinished) return []
  return flow.tasks.map((t, i) => ({ ...t, k: i + 1 })).filter(t => runOfTask(flow, runs, t.k) === undefined)
}

export const fmtTokens = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`)

export const fmtCost = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`

/** `38s`, `6m 12s`, `1h 05m`. */
export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const pad = (v: number) => String(v).padStart(2, '0')
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`
  return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`
}

/** How long the run has taken: to its end, or to `at` while it runs. */
export const elapsed = (r: AgentRun, at: number): number => (r.endedAt ?? Math.max(at, r.startedAt)) - r.startedAt

/** The runs together: cost, tokens, and the time from the first start to the last end (or `at`). */
export function totals(runs: readonly AgentRun[], at: number): { cost: number; tokens: number; time: number } {
  if (runs.length === 0) return { cost: 0, tokens: 0, time: 0 }
  const start = Math.min(...runs.map(r => r.startedAt))
  const end = Math.max(...runs.map(r => r.endedAt ?? Math.max(at, r.startedAt)))
  return { cost: runs.reduce((n, r) => n + r.costUsd, 0), tokens: runs.reduce((n, r) => n + r.tokens, 0), time: end - start }
}
