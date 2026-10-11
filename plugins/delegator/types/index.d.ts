// The delegator's types: the queue its hooks module keeps and its pane draws.

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

export type DelegatorState = {
  pending: Pending[]
  /** The newest first, a few kept. */
  recent: Decision[]
  /** Approve all was chosen in this main turn: every agent until it ends launches unasked. */
  approveAllTurn: boolean
}
