import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, Register, SessionContextBreakdown } from 'claude-code'

import { EFFORT_COLORS, MODEL_COLORS } from '../hooks/selector.ts'
import { plain, textOf } from '../hooks/cells.ts'
import type { CellsProps } from '../hooks/cells.ts'

const SURFACES = ['terminal', 'desktop'] as const
type Drawing = {
  find: (q: { type: string; key: string }) => Promise<{ props: Record<string, unknown> } | undefined>
  pointer: (e: { type: 'down'; x: number; y: number; button: 'left'; in: string }) => Promise<void>
}

/** A grid as the plugin handed it to its surface module: the band's (`hud`), or a pane's. */
async function cellsOf(d: Drawing, key = 'hud') {
  return (await d.find({ type: 'Client', key }))?.props.props as CellsProps | undefined
}

const linesOf = async (d: Drawing, key = 'hud') => plain((await cellsOf(d, key)) ?? { rows: [] })

/** Whether the grid draws text matching `pattern` on any row. */
const shows = async (d: Drawing, pattern: string | RegExp, key = 'hud') =>
  (await linesOf(d, key)).some(l => (typeof pattern === 'string' ? l.includes(pattern) : pattern.test(l)))

/** Whether the grid offers an action. */
const has = async (d: Drawing, action: string, key = 'hud') => ((await cellsOf(d, key))?.hits ?? []).some(h => h.id === action)

/** The text an action is drawn as, trimmed. */
async function labelOf(d: Drawing, action: string, key = 'hud') {
  const g = await cellsOf(d, key)
  return g ? textOf(g, action)?.trim() : undefined
}

/** Clicks an action where the grid draws it, as a pointer on either surface does. */
async function act(d: Drawing, action: string, key = 'hud') {
  const hit = (await cellsOf(d, key))?.hits.find(h => h.id === action)
  if (!hit) throw new Error(`no ${action} in the ${key} grid`)
  await d.pointer({ type: 'down', x: hit.x0, y: hit.y, button: 'left', in: key })
}

/** Which option of a picker the grid shows chosen: the one whose label is bold. */
async function chosen(d: Drawing, kind: 'model' | 'effort', key = 'hud') {
  const g = await cellsOf(d, key)
  if (!g) return undefined
  for (const h of g.hits.filter(x => x.id.startsWith(`pick:${kind}:`))) {
    let x = 0
    for (const run of g.rows[h.y] ?? []) {
      if (run.isBold && x < h.x1 && x + run.text.length > h.x0 && run.text.trim()) return h.id.split(':')[2]
      x += run.text.length
    }
  }
  return undefined
}

const click = (d: Drawing, kind: 'model' | 'effort', id: string, key = 'hud') => act(d, `pick:${kind}:${id}`, key)

/** The picker style a grid draws: the Rail's thin line, the Meter's rising bars, or the Ladder's strips. */
async function styleOf(d: Drawing, key = 'hud') {
  const text = (await linesOf(d, key)).join('\n')
  return text.includes('▔') ? 'rail' : /▃+ ▅+/.test(text) ? 'meter' : 'ladder'
}

/** What a drawing looks like with the buttons' per-mount handles left out. */
const shape = (v: unknown) => JSON.stringify(v, (k, x: unknown) => (k === 'press' ? undefined : x))

const BAND = (isWorking = false) => ({
  hasSurvey: false,
  isWorking,
  maxRows: 6,
  bodyColumns: 110,
  scroll: { offset: 0, bodyRows: 6 },
  view: {},
})

const PANE_PROPS = {
  title: 'Review code',
  isFocused: true,
  bodyColumns: 90,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

type World = {
  /** URLs the stand-in terminal-browser opened. */
  opened: string[]
  read: number
  submits: string[]
  commandRuns: string[]
  /** `/command args` for each run, as typed. */
  commandLines: string[]
  /** The main loop's model as `$.session.model()` answers it; `/model <alias>` sets it. */
  model: string
  /** Claude Code's settings; the band's timing tests run on a 5-minute cache. */
  settings: Record<string, unknown>
  /** The plan windows `$.session.usage()` reports. */
  limits: { kind: string; percentUsed: number }[]
  /** `/config` rows the plugin set, `[key, value]`. */
  configSets: [string, unknown][]
  /** Rows a trusted source holds: setting one is denied. */
  lockedRows: string[]
  /** The button the macOS alert answers with: `Keep warm`, `Dismiss` or `timeout`. */
  alertChoice: string
  files: Record<string, { text: string; mtimeMs: number }>
  commands: string[]
  toasts: string[]
  argv: string[][]
  forks: string[]
  opens: string[]
  /** What `/effort` answers, as Claude Code words it. */
  effortReply: string
  /** The next main-thread response, in place of the default one. */
  step: { answer: string; toolUses: { name: string; input: unknown }[]; usage: StepUsage } | null
  /** Subagents `$.agent.list()` answers, and how often it was asked. */
  agents: { id: string; type: string }[]
  agentLists: number
  /** What `$.session.usage({ breakdown })` breaks the window into. */
  breakdown: SessionContextBreakdown
  /** The main conversation as the next request carries it: the rows appended, a role's run merged into one message. */
  messages: { role: 'user' | 'assistant'; content: Record<string, unknown>[] }[]
  clock: ReturnType<typeof mock.clock>
}

type StepUsage = { model: string; input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

const BREAKDOWN: SessionContextBreakdown = {
  categories: [
    { name: 'System prompt', tokens: 8_000, color: 'promptBorder', isDeferred: false, kind: 'used' },
    { name: 'System tools', tokens: 12_000, color: 'inactive', isDeferred: false, kind: 'used' },
    { name: 'MCP tools', tokens: 3_000, color: 'permission', isDeferred: false, kind: 'used' },
    { name: 'Messages', tokens: 30_000, color: 'claude', isDeferred: false, kind: 'used' },
    { name: 'Free space', tokens: 147_000, color: 'inactive', isDeferred: false, kind: 'free' },
  ],
  totalTokens: 53_000,
  maxTokens: 200_000,
  rawMaxTokens: 200_000,
  autocompactSource: 'auto',
  percentage: 26,
  gridRows: [],
  model: 'claude-opus-5-5',
  memoryFiles: [],
  mcpTools: [{ name: 'mcp__linear__create_issue', serverName: 'linear', tokens: 3_000, isLoaded: true }],
  agents: [],
  isAutoCompactEnabled: true,
  apiUsage: null,
}

/** A stand-in for terminal-browser: adds the `browser` noun and records what it opens. */
const fakeBrowser = {
  name: 'terminal-browser',
  register: ((on: On) => {
    on('engine.create' as never, (async ($: unknown, e: unknown, next: (e: unknown) => Promise<Record<string, unknown>>) => {
      const built = await next(e)
      const served = () => {
        throw new Error('served by hooks')
      }
      return { ...built, browser: { open: served, close: served } }
    }) as never)
    on('browser.open' as never, (($: { ui: { toast: (t: string) => void } }, e: { url: string }) => {
      // The stand-in runs in its own environment: it reports what it opened through a toast the test records.
      $.ui.toast(`OPEN ${e.url}`)
      return { value: { ok: true, url: e.url } }
    }) as never)
  }) as Register,
}

/** The world beneath the plugin: clock, store, gh, git, files, the model fork and the UI calls. */
function world(on: On): World {
  const w: World = {
    opened: [],
    read: 0,
    submits: [],
    commandRuns: [],
    commandLines: [],
    model: 'claude-opus-5-5',
    settings: { promptCacheTtl: '5m' },
    limits: [],
    configSets: [],
    lockedRows: [],
    alertChoice: 'timeout',
    files: {},
    commands: [],
    toasts: [],
    argv: [],
    forks: [],
    opens: [],
    effortReply: '',
    step: null,
    agents: [],
    agentLists: 0,
    breakdown: BREAKDOWN,
    messages: [],
    clock: mock.clock(on, { now: Date.parse('2026-10-07T06:00:00Z') }),
  }
  mock.store(on)
  on('session.model', () => ({ value: w.model }))
  on('settings.read', () => ({ value: w.settings }))
  on('session.usage', ($, e) => ({
    value: { startedAt: 0, context: { window: 200_000, ...(e?.breakdown ? { breakdown: w.breakdown } : {}) }, rateLimits: w.limits },
  }))
  on('agent.list', () => {
    w.agentLists += 1
    return { value: w.agents.map(a => ({ ...a, description: '', status: 'running' as const })) }
  })
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.messages', () => ({ value: w.messages as never }))
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    const role = e.message.role
    if (e.agentId === undefined && role) {
      const last = w.messages.at(-1)
      if (last?.role === role) last.content.push(...e.message.content)
      else w.messages.push({ role, content: [...e.message.content] })
    }
    return stored
  })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('config.set', ($, e) => {
    if (w.lockedRows.includes(e.key)) return { deny: 'set by your organization' }
    w.configSets.push([e.key, e.value])
    return { value: e.value }
  })
  on('turn.step', async function* (_$, e) {
    const step = w.step
    w.step = null
    return {
      turnId: e.turnId,
      index: e.index,
      answer: step?.answer ?? 'done',
      toolUses: step?.toolUses ?? [],
      stopReason: 'end_turn' as const,
      usage: step?.usage ?? { model: 'claude-opus-5-5', input_tokens: 40, output_tokens: 300, cache_read_input_tokens: w.read, cache_creation_input_tokens: 2_000 },
    }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  // The engine's own band: empty, as with nothing else installed.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('ui.toast', ($, e) => {
    if (e.text.startsWith('OPEN ')) w.opened.push(e.text.slice(5))
    else w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.open', ($, e) => {
    w.opens.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: w.commands.map(name => ({ name, description: '', source: 'user' as const })) }))
  on('prompt.submit', ($, e) => {
    w.submits.push(e.text)
    return { text: e.text }
  })
  on('command.run', ($, e) => {
    w.commandRuns.push(e.command)
    w.commandLines.push(`/${e.command}${e.args ? ` ${e.args}` : ''}`)
    if (e.command === 'model') w.model = e.args
    if (e.command === 'effort') return { text: w.effortReply || `Set effort level to ${e.args} (this session only)` }
    return { text: 'ok' }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.root', () => ({ value: '/work' }))
  on('fs.list', ($, e) => {
    const rel = e.path.replace(/^\/work\/?/, '')
    const dir = rel === '.' || rel === '' ? '' : `${rel.replace(/^\.\//, '')}/`
    const names = Object.keys(w.files).filter(f => f.startsWith(dir) && !f.slice(dir.length).includes('/'))
    return { value: names.map(f => ({ name: f.slice(dir.length), kind: 'file' as const, size: 1, mtimeMs: w.files[f]?.mtimeMs ?? 0, isLink: false })) }
  })
  on('fs.stat', ($, e) => {
    if (e.path.endsWith('/assets/logo.icns')) return { value: { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false } }
    const f = w.files[e.path.replace(/^\/work\//, '')]
    if (!f) return { deny: 'missing' }
    return { value: { kind: 'file' as const, size: 1, mtimeMs: f.mtimeMs, isLink: false } }
  })
  on('fs.read', ($, e) => {
    const f = w.files[e.path] ?? w.files[e.path.replace(/^\/work\//, '')]
    if (!f) return { deny: `missing ${e.path}` }
    return { value: f.text }
  })
  on('model.fork', ($, e) => {
    w.forks.push(e.prompt)
    return {
      value: {
        isAnswered: true as const,
        text: 'ok',
        usage: { input_tokens: 8, output_tokens: 2, cache_read_input_tokens: 150_000, cache_creation_input_tokens: 0 },
      },
    }
  })
  on('process.run', ($, e) => {
    w.argv.push([...e.argv])
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const args = e.argv.join(' ')
    if (e.argv[0] === 'osascript') return out(`${w.alertChoice}\n`)
    if (args.startsWith('gh pr diff')) return out(DIFF)
    if (args.includes('pr view') && args.includes('headRefOid')) return out(JSON.stringify({ headRefOid: 'abc123' }))
    if (args.includes('contents/infra/firehose.tf')) return out(Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n'))
    return { value: { exitCode: 1, stdout: '', stderr: 'not on this machine', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return w
}

const DIFF = [
  'diff --git a/infra/iam.tf b/infra/iam.tf',
  '--- a/infra/iam.tf',
  '+++ b/infra/iam.tf',
  '@@ -40,6 +40,8 @@ resource "aws_iam_policy" "deploy" {',
  '   statement {',
  '     actions = [',
  '-      "iam:CreateRole",',
  '+      "iam:CreateRole",',
  '+      "iam:PassRole",',
  '+      "iam:TagRole",',
  '     ]',
  '     resources = ["arn:aws:iam::*:role/*billing-worker*"]',
  '   }',
].join('\n')

const REVIEW = [
  '**PR review:** https://github.com/acme/billing/pull/12',
  '',
  '### [1] high · `infra/iam.tf:42-44` — PassRole scoped to a pattern the roles do not match',
  '',
  'The Firehose role is named differently, see `infra/firehose.tf:17`.',
  '',
  '### [2] medium · `infra/iam.tf:45` — Missing iam:UntagRole',
  '',
  'Terraform untags on destroy.',
  '',
  '### Summary',
  '',
  'One blocking issue.',
].join('\n')

const MESSAGE = { text: REVIEW, isFirstOfReply: true }

const FILES_ANCHOR = /^https:\/\/github\.com\/acme\/billing\/pull\/12\/files#diff-[0-9a-f]{64}R/

/** One main-thread model request that read `read` tokens from the cache. */
async function request($: Engine, w: World, read: number, effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max') {
  w.read = read
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 3, ...(effort ? { effort } : {}) })) {
    // drain
  }
}

/** Opens the corner panel unless it already is (it stays open across mounts, as in a session). */
async function openPanel(band: Drawing) {
  if (!(await has(band, 'handoff'))) await act(band, 'panel')
}

async function review($: Engine, w: World) {
  await $.turn.complete({ answer: REVIEW, durationMs: 10, isAborted: false, turnId: 't2', reason: 'answer' })
  await w.clock.settle()
}

const start = ($: Engine) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })


/** Another plugin that makes a model call of its own, as a side chat does. */
const sidechat = {
  name: 'sidechat',
  register: ((on: On) => {
    on('command.run', { command: 'side' }, async $ => {
      await $.model.fork({ prompt: 'a side question' })
      return { text: 'answered' }
    })
  }) as Register,
}

/** Another plugin drawing a row above the prompt: each band must keep it. */
const otherBand = {
  name: 'other-band',
  register: ((on: On) => {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      const { Box, Text } = $.ui.resolve(e)
      const beneath = await next(e)
      return (
        <Box flexDirection="column">
          {beneath}
          <Text key="other">OTHER BAND</Text>
        </Box>
      )
    })
  }) as Register,
}
test('the band counts down, alerts once at two minutes, and Keep warm resets the clock', async ($, on) => {
  const w = world(on)
  await start($)
  await request($, w, 120_000)

  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: 'user-hud', surface, component: 'AbovePrompt', props: BAND() })
    // Collapsed: the countdown rides beside the tab; Keep warm waits for the cooling window.
    expect(await shows(band, '◆ 5:00')).toBe(true)
    expect(await has(band, 'keepwarm')).toBe(false)
    await act(band, 'panel')
    expect(await shows(band, /cache 5:00/)).toBe(true)
    expect(await shows(band, /122k cached · hit 98% · 5m/)).toBe(true)
    expect(await has(band, 'keepwarm')).toBe(true)
    await act(band, 'panel')
    await band.unmount()
  }

  await w.clock.advance(170_000)
  expect(w.toasts.filter(t => t.includes('Prompt cache expires'))).toHaveLength(0)
  await w.clock.advance(15_000) // the alert fires on the tick that reaches 2:00 left
  const alerts = w.toasts.filter(t => t.includes('Prompt cache expires'))
  expect(alerts).toHaveLength(1)
  expect(alerts[0]).toContain('expires in 2:00 (122k tokens)')
  expect(w.argv.some(a => a[0] === 'osascript')).toBe(true)
  expect(w.argv.some(a => a[0] === 'afplay')).toBe(true)
  await w.clock.advance(30_000)
  expect(w.toasts.filter(t => t.includes('Prompt cache expires'))).toHaveLength(1)

  // Cooling: Keep warm comes out of the closed panel, beside the tab.
  const band = await $.ui.mount({ plugin: 'user-hud', surface: 'terminal', component: 'AbovePrompt', props: BAND() })
  expect(await shows(band, /left/)).toBe(true)
  expect(await has(band, 'handoff')).toBe(false)
  await act(band, 'keepwarm')
  expect(w.forks).toHaveLength(1)
  expect(w.toasts.at(-1)).toContain('Cache refreshed: read 150k')
  await band.redraw()
  expect(await shows(band, '◆ 5:00')).toBe(true)
  expect(await has(band, 'keepwarm')).toBe(false)
})

test('the macOS alert carries the logo and a Keep warm button that keeps the cache warm', { options: { sound: false, alertSeconds: 12 } }, async ($, on) => {
  const w = world(on)
  w.alertChoice = 'Keep warm'
  await start($)
  await request($, w, 120_000)
  await w.clock.advance(185_000)
  const alerts = w.argv.filter(a => a[0] === 'osascript')
  expect(alerts).toHaveLength(1)
  expect(alerts[0]?.join(' ')).toContain('buttons {"Dismiss", "Keep warm"} default button "Keep warm" giving up after theSeconds')
  const [title, body, icon, seconds] = alerts[0]?.slice(-4) ?? []
  expect([title, body, seconds]).toEqual(['Claude Code: cache cooling', '2:00 left on 122k cached tokens. Keep it warm?', '12'])
  expect(icon).toMatch(/\/assets\/logo\.icns$/)
  expect(w.forks).toHaveLength(1)
  expect(w.toasts.at(-1)).toContain('Cache refreshed')
})

for (const choice of ['Dismiss', 'timeout']) {
  test(`the alert answered ${choice} (it closes by itself after 7 seconds) leaves the cache alone`, { options: { sound: false } }, async ($, on) => {
    const w = world(on)
    w.alertChoice = choice
    await start($)
    await request($, w, 120_000)
    await w.clock.advance(185_000)
    expect(w.argv.find(a => a[0] === 'osascript')?.at(-1)).toBe('7')
    expect(w.forks).toHaveLength(0)
  })
}

test('the band shows cold after expiry and stays quiet while Claude works', { options: { notifyMac: false, sound: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await request($, w, 50_000)
  const live = await $.ui.mount({ plugin: 'user-hud', surface: 'terminal', component: 'AbovePrompt', props: BAND(true) })
  expect(await shows(live, /cache live/)).toBe(true)
  expect(await has(live, 'keepwarm')).toBe(false)
  await w.clock.advance(301_000)
  await live.redraw(BAND())
  expect(await shows(live, /cache cold/)).toBe(true)
  expect(await has(live, 'keepwarm')).toBe(false)
  expect(w.argv.some(a => a[0] === 'osascript' || a[0] === 'afplay')).toBe(false)
})

test('auto keep-warm pings at 30 seconds and stops at the cap', { options: { autoKeepWarm: true, maxAutoPings: 2, notifyMac: false, sound: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await request($, w, 80_000)
  for (let i = 0; i < 4; i += 1) await w.clock.advance(300_000)
  expect(w.forks).toHaveLength(2)
})

test('the countdown runs an hour, as promptCacheTtl: "1h" or a subscription keeps it', { options: { notifyMac: false, sound: false } }, async ($, on) => {
  const w = world(on)
  w.settings = {}
  await start($)
  await request($, w, 100_000)
  const band = await $.ui.mount({ plugin: 'user-hud', surface: 'terminal', component: 'AbovePrompt', props: BAND() })
  expect(await shows(band, '◆ 60:00')).toBe(true)
  await openPanel(band)
  expect(await shows(band, '· 1h ')).toBe(true)
  // No Cache lifetime row: the lifetime is Claude Code's, not a plugin setting.
  expect(await has(band, 'set:cacheTtl')).toBe(false)
  expect((await $.command.run({ command: 'cache', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })).text).toContain('left of 1h (subscription default)')
})

const PAST_LIMIT = { context: { window: 200_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 103.4 }, { kind: 'seven_day', percentUsed: 61 }], changed: ['rateLimits' as const] }

test('on overage the band says so beside the cache and offers a new chat', { options: { notifyMac: false, sound: false } }, async ($, on) => {
  const w = world(on)
  w.settings = { promptCacheTtl: '1h' }
  await start($)
  await request($, w, 100_000)
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: 'user-hud', surface, component: 'AbovePrompt', props: BAND() })
    expect(await shows(band, '⚠ overage')).toBe(false)
    await band.unmount()
  }
  await $.session.measure(PAST_LIMIT)
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: 'user-hud', surface, component: 'AbovePrompt', props: { ...BAND(), maxRows: 30 } })
    // Closed: beside the countdown, which stays an hour because promptCacheTtl says so.
    expect(await shows(band, '⚠ overage')).toBe(true)
    expect(await shows(band, '◆ 60:00')).toBe(true)
    expect(await has(band, 'newchat')).toBe(true)
    await openPanel(band)
    expect(await shows(band, '5-hour limit 103% · a new chat costs less per turn')).toBe(true)
    await act(band, 'newchat')
    await act(band, 'panel')
    await band.unmount()
  }
  expect(w.commandLines.filter(l => l === '/clear')).toHaveLength(2)

  // Back under the limits: the indicator goes.
  await $.session.measure({ ...PAST_LIMIT, rateLimits: [{ kind: 'five_hour', percentUsed: 2 }] })
  const band = await $.ui.mount({ plugin: 'user-hud', surface: 'terminal', component: 'AbovePrompt', props: BAND() })
  expect(await shows(band, '⚠ overage')).toBe(false)
})

test('with promptCacheTtl unset, overage drops the countdown to 5 minutes, as Claude Code does', { options: { notifyMac: false, sound: false } }, async ($, on) => {
  const w = world(on)
  w.settings = {}
  w.limits = [{ kind: 'seven_day', percentUsed: 100 }]
  await start($)
  await request($, w, 100_000)
  const band = await $.ui.mount({ plugin: 'user-hud', surface: 'terminal', component: 'AbovePrompt', props: BAND() })
  expect(await shows(band, '◆ 5:00')).toBe(true)
  expect(await shows(band, '⚠ overage')).toBe(true)
})

test('the panel always offers Write handoff; with no /handoff command it asks Claude to write one', async ($, on) => {
  const w = world(on)
  await start($)
  const band = await $.ui.mount({ plugin: 'user-hud', surface: 'terminal', component: 'AbovePrompt', props: BAND() })
  await openPanel(band)
  expect(await has(band, 'handoff')).toBe(true)
  expect(await shows(band, 'no notes yet')).toBe(true)
  expect(await has(band, 'readhandoff')).toBe(false)
  await act(band, 'handoff')
  expect(w.submits[0]).toContain('.claude/handoffs/2026-10-07-')
  expect(w.commandRuns).toEqual([])
})

test('Handoff runs your own /handoff command when there is one, then Read handoff appears', async ($, on) => {
  const w = world(on)
  w.commands = ['handoff']
  await start($)
  const band = await $.ui.mount({ plugin: 'user-hud', surface: 'terminal', component: 'AbovePrompt', props: BAND() })
  await openPanel(band)
  await act(band, 'handoff')
  expect(w.commandRuns).toEqual(['handoff'])
  expect(w.submits).toEqual([])
  w.files['HANDOFF.md'] = { text: '# Handoff\n\nNext: fix PassRole.', mtimeMs: 5 }
  await $.turn.complete({ answer: 'Wrote HANDOFF.md', durationMs: 10, isAborted: false, turnId: 't9', reason: 'answer' })
  await w.clock.settle()
  await band.redraw()
  expect(await has(band, 'readhandoff')).toBe(true)
})

test('Read handoff shows the newest note and continues from it', async ($, on) => {
  const w = world(on)
  w.files['.claude/handoffs/2026-10-06-1800.md'] = { text: '# Old', mtimeMs: 1 }
  w.files['.claude/handoffs/2026-10-07-1200.md'] = { text: '# Newest handoff\n\n- [ ] widen PassRole', mtimeMs: 9 }
  w.files['README.md'] = { text: '# not a handoff', mtimeMs: 99 }
  await start($)
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: 'user-hud', surface, component: 'AbovePrompt', props: BAND() })
    await openPanel(band)
    expect(await shows(band, 'newest · ')).toBe(true)
    await act(band, 'readhandoff')
    await band.unmount()
    const pane = await $.ui.mount({ plugin: 'user-hud', surface, component: 'Pane', requestId: 'handoff', props: { ...PANE_PROPS, title: 'Handoff' } })
    // The note as cells: its heading bold, its list kept, no Markdown or Button the surface draws its own way.
    expect(await pane.findAll({ type: 'Markdown' })).toEqual([])
    expect(await pane.findAll({ type: 'Button' })).toEqual([])
    expect(await shows(pane, /^Newest handoff\s*$/, 'handoff')).toBe(true)
    expect(await shows(pane, '- [ ] widen PassRole', 'handoff')).toBe(true)
    expect(await shows(pane, /2026-10-07-1200\.md · \d+[mhd] ago · 1 of 2/, 'handoff')).toBe(true)
    await act(pane, 'handoff:older', 'handoff')
    expect(await shows(pane, /^Old\s*$/, 'handoff')).toBe(true)
    await act(pane, 'handoff:newer', 'handoff')
    await act(pane, 'handoff:continue', 'handoff')
    expect(w.submits.at(-1)).toContain('Read the handoff note `.claude/handoffs/2026-10-07-1200.md`')
    await pane.unmount()
  }
})



test('the band keeps what other plugins draw above the prompt', { plugins: [otherBand] }, async ($, on) => {
  const w = world(on)
  await start($)
  await request($, w, 50_000)
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: 'user-hud', surface, component: 'AbovePrompt', props: BAND() })
    expect(await band.find({ type: 'Text', text: 'OTHER BAND' })).toBeTruthy()
    expect(await has(band, 'panel')).toBe(true)
    expect(await shows(band, '◆ 5:00')).toBe(true)
    await openPanel(band)
    expect(await band.find({ type: 'Text', text: 'OTHER BAND' })).toBeTruthy()
    expect(await has(band, 'handoff')).toBe(true)
    expect(await shows(band, /cache 5:00/)).toBe(true)
    await act(band, 'panel')
    await band.unmount()
  }
})

test('the corner tab opens and closes the panel, and /hud does the same', async ($, on) => {
  const w = world(on)
  await start($)
  await request($, w, 50_000)
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: 'user-hud', surface, component: 'AbovePrompt', props: { ...BAND(), maxRows: 30 } })
    expect((await labelOf(band, 'panel'))).toBe('◆ user-hud ▴')
    expect(await has(band, 'handoff')).toBe(false)
    expect(await band.find({ type: 'Client', key: 'pickers' })).toBe(undefined)
    await act(band, 'panel')
    expect((await labelOf(band, 'panel'))).toBe('◆ user-hud ▾')
    for (const key of ['set:autoKeepWarm', 'set:warnSeconds', 'set:selectorStyle', 'handoff', 'tokens']) {
      expect(await has(band, key), key).toBe(true)
    }
    for (const label of ['Haiku 4.5', 'Fable 5.1', 'Low', 'Ultracode']) {
      expect(await shows(band, label), label).toBe(true)
    }
    // Open, the status moves into the panel rather than showing twice.
    expect(await shows(band, '◆ 5:00')).toBe(false)
    expect(await shows(band, /^── S E T T I N G S ─+$/)).toBe(true)
    expect(await shows(band, /─ user-hud ─$/)).toBe(true)
    await act(band, 'panel')
    expect(await has(band, 'handoff')).toBe(false)
    await band.unmount()
  }

  const band = await $.ui.mount({ plugin: 'user-hud', surface: 'terminal', component: 'AbovePrompt', props: BAND() })
  const hud = { command: 'hud', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } }
  expect((await $.command.run(hud)).text).toBe('user-hud panel open.')
  await band.redraw()
  expect(await has(band, 'handoff')).toBe(true)
  expect((await $.command.run(hud)).text).toBe('user-hud panel closed.')
  await band.redraw()
  expect(await has(band, 'handoff')).toBe(false)
})

test('the tree grows to the band width; short of rows the dividers go, then the settings fold onto one line', async ($, on) => {
  const w = world(on)
  await start($)
  await request($, w, 50_000)
  for (const surface of SURFACES) {
    // Rail at the desktop's 12 rows: the pickers take two rows each, so the settings fold onto one line.
    const band = await $.ui.mount({ plugin: 'user-hud', surface, component: 'AbovePrompt', props: { ...BAND(), maxRows: 12 } })
    // The desktop sets the tree beside its own collapse control; ungrown, the tab would sit on the left.
    expect((await band.find({ type: 'Box' }))?.props.flexGrow).toBe(1)
    await act(band, 'panel')
    expect((await band.find({ type: 'Box' }))?.props.flexGrow).toBe(1)
    expect(await shows(band, /C A C H E|S E T T I N G S|H A N D O F F|─ user-hud ─/)).toBe(false)
    expect(await shows(band, 'ping 30s before expiry')).toBe(false)
    for (const key of ['set:autoKeepWarm', 'set:sound', 'set:notifyMac', 'set:warnSeconds', 'set:selectorStyle', 'handoff', 'tokens']) {
      expect(await has(band, key), key).toBe(true)
    }
    await band.redraw({ ...BAND(), maxRows: 30 })
    expect(await shows(band, 'ping 30s before expiry')).toBe(true)
    expect(await shows(band, /^── C A C H E/)).toBe(true)
    await act(band, 'panel')
    await band.unmount()
  }
})

test('the one-row Ladder keeps the settings rows at 12 rows, under the SETTINGS divider alone', { options: { selectorStyle: 'ladder' } }, async ($, on) => {
  const w = world(on)
  await start($)
  await request($, w, 50_000)
  const band = await $.ui.mount({ plugin: 'user-hud', surface: 'desktop', component: 'AbovePrompt', props: { ...BAND(), maxRows: 12 } })
  await openPanel(band)
  expect(await shows(band, /S E T T I N G S/)).toBe(true)
  expect(await shows(band, /C A C H E|H A N D O F F/)).toBe(false)
  expect(await shows(band, 'ping 30s before expiry')).toBe(true)
  expect(await shows(band, /^◇ Picker style +Rail, Ladder or Meter +Ladder $/)).toBe(true)
})

test('the whole band is one grid of cells, the same on the terminal and the desktop, with no native buttons', { options: { sound: true, autoKeepWarm: false } }, async ($, on) => {
  const w = world(on)
  w.settings = { ...w.settings, effortLevel: 'high' }
  await start($)
  await request($, w, 120_000)
  const drawn: Record<string, string> = {}
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: 'user-hud', surface, component: 'AbovePrompt', props: { ...BAND(), maxRows: 30 } })
    for (const isOpen of [false, true]) {
      if (isOpen) await openPanel(band)
      // Nothing the surface draws its own way: no Button anywhere in the band, inside the grid or out.
      expect(await band.findAll({ type: 'Button' })).toEqual([])
      expect(await band.findAll({ type: 'Button', in: 'hud' })).toEqual([])
      drawn[`${surface}-${isOpen}`] = shape([await band.find({ type: 'Client', key: 'hud' }), await band.drawn({ in: 'hud' })])
    }
    expect(await labelOf(band, 'set:sound')).toBe('● On')
    expect(await labelOf(band, 'set:autoKeepWarm')).toBe('○ Off')
    await act(band, 'panel')
    await band.unmount()
  }
  expect(drawn['desktop-false']).toBe(drawn['terminal-false'])
  expect(drawn['desktop-true']).toBe(drawn['terminal-true'])
})

test('a surface with no Client (VS Code) gets the same rows as text, and its actions as buttons', async ($, on) => {
  const w = world(on)
  await start($)
  const band = await $.ui.mount({ plugin: 'user-hud', surface: 'vscode', component: 'AbovePrompt', props: { ...BAND(), maxRows: 30 } })
  expect(await band.find({ type: 'Client', key: 'hud' })).toBe(undefined)
  expect((await band.find({ type: 'Button', key: 'panel' }))?.props.label).toBe('◆ user-hud ▴')
  await band.press({ key: 'panel' })
  expect(await band.find({ type: 'Text', text: /Haiku 4\.5/ })).toBeTruthy()
  expect((await band.find({ type: 'Button', key: 'handoff' }))?.props.hotkey).toBe('h')
  await band.press({ key: 'pick:model:sonnet' })
  expect(w.commandLines).toEqual(['/model sonnet'])
})

test('the model and effort pickers run /model and /effort and show what requests carry', async ($, on) => {
  const w = world(on)
  w.settings = { ...w.settings, effortLevel: 'high' }
  await start($)
  const band = await $.ui.mount({ plugin: 'user-hud', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND(), maxRows: 30 } })
  expect(await shows(band, 'Opus 5.5 · High')).toBe(true)

  await openPanel(band)
  expect([await chosen(band, 'model'), await chosen(band, 'effort')]).toEqual(['opus', 'high'])
  // Rail: the chosen segment is solid in its colours, the others a thin line in theirs.
  const rows = (await cellsOf(band))!.rows
  expect(rows[1]!.some(r => r.bg === MODEL_COLORS.opus)).toBe(true)
  expect(rows[1]!.some(r => r.color === MODEL_COLORS.sonnet && r.text.startsWith('▔'))).toBe(true)

  await click(band, 'model', 'opus') // already in use: nothing runs
  await click(band, 'model', 'sonnet')
  await click(band, 'effort', 'max')
  expect(w.commandLines).toEqual(['/model sonnet', '/effort max'])
  expect([await chosen(band, 'model'), await chosen(band, 'effort')]).toEqual(['sonnet', 'max'])

  // The next request carries xhigh (the model's ceiling): the panel shows what is really used.
  await request($, w, 40_000, 'xhigh')
  await act(band, 'panel')
  expect(await shows(band, 'Sonnet 5.5 · XHigh')).toBe(true)
})

test('a model switch resets the cache and the panel reads the new model', async ($, on) => {
  const w = world(on)
  on('classic.PostModelSwitch', () => ({}))
  await start($)
  await request($, w, 60_000)
  await $.classic.PostModelSwitch({
    from_model: 'claude-opus-5-5',
    to_model: 'claude-fable-5-1',
    requested_model: 'fable',
    source: 'picker',
    context_tokens: 60_000,
    prompt_cache_warm: true,
    cache_ttl: '5m',
    estimated_cache_write_usd: 0.4,
    pricing: 'catalog',
  })
  const band = await $.ui.mount({ plugin: 'user-hud', surface: 'terminal', component: 'AbovePrompt', props: BAND() })
  expect(await shows(band, 'Fable 5.1')).toBe(true)
  await openPanel(band)
  expect(await shows(band, /cache reset \(model switched\)/)).toBe(true)
})

test('the settings toggles write their /config rows and take effect at once', { options: { notifyMac: true, sound: false } }, async ($, on) => {
  const w = world(on)
  w.lockedRows = ['user-hud.sound']
  await start($)
  await request($, w, 80_000)
  const band = await $.ui.mount({ plugin: 'user-hud', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND(), maxRows: 30 } })
  await openPanel(band)
  // The world beneath swallows ui.invalidate, so redraw as the engine would before reading.
  const label = async (key: string) => {
    await band.redraw()
    return labelOf(band, key)
  }

  expect(await label('set:autoKeepWarm')).toBe('○ Off')
  await act(band, 'set:autoKeepWarm')
  expect(await label('set:autoKeepWarm')).toBe('● On')
  await act(band, 'set:notifyMac')
  expect(await label('set:notifyMac')).toBe('○ Off')
  await act(band, 'set:warnSeconds')
  expect(await label('set:warnSeconds')).toBe('5:00')
  expect(w.configSets).toEqual([
    ['user-hud.autoKeepWarm', true],
    ['user-hud.notifyMac', false],
    ['user-hud.warnSeconds', 300],
  ])

  // A row a trusted source holds stays as it was, and says why.
  await act(band, 'set:sound')
  expect(await label('set:sound')).toBe('○ Off')
  expect(w.toasts.at(-1)).toBe('Could not change sound: set by your organization')

  // Auto keep-warm now pings by itself; the banner is off, so the alert posts none.
  await w.clock.advance(300_000)
  expect(w.forks).toHaveLength(1)
  expect(w.argv.some(a => a[0] === 'osascript')).toBe(false)
})

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } }

for (const selectorStyle of ['rail', 'ladder', 'meter'] as const) {
  test(`the ${selectorStyle} pickers draw the same grid on the terminal and the desktop`, { options: { selectorStyle } }, async ($, on) => {
    const w = world(on)
    w.settings = { ...w.settings, effortLevel: 'xhigh' }
    await start($)
    const drawn: string[] = []
    for (const surface of SURFACES) {
      const band = await $.ui.mount({ plugin: 'user-hud', surface, component: 'AbovePrompt', props: { ...BAND(), maxRows: 30 } })
      await openPanel(band)
      expect(await styleOf(band)).toBe(selectorStyle)
      for (const label of ['Haiku 4.5', 'Fable 5.1', 'Low', 'Ultracode']) expect(await shows(band, label), label).toBe(true)
      const tree = shape(await band.drawn({ in: 'hud' }))
      // Every colour of both ramps is on show, chosen or not.
      for (const c of [...Object.values(MODEL_COLORS), ...EFFORT_COLORS.ultracode]) expect(tree).toContain(c)
      drawn.push(tree)
      await act(band, 'panel')
      await band.unmount()
    }
    expect(drawn[1]).toBe(drawn[0])
  })
}

test('the Picker style row cycles Rail, Ladder, Meter and writes its /config row', async ($, on) => {
  const w = world(on)
  await start($)
  const band = await $.ui.mount({ plugin: 'user-hud', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND(), maxRows: 30 } })
  await openPanel(band)
  expect(await styleOf(band)).toBe('rail')
  await act(band, 'set:selectorStyle')
  await band.redraw()
  expect((await labelOf(band, 'set:selectorStyle'))).toBe('Ladder')
  expect(await styleOf(band)).toBe('ladder')
  await act(band, 'set:selectorStyle')
  await band.redraw()
  expect(await styleOf(band)).toBe('meter')
  expect(w.configSets).toEqual([
    ['user-hud.selectorStyle', 'ladder'],
    ['user-hud.selectorStyle', 'meter'],
  ])
})

test('the Meter lights every step up to the chosen one and dims the rest', { options: { selectorStyle: 'meter' } }, async ($, on) => {
  const w = world(on)
  w.settings = { ...w.settings, effortLevel: 'high' }
  await start($)
  const band = await $.ui.mount({ plugin: 'user-hud', surface: 'desktop', component: 'AbovePrompt', props: { ...BAND(), maxRows: 30 } })
  await openPanel(band)
  const g = (await cellsOf(band))!
  // The bar row of each field: its cells under each option, lit or dim.
  const isDim = (kind: 'model' | 'effort', id: string) => {
    const hit = g.hits.find(h => h.id === `pick:${kind}:${id}`)!
    let x = 0
    for (const run of g.rows[hit.y]!) {
      if (x >= hit.x0 && x < hit.x1) return run.isDim
      if (x + run.text.length > hit.x0) return run.isDim
      x += run.text.length
    }
    return undefined
  }
  expect(['low', 'high', 'xhigh', 'ultracode'].map(id => isDim('effort', id))).toEqual([false, false, true, true])
  expect(['haiku', 'opus', 'fable'].map(id => isDim('model', id))).toEqual([false, false, true])
  expect(plain(g)[0]).toMatch(/▃+ ▅+ ▆+ █+/)
})

test('Ultracode runs /effort ultracode on; a level turns it off again', async ($, on) => {
  const w = world(on)
  w.settings = { ...w.settings, effortLevel: 'high' }
  w.effortReply = 'Ultracode on (this session only): Claude may run multi-agent workflows. Effort stays high'
  await start($)
  const band = await $.ui.mount({ plugin: 'user-hud', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND(), maxRows: 30 } })
  await openPanel(band)
  await click(band, 'effort', 'ultracode')
  expect(w.commandLines).toEqual(['/effort ultracode on'])
  expect(await chosen(band, 'effort')).toBe('ultracode')
  await act(band, 'panel')
  // Collapsed, the effort reads in its own colours, letter by letter: the rainbow for Ultracode.
  expect(await shows(band, 'Opus 5.5 · Ultracode')).toBe(true)
  const chip = JSON.stringify((await cellsOf(band))?.rows)
  expect(chip).toContain(EFFORT_COLORS.ultracode[0])
  expect(chip).toContain(EFFORT_COLORS.ultracode[6])
  expect(chip).toContain(MODEL_COLORS.opus)

  w.effortReply = ''
  await act(band, 'panel')
  await click(band, 'effort', 'medium')
  expect(w.commandLines).toEqual(['/effort ultracode on', '/effort medium'])
  expect(await chosen(band, 'effort')).toBe('medium')
})

test('where ultracode is refused, the picker stays on the level and the toast says why', async ($, on) => {
  const w = world(on)
  w.settings = { ...w.settings, effortLevel: 'high' }
  w.effortReply = 'Ultracode needs dynamic workflows enabled (see /config).'
  await start($)
  const band = await $.ui.mount({ plugin: 'user-hud', surface: 'desktop', component: 'AbovePrompt', props: { ...BAND(), maxRows: 30 } })
  await openPanel(band)
  await click(band, 'effort', 'ultracode')
  expect(w.toasts.at(-1)).toBe('Ultracode needs dynamic workflows enabled (see /config).')
  await band.redraw()
  expect(await chosen(band, 'effort')).toBe('high')
})

test('/effort typed at the prompt moves the picker too', async ($, on) => {
  const w = world(on)
  w.settings = { ...w.settings, effortLevel: 'high' }
  w.effortReply = 'Ultracode on (this session only)'
  await start($)
  await $.command.run({ command: 'effort', args: 'ultracode', ...RUN })
  const band = await $.ui.mount({ plugin: 'user-hud', surface: 'terminal', component: 'AbovePrompt', props: BAND() })
  expect(await shows(band, 'Opus 5.5 · Ultracode')).toBe(true)
  w.effortReply = ''
  await $.command.run({ command: 'effort', args: 'low', ...RUN })
  await band.redraw()
  expect(await shows(band, 'Opus 5.5 · Low')).toBe(true)
})

// ---------- token usage ----------

let uuid = 0
const append = ($: Engine, door: 'prompt' | 'response' | 'tool-result' | 'tool-message' | 'hook-context' | 'compaction', message: Record<string, unknown>, origin: Record<string, unknown>, agentId?: string) =>
  $.session.append({
    door,
    uuid: `u${(uuid += 1)}`,
    origin: origin as never,
    message: { type: message.role === 'assistant' ? 'assistant' : 'user', ...message } as never,
    ...(agentId ? { agentId } : {}),
  })

const words = (n: number) => 'x'.repeat(n * 4)

/** One turn: a prompt, a Read of a big file, a Linear call, a skill and a hook's context; then the next request's real usage. */
async function session($: Engine, w: World) {
  await append($, 'prompt', { role: 'user', content: [{ type: 'text', text: words(500) }] }, { kind: 'composer' })
  await append($, 'response', { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/work/hooks/register.tsx' } }] }, { kind: 'model', model: 'claude-opus-5-5' })
  await append($, 'tool-result', { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: words(20_000) }] }, { kind: 'tool', tool: 'Read' })
  await append($, 'response', { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'mcp__linear__list_issues', input: {} }] }, { kind: 'model', model: 'claude-opus-5-5' })
  await append($, 'tool-result', { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: words(6_000) }] }, { kind: 'tool', tool: 'mcp__linear__list_issues' })
  await append($, 'response', { role: 'assistant', content: [{ type: 'tool_use', id: 't3', name: 'Skill', input: { skill: 'pstack:tdd' } }] }, { kind: 'model', model: 'claude-opus-5-5' })
  await append($, 'tool-message', { role: 'user', isMeta: true, content: [{ type: 'text', text: words(3_000) }] }, { kind: 'tool', tool: 'Skill' })
  await append($, 'hook-context', { role: 'user', isMeta: true, content: [{ type: 'text', text: words(500) }] }, { kind: 'hook', event: 'PostToolUse' })
  // A subagent's own rows: its conversation, not this one.
  await append($, 'prompt', { role: 'user', content: [{ type: 'text', text: words(9_000) }] }, { kind: 'composer' }, 'a1')
  w.step = {
    answer: words(200),
    toolUses: [{ name: 'Bash', input: { command: 'npm test' } }],
    usage: { model: 'claude-opus-5-5', input_tokens: 1_000, cache_read_input_tokens: 70_000, cache_creation_input_tokens: 4_000, output_tokens: 2_000 },
  }
  await request($, w, 70_000)
}

const tokensText = async ($: Engine) => (await $.command.run({ command: 'tokens', args: '', ...RUN })).text ?? ''

test('tokens: every row is filed under its group and each request’s real tokens are split across them', async ($, on) => {
  const w = world(on)
  await start($)
  await session($, w)
  const text = await tokensText($)
  // What the groups used adds up to the API's own count for the request.
  expect(text).toContain('77k tokens over 1 requests: 70k cache read, 4k cache write, 1k new input, 2k output')
  expect(text).toMatch(/^Files \d+%: 20k used, 20k in context now, 1 calls\. Read 20k {2}— {2}register\.tsx 20k$/m)
  expect(text).toMatch(/^MCP \d+%: 9k used, 6k in context now, 1 calls\. linear 6k {2}— {2}list_issues 6k {2}— {2}schemas: linear 3k$/m)
  expect(text).toMatch(/^Skills & plugins \d+%: .*pstack:tdd 3k · PostToolUse 500/m)
  // Chat: the 500-token prompt, and the reply's 200; the subagent's 9k prompt is its own conversation's.
  expect(text).toMatch(/^Chat <?\d+%: 700 used, 500 in context now, 1 calls\. you 500$/m)
  expect(text).toMatch(/^Shell <?\d+%: 7 used, 0 in context now/m)
  expect(text).toMatch(/^Thinking \d+%: 2k used, 0 in context now/m)
  // 75k in: the groups held about 30k, the MCP schemas 3k; the system prompt and built-in tools the rest.
  expect(text).toMatch(/^System & memory \d+%: 4[0-9]k used/m)
  expect(text).toContain('Every request carries 23k before the chat: MCP 3k, System & memory 20k.')
  expect(w.opens).toContain('tokens')
})

test('subagents’ requests and other plugins’ model calls are counted whole, under who spent', { plugins: [sidechat] }, async ($, on) => {
  const w = world(on)
  w.agents = [{ id: 'a1', type: 'Explore' }]
  await start($)
  for await (const _ of $.turn.step({ turnId: 't9', index: 0, model: 'claude-haiku-4-5', messageCount: 2, agentId: 'a1' })) {
    // drain
  }
  await $.command.run({ command: 'side', args: '', ...RUN })
  const text = await tokensText($)
  expect(text).toContain('152k tokens over 2 requests')
  expect(text).toContain('Of those, subagents 2k over 1 requests; plugin model calls 150k over 1.')
  expect(text).toMatch(/^Subagents \d+%: 2k used.*spent: Explore 2k$/m)
  expect(text).toMatch(/^Skills & plugins \d+%: 150k used.*spent: sidechat 150k$/m)
  // The main conversation made no request: nothing landed in its groups.
  expect(text).not.toMatch(/^(Files|Chat|Thinking) /m)
})

test('the TOKENS row shows the split and opens the Tokens pane; /clear starts the tally over', async ($, on) => {
  const w = world(on)
  await start($)
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: 'user-hud', surface, component: 'AbovePrompt', props: { ...BAND(), maxRows: 30 } })
    await openPanel(band)
    expect(await shows(band, 'counting from the next request')).toBe(true)
    await act(band, 'panel')
    await band.unmount()
  }
  await session($, w)
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: 'user-hud', surface, component: 'AbovePrompt', props: { ...BAND(), maxRows: 30 } })
    expect(await shows(band, '77k tokens')).toBe(true)
    await openPanel(band)
    // The stacked bar: a run of cells per group in its colour, 16 cells in all, on the TOKENS row.
    const g = (await cellsOf(band))!
    const tokensRow = g.rows[plain(g).findIndex(l => l.startsWith('TOKENS'))]!
    const segments = tokensRow.filter(r => r.bg !== '')
    expect(segments.length).toBeGreaterThan(3)
    expect(segments.reduce((n, r) => n + r.text.length, 0)).toBe(16)
    expect(segments.map(r => r.bg)).toContain('#3987e5')
    expect(await shows(band, /· System & memory \d+%/)).toBe(true)
    await act(band, 'tokens')
    await act(band, 'panel')
    await band.unmount()

    const pane = await $.ui.mount({ plugin: 'user-hud', surface, component: 'Pane', requestId: 'tokens', props: { ...PANE_PROPS, title: 'Tokens' } })
    expect(await shows(pane, /^77k tokens over 1 requests/, 'tokens')).toBe(true)
    expect(await pane.findAll({ type: 'Button' })).toEqual([])
    for (const label of ['Files', 'MCP', 'Skills & plugins', 'Thinking', 'System & memory', 'Chat', 'Shell']) {
      expect(await shows(pane, label, 'tokens'), label).toBe(true)
    }
    expect(await shows(pane, /register\.tsx 20k/, 'tokens')).toBe(true)
    expect(await shows(pane, /pstack:tdd 3k/, 'tokens')).toBe(true)
    await pane.unmount()
  }
  expect(w.opens.filter(id => id === 'tokens')).toHaveLength(2)

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { sessionId: 's1' } as never })
  const pane = await $.ui.mount({ plugin: 'user-hud', surface: 'terminal', component: 'Pane', requestId: 'tokens', props: { ...PANE_PROPS, title: 'Tokens' } })
  expect(await shows(pane, /No tokens counted yet/, 'tokens')).toBe(true)
  // What every request carries before the chat stays known.
  expect(await shows(pane, /Every request carries 23k/, 'tokens')).toBe(true)
})

test('a compaction empties what the groups hold in the context and keeps what they used', async ($, on) => {
  const w = world(on)
  await start($)
  await session($, w)
  await append($, 'compaction', { content: [{ type: 'text', text: 'boundary' }] }, { kind: 'engine' })
  await append($, 'compaction', { role: 'user', isMeta: true, content: [{ type: 'text', text: words(2_000) }] }, { kind: 'engine' })
  const text = await tokensText($)
  expect(text).toMatch(/^Files \d+%: 20k used, 0 in context now/m)
  expect(text).toMatch(/^System & memory \d+%: \d+k used, 2k in context now/m)
})

test('where a two-row style’s columns do not fit, both pickers fall back to the Ladder together', async ($, on) => {
  const w = world(on)
  await start($)
  for (const [columns, style] of [[110, 'rail'], [62, 'ladder']] as const) {
    const band = await $.ui.mount({ plugin: 'user-hud', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND(), maxRows: 30, bodyColumns: columns } })
    await openPanel(band)
    expect(await styleOf(band), `at ${columns}`).toBe(style)
    // The style row still names the one chosen.
    expect((await labelOf(band, 'set:selectorStyle'))).toBe('Rail')
    await act(band, 'panel')
    await band.unmount()
  }
  expect(w.configSets).toEqual([])
})

test('after /resume the tally starts over and the next request is split by the conversation now in the context', async ($, on) => {
  const w = world(on)
  await start($)
  await session($, w)
  await $.session.end({ reason: 'resume', sessionId: 's1', resume: { sessionId: 's1' } as never })
  // The resumed conversation: loaded, never appended.
  w.messages = [
    { role: 'user', content: [{ type: 'text', text: words(100) }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'old', name: 'Bash', input: { command: 'make' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'old', content: words(30_000) }] },
  ]
  w.step = { answer: '', toolUses: [], usage: { model: 'claude-opus-5-5', input_tokens: 0, cache_read_input_tokens: 60_000, cache_creation_input_tokens: 0, output_tokens: 0 } }
  await request($, w, 60_000)
  const text = await tokensText($)
  expect(text).toContain('60k tokens over 1 requests')
  expect(text).toMatch(/^Shell \d+%: 30k used, 30k in context now/m)
  expect(text).not.toMatch(/^Files /m)
})

test('Reset in the pane starts the counts over and keeps what the context holds', async ($, on) => {
  const w = world(on)
  await start($)
  await session($, w)
  const pane = await $.ui.mount({ plugin: 'user-hud', surface: 'desktop', component: 'Pane', requestId: 'tokens', props: { ...PANE_PROPS, title: 'Tokens' } })
  await act(pane, 'tokens:reset', 'tokens')
  expect(await shows(pane, /No tokens counted yet/, 'tokens')).toBe(true)
  w.step = { answer: '', toolUses: [], usage: { model: 'claude-opus-5-5', input_tokens: 0, cache_read_input_tokens: 75_000, cache_creation_input_tokens: 0, output_tokens: 0 } }
  await request($, w, 75_000)
  // The 20k file is still in the context: it keeps its share of the next request.
  expect(await tokensText($)).toMatch(/^Files \d+%: 20k used, 20k in context now, 0 calls/m)
})

test('an agent no list names (a workflow’s, the engine’s own fork) is counted as unlisted, the list asked at most every 5 seconds', async ($, on) => {
  const w = world(on)
  await start($)
  for (const id of ['wf1', 'wf2']) {
    for await (const _ of $.turn.step({ turnId: 't9', index: 0, model: 'claude-haiku-4-5', messageCount: 2, agentId: id })) {
      // drain
    }
  }
  expect(w.agentLists).toBe(1)
  expect(await tokensText($)).toContain('spent: unlisted (workflows, compaction) 5k')
  expect(w.toasts).toEqual([])
})

test('the Ladder’s rows are counted as it wraps, so a narrow 12-row band folds the settings instead of scrolling', { options: { selectorStyle: 'ladder' } }, async ($, on) => {
  const w = world(on)
  await start($)
  await request($, w, 50_000)
  for (const [columns, isFolded] of [[110, false], [64, true]] as const) {
    const band = await $.ui.mount({ plugin: 'user-hud', surface: 'desktop', component: 'AbovePrompt', props: { ...BAND(), maxRows: 12, bodyColumns: columns } })
    await openPanel(band)
    expect(await shows(band, 'ping 30s before expiry'), `at ${columns} columns`).toBe(!isFolded)
    await act(band, 'panel')
    await band.unmount()
  }
})

test('/hud-styles shows Rail, Ladder and Meter side by side, the same grid on every surface, and Use switches', async ($, on) => {
  const w = world(on)
  w.settings = { ...w.settings, effortLevel: 'xhigh' }
  await start($)
  expect((await $.command.run({ command: 'hud-styles', args: '', ...RUN })).text).toContain('In use: Rail')
  expect(w.opens).toContain('styles')
  const drawn: string[] = []
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: 'user-hud', surface, component: 'Pane', requestId: 'styles', props: { ...PANE_PROPS, title: 'Picker styles', bodyColumns: 60 } })
    // Each style in full, even in a pane narrower than its columns: the Rail's line, the Meter's bars, the Ladder's strips.
    const text = (await linesOf(pane, 'styles')).join('\n')
    expect(text).toContain('▔')
    expect(text).toMatch(/▃+ ▅+ ▆+ █+/)
    expect(text).toMatch(/▄ Haiku 4\.5 ▄▄ Sonnet 5\.5/)
    expect(await shows(pane, /^Rail ● in use/, 'styles')).toBe(true)
    expect(await has(pane, 'use:ladder', 'styles')).toBe(true)
    expect(await pane.findAll({ type: 'Button' })).toEqual([])
    drawn.push(shape(await pane.drawn({ in: 'styles' })))
    if (surface === 'desktop') {
      await act(pane, 'use:meter', 'styles')
      await click(pane, 'effort', 'max', 'styles')
    }
    await pane.unmount()
  }
  expect(drawn[1]).toBe(drawn[0])
  expect(w.configSets).toEqual([['user-hud.selectorStyle', 'meter']])
  expect(w.commandLines).toEqual(['/effort max'])
})

