// Pure token accounting: no `$`, so tests call it directly.
//
// Two measures per group. What a group holds in the conversation (`inContext`, `kinds`, `items`) is an
// estimate, about 4 characters a token, read off every row the session keeps. What it `used` is real:
// each main-thread request's input, as the API counted it, split across the groups by what they held
// in the context when it went out; its output split by what was written (reply text, tool arguments,
// thinking as the rest). So the groups' `used` adds up to the API's own totals.
import type { ApiTally, GroupId, GroupTally, TokenState } from '../types'
import { fmtTokens } from './cache.ts'

/**
 * In the categorical order whose neighbours stay apart for colour-blind readers, the two greys last. One
 * step per hue serves both themes: each sits inside the lightness band of a light and a dark background.
 */
export const GROUPS: readonly { id: GroupId; label: string; color: string; about: string }[] = [
  { id: 'files', label: 'Files', color: '#3987e5', about: 'Read, Write, Edit, Grep, Glob, @-mentioned files' },
  { id: 'chat', label: 'Chat', color: '#d95926', about: 'your prompts in, Claude’s replies out' },
  { id: 'mcp', label: 'MCP', color: '#1baf7a', about: 'MCP tool calls and schemas, by server' },
  { id: 'shell', label: 'Shell', color: '#c98500', about: 'Bash and background task output' },
  { id: 'skills', label: 'Skills & plugins', color: '#d55181', about: 'skills, slash commands, plugin and hook context, plugin model calls' },
  { id: 'web', label: 'Web', color: '#008300', about: 'WebFetch and WebSearch' },
  { id: 'agents', label: 'Subagents', color: '#9085e9', about: 'what the Agent tool is told and returns, and what subagents spend' },
  { id: 'thinking', label: 'Thinking', color: '#e34948', about: 'reasoning Claude writes before it answers' },
  { id: 'system', label: 'System & memory', color: '#7d7c77', about: 'system prompt, tool schemas, reminders, memory files, compaction' },
  { id: 'other', label: 'Other tools', color: '#b0afa8', about: 'TodoWrite, AskUserQuestion and the rest' },
]

export const GROUP_IDS: readonly GroupId[] = GROUPS.map(g => g.id)

export const groupOf = (id: GroupId) => GROUPS.find(g => g.id === id) ?? GROUPS[GROUPS.length - 1]!

export const CHARS_PER_TOKEN = 4
/** An image block, about what the API charges a screenshot. */
export const IMAGE_TOKENS = 1_600
/** A PDF or other document block whose size the row does not say. */
export const DOCUMENT_TOKENS = 3_000
/** Subjects kept per group; the smallest fold into one entry past it. */
export const MAX_ITEMS = 24
const FOLDED = 'other'

export const estimate = (chars: number) => (chars > 0 ? Math.ceil(chars / CHARS_PER_TOKEN) : 0)

const EMPTY_API: ApiTally = { requests: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }

const emptyGroup = (): GroupTally => ({ used: 0, inContext: 0, kinds: {}, items: {}, spent: {}, calls: 0 })

export function emptyTokens(since: number | null): TokenState {
  return {
    groups: Object.fromEntries(GROUP_IDS.map(id => [id, emptyGroup()])) as Record<GroupId, GroupTally>,
    main: EMPTY_API,
    agents: EMPTY_API,
    plugins: EMPTY_API,
    standing: {},
    schemas: {},
    costUsd: null,
    costBase: 0,
    since,
  }
}

// ---------- which group a tool belongs to ----------

const FILE_TOOLS: Record<string, string> = {
  Read: 'Read',
  NotebookRead: 'Read',
  Write: 'Write',
  Edit: 'Edit',
  MultiEdit: 'Edit',
  NotebookEdit: 'Edit',
  Grep: 'Search',
  Glob: 'Search',
  LS: 'Search',
}
const SHELL_TOOLS: Record<string, string> = {
  Bash: 'Bash',
  PowerShell: 'PowerShell',
  BashOutput: 'background',
  TaskOutput: 'background',
  KillShell: 'background',
  KillBash: 'background',
  TaskStop: 'background',
  Monitor: 'Monitor',
}
const WEB_TOOLS: Record<string, string> = { WebFetch: 'fetch', WebSearch: 'search', web_fetch: 'fetch', web_search: 'search' }
const AGENT_TOOLS = new Set(['Agent', 'Task', 'SendMessage'])
const SKILL_TOOLS = new Set(['Skill', 'SlashCommand'])

/** Where one tool call's tokens go: its group, a kind within it, and the subject it was about. */
export type Attribution = { group: GroupId; kind: string; item?: string }

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
const field = (input: unknown, key: string) => (input && typeof input === 'object' ? str((input as Record<string, unknown>)[key]) : undefined)

export const basename = (path: string) => path.replace(/\/+$/, '').split('/').pop() || path

const clip = (s: string, n = 28) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** `git` for `cd app && git status`, `npm` for `FOO=1 npm test`. */
export function commandHead(command: string): string {
  const last = command.split(/&&|\|\||;|\n/).map(s => s.trim()).filter(s => s && !/^cd\s/.test(s))[0] ?? command.trim()
  const words = last.split(/\s+/).filter(w => !/^[A-Z_][A-Z0-9_]*=/.test(w))
  return basename(words[0] ?? 'shell') || 'shell'
}

export function hostOf(url: string): string {
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(url)
  return (m?.[1] ?? url).replace(/^www\./, '')
}

/** `mcp__linear__create_issue` → linear, create_issue. */
export function mcpParts(name: string): { server: string; tool: string } {
  const [, server = 'mcp', ...rest] = name.split('__')
  return { server, tool: rest.join('__') || name }
}

export function attribute(name: string, input: unknown): Attribution {
  if (name.startsWith('mcp__')) {
    const { server, tool } = mcpParts(name)
    return { group: 'mcp', kind: server, item: tool }
  }
  const file = FILE_TOOLS[name]
  if (file) {
    const path = field(input, 'file_path') ?? field(input, 'notebook_path')
    const pattern = field(input, 'pattern') ?? field(input, 'path')
    return { group: 'files', kind: file, item: path ? basename(path) : pattern ? clip(pattern) : undefined }
  }
  const shell = SHELL_TOOLS[name]
  if (shell) {
    const command = field(input, 'command')
    return { group: 'shell', kind: shell, item: command ? commandHead(command) : undefined }
  }
  const web = WEB_TOOLS[name]
  if (web) {
    const url = field(input, 'url')
    return { group: 'web', kind: web, item: url ? hostOf(url) : web === 'search' ? 'search' : undefined }
  }
  if (AGENT_TOOLS.has(name)) return { group: 'agents', kind: name, item: field(input, 'subagent_type') ?? field(input, 'to') ?? 'general-purpose' }
  if (SKILL_TOOLS.has(name)) return { group: 'skills', kind: 'skill', item: field(input, 'skill') ?? field(input, 'command') }
  if (name === 'ToolSearch') return { group: 'system', kind: 'tool schemas' }
  return { group: 'other', kind: name }
}

// ---------- reading a row ----------

export type Block = { type: string; [field: string]: unknown }

/** One row `session.append` hands a hook, as much of it as the accounting reads. */
export type Row = {
  door: string
  origin: { kind: string; [field: string]: unknown }
  message: { type: string; name?: string; role?: string; isMeta?: boolean; content: readonly Block[] }
  agentId?: string
}

/** Tokens a row added to one group. */
export type Share = { group: GroupId; kind: string; item?: string; tokens: number; calls?: number }

/** A tool call the model asked for, remembered by id so its result lands in the same place. */
export type ToolUse = Attribution & { id: string }

export function blockTokens(b: Block): number {
  switch (b.type) {
    case 'text':
      return estimate(str(b.text)?.length ?? 0)
    case 'tool_use':
    case 'server_tool_use':
      return estimate((str(b.name)?.length ?? 0) + (JSON.stringify(b.input ?? {})?.length ?? 0))
    case 'tool_result': {
      const c = b.content
      if (typeof c === 'string') return estimate(c.length)
      return Array.isArray(c) ? c.reduce((n: number, x) => n + blockTokens(x as Block), 0) : 0
    }
    case 'image':
      return IMAGE_TOKENS
    case 'document': {
      const source = b.source as { type?: string; data?: unknown } | undefined
      return source?.type === 'text' && typeof source.data === 'string' ? estimate(source.data.length) : DOCUMENT_TOKENS
    }
    case 'thinking':
      return estimate(str(b.thinking)?.length ?? 0)
    case 'redacted_thinking':
      return estimate(str(b.data)?.length ?? 0)
    default:
      return estimate(JSON.stringify(b)?.length ?? 0)
  }
}

const rowTokens = (content: readonly Block[]) => content.reduce((n, b) => n + blockTokens(b), 0)

/** `/goal` from a command row's `<command-name>/goal</command-name>`. */
export function commandName(content: readonly Block[]): string | undefined {
  const text = content.map(b => (b.type === 'text' ? str(b.text) ?? '' : '')).join('\n')
  const m = /<command-name>\/?([^<\s]+)<\/command-name>/.exec(text) ?? /^\s*\/([\w:.-]+)/.exec(text)
  return m?.[1]
}

const MEMORY_ATTACHMENT = /memory|claude_?md|rules/i
/** The skill, agent and tool listings: what every request carries, which the context breakdown already counts. */
const LISTING_ATTACHMENT = /listing|deferred_tools|mcp_instructions/i
const FILE_ATTACHMENT = /file|directory|pdf|notebook|selection|image/i

function attachmentShare(name: string | undefined, tokens: number): Share {
  const n = name ?? 'attachment'
  if (MEMORY_ATTACHMENT.test(n)) return { group: 'system', kind: 'memory', item: n, tokens }
  if (/mcp/i.test(n)) return { group: 'mcp', kind: 'resources', item: n, tokens }
  if (/skill/i.test(n)) return { group: 'skills', kind: 'skill', item: n, tokens }
  if (/queued_command/i.test(n)) return { group: 'chat', kind: 'you', tokens }
  if (FILE_ATTACHMENT.test(n)) return { group: 'files', kind: 'mentioned', item: n, tokens }
  return { group: 'system', kind: 'reminders', item: n, tokens }
}

/** Context a hook or plugin injected: a settings hook by its event, a plugin by the chain it rode. */
function injectedShare(origin: Row['origin'], tokens: number): Share | null {
  if (origin.kind === 'hook') return { group: 'skills', kind: 'hooks', item: str(origin.event) ?? 'hook', tokens }
  if (origin.kind === 'plugin') {
    const who = str(origin.name)
    return { group: 'skills', kind: 'plugins', item: who ?? `context via ${str(origin.event) ?? 'a hook'}`, tokens }
  }
  return null
}

function promptShare(row: Row, tokens: number): Share {
  const o = row.origin
  const injected = injectedShare(o, tokens)
  if (injected) return { ...injected, calls: 1 }
  if (row.message.isMeta) return { group: 'system', kind: 'reminders', tokens }
  switch (o.kind) {
    case 'composer':
    case 'bridge':
    case 'sdk':
    case 'unclassified':
    case 'auto-continuation':
      return { group: 'chat', kind: 'you', tokens, calls: 1 }
    case 'task-notification':
      return { group: 'shell', kind: 'background', item: 'notifications', tokens }
    case 'scheduled-trigger':
      return { group: 'chat', kind: 'scheduled', tokens, calls: 1 }
    default:
      return { group: 'chat', kind: 'messages', item: o.kind, tokens, calls: 1 }
  }
}

/**
 * What one main-conversation row added, group by group, and the tool calls it asked for. `lookup` finds
 * a tool call by id so its result lands where the call did; `lastSkill` names the skill a Skill call loaded.
 * A row no request carries (no role), and a subagent's row, add nothing here.
 */
export function classifyRow(row: Row, lookup: (id: string) => Attribution | undefined, lastSkill: string | null): { shares: Share[]; uses: ToolUse[] } {
  const shares: Share[] = []
  const uses: ToolUse[] = []
  const { message, door, origin } = row
  if (!message.role || row.agentId !== undefined) return { shares, uses }

  switch (door) {
    case 'response':
      for (const b of message.content) {
        if (b.type === 'text') {
          shares.push({ group: 'chat', kind: 'Claude', tokens: blockTokens(b) })
        } else if (b.type === 'tool_use' || b.type === 'server_tool_use') {
          const at = attribute(str(b.name) ?? 'tool', b.input)
          if (typeof b.id === 'string') uses.push({ ...at, id: b.id })
          shares.push({ ...at, tokens: blockTokens(b), calls: 1 })
        } else if (b.type === 'thinking' || b.type === 'redacted_thinking') {
          // Sent back with later requests while the model keeps it: the Thinking group's context.
          shares.push({ group: 'thinking', kind: 'reasoning', tokens: blockTokens(b) })
        } else if (b.type.endsWith('_tool_result')) {
          // A tool the API ran inside the response (web search): its result rides in the same message.
          const at = attribute(b.type.replace(/_tool_result$/, ''), undefined)
          shares.push({ ...at, tokens: blockTokens(b) })
        } else {
          const tokens = blockTokens(b)
          if (tokens > 0) shares.push({ group: 'chat', kind: 'Claude', tokens })
        }
      }
      break
    case 'tool-result':
      for (const b of message.content) {
        const id = str(b.tool_use_id)
        const { group, kind, item } = (id ? lookup(id) : undefined) ?? attribute(str(origin.tool) ?? 'tool', undefined)
        shares.push({ group, kind, item, tokens: blockTokens(b) })
      }
      break
    case 'tool-message': {
      const tool = str(origin.tool) ?? 'tool'
      const at = tool === 'Skill' ? { group: 'skills' as const, kind: 'skill', item: lastSkill ?? undefined } : attribute(tool, undefined)
      shares.push({ ...at, tokens: rowTokens(message.content) })
      break
    }
    case 'prompt':
      shares.push(promptShare(row, rowTokens(message.content)))
      break
    case 'command':
      shares.push({ group: 'skills', kind: 'command', item: commandName(message.content), tokens: rowTokens(message.content), calls: message.isMeta ? 0 : 1 })
      break
    case 'attachment':
    case 'hook-context':
    case 'note': {
      if (door === 'attachment' && LISTING_ATTACHMENT.test(message.name ?? '')) break
      const tokens = rowTokens(message.content)
      shares.push(injectedShare(origin, tokens) ?? (door === 'attachment' ? attachmentShare(message.name, tokens) : { group: 'system', kind: 'reminders', item: message.name, tokens }))
      break
    }
    case 'delivery':
      shares.push(promptShare(row, rowTokens(message.content)))
      break
    case 'compaction':
      shares.push({ group: 'system', kind: 'compaction', tokens: rowTokens(message.content) })
      break
    default:
      shares.push({ group: 'system', kind: door, tokens: rowTokens(message.content) })
  }
  return { shares: shares.filter(s => s.tokens > 0 || (s.calls ?? 0) > 0), uses }
}

// ---------- what the context holds, read off the messages themselves ----------

/** One message as the next request carries it (`$.session.messages({ as: 'api' })`). */
export type ApiMessage = { role: string; content: readonly Block[] | string }

/** A user message's text block: a reminder the engine wrapped, a slash command, or the person's words. */
function userTextShare(text: string, tokens: number, afterSkill: string | null | undefined): Share {
  if (afterSkill !== undefined) return { group: 'skills', kind: 'skill', item: afterSkill ?? undefined, tokens }
  if (/^\s*<system-reminder>/.test(text)) return { group: 'system', kind: 'reminders', tokens }
  const command = /<command-name>\/?([^<\s]+)<\/command-name>/.exec(text)
  if (command) return { group: 'skills', kind: 'command', item: command[1], tokens }
  return { group: 'chat', kind: 'you', tokens }
}

/**
 * What each group holds in the context, measured from the messages the next request is built from: after
 * a load (a resume, a reload), a compaction, or whenever the engine has trimmed old tool results, the rows
 * seen going in no longer say. A Skill call's body, which follows its result, counts as that skill.
 */
export function contextOf(messages: readonly ApiMessage[]): Record<GroupId, number> {
  const held = Object.fromEntries(GROUP_IDS.map(id => [id, 0])) as Record<GroupId, number>
  const calls = new Map<string, Attribution>()
  for (const m of messages) {
    const blocks: readonly Block[] = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content
    if (m.role === 'assistant') {
      const { shares, uses } = classifyRow({ door: 'response', origin: { kind: 'model' }, message: { type: 'assistant', role: 'assistant', content: blocks } }, () => undefined, null)
      for (const u of uses) calls.set(u.id, u)
      for (const sh of shares) held[sh.group] += sh.tokens
      continue
    }
    // undefined: no Skill result yet in this message; a name (or null) once one came.
    let afterSkill: string | null | undefined
    for (const b of blocks) {
      if (b.type === 'tool_result') {
        const at = calls.get(str(b.tool_use_id) ?? '') ?? attribute('tool', undefined)
        held[at.group] += blockTokens(b)
        afterSkill = at.group === 'skills' && at.kind === 'skill' ? at.item ?? null : undefined
      } else if (b.type === 'text') {
        const sh = userTextShare(str(b.text) ?? '', blockTokens(b), afterSkill)
        held[sh.group] += sh.tokens
      } else {
        held.chat += blockTokens(b)
      }
    }
  }
  return held
}

/** Sets what each group holds in the context, as measured; what they used and added stays. */
export function withContext(s: TokenState, held: Record<GroupId, number>): TokenState {
  return { ...s, groups: mapGroups(s, (g, id) => ({ ...g, inContext: held[id] })) }
}

/**
 * The groups the messages measure exactly: tool results, matched to their calls by id, and the thinking
 * the model keeps. The rest (a hook's context, a plugin's prompt) read as plain reminders or prompts there.
 */
const MEASURED_EXACTLY: readonly GroupId[] = ['files', 'shell', 'web', 'mcp', 'agents', 'other', 'thinking']

/**
 * Lowers what the exactly measured groups hold to the measurement, where the engine has since trimmed old
 * tool results or dropped earlier thinking; the other groups keep what their rows said.
 */
export function trimmedTo(s: TokenState, held: Record<GroupId, number>): TokenState {
  return { ...s, groups: mapGroups(s, (g, id) => (MEASURED_EXACTLY.includes(id) ? { ...g, inContext: Math.min(g.inContext, held[id]) } : g)) }
}

/**
 * Starts the counts over from `now` and keeps what the context still holds: the pane's Reset, mid-chat,
 * so the next request is still split by what is really in it. The cost is counted from here too.
 */
export function restarted(s: TokenState, now: number): TokenState {
  const fresh = emptyTokens(now)
  return {
    ...fresh,
    groups: mapGroups(fresh, (g, id) => ({ ...g, inContext: s.groups[id].inContext })),
    standing: s.standing,
    schemas: s.schemas,
    costBase: s.costUsd ?? s.costBase,
    costUsd: s.costUsd,
  }
}

// ---------- tallying ----------

const bump = (r: Record<string, number>, key: string, n: number) => ({ ...r, [key]: (r[key] ?? 0) + n })

/** Keeps the largest `max` subjects; the rest fold into one. */
export function capItems(items: Record<string, number>, max = MAX_ITEMS): Record<string, number> {
  const entries = Object.entries(items)
  if (entries.length <= max) return items
  const sorted = entries.filter(([k]) => k !== FOLDED).sort((a, b) => b[1] - a[1])
  const kept = sorted.slice(0, max - 1)
  const folded = sorted.slice(max - 1).reduce((n, [, v]) => n + v, items[FOLDED] ?? 0)
  return Object.fromEntries([...kept, [FOLDED, folded]])
}

export function addShares(s: TokenState, shares: readonly Share[]): TokenState {
  if (shares.length === 0) return s
  const groups = { ...s.groups }
  for (const sh of shares) {
    const g = groups[sh.group]
    groups[sh.group] = {
      ...g,
      inContext: g.inContext + sh.tokens,
      kinds: sh.tokens > 0 ? bump(g.kinds, sh.kind, sh.tokens) : g.kinds,
      items: sh.item && sh.tokens > 0 ? capItems(bump(g.items, sh.item, sh.tokens)) : g.items,
      calls: g.calls + (sh.calls ?? 0),
    }
  }
  return { ...s, groups }
}

/** A compaction replaced the conversation with its summary: nothing the groups added is in the context any more. */
export function compacted(s: TokenState): TokenState {
  return { ...s, groups: mapGroups(s, g => ({ ...g, inContext: 0 })) }
}

function mapGroups(s: TokenState, fn: (g: GroupTally, id: GroupId) => GroupTally): Record<GroupId, GroupTally> {
  return Object.fromEntries(GROUP_IDS.map(id => [id, fn(s.groups[id], id)])) as Record<GroupId, GroupTally>
}

/** What each group held in the context, plus what it adds to every request, when a request went out. */
export function contextWeights(s: TokenState): Record<GroupId, number> {
  return Object.fromEntries(GROUP_IDS.map(id => [id, s.groups[id].inContext + (s.standing[id] ?? 0)])) as Record<GroupId, number>
}

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export const inputOf = (u: Usage) => u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

export function addApi(t: ApiTally, u: Usage): ApiTally {
  return {
    requests: t.requests + 1,
    input: t.input + u.input_tokens,
    cacheRead: t.cacheRead + u.cache_read_input_tokens,
    cacheWrite: t.cacheWrite + u.cache_creation_input_tokens,
    output: t.output + u.output_tokens,
  }
}

/** The step's response as `turn.step` resolves it: the visible text and the tool calls. */
export type StepOutput = { answer: string; toolUses: readonly { name: string; input: unknown }[] }

/**
 * Splits one main-thread request's real tokens across the groups. Input: by `weights`, what each group held
 * when the request went out; whatever the request carried beyond them (the system prompt and tool schemas,
 * before the context breakdown names them) goes to System. Output: the reply text to Chat, each tool call's
 * arguments to its group, and the rest, the thinking, to Thinking.
 */
export function attributeRequest(s: TokenState, weights: Record<GroupId, number>, u: Usage, out: StepOutput): TokenState {
  const input = inputOf(u)
  const known = GROUP_IDS.reduce((n, id) => n + weights[id], 0)
  const scale = known > input ? input / known : 1
  const used: Record<string, number> = Object.fromEntries(GROUP_IDS.map(id => [id, weights[id] * scale]))
  used.system = (used.system ?? 0) + Math.max(0, input - known)

  const written: { group: GroupId; tokens: number }[] = [
    { group: 'chat', tokens: estimate(out.answer.length) },
    ...out.toolUses.map(t => ({ group: attribute(t.name, t.input).group, tokens: estimate(t.name.length + (JSON.stringify(t.input ?? {})?.length ?? 0)) })),
  ]
  const writtenSum = written.reduce((n, w) => n + w.tokens, 0)
  const outScale = writtenSum > u.output_tokens ? u.output_tokens / writtenSum : 1
  for (const w of written) used[w.group] = (used[w.group] ?? 0) + w.tokens * outScale
  used.thinking = (used.thinking ?? 0) + Math.max(0, u.output_tokens - writtenSum)

  return {
    ...s,
    main: addApi(s.main, u),
    groups: mapGroups(s, (g, id) => ({ ...g, used: g.used + (used[id] ?? 0) })),
  }
}

/** A subagent's request: all of it is the Subagents group's, under the agent's type. */
export function attributeAgent(s: TokenState, u: Usage, agentType: string): TokenState {
  const total = inputOf(u) + u.output_tokens
  const g = s.groups.agents
  return {
    ...s,
    agents: addApi(s.agents, u),
    groups: { ...s.groups, agents: { ...g, used: g.used + total, spent: capItems(bump(g.spent, agentType, total)) } },
  }
}

/**
 * A model call made beside the conversation: a plugin's (a side chat, a keep-warm ping) goes to Skills &
 * plugins under the plugin's name; one the engine makes for itself, to System.
 */
export function attributePlugin(s: TokenState, u: Usage, plugin: string): TokenState {
  const total = inputOf(u) + u.output_tokens
  const id: GroupId = plugin === 'engine' ? 'system' : 'skills'
  const g = s.groups[id]
  return {
    ...s,
    plugins: addApi(s.plugins, u),
    groups: { ...s.groups, [id]: { ...g, used: g.used + total, spent: capItems(bump(g.spent, plugin === 'engine' ? 'Claude Code' : plugin, total)), calls: g.calls + 1 } },
  }
}

// ---------- the context breakdown: what each request carries before the conversation ----------

/** As much of `$.session.usage({ breakdown })`'s breakdown as the accounting reads. */
export type Breakdown = {
  categories: readonly { name: string; tokens: number; kind: string }[]
  mcpTools: readonly { serverName: string; tokens: number; isLoaded: boolean }[]
  memoryFiles: readonly { tokens: number }[]
  agents: readonly { tokens: number }[]
  skills?: { tokens: number }
  slashCommands?: { tokens: number }
}

/**
 * Per group, what every request carries before any conversation: the MCP schemas loaded, the skill and
 * command listings, the custom agents' descriptions, and the rest of the window's `used` rows but the
 * messages themselves (the system prompt, the built-in tools, memory files) as System.
 */
export function standingFrom(b: Breakdown): Partial<Record<GroupId, number>> {
  const mcp = b.mcpTools.filter(t => t.isLoaded).reduce((n, t) => n + t.tokens, 0)
  const skills = (b.skills?.tokens ?? 0) + (b.slashCommands?.tokens ?? 0)
  const agents = b.agents.reduce((n, a) => n + a.tokens, 0)
  const used = b.categories.filter(c => c.kind === 'used' && !/message/i.test(c.name)).reduce((n, c) => n + c.tokens, 0)
  const system = Math.max(0, used - mcp - skills - agents)
  return { system, mcp, skills, agents }
}

/** MCP schema tokens per server, loaded ones only. */
export function mcpSchemas(b: Breakdown): Record<string, number> {
  const by: Record<string, number> = {}
  for (const t of b.mcpTools) if (t.isLoaded) by[t.serverName] = (by[t.serverName] ?? 0) + t.tokens
  return by
}

// ---------- reading the tallies ----------

export const totalUsed = (s: TokenState) => GROUP_IDS.reduce((n, id) => n + s.groups[id].used, 0)

export const apiTotal = (t: ApiTally) => t.input + t.cacheRead + t.cacheWrite + t.output

/** The groups that used anything, most first. */
export function ranked(s: TokenState): { id: GroupId; used: number; share: number }[] {
  const total = totalUsed(s)
  return GROUP_IDS.map(id => ({ id, used: s.groups[id].used, share: total > 0 ? s.groups[id].used / total : 0 }))
    .filter(g => g.used > 0 || s.groups[g.id].inContext > 0)
    .sort((a, b) => b.used - a.used)
}

export function top(r: Record<string, number>, n: number): [string, number][] {
  return Object.entries(r)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
}

/**
 * One stacked bar `cells` wide: each group's run of cells, in the fixed group order, a group with any share
 * at least one cell, the largest-remainder method so the cells add up exactly.
 */
export function stack(s: TokenState, cells: number): { id: GroupId; cells: number }[] {
  const total = totalUsed(s)
  if (total <= 0 || cells <= 0) return []
  const present = GROUP_IDS.filter(id => s.groups[id].used > 0)
  const raw = present.map(id => ({ id, exact: (s.groups[id].used / total) * cells }))
  const out = raw.map(r => ({ id: r.id, cells: Math.max(1, Math.floor(r.exact)), rem: r.exact - Math.floor(r.exact) }))
  let over = out.reduce((n, r) => n + r.cells, 0) - cells
  // Too many (every group got its one cell): take from the largest runs.
  while (over > 0) {
    const big = [...out].sort((a, b) => b.cells - a.cells)[0]
    if (!big || big.cells <= 1) break
    big.cells -= 1
    over -= 1
  }
  // Too few: hand the rest out by the largest remainders.
  for (const r of [...out].sort((a, b) => b.rem - a.rem)) {
    if (over >= 0) break
    r.cells += 1
    over += 1
  }
  return out.map(({ id, cells: c }) => ({ id, cells: c }))
}

export const pct = (share: number) => (share >= 0.995 ? '100%' : share > 0 && share < 0.01 ? '<1%' : `${Math.round(share * 100)}%`)

/** 470k, 1.2M: the tallies are fractional once split, so round first. */
export const fmt = (n: number) => fmtTokens(Math.round(n))

/** `Read 22k · Write 4k`: the largest entries of a breakdown. */
export const listTop = (r: Record<string, number>, n: number) =>
  top(r, n)
    .map(([k, v]) => `${k} ${fmt(v)}`)
    .join(' · ')

/** One line on the API's own totals: what every group's `used` adds up to. */
export function apiLine(s: TokenState): string {
  const all = [s.main, s.agents, s.plugins]
  const sum = (k: keyof ApiTally) => all.reduce((n, t) => n + t[k], 0)
  const parts = [
    `${fmt(sum('cacheRead'))} cache read`,
    `${fmt(sum('cacheWrite'))} cache write`,
    `${fmt(sum('input'))} new input`,
    `${fmt(sum('output'))} output`,
  ]
  const cost = s.costUsd !== null ? ` · $${Math.max(0, s.costUsd - s.costBase).toFixed(2)}` : ''
  return `${fmt(totalUsed(s))} tokens over ${sum('requests')} requests: ${parts.join(', ')}${cost}`
}

/** What every request carries before the chat, by group; empty before the context breakdown came in. */
export function standingLine(s: TokenState): string {
  const parts = GROUP_IDS.filter(id => (s.standing[id] ?? 0) > 0).map(id => `${groupOf(id).label} ${fmt(s.standing[id] ?? 0)}`)
  const total = GROUP_IDS.reduce((n, id) => n + (s.standing[id] ?? 0), 0)
  return parts.length > 0 ? `Every request carries ${fmt(total)} before the chat: ${parts.join(', ')}` : ''
}

/** A group's detail: the kinds, the subjects, and who spent on its behalf. */
export function detailLine(s: TokenState, id: GroupId): string {
  const g = s.groups[id]
  const schemas = id === 'mcp' ? listTop(s.schemas, 3) : ''
  return [
    listTop(g.kinds, 4),
    listTop(g.items, 3),
    Object.keys(g.spent).length > 0 ? `spent: ${listTop(g.spent, 3)}` : '',
    schemas ? `schemas: ${schemas}` : '',
  ]
    .filter(Boolean)
    .join('  —  ')
}

/** `/tokens` as text: the totals, then each group that used anything. */
export function summary(s: TokenState): string {
  if (totalUsed(s) <= 0) return 'No tokens counted yet: the next request starts the tally.'
  const lines = [apiLine(s)]
  if (s.agents.requests + s.plugins.requests > 0) {
    lines.push(`Of those, subagents ${fmt(apiTotal(s.agents))} over ${s.agents.requests} requests; plugin model calls ${fmt(apiTotal(s.plugins))} over ${s.plugins.requests}.`)
  }
  for (const r of ranked(s)) {
    const g = s.groups[r.id]
    const head = `${groupOf(r.id).label} ${pct(r.share)}: ${fmt(g.used)} used, ${fmt(g.inContext)} in context now, ${g.calls} calls`
    const detail = detailLine(s, r.id)
    lines.push(detail ? `${head}. ${detail}` : `${head}.`)
  }
  const standing = standingLine(s)
  if (standing) lines.push(`${standing}.`)
  return lines.join('\n')
}
