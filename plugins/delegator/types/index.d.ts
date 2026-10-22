// The delegator's types: the queue its hooks module keeps, and what it tracks of the agents that launch.

/** A model the Agent tool takes by alias. */
export type ModelAlias = 'haiku' | 'sonnet' | 'opus' | 'fable'

/** What kind of launch an agent is: what the delegator may change about it. */
export type AgentKind =
  /** An Agent tool call: task and model both editable. */
  | 'agent'
  /** A fork of the parent: it always runs on the parent's model. */
  | 'fork'
  /** A workflow script's `agent()`: it can only be approved or refused. */
  | 'workflow'
  /** A teammate of the session's team. */
  | 'teammate'

/** The model the delegator would pick for a task, and why. */
export type Suggestion = { model: ModelAlias; reason: string }

/** An agent waiting for the person's decision. */
export type Pending = {
  /** The delegator's own number for it, shown in the dialog and the pane. */
  n: number
  description: string
  subagentType: string
  /** The task as the caller wrote it; notes the person adds go after it. */
  prompt: string
  notes: string[]
  /** The model the caller asked for, null when it left it to the agent's default. */
  requested: string | null
  /** The model it launches on: the person's choice, else the request, else the suggestion; null for the agent's default. */
  model: string | null
  suggestion: Suggestion | null
  parentModel: string
  kind: AgentKind
  /** Started by a subagent, not the main chat. */
  isNested: boolean
}

/** What happened to an agent the delegator held. */
export type Decision = {
  n: number
  description: string
  subagentType: string
  outcome: 'approved' | 'auto' | 'refused'
  /** The model it launched on, as the engine resolved it; null when refused. */
  model: string | null
  at: number
  /** Why it was refused, when it was. */
  reason?: string
}

/** Which character an agent is drawn as. */
export type Role = 'explorer' | 'developer' | 'architect' | 'researcher' | 'reviewer' | 'clawd'

export type RunStatus = 'running' | 'done' | 'failed'

/** An agent that launched: what it is, and what it has cost so far. */
export type AgentRun = {
  /** The engine's id for it: only an agent with a loop to report on is tracked. */
  agentId: string
  /** The same number the queue gave it. */
  n: number
  type: string
  description: string
  role: Role
  /** As the engine resolved it, then as each model request reports it. */
  model: string
  status: RunStatus
  startedAt: number
  endedAt?: number
  /** Tokens its last model request held: input, cache read, cache write and output. */
  contextTokens: number
  /** Its model's context window. */
  contextMax: number
  /** Every request's tokens, added up. */
  tokens: number
  /** Estimated from list prices: the engine reports tokens, not money. */
  costUsd: number
  /** What it reported through the `step` tool. */
  steps?: { done: number; total: number; note?: string }
}

export type Phase = 'plan' | 'design' | 'delegate' | 'review' | 'close'

/** A worker task an orchestrating session planned: its title is the Agent description it will launch with. */
export type PlannedTask = { title: string; tier: string; after: number[] }

/** What an orchestrating session reported through the `progress` tool. */
export type Flow = { title: string; phase: Phase; done: number; total: number; isFinished: boolean; tasks: PlannedTask[] }

export type DelegatorState = {
  pending: Pending[]
  /** The newest first, a few kept. */
  recent: Decision[]
  /** Approve all was chosen in this main turn: every agent until it ends launches unasked. */
  approveAllTurn: boolean
}

/** What the delegator tracks of the agents once they launch, kept for the session through reloads. */
export type Tracking = {
  /** The last number given to an agent: each agent takes the next, the gate on or off. */
  issued: number
  /** The agents launched, oldest first, the newest 200 kept. */
  runs: AgentRun[]
  flow: Flow | null
  /** `c` hid the agents done. */
  isDoneHidden: boolean
}

declare module 'claude-code' {
  interface PluginState {
    delegator: { tracking: Tracking; frame: number }
  }
}
