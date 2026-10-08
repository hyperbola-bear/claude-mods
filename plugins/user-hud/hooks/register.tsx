/**
 * user-hud: a corner panel above the Claude Code prompt.
 *
 * Collapsed, it is one row at the band's right edge: the cache countdown,
 * model · effort, Keep warm once the cache is cooling, and the ◆ user-hud tab.
 * The tab (or /hud) opens the panel above it: model and effort pickers (they
 * run /model and /effort), the cache, the settings toggled most (written
 * through /config), and the handoff buttons. Open or closed is remembered.
 *
 * 1. Prompt cache countdown. Every main-thread model request refreshes the
 *    prompt cache, so the time since the last request says how long the cache
 *    has left: an hour, as Claude Code keeps it with `promptCacheTtl: "1h"` or
 *    on a subscription, or 5 minutes where it says so (the setting, or overage
 *    with the setting unset). On overage (a plan window past its limit) the
 *    band shows ⚠ overage and a New chat button (/clear). The band counts it down;
 *    with `warnSeconds` left while you are idle it alerts once (toast, sound,
 *    and a macOS alert with the plugin's logo and its own Keep warm button that
 *    closes after `alertSeconds`). [ Keep warm ] (w) or /keepwarm sends a one-line
 *    `$.model.fork` over the session's own transcript, which reads the cached
 *    prefix, resets its timer and adds nothing to the conversation.
 *
 * 2. Handoff. [ Handoff ] (h) runs your /handoff command, or a built-in
 *    prompt that writes .claude/handoffs/<date>.md when you have none;
 *    [ Read handoff ] (r) or /read-handoff shows the newest note in a pane with
 *    a button to continue from it.
 *
 * 3. Token usage. Every row the conversation keeps (`session.append`) is read
 *    for what it added and filed under a group (files, chat, MCP, shell, skills
 *    and plugins, web, subagents, thinking, system, other tools). Each main
 *    request's real token counts (`turn.step`) are split across the groups by
 *    what they held in the context when it went out; subagents' requests and
 *    other plugins' model calls are counted whole. The panel's TOKENS row
 *    shows the split; Details (t) or /tokens opens the Tokens pane.
 *
 * 4. Pickers. MODEL runs blue to orange as the models get more capable, and
 *    EFFORT from one grey to the full rainbow at Ultracode. Three styles (Rail,
 *    Ladder, Meter), drawn from coloured Box and Text and plain Buttons, so the
 *    terminal and the desktop draw the same picture.
 *
 * The band draws whatever other plugins put above the prompt first (it calls
 * `next`), so it sits beside pr-review-ui's band rather than replacing it.
 *
 * Reaches: model.fork (keep-warm pings), process.run (osascript, afplay),
 * fs reads (handoff notes, the alert's logo), store (the panel's open state),
 * settings read (the effort level, promptCacheTtl), env read
 * (CLAUDE_CODE_PROMPT_CACHE_TTL), session usage (the plan windows, the context
 * breakdown, the cost), agent list (a subagent's type), config set (the panel's
 * toggles), command run (/model, /effort, /handoff, /clear) and prompt submit
 * on button presses. It reads the conversation's rows and every model call to
 * count tokens, and changes none of them. Writes no files.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelForkResult, Register } from 'claude-code'

import type { CacheTtl, HandoffFile, HandoffState, HudState, PlanLimit, SelectorStyle, TtlInfo } from '../types'
import {
  EMPTY_CACHE,
  KEEP_WARM_PROMPT,
  TTL_MS,
  afterRequest,
  cacheTtlFor,
  cachedTokens,
  fmtClock,
  fmtTokens,
  hitRate,
  level,
  limitLabel,
  overageOf,
  pingSummary,
  promptTokens,
  remainingMs,
  shouldAlert,
  shouldAutoPing,
} from './cache.ts'
import { HANDOFF_DIRS, age, handoffPrompt, handoffTarget, isHandoffName, joinPath, newest, resumePrompt } from './handoff.ts'
import { MODELS, asEffort, footerRule, lifeBar, modelAlias, modelLabel, nextWarn, sectionRule } from './hud.ts'
import { picker, pickerRows, styleAt, tinted } from './pickers.tsx'
import type { PickerOption, Ui } from './pickers.tsx'
import { EFFORT_COLORS, EFFORT_STEPS, MODEL_COLORS, SELECTOR_STYLES, asStyle, effortStep, nextStyle, parseEffortArgs, styleLabel, ultracodeTook } from './selector.ts'
import type { EffortStep } from './selector.ts'
import { stackedBar, tokenPane } from './tokenview.tsx'
import {
  addShares,
  attributeAgent,
  attributePlugin,
  attributeRequest,
  classifyRow,
  compacted,
  contextOf,
  contextWeights,
  emptyTokens,
  groupOf,
  mcpSchemas,
  pct,
  ranked,
  restarted,
  standingFrom,
  summary,
  totalUsed,
  trimmedTo,
  withContext,
} from './tokens.ts'
import type { Attribution, Row, ToolUse } from './tokens.ts'

const STORE_OPEN = 'panelOpen'
const HANDOFF_PANE = 'handoff'
const TOKENS_PANE = 'tokens'
const STYLES_PANE = 'styles'
/** The width the styles pane asks for: Rail's and Meter's columns, beside the field names. */
const STYLES_PANE_COLUMNS = 76
const PANEL_WIDTH = 72
/** The column the field names (MODEL, EFFORT, TOKENS) sit in. */
const FIELD_WIDTH = 8
/** Cells of the TOKENS row's stacked bar. */
const TOKEN_BAR_CELLS = 16
/** The context breakdown is asked for at most this often, after a turn. */
const STANDING_EVERY_MS = 20_000
/** Tool calls remembered by id, so their results land in the same group. */
const MAX_TOOL_USES = 4_000
/** Requests between two measurements of the context, which catch the tool results the engine trims. */
const MEASURE_EVERY = 25
/** `$.agent.list()` is asked at most this often for an agent it does not name. */
const AGENT_LIST_EVERY_MS = 5_000
/** An agent no list names: a workflow's, or the engine's own fork (compaction, memory). */
const UNLISTED_AGENT = 'unlisted (workflows, compaction)'

const EMPTY_HANDOFF: HandoffState = { files: [], index: 0, text: null, error: null, hasCommand: false }

const cacheA = atom({ plugin: 'user-hud', key: 'cache' } as const, EMPTY_CACHE)
const ttlA = atom({ plugin: 'user-hud', key: 'ttl' } as const, { ttl: '1h', source: 'default' } as TtlInfo)
const handoffA = atom({ plugin: 'user-hud', key: 'handoff' } as const, EMPTY_HANDOFF)
const hudA = atom({ plugin: 'user-hud', key: 'hud' } as const, { isOpen: false, model: null, effort: null, ultracode: false, overage: null } as HudState)
const tokensA = atom({ plugin: 'user-hud', key: 'tokens' } as const, emptyTokens(null))

type Cfg = {
  warnMs: number
  notifyMac: boolean
  alertSeconds: number
  sound: boolean
  autoKeepWarm: boolean
  maxAutoPings: number
  showBand: boolean
  handoffPath: string
  selectorStyle: SelectorStyle
}

export function readCfg(o: Record<string, unknown>): Cfg {
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const b = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  return {
    warnMs: Math.max(15, n(o.warnSeconds, 120)) * 1000,
    notifyMac: b(o.notifyMac, true),
    alertSeconds: Math.min(60, Math.max(3, Math.round(n(o.alertSeconds, 7)))),
    sound: b(o.sound, true),
    autoKeepWarm: b(o.autoKeepWarm, false),
    maxAutoPings: Math.max(1, n(o.maxAutoPings, 3)),
    showBand: b(o.showBand, true),
    handoffPath: typeof o.handoffPath === 'string' ? o.handoffPath.trim() : '',
    selectorStyle: asStyle(o.selectorStyle),
  }
}

// Module state: set by register(); lost on a reload.
let options: Record<string, unknown> = {}
let cfg: Cfg = readCfg({})
let isHandoffPending = false
const toolUses = new Map<string, Attribution>()
let lastSkill: string | null = null
const agentTypes = new Map<string, string>()
let agentsListedAt = 0
let standingAt = 0
/** Set when the rows seen going in no longer say what the context holds: after a compaction or a resume. */
let needsMeasure = false
let requestsSinceMeasure = 0

// ---------- prompt cache ----------

async function ttlNow($: EngineInterface): Promise<CacheTtl> {
  return (await read($, ttlA)).ttl
}

/**
 * A macOS dialog rather than a notification banner: banners take no buttons and leave when macOS
 * says. Arguments: title, body, icon path ('' for the system note icon), seconds before it closes.
 * Prints the button pressed, or `timeout`.
 */
const ALERT_SCRIPT = [
  'on run argv',
  'set theTitle to item 1 of argv',
  'set theBody to item 2 of argv',
  'set theIcon to item 3 of argv',
  'set theSeconds to (item 4 of argv) as integer',
  'try',
  'if theIcon is "" then',
  'set r to display dialog theBody with title theTitle buttons {"Dismiss", "Keep warm"} default button "Keep warm" giving up after theSeconds with icon note',
  'else',
  'set r to display dialog theBody with title theTitle buttons {"Dismiss", "Keep warm"} default button "Keep warm" giving up after theSeconds with icon (POSIX file theIcon as alias)',
  'end if',
  'on error number -128',
  'return "Dismiss"',
  'end try',
  'if gave up of r then return "timeout"',
  'return button returned of r',
  'end run',
]

/** Shows the macOS alert and resolves with the button pressed: `Keep warm`, `Dismiss`, or `timeout`. */
async function macAlert($: EngineInterface, title: string, body: string): Promise<string | null> {
  const icon = `${$.plugin.root}/assets/logo.icns`
  const hasIcon = (await $.fs.stat(icon).catch(() => null))?.kind === 'file'
  const argv = ['osascript', ...ALERT_SCRIPT.flatMap(line => ['-e', line]), title, body, hasIcon ? icon : '', String(cfg.alertSeconds)]
  const r = await $.process.run(argv, { timeoutMs: (cfg.alertSeconds + 5) * 1000 }).catch(() => null)
  return r !== null && r.exitCode === 0 ? r.stdout.trim() : null
}

async function notify($: EngineInterface, title: string, body: string) {
  if (cfg.sound) {
    $.process.run(['afplay', '/System/Library/Sounds/Glass.aiff'], { timeoutMs: 5000 }).catch(() => {})
  }
  if (cfg.notifyMac && (await macAlert($, title, body)) === 'Keep warm') await ping($, 'manual')
}

async function ping($: EngineInterface, origin: 'manual' | 'auto'): Promise<string> {
  const c = await read($, cacheA)
  if (c.isPinging) return 'A keep-warm ping is already running.'
  if (c.isWorking) return 'Claude is working, which keeps the cache warm by itself.'
  await update($, cacheA, s => ({ ...s, isPinging: true }))
  const at = await $.clock.now()
  let line: string
  try {
    const r = await $.model.fork({ prompt: KEEP_WARM_PROMPT })
    if (r.isAnswered) {
      const usage = r.usage
      await update($, tokensA, s => attributePlugin(s, usage, 'user-hud')).catch(() => {})
      const summary = pingSummary(r.usage)
      line = summary.line
      await update($, cacheA, s => {
        const next = summary.isWarm ? afterRequest(s, at, r.usage, s.model) : s
        // A ping's own tokens are tiny; keep the last real request's counts on show.
        return {
          ...next,
          inputTokens: s.inputTokens,
          readTokens: summary.isWarm ? Math.max(s.readTokens, r.usage.cache_read_input_tokens) : s.readTokens,
          writeTokens: s.writeTokens,
        }
      })
    } else if (r.reason === 'nothing-to-fork') {
      line = 'Nothing to keep warm yet: send a first prompt.'
    } else if (r.reason === 'api-error') {
      line = `Keep-warm ping failed (API ${r.status ?? 'error'}).`
    } else {
      line = `Keep-warm ping did not answer (${r.reason}).`
    }
  } catch (err) {
    line = `Keep-warm ping could not be sent: ${String(err).slice(0, 120)}`
  }
  await update($, cacheA, s => ({ ...s, isPinging: false, autoPings: origin === 'auto' ? s.autoPings + 1 : s.autoPings, lastPing: line }))
  $.ui.toast(origin === 'auto' ? `Auto keep-warm: ${line}` : line, { timeoutMs: 6000 })
  $.ui.invalidate('ui.render')
  return line
}

async function tick($: EngineInterface) {
  const c = await read($, cacheA)
  if (c.lastHitAt === null) return
  const now = await $.clock.now()
  const rem = remainingMs(c.lastHitAt, await ttlNow($), now)
  if (shouldAlert(c, rem, cfg.warnMs)) {
    const hitAt = c.lastHitAt
    await update($, cacheA, s => ({ ...s, alertedFor: hitAt }))
    const left = fmtClock(rem ?? 0)
    const size = fmtTokens(cachedTokens(c))
    $.ui.toast(`Prompt cache expires in ${left} (${size} tokens). Press w on the cache band or run /keepwarm to keep it warm.`, { timeoutMs: 20_000 })
    void notify($, 'Claude Code: cache cooling', `${left} left on ${size} cached tokens. Keep it warm?`)
  }
  if (shouldAutoPing(c, rem, { autoKeepWarm: cfg.autoKeepWarm, maxAutoPings: cfg.maxAutoPings, warnMs: cfg.warnMs })) {
    void ping($, 'auto')
  }
  // Redraw the countdown each second while it runs, and once more as it lands on cold.
  if (rem !== null && rem > -2000) $.ui.invalidate('ui.render')
}

async function reset($: EngineInterface, reason: string) {
  await update($, cacheA, s => ({ ...EMPTY_CACHE, isWorking: s.isWorking, resetReason: reason }))
}

/** The lifetime the countdown uses, as Claude Code picks it: promptCacheTtl, else 1h, else 5m on overage. */
async function resolveTtl($: EngineInterface) {
  const env = await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL').catch(() => undefined)
  const settings = await $.settings.read().catch(() => ({}) as Record<string, unknown>)
  const { overage } = await read($, hudA)
  await update($, ttlA, () => cacheTtlFor(env ?? settings.promptCacheTtl, overage !== null))
}

/** Follows the plan windows: past a limit the subscription is on overage, and the indicator shows. */
async function trackOverage($: EngineInterface, limits: readonly PlanLimit[]) {
  const overage = overageOf(limits)
  const before = (await read($, hudA)).overage
  if (before?.kind === overage?.kind && Math.round(before?.percentUsed ?? 0) === Math.round(overage?.percentUsed ?? 0)) return
  await update($, hudA, s => ({ ...s, overage }))
  await resolveTtl($)
}

/** A fresh conversation: /clear, so the next turns stop re-sending this long one (it stays in /resume). */
async function startNewChat($: EngineInterface) {
  await $.command.run({ command: 'clear', args: '' }).catch(err => $.ui.toast(`/clear failed: ${String(err).slice(0, 120)}`))
}

// ---------- corner panel ----------

async function setPanelOpen($: EngineInterface, isOpen: boolean) {
  await update($, hudA, s => ({ ...s, isOpen }))
  await $.store.set(STORE_OPEN, isOpen).catch(() => {})
}

async function pickModel($: EngineInterface, alias: string) {
  const before = (await read($, hudA)).model
  if (modelAlias(before) === alias) return
  await update($, hudA, s => ({ ...s, model: alias }))
  try {
    await $.command.run({ command: 'model', args: alias })
  } catch (err) {
    $.ui.toast(`/model ${alias} failed: ${String(err).slice(0, 120)}`)
  }
  const now = await $.session.model().catch(() => null)
  if (now) await update($, hudA, s => ({ ...s, model: now }))
}

/**
 * Runs `/effort <level>`, which also turns ultracode off, or `/effort ultracode on`, which keeps the
 * level and lets Claude run multi-agent workflows; that one is refused where dynamic workflows are off,
 * and the toast says why.
 */
async function pickEffort($: EngineInterface, step: EffortStep) {
  const hud = await read($, hudA)
  if (effortStep(hud.effort, hud.ultracode) === step) return
  const args = step === 'ultracode' ? 'ultracode on' : step
  await update($, hudA, s => (step === 'ultracode' ? { ...s, ultracode: true } : { ...s, effort: step, ultracode: false }))
  const r = await $.command.run({ command: 'effort', args }).catch(err => {
    $.ui.toast(`/effort ${args} failed: ${String(err).slice(0, 120)}`)
    return null
  })
  if (step === 'ultracode' && (r === null || !ultracodeTook(r.text))) {
    await update($, hudA, s => ({ ...s, ultracode: false }))
    if (r?.text) $.ui.toast(r.text, { timeoutMs: 8000 })
  }
}

async function cycleStyle($: EngineInterface) {
  await setOption($, 'selectorStyle', nextStyle(cfg.selectorStyle))
}

// ---------- pickers ----------

/** The model and effort options as the pickers draw them; `prefix` keeps the keys of several drawings apart. */
function pickerOptions($: EngineInterface, hud: HudState, prefix = ''): { model: PickerOption[]; effort: PickerOption[] } {
  const alias = modelAlias(hud.model)
  const step = effortStep(hud.effort, hud.ultracode)
  return {
    model: MODELS.map(m => ({
      key: `${prefix}model-${m.alias}`,
      label: m.label,
      colors: [MODEL_COLORS[m.alias] ?? '#888888'],
      isOn: alias === m.alias,
      onPress: () => void pickModel($, m.alias),
    })),
    effort: EFFORT_STEPS.map(f => ({
      key: `${prefix}effort-${f.step}`,
      label: f.label,
      colors: EFFORT_COLORS[f.step],
      isOn: step === f.step,
      onPress: () => void pickEffort($, f.step),
    })),
  }
}

/** A field's name in its column, then its body; beside the body's last row where the labels sit last (the Meter). */
function fieldRow(ui: Ui, label: string, body: JSX.Element, isLabelLast = false) {
  const { Box, Text } = ui
  return (
    <Box key={`field-${label}`} flexDirection="row" alignItems={isLabelLast ? 'flex-end' : 'flex-start'}>
      <Box width={FIELD_WIDTH} flexShrink={0}>
        <Text dimColor>{label}</Text>
      </Box>
      {body}
    </Box>
  )
}

// ---------- token usage ----------

function remember(uses: readonly ToolUse[]) {
  for (const u of uses) {
    toolUses.set(u.id, { group: u.group, kind: u.kind, item: u.item })
    if (u.group === 'skills' && u.kind === 'skill' && u.item) lastSkill = u.item
  }
  for (const id of toolUses.keys()) {
    if (toolUses.size <= MAX_TOOL_USES) break
    toolUses.delete(id)
  }
}

/** Files one main-conversation row under its groups; a compaction's boundary first empties the context. */
async function countRow($: EngineInterface, row: Row) {
  if (row.door === 'compaction' && !row.message.role) {
    await update($, tokensA, compacted)
    return
  }
  const { shares, uses } = classifyRow(row, id => toolUses.get(id), lastSkill)
  remember(uses)
  if (shares.length > 0) await update($, tokensA, s => addShares(s, shares))
}

/** What each request carries before the conversation, from the context breakdown; at most every 20 seconds unless forced. */
async function refreshStanding($: EngineInterface, isForced = false) {
  const now = await $.clock.now()
  if (!isForced && now - standingAt < STANDING_EVERY_MS) return
  standingAt = now
  const usage = await $.session.usage({ breakdown: 'summary' }).catch(() => null)
  const b = usage?.context.breakdown
  if (!b) return
  await update($, tokensA, s => ({ ...s, standing: standingFrom(b), schemas: mcpSchemas(b) }))
}

async function agentType($: EngineInterface, agentId: string): Promise<string> {
  const known = agentTypes.get(agentId)
  if (known) return known
  const now = await $.clock.now()
  if (now - agentsListedAt < AGENT_LIST_EVERY_MS) return UNLISTED_AGENT
  agentsListedAt = now
  for (const a of await $.agent.list().catch(() => [])) agentTypes.set(a.id, a.type)
  return agentTypes.get(agentId) ?? UNLISTED_AGENT
}

/**
 * Measures what each group holds from the messages the next request is built from. `replace` where the
 * rows seen going in cannot say (a load, a resume, a compaction); `trim` every so many requests, which
 * lowers only the groups the messages measure exactly, for the tool results the engine has trimmed since.
 */
async function measureContext($: EngineInterface, how: 'replace' | 'trim') {
  needsMeasure = false
  requestsSinceMeasure = 0
  const held = contextOf(await $.session.messages({ as: 'api' }))
  await update($, tokensA, s => (how === 'replace' ? withContext(s, held) : trimmedTo(s, held)))
}

/** A model call made beside the conversation: credited to the plugin that made it (this one's pings are counted where they are sent). */
async function countModelCall($: EngineInterface, plugin: string, r: { value?: ModelForkResult }) {
  const usage = r.value && 'usage' in r.value ? r.value.usage : undefined
  if (plugin === 'user-hud' || !usage || usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens === 0) return
  await update($, tokensA, s => attributePlugin(s, usage, plugin))
}

/** A new conversation (/clear, /resume): the tally starts over, and the context is measured before the next request. */
async function resetTokens($: EngineInterface) {
  toolUses.clear()
  lastSkill = null
  needsMeasure = true
  const now = await $.clock.now()
  await update($, tokensA, s => ({ ...emptyTokens(now), standing: s.standing, schemas: s.schemas, costUsd: s.costUsd, costBase: s.costUsd ?? s.costBase }))
}

/** The pane's Reset: the counts start over, mid-chat, and what the context still holds stays. */
async function restartTokens($: EngineInterface) {
  const now = await $.clock.now()
  await update($, tokensA, s => restarted(s, now))
}

async function openTokensPane($: EngineInterface) {
  await refreshStanding($, true)
  await $.ui.open({ id: TOKENS_PANE, title: 'Tokens' })
}

/**
 * Writes one of this plugin's /config rows. The engine reloads the module with
 * the new options; applying them here too redraws the panel without waiting.
 */
async function setOption($: EngineInterface, field: string, value: boolean | string | number) {
  const r = await $.config.set({ key: `user-hud.${field}`, value }).catch(err => ({ deny: String(err).slice(0, 120) }))
  if (r.deny !== undefined) {
    $.ui.toast(`Could not change ${field}: ${r.deny}`)
    return
  }
  options = { ...options, [field]: value }
  cfg = readCfg(options)
  $.ui.invalidate('ui.render')
}

// ---------- handoff ----------

/** The project root, absolute; paths shown and handed to Claude stay relative to it. */
async function projectRoot($: EngineInterface): Promise<string> {
  return (await $.session.root().catch(() => '.')).replace(/\/$/, '')
}

const under = (root: string, path: string) => (path.startsWith('/') ? path : `${root}/${path}`)

async function scanHandoffs($: EngineInterface): Promise<HandoffFile[]> {
  const found: HandoffFile[] = []
  const root = await projectRoot($)
  const add = async (dir: string, onlyMarkdown: boolean) => {
    const entries = await $.fs.list(under(root, dir)).catch(() => [])
    for (const f of entries) {
      if (f.kind !== 'file') continue
      if (onlyMarkdown ? /\.md$/i.test(f.name) : isHandoffName(dir, f.name)) found.push({ path: joinPath(dir, f.name), mtimeMs: f.mtimeMs })
    }
  }
  if (cfg.handoffPath) {
    const st = await $.fs.stat(under(root, cfg.handoffPath)).catch(() => null)
    if (st?.kind === 'file') found.push({ path: cfg.handoffPath, mtimeMs: st.mtimeMs })
    else if (st?.kind === 'dir') await add(cfg.handoffPath, true)
  } else {
    for (const dir of HANDOFF_DIRS) await add(dir, false)
  }
  const files = newest(found)
  const commands = await $.command.list().catch(() => [])
  const hasCommand = commands.some(c => c.name === 'handoff')
  await update($, handoffA, s => ({ ...s, files, hasCommand, index: Math.min(s.index, Math.max(0, files.length - 1)) }))
  return files
}

async function loadHandoff($: EngineInterface, index: number) {
  const { files } = await read($, handoffA)
  const file = files[index]
  if (!file) {
    await update($, handoffA, s => ({ ...s, index: 0, text: null, error: null }))
    return
  }
  try {
    const text = await $.fs.read(under(await projectRoot($), file.path))
    await update($, handoffA, s => ({ ...s, index, text: typeof text === 'string' ? text : '', error: null }))
  } catch (err) {
    await update($, handoffA, s => ({ ...s, index, text: null, error: `Could not read ${file.path}: ${String(err).slice(0, 120)}` }))
  }
}

async function runHandoff($: EngineInterface) {
  const commands = await $.command.list().catch(() => [])
  isHandoffPending = true
  if (commands.some(c => c.name === 'handoff')) {
    await $.command.run({ command: 'handoff', args: '' }).catch(err => $.ui.toast(`/handoff failed: ${String(err).slice(0, 120)}`))
  } else {
    const target = handoffTarget(await $.clock.now())
    await $.prompt.submit({ text: handoffPrompt(target) })
    $.ui.toast(`No /handoff command found: asking Claude to write ${target}`)
  }
}

async function openHandoffPane($: EngineInterface) {
  const files = await scanHandoffs($)
  await loadHandoff($, 0)
  await $.ui.open({ id: HANDOFF_PANE, title: 'Handoff' })
  if (files.length === 0) $.ui.toast('No handoff note found yet: press h on the band (or run /handoff) to write one.')
}

export const register: Register = (on, given) => {
  options = { ...((given ?? {}) as Record<string, unknown>) }
  cfg = readCfg(options)
  isHandoffPending = false
  toolUses.clear()
  lastSkill = null
  agentTypes.clear()
  agentsListedAt = 0
  standingAt = 0
  needsMeasure = false
  requestsSinceMeasure = 0

  // ---------- lifecycle ----------

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'cache', description: 'Prompt cache status: time left, size, hit rate and lifetime' })
    await $.command.register({ name: 'keepwarm', description: 'Refresh the prompt cache now with a one-line ping (adds nothing to the chat)' })
    await $.command.register({ name: 'read-handoff', description: 'Show the newest handoff note, with a button to continue from it' })
    await $.command.register({ name: 'hud', description: 'Open or close the user-hud panel in the corner above the prompt' })
    await $.command.register({ name: 'hud-styles', description: 'The three picker styles side by side (Rail, Ladder, Meter), with a button to use each' })
    await $.command.register({ name: 'tokens', description: 'Where this session’s tokens went: files, chat, MCP, shell, skills and plugins, subagents and more' })

    const isOpen = (await $.store.get(STORE_OPEN).catch(() => undefined)) === true
    const model = await $.session.model().catch(() => null)
    const settings = await $.settings.read().catch(() => ({}) as Record<string, unknown>)
    // `effortLevel: "ultracode"` starts a session at xhigh with ultracode on.
    const isUltracode = settings.effortLevel === 'ultracode'
    await update($, hudA, s => ({
      ...s,
      isOpen,
      model: model ?? s.model,
      effort: s.effort ?? (isUltracode ? 'xhigh' : asEffort(settings.effortLevel)),
      ultracode: s.ultracode || isUltracode,
    }))
    const usage = await $.session.usage().catch(() => null)
    await trackOverage($, usage?.rateLimits ?? [])
    await resolveTtl($)
    await scanHandoffs($).catch(() => [])
    // A reload keeps the tally (it is the session's); a fresh session starts it.
    const now = await $.clock.now()
    await update($, tokensA, s => (s.since === null ? { ...s, since: now } : s))
    // A resumed conversation, or a reload mid-chat: what is already in the context.
    await measureContext($, 'replace').catch(() => {})
    await refreshStanding($, true).catch(() => {})

    $.clock.every(1000, () => void tick($))
    return started
  })

  on('turn.start', async ($, e, next) => {
    await update($, cacheA, s => ({ ...s, isWorking: true, autoPings: 0 }))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, cacheA, s => ({ ...s, isWorking: false }))
      if (isHandoffPending) {
        isHandoffPending = false
        void scanHandoffs($)
      }
      void refreshStanding($).catch(() => {})
    }
    return next(e)
  })

  // Every main-thread request reads or writes the cache: that is the clock's reset. Its real token
  // counts are split across the groups by what they held when it went out.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      const result = yield* next(e)
      try {
        const usage = result.usage
        if (usage) {
          const type = await agentType($, e.agentId)
          await update($, tokensA, s => attributeAgent(s, usage, type))
        }
      } catch {
        // Never disturb the turn over a display.
      }
      return result
    }
    const at = await $.clock.now()
    // The effort the request really carries, after any downgrade for the model.
    const effort = asEffort(e.effort)
    if (effort) await update($, hudA, s => (s.effort === effort ? s : { ...s, effort })).catch(() => {})
    requestsSinceMeasure += 1
    if (needsMeasure) await measureContext($, 'replace').catch(() => {})
    else if (requestsSinceMeasure >= MEASURE_EVERY) await measureContext($, 'trim').catch(() => {})
    const weights = await read($, tokensA).then(contextWeights, () => null)
    const result = yield* next(e)
    try {
      const usage = result.usage
      if (usage) {
        await update($, cacheA, s => afterRequest(s, at, usage, usage.model))
        if (weights) await update($, tokensA, s => attributeRequest(s, weights, usage, { answer: result.answer, toolUses: result.toolUses }))
      }
    } catch {
      // Never disturb the turn over a display.
    }
    return result
  })

  // Every row the main conversation keeps, as stored: what it added, group by group.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId === undefined && stored.message) {
      await countRow($, { door: e.door, origin: e.origin, message: stored.message }).catch(() => {})
    }
    return stored
  }).catch(($, e, next) => next(e))

  // Model calls other plugins make beside the conversation (a side chat's fork, a summary).
  on('model.fork', async ($, e, next) => {
    const r = await next(e)
    await countModelCall($, next.origin.plugin, r).catch(() => {})
    return r
  }).catch(($, e, next) => next(e))
  on('model.complete', async ($, e, next) => {
    const r = await next(e)
    await countModelCall($, next.origin.plugin, r).catch(() => {})
    return r
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    await reset($, 'compacted')
    // The summary and the messages kept: measured before the next request.
    needsMeasure = true
    return result
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await reset($, 'cleared')
    if (e.reason === 'clear' || e.reason === 'resume') await resetTokens($)
    return next(e)
  })

  // Claude Code reports the plan windows and the cost after each response; past a limit is overage.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await trackOverage($, e.rateLimits).catch(() => {})
    const cost = e.cost
    if (e.changed.includes('cost') && cost) await update($, tokensA, s => ({ ...s, costUsd: cost.usd })).catch(() => {})
    return next(e)
  })

  // /effort typed at the prompt moves the picker too; `/effort <level>` also turns ultracode off.
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const r = await next(e)
    const change = parseEffortArgs(e.args)
    if (change.ultracode === true && !ultracodeTook(r.text)) return r
    if (change.effort !== undefined || change.ultracode !== undefined) await update($, hudA, s => ({ ...s, ...change })).catch(() => {})
    return r
  }).catch(($, e, next) => next(e))

  on('classic.PostModelSwitch', async ($, e, next) => {
    await reset($, 'model switched')
    await update($, hudA, s => ({ ...s, model: e.to_model }))
    return next(e)
  }).catch(($, e, next) => next(e))

  // ---------- commands ----------

  on('command.run', { command: 'cache' }, async $ => {
    const c = await read($, cacheA)
    const t = await read($, ttlA)
    if (c.lastHitAt === null) {
      return { text: c.resetReason ? `Cache reset (${c.resetReason}); the next prompt writes a new one.` : 'No cached prompt yet: send a first prompt.' }
    }
    const rem = remainingMs(c.lastHitAt, t.ttl, await $.clock.now()) ?? 0
    const hud = await read($, hudA)
    const why = { setting: 'set by promptCacheTtl', overage: 'overage: unset promptCacheTtl drops to 5m', default: 'subscription default' }[t.source]
    const lines = [
      rem > 0 ? `Cache warm: ${fmtClock(rem)} left of ${t.ttl} (${why}).` : `Cache expired ${fmtClock(-rem)} ago (${t.ttl}, ${why}).`,
      hud.overage ? `On overage (${limitLabel(hud.overage)}): a new chat costs less per turn.` : '',
      `Last request: ${fmtTokens(c.readTokens)} read from cache, ${fmtTokens(c.writeTokens)} written, ${fmtTokens(c.inputTokens)} uncached` +
        (hitRate(c) !== null ? ` (hit ${hitRate(c)}%).` : '.'),
      c.model ? `Model: ${c.model}.` : '',
      c.lastPing ? `Last ping: ${c.lastPing}` : '',
    ]
    return { text: lines.filter(Boolean).join('\n') }
  })

  on('command.run', { command: 'keepwarm' }, async $ => {
    const c = await read($, cacheA)
    if (c.lastHitAt === null) return { text: 'Nothing cached yet: send a first prompt.' }
    void ping($, 'manual')
    return { text: 'Sending a keep-warm ping…' }
  })

  on('command.run', { command: 'read-handoff' }, async $ => {
    await openHandoffPane($)
    const { files } = await read($, handoffA)
    return { text: files[0] ? `Handoff: ${files[0].path}` : 'No handoff note found.' }
  })

  on('command.run', { command: 'hud' }, async $ => {
    const { isOpen } = await read($, hudA)
    await setPanelOpen($, !isOpen)
    return { text: isOpen ? 'user-hud panel closed.' : 'user-hud panel open.' }
  })

  on('command.run', { command: 'hud-styles' }, async $ => {
    await $.ui.open({ id: STYLES_PANE, title: 'Picker styles', columns: STYLES_PANE_COLUMNS }).catch(() => {})
    return { text: `Picker styles: Rail, Ladder and Meter side by side. In use: ${styleLabel(cfg.selectorStyle)}.` }
  })

  on('command.run', { command: 'tokens' }, async $ => {
    await openTokensPane($).catch(() => {})
    return { text: summary(await read($, tokensA)) }
  })

  // ---------- corner panel above the prompt ----------

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Whatever other plugins draw above the prompt comes first; this band goes under it.
    const beneath = await next(e)
    if (!cfg.showBand || e.props.hasSurvey) return beneath
    const c = await read($, cacheA)
    const t = await read($, ttlA)
    const hud = await read($, hudA)
    const handoff = await read($, handoffA)
    const tokens = await read($, tokensA)
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const now = await $.clock.now()
    const rem = remainingMs(c.lastHitAt, t.ttl, now)
    const lv = level(rem, cfg.warnMs, e.props.isWorking || c.isWorking)
    const hit = hitRate(c)
    const width = Math.max(24, Math.min(PANEL_WIDTH, e.props.bodyColumns))
    // The terminal draws pills as filled cells; the other surfaces draw native buttons, which only look
    // right as themselves (a coloured Box behind a plain Button paints a square block there).
    const isNative = e.surface !== 'terminal'
    const canWarm = !c.isPinging && (lv === 'warm' || lv === 'cooling')
    const alias = modelAlias(hud.model)
    const step = effortStep(hud.effort, hud.ultracode)
    const used = totalUsed(tokens)

    const keepWarm = (
      <Button
        key="keepwarm"
        label="Keep warm"
        hotkey="w"
        variant={lv === 'cooling' ? 'primary' : undefined}
        dimColor={lv === 'warm'}
        onPress={() => void ping($, 'manual')}
      />
    )

    const newChat = <Button key="newchat" label="New chat" onPress={() => void startNewChat($)} />
    const overageMark = hud.overage && <Text color="warning">⚠ overage</Text>

    // ----- the tab row: always there, at the band's right edge -----

    const chip =
      c.isPinging ? <Text dimColor>◆ pinging…</Text>
      : lv === 'live' ? <Text color="success">◆ cache live</Text>
      : lv === 'warm' ? <Text color="success">◆ {fmtClock(rem ?? 0)}</Text>
      : lv === 'cooling' ? <Text color="warning" bold>◆ {fmtClock(rem ?? 0)} left</Text>
      : lv === 'cold' ? <Text color="error">◇ cache cold</Text>
      : null

    // The model in its colour on the blue-to-orange ramp, the effort in its own, letter by letter.
    const modelName = modelLabel(hud.model)
    const stepLabel = EFFORT_STEPS.find(f => f.step === step)?.label
    const setup = !modelName && !stepLabel ? null : (
      <Text key="setup">
        {modelName && (
          <Text color={alias ? MODEL_COLORS[alias] : undefined} dimColor={!alias}>
            {modelName}
          </Text>
        )}
        {modelName && stepLabel && <Text dimColor> · </Text>}
        {step && stepLabel && tinted(ui, 'setup-effort', stepLabel, EFFORT_COLORS[step])}
      </Text>
    )

    const tab = (
      <Box key="tabrow" flexDirection="row" flexWrap="wrap" justifyContent="flex-end" columnGap={2}>
        {!hud.isOpen && chip}
        {!hud.isOpen && overageMark}
        {!hud.isOpen && hud.overage && newChat}
        {!hud.isOpen && used > 0 && <Text dimColor>{fmtTokens(Math.round(used))} tokens</Text>}
        {!hud.isOpen && setup}
        {!hud.isOpen && lv === 'cooling' && canWarm && keepWarm}
        <Box key="tab" backgroundColor="claude" paddingX={1}>
          <Button key="panel" plain label={`◆ user-hud ${hud.isOpen ? '▾' : '▴'}`} onPress={() => void setPanelOpen($, !hud.isOpen)} />
        </Box>
      </Box>
    )
    // flexGrow: the desktop sets the tree beside its own collapse control in a row, where an ungrown
    // tree shrinks to its content and the tab lands on the left.
    if (!hud.isOpen) {
      return (
        <Box flexDirection="column" flexGrow={1}>
          {beneath}
          {tab}
        </Box>
      )
    }

    // ----- the panel: grows up from the tab -----

    const pill = (key: string, label: string, isOn: boolean, onPress: () => void) =>
      isNative ? (
        <Button key={`set-${key}`} label={label} variant={isOn ? 'primary' : undefined} onPress={onPress} />
      ) : (
        <Box key={`pill-${key}`} flexShrink={0} backgroundColor={isOn ? 'success' : 'subtle'}>
          <Button key={`set-${key}`} plain label={` ${label} `} onPress={onPress} />
        </Box>
      )
    const field = (label: string, body: JSX.Element, isLabelLast = false) => fieldRow(ui, label, body, isLabelLast)

    // The pickers: the same tree on every surface, in the style chosen.
    const pickerWidth = width - FIELD_WIDTH
    const { model: modelOptions, effort: effortOptions } = pickerOptions($, hud)
    const style = styleAt(cfg.selectorStyle, pickerWidth, [modelOptions.map(o => o.label), effortOptions.map(o => o.label)])
    const pickerRowCount = pickerRows(style, pickerWidth, modelOptions) + pickerRows(style, pickerWidth, effortOptions)
    // The Meter's labels sit under its bars: the field name goes beside the labels.
    const isLabelLast = style === 'meter'

    // ----- the tokens row: a stacked bar of where they went, the two largest named -----

    const leaders = ranked(tokens).filter(g => g.used > 0).slice(0, 2)
    const tokensRow = (
      <Box key="tokensrow" flexDirection="row" columnGap={1}>
        {used > 0 ? stackedBar(ui, 'panel-bar', tokens, TOKEN_BAR_CELLS) : <Text dimColor>counting from the next request</Text>}
        {used > 0 && <Text>{fmtTokens(Math.round(used))}</Text>}
        {leaders.map(l => (
          <Text key={`lead-${l.id}`} dimColor wrap="truncate">
            · {groupOf(l.id).label} {pct(l.share)}
          </Text>
        ))}
        <Box flexGrow={1} />
        <Button key="tokens" plain hotkey="t" label="Details" onPress={() => void openTokensPane($)} />
      </Box>
    )

    const bar = lifeBar(rem ?? 0, TTL_MS[t.ttl])
    const cacheLine = (
      <Box key="cacheline" flexDirection="row" columnGap={1}>
        {lv === 'none' && (
          <Text dimColor wrap="truncate">
            {c.resetReason ? `◇ cache reset (${c.resetReason}): the next prompt writes a new one` : '◇ nothing cached yet: send a first prompt'}
          </Text>
        )}
        {lv === 'live' && <Text color="success">◆ cache live</Text>}
        {lv === 'warm' && <Text color="success">◆ cache {fmtClock(rem ?? 0)}</Text>}
        {lv === 'cooling' && (
          <Text color="warning" bold>
            ◆ cache {fmtClock(rem ?? 0)} left
          </Text>
        )}
        {lv === 'cold' && (
          <Text color="error" wrap="truncate">
            ◇ cache cold · next prompt re-writes {fmtTokens(promptTokens(c))}
          </Text>
        )}
        {(lv === 'warm' || lv === 'cooling') && (
          <Text>
            <Text color={lv === 'cooling' ? 'warning' : 'success'}>{bar.on}</Text>
            <Text dimColor>{bar.off}</Text>
          </Text>
        )}
        {(lv === 'live' || lv === 'warm' || lv === 'cooling') && (
          <Text dimColor wrap="truncate">
            {fmtTokens(cachedTokens(c))} cached{hit !== null ? ` · hit ${hit}%` : ''} · {t.ttl}
          </Text>
        )}
        <Box flexGrow={1} />
        {c.isPinging && <Text dimColor>pinging…</Text>}
        {canWarm && keepWarm}
      </Box>
    )

    const toggle = (key: string, label: string, desc: string, isOn: boolean) => (
      <Box key={`row-${key}`} flexDirection="row" columnGap={1}>
        {isOn ? <Text color="success">●</Text> : <Text dimColor>○</Text>}
        <Box width={16} flexShrink={0}>
          <Text bold>{label}</Text>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          <Text dimColor wrap="truncate">
            {desc}
          </Text>
        </Box>
        {pill(key, isNative ? (isOn ? 'On' : 'Off') : isOn ? '● On' : '○ Off', isOn, () => void setOption($, key, !isOn))}
      </Box>
    )
    const choice = (key: string, label: string, desc: string, value: string, onPress: () => void) => (
      <Box key={`row-${key}`} flexDirection="row" columnGap={1}>
        <Text dimColor>◇</Text>
        <Box width={16} flexShrink={0}>
          <Text bold>{label}</Text>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          <Text dimColor wrap="truncate">
            {desc}
          </Text>
        </Box>
        {pill(key, value, false, onPress)}
      </Box>
    )
    const warnSeconds = Math.round(cfg.warnMs / 1000)
    const onWarn = () => void setOption($, 'warnSeconds', nextWarn(warnSeconds))
    const onStyle = () => void cycleStyle($)
    const settingRows = [
      toggle('autoKeepWarm', 'Auto keep-warm', `ping 30s before expiry, up to ${cfg.maxAutoPings}`, cfg.autoKeepWarm),
      toggle('sound', 'Alert sound', 'Glass at the warning', cfg.sound),
      toggle('notifyMac', 'Mac alert', `Keep warm button, closes in ${cfg.alertSeconds}s`, cfg.notifyMac),
      choice('warnSeconds', 'Alert at', 'time left when the alert fires', fmtClock(warnSeconds * 1000), onWarn),
      choice('selectorStyle', 'Picker style', 'Rail, Ladder or Meter', styleLabel(cfg.selectorStyle), onStyle),
    ]
    // Short of rows, the settings fold onto one line of pills, the same buttons under the same keys.
    const settingsLine = (
      <Box key="settingsline" flexDirection="row" flexWrap="wrap" columnGap={1}>
        {pill('autoKeepWarm', `${cfg.autoKeepWarm ? '●' : '○'} Auto keep-warm`, cfg.autoKeepWarm, () => void setOption($, 'autoKeepWarm', !cfg.autoKeepWarm))}
        {pill('sound', `${cfg.sound ? '●' : '○'} Sound`, cfg.sound, () => void setOption($, 'sound', !cfg.sound))}
        {pill('notifyMac', `${cfg.notifyMac ? '●' : '○'} Mac alert`, cfg.notifyMac, () => void setOption($, 'notifyMac', !cfg.notifyMac))}
        {pill('warnSeconds', `Alert ${fmtClock(warnSeconds * 1000)}`, false, onWarn)}
        {pill('selectorStyle', styleLabel(cfg.selectorStyle), false, onStyle)}
      </Box>
    )

    const newestNote = handoff.files[0]
    const handoffRow = (
      <Box key="handoffrow" flexDirection="row" columnGap={3}>
        <Box flexDirection="row" columnGap={1}>
          <Text color="claude">✦</Text>
          <Button key="handoff" plain hotkey="h" label="Write handoff" onPress={() => void runHandoff($)} />
        </Box>
        {newestNote && (
          <Box flexDirection="row" columnGap={1}>
            <Text color="suggestion">◆</Text>
            <Button key="readhandoff" plain hotkey="r" label="Read handoff" onPress={() => void openHandoffPane($)} />
          </Box>
        )}
        <Text dimColor wrap="truncate">
          {newestNote ? `newest · ${age(newestNote.mtimeMs, now)}` : 'no notes yet'}
        </Text>
      </Box>
    )

    const rule = (key: string, text: string) => (
      <Text key={key} dimColor wrap="truncate">
        {text}
      </Text>
    )

    // Rows to spare decide the layout: every divider; then only SETTINGS's; then none, the settings on one line.
    const core = pickerRowCount + 1 + 1 + (hud.overage ? 1 : 0) + 1 + 1
    const layout = e.props.maxRows >= core + settingRows.length + 4 ? 'full' : e.props.maxRows >= core + settingRows.length + 1 ? 'tight' : 'compact'
    const isFull = layout === 'full'

    const panel = (
      <Box key="panel" flexDirection="column" width={width}>
        {field('MODEL', picker(ui, style, modelOptions, pickerWidth), isLabelLast)}
        {field('EFFORT', picker(ui, style, effortOptions, pickerWidth), isLabelLast)}
        {field('TOKENS', tokensRow)}
        {isFull && rule('rule-cache', sectionRule('CACHE', width))}
        {cacheLine}
        {hud.overage && (
          <Box key="overage" flexDirection="row" columnGap={1}>
            {overageMark}
            <Text dimColor wrap="truncate">
              {limitLabel(hud.overage)} · a new chat costs less per turn
            </Text>
            <Box flexGrow={1} />
            {newChat}
          </Box>
        )}
        {layout !== 'compact' && rule('rule-settings', sectionRule('SETTINGS', width))}
        {layout === 'compact' ? settingsLine : settingRows}
        {isFull && rule('rule-handoff', sectionRule('HANDOFF', width))}
        {handoffRow}
        {isFull && rule('rule-footer', footerRule('user-hud', width))}
      </Box>
    )

    return (
      <Box flexDirection="column" flexGrow={1}>
        {beneath}
        <Box flexDirection="column" alignItems="flex-end">
          {panel}
          {tab}
        </Box>
      </Box>
    )
  })

  // ---------- picker styles pane ----------

  // The three styles drawn as the panel draws them, each in full whatever the pane's width.
  on('ui.render', { component: 'Pane', requestId: STYLES_PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const hud = await read($, hudA)
    const width = Math.max(e.props.bodyColumns, STYLES_PANE_COLUMNS) - FIELD_WIDTH
    return (
      <Box flexDirection="column" rowGap={1}>
        <Text dimColor wrap="wrap">
          Model: blue to orange as the models get more capable. Effort: one grey to the full rainbow at Ultracode. Each style is the same tree on every surface; pressing a step here picks it.
        </Text>
        {SELECTOR_STYLES.map(st => {
          const options = pickerOptions($, hud, `${st.style}-`)
          const isLabelLast = st.style === 'meter'
          return (
            <Box key={`style-${st.style}`} flexDirection="column">
              <Box flexDirection="row" columnGap={2}>
                <Text bold>{st.label}</Text>
                {cfg.selectorStyle === st.style ? (
                  <Text color="success">● in use</Text>
                ) : (
                  <Button key={`use-${st.style}`} label={`Use ${st.label}`} onPress={() => void setOption($, 'selectorStyle', st.style)} />
                )}
              </Box>
              {fieldRow(ui, 'MODEL', picker(ui, st.style, options.model, width), isLabelLast)}
              {fieldRow(ui, 'EFFORT', picker(ui, st.style, options.effort, width), isLabelLast)}
            </Box>
          )
        })}
      </Box>
    )
  })

  // ---------- tokens pane ----------

  on('ui.render', { component: 'Pane', requestId: TOKENS_PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const tokens = await read($, tokensA)
    return tokenPane(ui, tokens, Math.max(20, e.props.bodyColumns - 2), {
      refresh: () => void refreshStanding($, true),
      reset: () => void restartTokens($),
    })
  })

  // ---------- handoff pane ----------

  on('ui.render', { component: 'Pane', requestId: HANDOFF_PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const ho = await read($, handoffA)
    const now = await $.clock.now()
    const file = ho.files[ho.index]
    if (!file) {
      return (
        <Box flexDirection="column">
          <Text dimColor wrap="wrap">
            No handoff note found in this project. Press h on the band to write one{ho.hasCommand ? ' with your /handoff command' : ' (it goes to .claude/handoffs/)'}.
          </Text>
          <Button key="write" label="Write a handoff" hotkey="h" variant="primary" onPress={() => void runHandoff($)} />
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          <Button key="continue" label="Continue from this" hotkey="c" variant="primary" onPress={() => void $.prompt.submit({ text: resumePrompt(file.path) })} />
          {ho.index < ho.files.length - 1 && <Button key="older" label="Older" hotkey="o" dimColor onPress={() => void loadHandoff($, ho.index + 1)} />}
          {ho.index > 0 && <Button key="newer" label="Newer" hotkey="n" dimColor onPress={() => void loadHandoff($, ho.index - 1)} />}
          <Button key="rescan" label="Rescan" hotkey="r" dimColor onPress={() => void scanHandoffs($).then(() => loadHandoff($, 0))} />
        </Box>
        <Text color="suggestion" wrap="truncate-start">
          {file.path} · {age(file.mtimeMs, now)}
          {ho.files.length > 1 ? ` · ${ho.index + 1} of ${ho.files.length}` : ''}
        </Text>
        {ho.error && (
          <Text color="error" wrap="wrap">
            {ho.error}
          </Text>
        )}
        {ho.text !== null && <Markdown key="handoff" text={ho.text.length > 20_000 ? `${ho.text.slice(0, 20_000)}\n\n…` : ho.text} />}
        {ho.text === null && !ho.error && <Text dimColor>Loading…</Text>}
      </Box>
    )
  })
}
