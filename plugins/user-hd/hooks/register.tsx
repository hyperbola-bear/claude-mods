/**
 * user-hd: a corner panel above the Claude Code prompt.
 *
 * Collapsed, it is one row at the band's right edge: the cache countdown,
 * model · effort, Keep warm once the cache is cooling, and the ◆ user-hd tab.
 * The tab (or /hud) opens the panel above it: model and effort pickers (they
 * run /model and /effort), the cache, the settings toggled most (written
 * through /config), and the handoff buttons. Open or closed is remembered.
 *
 * 1. Prompt cache countdown. Every main-thread model request refreshes the
 *    prompt cache, so the time since the last request says how long the cache
 *    has left (5 minutes, or an hour on a 1h cache). The band counts it down;
 *    with `warnSeconds` left while you are idle it alerts once (toast, macOS
 *    banner, sound). [ Keep warm ] (w) or /keepwarm sends a one-line
 *    `$.model.fork` over the session's own transcript, which reads the cached
 *    prefix, resets its timer and adds nothing to the conversation.
 *
 * 2. Handoff. [ Handoff ] (h) runs your /handoff command, or a built-in
 *    prompt that writes .claude/handoffs/<date>.md when you have none;
 *    [ Read handoff ] (r) or /read-handoff shows the newest note in a pane with
 *    a button to continue from it.
 *
 * The band draws whatever other plugins put above the prompt first (it calls
 * `next`), so it sits beside pr-review-ui's band rather than replacing it.
 *
 * Reaches: model.fork (keep-warm pings), process.run (osascript, afplay),
 * fs reads (handoff notes), store (the learned cache lifetime, the panel's
 * open state), settings read (the effort level), config set (the panel's
 * toggles), command run (/model, /effort, /handoff) and prompt submit on
 * button presses. Writes no files.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheTtl, Effort, HandoffFile, HandoffState, HudState, TtlInfo } from '../types'
import {
  EMPTY_CACHE,
  KEEP_WARM_PROMPT,
  TTL_MS,
  afterRequest,
  cachedTokens,
  fmtClock,
  fmtTokens,
  hitRate,
  learnsOneHour,
  level,
  pingSummary,
  promptTokens,
  remainingMs,
  shouldAlert,
  shouldAutoPing,
} from './cache.ts'
import { HANDOFF_DIRS, age, handoffPrompt, handoffTarget, isHandoffName, joinPath, newest, resumePrompt } from './handoff.ts'
import { EFFORTS, MODELS, asEffort, effortLabel, footerRule, lifeBar, modelAlias, modelLabel, nextTtl, nextWarn, sectionRule } from './hud.ts'

const STORE_TTL = 'learnedTtl'
const STORE_OPEN = 'panelOpen'
const HANDOFF_PANE = 'handoff'
const PANEL_WIDTH = 72
/** Rows the open panel takes with its dividers, the tab row included. */
const FULL_PANEL_ROWS = 14

const EMPTY_HANDOFF: HandoffState = { files: [], index: 0, text: null, error: null, hasCommand: false }

const cacheA = atom({ plugin: 'user-hd', key: 'cache' } as const, EMPTY_CACHE)
const ttlA = atom({ plugin: 'user-hd', key: 'ttl' } as const, { ttl: '5m', source: 'assumed' } as TtlInfo)
const handoffA = atom({ plugin: 'user-hd', key: 'handoff' } as const, EMPTY_HANDOFF)
const hudA = atom({ plugin: 'user-hd', key: 'hud' } as const, { isOpen: false, model: null, effort: null } as HudState)

type Cfg = {
  cacheTtl: 'auto' | CacheTtl
  warnMs: number
  notifyMac: boolean
  sound: boolean
  autoKeepWarm: boolean
  maxAutoPings: number
  showBand: boolean
  handoffPath: string
}

export function readCfg(o: Record<string, unknown>): Cfg {
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const b = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  const ttl = o.cacheTtl === '5m' || o.cacheTtl === '1h' ? o.cacheTtl : 'auto'
  return {
    cacheTtl: ttl,
    warnMs: Math.max(15, n(o.warnSeconds, 120)) * 1000,
    notifyMac: b(o.notifyMac, true),
    sound: b(o.sound, true),
    autoKeepWarm: b(o.autoKeepWarm, false),
    maxAutoPings: Math.max(1, n(o.maxAutoPings, 3)),
    showBand: b(o.showBand, true),
    handoffPath: typeof o.handoffPath === 'string' ? o.handoffPath.trim() : '',
  }
}

// Module state: set by register(); lost on a reload.
let options: Record<string, unknown> = {}
let cfg: Cfg = readCfg({})
let isHandoffPending = false

// ---------- prompt cache ----------

async function ttlNow($: EngineInterface): Promise<CacheTtl> {
  return (await read($, ttlA)).ttl
}

async function notify($: EngineInterface, title: string, body: string) {
  if (cfg.notifyMac) {
    $.process
      .run(['osascript', '-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run', title, body], { timeoutMs: 5000 })
      .catch(() => {})
  }
  if (cfg.sound) {
    $.process.run(['afplay', '/System/Library/Sounds/Glass.aiff'], { timeoutMs: 5000 }).catch(() => {})
  }
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
    void notify($, 'Claude Code: cache cooling', `${left} left on ${size} cached tokens. Run /keepwarm to keep it warm.`)
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

/** The lifetime the countdown uses: the setting, else a learned 1h, else 5m. */
async function resolveTtl($: EngineInterface) {
  let ttl: TtlInfo = { ttl: '5m', source: 'assumed' }
  if (cfg.cacheTtl !== 'auto') ttl = { ttl: cfg.cacheTtl, source: 'setting' }
  else if ((await $.store.get(STORE_TTL).catch(() => undefined)) === '1h') ttl = { ttl: '1h', source: 'learned' }
  await update($, ttlA, () => ttl)
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

async function pickEffort($: EngineInterface, effort: Effort) {
  if ((await read($, hudA)).effort === effort) return
  await update($, hudA, s => ({ ...s, effort }))
  await $.command.run({ command: 'effort', args: effort }).catch(err => $.ui.toast(`/effort ${effort} failed: ${String(err).slice(0, 120)}`))
}

/**
 * Writes one of this plugin's /config rows. The engine reloads the module with
 * the new options; applying them here too redraws the panel without waiting.
 */
async function setOption($: EngineInterface, field: string, value: boolean | string | number) {
  const r = await $.config.set({ key: `user-hd.${field}`, value }).catch(err => ({ deny: String(err).slice(0, 120) }))
  if (r.deny !== undefined) {
    $.ui.toast(`Could not change ${field}: ${r.deny}`)
    return
  }
  options = { ...options, [field]: value }
  cfg = readCfg(options)
  if (field === 'cacheTtl') await resolveTtl($)
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

  // ---------- lifecycle ----------

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'cache', description: 'Prompt cache status: time left, size, hit rate and lifetime' })
    await $.command.register({ name: 'keepwarm', description: 'Refresh the prompt cache now with a one-line ping (adds nothing to the chat)' })
    await $.command.register({ name: 'read-handoff', description: 'Show the newest handoff note, with a button to continue from it' })
    await $.command.register({ name: 'hud', description: 'Open or close the user-hd panel in the corner above the prompt' })

    await resolveTtl($)
    const isOpen = (await $.store.get(STORE_OPEN).catch(() => undefined)) === true
    const model = await $.session.model().catch(() => null)
    const settings = await $.settings.read().catch(() => ({}) as Record<string, unknown>)
    await update($, hudA, s => ({ isOpen, model: model ?? s.model, effort: s.effort ?? asEffort(settings.effortLevel) }))
    await scanHandoffs($).catch(() => [])

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
    }
    return next(e)
  })

  // Every main-thread request reads or writes the cache: that is the clock's reset.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    const at = await $.clock.now()
    // The effort the request really carries, after any downgrade for the model.
    const effort = asEffort(e.effort)
    if (effort) await update($, hudA, s => (s.effort === effort ? s : { ...s, effort })).catch(() => {})
    const result = yield* next(e)
    try {
      const usage = result.usage
      if (usage) {
        const before = await read($, cacheA)
        if (cfg.cacheTtl === 'auto' && before.lastHitAt !== null) {
          const gap = at - before.lastHitAt
          if (learnsOneHour(gap, promptTokens(before), usage.cache_read_input_tokens)) {
            const current = await read($, ttlA)
            if (current.ttl !== '1h') {
              await update($, ttlA, () => ({ ttl: '1h', source: 'learned' }))
              await $.store.set(STORE_TTL, '1h').catch(() => {})
              $.ui.toast('Your prompt cache lives 1 hour: the countdown now uses 1h.')
            }
          }
        }
        await update($, cacheA, s => afterRequest(s, at, usage, usage.model))
      }
    } catch {
      // Never disturb the turn over a display.
    }
    return result
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    await reset($, 'compacted')
    return result
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await reset($, 'cleared')
    return next(e)
  })

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
    const lines = [
      rem > 0 ? `Cache warm: ${fmtClock(rem)} left of ${t.ttl} (${t.source}).` : `Cache expired ${fmtClock(-rem)} ago (${t.ttl}, ${t.source}).`,
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
    return { text: isOpen ? 'user-hd panel closed.' : 'user-hd panel open.' }
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
    const { Box, Text, Button } = $.ui.resolve(e)
    const now = await $.clock.now()
    const rem = remainingMs(c.lastHitAt, t.ttl, now)
    const lv = level(rem, cfg.warnMs, e.props.isWorking || c.isWorking)
    const hit = hitRate(c)
    const width = Math.max(24, Math.min(PANEL_WIDTH, e.props.bodyColumns))
    // The terminal draws pills as filled cells; the other surfaces draw native buttons, which only look
    // right as themselves (a coloured Box behind a plain Button paints a square block there).
    const isNative = e.surface !== 'terminal'
    // The desktop caps the band at 12 rows; drop the dividers rather than make the panel scroll.
    const isCompact = e.props.maxRows < FULL_PANEL_ROWS
    const setup = [modelLabel(hud.model), effortLabel(hud.effort)].filter(Boolean).join(' · ')
    const canWarm = !c.isPinging && (lv === 'warm' || lv === 'cooling')

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

    // ----- the tab row: always there, at the band's right edge -----

    const chip =
      c.isPinging ? <Text dimColor>◆ pinging…</Text>
      : lv === 'live' ? <Text color="success">◆ cache live</Text>
      : lv === 'warm' ? <Text color="success">◆ {fmtClock(rem ?? 0)}</Text>
      : lv === 'cooling' ? <Text color="warning" bold>◆ {fmtClock(rem ?? 0)} left</Text>
      : lv === 'cold' ? <Text color="error">◇ cache cold</Text>
      : null

    const tab = (
      <Box key="tabrow" flexDirection="row" flexWrap="wrap" justifyContent="flex-end" columnGap={2}>
        {!hud.isOpen && chip}
        {!hud.isOpen && setup !== '' && <Text dimColor>{setup}</Text>}
        {!hud.isOpen && lv === 'cooling' && canWarm && keepWarm}
        <Box key="tab" backgroundColor="claude" paddingX={1}>
          <Button key="panel" plain label={`◆ user-hd ${hud.isOpen ? '▾' : '▴'}`} onPress={() => void setPanelOpen($, !hud.isOpen)} />
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

    const segment = (key: string, label: string, isOn: boolean, onPress: () => void) =>
      isNative ? (
        <Button key={key} label={label} plain={isOn ? undefined : true} variant={isOn ? 'primary' : undefined} onPress={onPress} />
      ) : (
        <Box key={`seg-${key}`} backgroundColor={isOn ? 'claude' : undefined}>
          <Button key={key} plain label={` ${label} `} onPress={onPress} />
        </Box>
      )
    const pill = (key: string, label: string, isOn: boolean, onPress: () => void) =>
      isNative ? (
        <Button key={`set-${key}`} label={label} variant={isOn ? 'primary' : undefined} onPress={onPress} />
      ) : (
        <Box key={`pill-${key}`} flexShrink={0} backgroundColor={isOn ? 'success' : 'subtle'}>
          <Button key={`set-${key}`} plain label={` ${label} `} onPress={onPress} />
        </Box>
      )
    const field = (label: string, body: JSX.Element) => (
      <Box key={`field-${label}`} flexDirection="row">
        <Box width={8} flexShrink={0}>
          <Text dimColor>{label}</Text>
        </Box>
        {body}
      </Box>
    )

    const alias = modelAlias(hud.model)
    const models = (
      <Box flexDirection="row">
        {MODELS.map(m => segment(`model-${m.alias}`, m.label, alias === m.alias, () => void pickModel($, m.alias)))}
      </Box>
    )
    const efforts = (
      <Box flexDirection="row" backgroundColor={isNative ? undefined : 'subtle'}>
        {EFFORTS.map(f => segment(`effort-${f.level}`, f.label, hud.effort === f.level, () => void pickEffort($, f.level)))}
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

    const rule = (text: string) => (
      <Text dimColor wrap="truncate">
        {text}
      </Text>
    )

    const panel = (
      <Box key="panel" flexDirection="column" width={width}>
        {field('MODEL', models)}
        {field('EFFORT', efforts)}
        {!isCompact && rule(sectionRule('CACHE', width))}
        {cacheLine}
        {rule(sectionRule('SETTINGS', width))}
        {toggle('autoKeepWarm', 'Auto keep-warm', `ping 30s before expiry, up to ${cfg.maxAutoPings}`, cfg.autoKeepWarm)}
        {toggle('sound', 'Alert sound', 'Glass at the warning', cfg.sound)}
        {toggle('notifyMac', 'Mac banner', 'see the alert from other apps', cfg.notifyMac)}
        {choice(
          'cacheTtl',
          'Cache lifetime',
          cfg.cacheTtl === 'auto' ? 'auto learns 1h when it sees one' : 'fixed',
          cfg.cacheTtl === 'auto' ? `auto · ${t.ttl}` : cfg.cacheTtl,
          () => void setOption($, 'cacheTtl', nextTtl(cfg.cacheTtl)),
        )}
        {choice('warnSeconds', 'Alert at', 'time left when the alert fires', fmtClock(warnSeconds * 1000), () => void setOption($, 'warnSeconds', nextWarn(warnSeconds)))}
        {!isCompact && rule(sectionRule('HANDOFF', width))}
        {handoffRow}
        {!isCompact && rule(footerRule('user-hd', width))}
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
