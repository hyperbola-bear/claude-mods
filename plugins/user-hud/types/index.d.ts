export type CacheTtl = '5m' | '1h'

export type CacheState = {
  /** When the last main-thread request (or keep-warm ping) read or wrote the cache. */
  lastHitAt: number | null
  /** Token counts of that request, as the API reported them. */
  inputTokens: number
  readTokens: number
  writeTokens: number
  model: string | null
  /** The lastHitAt the 2-minute alert already fired for, so it fires once per stretch. */
  alertedFor: number | null
  /** True while a model turn runs on the main thread. */
  isWorking: boolean
  /** True while a keep-warm ping is in flight. */
  isPinging: boolean
  /** Automatic pings made since the person last sent a prompt. */
  autoPings: number
  /** One line about the last ping, for /cache. */
  lastPing: string | null
  /** Why the cache was reset (compaction, model switch, clear), shown until the next request. */
  resetReason: string | null
}

export type TtlInfo = {
  ttl: CacheTtl
  /** `setting`: promptCacheTtl or its env var; `overage`: unset, and the plan is past a limit; `default`: unset, a subscription's 1h. */
  source: 'setting' | 'overage' | 'default'
}

/** One plan window (`five_hour`, `seven_day`) and how much of it is used, 0 to 100 and past. */
export type PlanLimit = { kind: string; percentUsed: number }

export type HandoffFile = { path: string; mtimeMs: number }

export type HandoffState = {
  files: HandoffFile[]
  /** Index into `files` the pane shows. */
  index: number
  text: string | null
  error: string | null
  /** True when a `/handoff` command exists (yours); false means the built-in prompt is used. */
  hasCommand: boolean
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** How the model and effort pickers are drawn: the three designs the Style row cycles through. */
export type SelectorStyle = 'rail' | 'ladder' | 'meter'

export type HudState = {
  /** True while the corner panel is open; only the tab shows otherwise. */
  isOpen: boolean
  /** The main loop's model as `/model` shows it; null before it is known. */
  model: string | null
  /** The effort the last main-thread request carried, or the one picked in the panel; null when unknown. */
  effort: Effort | null
  /** True while ultracode is on (`/effort ultracode`): the effort stays, and Claude may run multi-agent workflows. */
  ultracode: boolean
  /** The plan window past its limit while the subscription is on overage; null otherwise. */
  overage: PlanLimit | null
  /** How full the context window is, a whole percentage, as the engine reports it; null before a response of the live window. */
  contextPercent: number | null
  /** The context window's size in tokens; null before the engine reported it. */
  contextWindow: number | null
  /** What the open panel shows: the cards, or the settings behind `s`. */
  view: HudView
  /** The card the open panel starts with (`+N more` and `a: review` move it); null for the usual order. */
  lead: CardId | null
}

/** The open panel's cards, in their usual order. */
export type CardId = 'sessions' | 'context' | 'model' | 'cache' | 'assume' | 'next' | 'handoff'

export type HudView = 'cards' | 'settings'

/** What a session's status file says it is doing. */
export type SessionStatus = 'busy' | 'waiting' | 'idle'

/** One live Claude Code session on this machine, read from `~/.claude/sessions/<pid>.json`. */
export type SessionInfo = {
  sessionId: string
  pid: number
  status: SessionStatus
  /** The name to show, at most 30 characters. */
  title: string
  entry: 'cli' | 'app'
  /** When its status last changed, in ms since the epoch. */
  statusAt: number
}

/** Waiting on you, running a turn, idle within the last 8 hours, idle longer. */
export type SessionGroup = 'needs' | 'working' | 'done' | 'asleep'

export type Sessions = {
  /** This session; in no group. */
  self: SessionInfo | null
  /** The other sessions, each group most recent first. */
  byGroup: Record<SessionGroup, SessionInfo[]>
  /** When the status files were last read; 0 before the first read. */
  readAt: number
}

/** A guess Claude reported through the `assumption` tool, for the person to mark. */
export type Guess = { id: string; text: string; status: 'open' | 'right' | 'wrong'; at: number }

/** Where tokens go, one bucket per kind of work. */
export type GroupId = 'chat' | 'thinking' | 'files' | 'shell' | 'web' | 'mcp' | 'skills' | 'agents' | 'system' | 'other'

export type GroupTally = {
  /**
   * Real API tokens this group accounts for this session: its share of each main-thread request's
   * input (by what it holds in the context), the output written for it, and the requests it made itself.
   */
  used: number
  /** Estimated tokens it holds in the main conversation now, since the last compaction. */
  inContext: number
  /** Estimated tokens it put into the conversation this session, by kind (Read, Write, a server, a hook). */
  kinds: Record<string, number>
  /** The same, by subject (a file, a command, a skill, a site), the largest kept. */
  items: Record<string, number>
  /** Real tokens of the requests the group made itself, by who made them: a subagent's type, a plugin's name. */
  spent: Record<string, number>
  /** Tool calls, prompts, skills or requests that landed here. */
  calls: number
  /**
   * The group by sub-item (a file, a server, a plugin, the system prompt): what each used of the group's
   * real tokens, split the way the group's own are, so they add up to `used`; and what each holds now.
   */
  lines: Record<string, LineTally>
}

/** One sub-item of a group: real tokens it accounts for this session, and estimated tokens it holds now. */
export type LineTally = { used: number; inContext: number }

/** Token counts as the API reported them, summed over requests. */
export type ApiTally = {
  requests: number
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

export type TokenState = {
  groups: Record<GroupId, GroupTally>
  /** The main conversation's requests. */
  main: ApiTally
  /** Subagents' requests. */
  agents: ApiTally
  /** Model calls plugins made (side chats, keep-warm pings). */
  plugins: ApiTally
  /** What each request carries before any conversation (system prompt, tool schemas, skill listings), per group. */
  standing: Partial<Record<GroupId, number>>
  /** The MCP tool schemas each request carries, by server. */
  schemas: Record<string, number>
  /** What each request carries before the conversation, per group by sub-item (the system prompt, a server's schemas). */
  standingLines: Partial<Record<GroupId, Record<string, number>>>
  /** The session's cost in US dollars, as /cost totals it; null where the host keeps no ledger. */
  costUsd: number | null
  /** What the session had cost when counting began (a Reset, a /clear): the tally's cost is what came after. */
  costBase: number
  /** When counting began: the session's start, its last /clear, or a Reset. */
  since: number | null
}

/** Next steps: the prompts suggested after the last main turn. */
export type NextState = {
  /** The suggestions, at most three; empty before the first reply and while a turn runs. */
  items: string[]
  /** True while the suggestions are being asked for. */
  isThinking: boolean
  /** Why the last ask brought none (an API error), shown dim in its place; null otherwise. */
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'user-hud': {
      cache: CacheState
      ttl: TtlInfo
      handoff: HandoffState
      hud: HudState
      tokens: TokenState
      next: NextState
      /** The groups opened in the Tokens pane. */
      tokensOpen: GroupId[]
      sessions: Sessions
      /** Whether the Sessions pane lists the sessions asleep. */
      asleepShown: boolean
      guesses: Guess[]
    }
  }
}
