import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, Register } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const

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
  settings: Record<string, unknown>
  /** `/config` rows the plugin set, `[key, value]`. */
  configSets: [string, unknown][]
  /** Rows a trusted source holds: setting one is denied. */
  lockedRows: string[]
  files: Record<string, { text: string; mtimeMs: number }>
  commands: string[]
  toasts: string[]
  argv: string[][]
  forks: string[]
  opens: string[]
  clock: ReturnType<typeof mock.clock>
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
    settings: {},
    configSets: [],
    lockedRows: [],
    files: {},
    commands: [],
    toasts: [],
    argv: [],
    forks: [],
    opens: [],
    clock: mock.clock(on, { now: Date.parse('2026-10-07T06:00:00Z') }),
  }
  mock.store(on)
  on('session.model', () => ({ value: w.model }))
  on('settings.read', () => ({ value: w.settings }))
  on('config.set', ($, e) => {
    if (w.lockedRows.includes(e.key)) return { deny: 'set by your organization' }
    w.configSets.push([e.key, e.value])
    return { value: e.value }
  })
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'done',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: { model: 'claude-opus-5-5', input_tokens: 40, output_tokens: 300, cache_read_input_tokens: w.read, cache_creation_input_tokens: 2_000 },
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
async function openPanel(band: { find: (q: { type: string; key: string }) => Promise<unknown>; press: (q: { key: string }) => Promise<unknown> }) {
  if (!(await band.find({ type: 'Button', key: 'handoff' }))) await band.press({ key: 'panel' })
}

async function review($: Engine, w: World) {
  await $.turn.complete({ answer: REVIEW, durationMs: 10, isAborted: false, turnId: 't2', reason: 'answer' })
  await w.clock.settle()
}

const start = ($: Engine) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })


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
    const band = await $.ui.mount({ plugin: 'user-hd', surface, component: 'AbovePrompt', props: BAND() })
    // Collapsed: the countdown rides beside the tab; Keep warm waits for the cooling window.
    expect(await band.find({ type: 'Text', text: '◆ 5:00' })).toBeTruthy()
    expect(await band.find({ type: 'Button', key: 'keepwarm' })).toBe(undefined)
    await band.press({ key: 'panel' })
    expect((await band.find({ type: 'Text', text: /cache 5:00/ }))?.text).toContain('5:00')
    expect((await band.find({ type: 'Text', text: /122k cached · hit 98% · 5m/ }))).toBeTruthy()
    expect(await band.find({ type: 'Button', key: 'keepwarm' })).toBeTruthy()
    await band.press({ key: 'panel' })
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
  const band = await $.ui.mount({ plugin: 'user-hd', surface: 'terminal', component: 'AbovePrompt', props: BAND() })
  expect(await band.find({ type: 'Text', text: /left/ })).toBeTruthy()
  expect(await band.find({ type: 'Button', key: 'handoff' })).toBe(undefined)
  await band.press({ key: 'keepwarm' })
  expect(w.forks).toHaveLength(1)
  expect(w.toasts.at(-1)).toContain('Cache refreshed: read 150k')
  await band.redraw()
  expect(await band.find({ type: 'Text', text: '◆ 5:00' })).toBeTruthy()
  expect(await band.find({ type: 'Button', key: 'keepwarm' })).toBe(undefined)
})

test('the band shows cold after expiry and stays quiet while Claude works', { options: { notifyMac: false, sound: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await request($, w, 50_000)
  const live = await $.ui.mount({ plugin: 'user-hd', surface: 'terminal', component: 'AbovePrompt', props: BAND(true) })
  expect(await live.find({ type: 'Text', text: /cache live/ })).toBeTruthy()
  expect(await live.find({ type: 'Button', key: 'keepwarm' })).toBe(undefined)
  await w.clock.advance(301_000)
  await live.redraw(BAND())
  expect(await live.find({ type: 'Text', text: /cache cold/ })).toBeTruthy()
  expect(await live.find({ type: 'Button', key: 'keepwarm' })).toBe(undefined)
  expect(w.argv.some(a => a[0] === 'osascript' || a[0] === 'afplay')).toBe(false)
})

test('auto keep-warm pings at 30 seconds and stops at the cap', { options: { autoKeepWarm: true, maxAutoPings: 2, notifyMac: false, sound: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await request($, w, 80_000)
  for (let i = 0; i < 4; i += 1) await w.clock.advance(300_000)
  expect(w.forks).toHaveLength(2)
})

test('a one-hour cache is learned from a hit after six idle minutes', { options: { notifyMac: false, sound: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await request($, w, 100_000)
  await w.clock.advance(6 * 60_000)
  await request($, w, 101_000)
  expect(w.toasts.some(t => t.includes('lives 1 hour'))).toBe(true)
  const band = await $.ui.mount({ plugin: 'user-hd', surface: 'terminal', component: 'AbovePrompt', props: BAND() })
  await openPanel(band)
  expect(await band.find({ type: 'Text', text: /cache 60:00/ })).toBeTruthy()
  expect(await band.find({ type: 'Text', text: /· 1h/ })).toBeTruthy()
})

test('the panel always offers Write handoff; with no /handoff command it asks Claude to write one', async ($, on) => {
  const w = world(on)
  await start($)
  const band = await $.ui.mount({ plugin: 'user-hd', surface: 'terminal', component: 'AbovePrompt', props: BAND() })
  await openPanel(band)
  expect(await band.find({ type: 'Button', key: 'handoff' })).toBeTruthy()
  expect(await band.find({ type: 'Text', text: 'no notes yet' })).toBeTruthy()
  expect(await band.find({ type: 'Button', key: 'readhandoff' })).toBe(undefined)
  await band.press({ key: 'handoff' })
  expect(w.submits[0]).toContain('.claude/handoffs/2026-10-07-')
  expect(w.commandRuns).toEqual([])
})

test('Handoff runs your own /handoff command when there is one, then Read handoff appears', async ($, on) => {
  const w = world(on)
  w.commands = ['handoff']
  await start($)
  const band = await $.ui.mount({ plugin: 'user-hd', surface: 'terminal', component: 'AbovePrompt', props: BAND() })
  await openPanel(band)
  await band.press({ key: 'handoff' })
  expect(w.commandRuns).toEqual(['handoff'])
  expect(w.submits).toEqual([])
  w.files['HANDOFF.md'] = { text: '# Handoff\n\nNext: fix PassRole.', mtimeMs: 5 }
  await $.turn.complete({ answer: 'Wrote HANDOFF.md', durationMs: 10, isAborted: false, turnId: 't9', reason: 'answer' })
  await w.clock.settle()
  await band.redraw()
  expect(await band.find({ type: 'Button', key: 'readhandoff' })).toBeTruthy()
})

test('Read handoff shows the newest note and continues from it', async ($, on) => {
  const w = world(on)
  w.files['.claude/handoffs/2026-10-06-1800.md'] = { text: '# Old', mtimeMs: 1 }
  w.files['.claude/handoffs/2026-10-07-1200.md'] = { text: '# Newest handoff\n\n- [ ] widen PassRole', mtimeMs: 9 }
  w.files['README.md'] = { text: '# not a handoff', mtimeMs: 99 }
  await start($)
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: 'user-hd', surface, component: 'AbovePrompt', props: BAND() })
    await openPanel(band)
    expect(await band.find({ type: 'Text', text: /^newest · / })).toBeTruthy()
    await band.press({ key: 'readhandoff' })
    await band.unmount()
    const pane = await $.ui.mount({ plugin: 'user-hd', surface, component: 'Pane', requestId: 'handoff', props: { ...PANE_PROPS, title: 'Handoff' } })
    expect((await pane.find({ type: 'Markdown' }))?.text).toContain('Newest handoff')
    expect(await pane.find({ type: 'Text', text: /2026-10-07-1200\.md/ })).toBeTruthy()
    await pane.press({ key: 'older' })
    expect((await pane.find({ type: 'Markdown' }))?.text).toContain('# Old')
    await pane.press({ key: 'newer' })
    await pane.press({ key: 'continue' })
    expect(w.submits.at(-1)).toContain('Read the handoff note `.claude/handoffs/2026-10-07-1200.md`')
    await pane.unmount()
  }
})



test('the band keeps what other plugins draw above the prompt', { plugins: [otherBand] }, async ($, on) => {
  const w = world(on)
  await start($)
  await request($, w, 50_000)
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: 'user-hd', surface, component: 'AbovePrompt', props: BAND() })
    expect(await band.find({ type: 'Text', text: 'OTHER BAND' })).toBeTruthy()
    expect(await band.find({ type: 'Button', key: 'panel' })).toBeTruthy()
    expect(await band.find({ type: 'Text', text: '◆ 5:00' })).toBeTruthy()
    await openPanel(band)
    expect(await band.find({ type: 'Text', text: 'OTHER BAND' })).toBeTruthy()
    expect(await band.find({ type: 'Button', key: 'handoff' })).toBeTruthy()
    expect(await band.find({ type: 'Text', text: /cache 5:00/ })).toBeTruthy()
    await band.press({ key: 'panel' })
    await band.unmount()
  }
})

test('the corner tab opens and closes the panel, and /hud does the same', async ($, on) => {
  const w = world(on)
  await start($)
  await request($, w, 50_000)
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: 'user-hd', surface, component: 'AbovePrompt', props: BAND() })
    expect((await band.find({ type: 'Button', key: 'panel' }))?.props.label).toBe('◆ user-hd ▴')
    expect(await band.find({ type: 'Button', key: 'handoff' })).toBe(undefined)
    expect(await band.find({ type: 'Button', key: 'model-opus' })).toBe(undefined)
    await band.press({ key: 'panel' })
    expect((await band.find({ type: 'Button', key: 'panel' }))?.props.label).toBe('◆ user-hd ▾')
    for (const key of ['model-haiku', 'model-fable', 'effort-low', 'effort-max', 'set-autoKeepWarm', 'set-warnSeconds', 'handoff']) {
      expect(await band.find({ type: 'Button', key }), key).toBeTruthy()
    }
    // Open, the status moves into the panel rather than showing twice.
    expect(await band.find({ type: 'Text', text: '◆ 5:00' })).toBe(undefined)
    expect(await band.find({ type: 'Text', text: /^── S E T T I N G S ─+$/ })).toBeTruthy()
    expect(await band.find({ type: 'Text', text: /─ user-hd ─$/ })).toBeTruthy()
    await band.press({ key: 'panel' })
    expect(await band.find({ type: 'Button', key: 'handoff' })).toBe(undefined)
    await band.unmount()
  }

  const band = await $.ui.mount({ plugin: 'user-hd', surface: 'terminal', component: 'AbovePrompt', props: BAND() })
  const hud = { command: 'hud', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } }
  expect((await $.command.run(hud)).text).toBe('user-hd panel open.')
  await band.redraw()
  expect(await band.find({ type: 'Button', key: 'handoff' })).toBeTruthy()
  expect((await $.command.run(hud)).text).toBe('user-hd panel closed.')
  await band.redraw()
  expect(await band.find({ type: 'Button', key: 'handoff' })).toBe(undefined)
})

test('the model and effort pickers run /model and /effort and show what requests carry', async ($, on) => {
  const w = world(on)
  w.settings = { effortLevel: 'high' }
  await start($)
  const band = await $.ui.mount({ plugin: 'user-hd', surface: 'terminal', component: 'AbovePrompt', props: BAND() })
  expect(await band.find({ type: 'Text', text: 'Opus 5.5 · High' })).toBeTruthy()

  await openPanel(band)
  expect((await band.find({ type: 'Box', key: 'seg-model-opus' }))?.props.backgroundColor).toBe('claude')
  expect((await band.find({ type: 'Box', key: 'seg-effort-high' }))?.props.backgroundColor).toBe('claude')
  expect((await band.find({ type: 'Box', key: 'seg-model-sonnet' }))?.props.backgroundColor).toBe(undefined)

  await band.press({ key: 'model-opus' }) // already in use: nothing runs
  await band.press({ key: 'model-sonnet' })
  await band.press({ key: 'effort-max' })
  expect(w.commandLines).toEqual(['/model sonnet', '/effort max'])
  expect((await band.find({ type: 'Box', key: 'seg-model-sonnet' }))?.props.backgroundColor).toBe('claude')
  expect((await band.find({ type: 'Box', key: 'seg-effort-max' }))?.props.backgroundColor).toBe('claude')

  // The next request carries xhigh (the model's ceiling): the panel shows what is really used.
  await request($, w, 40_000, 'xhigh')
  await band.press({ key: 'panel' })
  expect(await band.find({ type: 'Text', text: 'Sonnet 5.5 · XHigh' })).toBeTruthy()
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
  const band = await $.ui.mount({ plugin: 'user-hd', surface: 'terminal', component: 'AbovePrompt', props: BAND() })
  expect(await band.find({ type: 'Text', text: 'Fable 5.1' })).toBeTruthy()
  await openPanel(band)
  expect(await band.find({ type: 'Text', text: /cache reset \(model switched\)/ })).toBeTruthy()
})

test('the settings toggles write their /config rows and take effect at once', { options: { notifyMac: true, sound: false } }, async ($, on) => {
  const w = world(on)
  w.lockedRows = ['user-hd.sound']
  await start($)
  await request($, w, 80_000)
  const band = await $.ui.mount({ plugin: 'user-hd', surface: 'terminal', component: 'AbovePrompt', props: BAND() })
  await openPanel(band)
  // The world beneath swallows ui.invalidate, so redraw as the engine would before reading.
  const label = async (key: string) => {
    await band.redraw()
    return (await band.find({ type: 'Button', key }))?.props.label
  }

  expect(await label('set-autoKeepWarm')).toBe(' ○ Off ')
  await band.press({ key: 'set-autoKeepWarm' })
  expect(await label('set-autoKeepWarm')).toBe(' ● On ')
  await band.press({ key: 'set-notifyMac' })
  expect(await label('set-notifyMac')).toBe(' ○ Off ')
  await band.press({ key: 'set-cacheTtl' })
  expect(await label('set-cacheTtl')).toBe(' 5m ')
  await band.press({ key: 'set-warnSeconds' })
  expect(await label('set-warnSeconds')).toBe(' 5:00 ')
  expect(w.configSets).toEqual([
    ['user-hd.autoKeepWarm', true],
    ['user-hd.notifyMac', false],
    ['user-hd.cacheTtl', '5m'],
    ['user-hd.warnSeconds', 300],
  ])

  // A row a trusted source holds stays as it was, and says why.
  await band.press({ key: 'set-sound' })
  expect(await label('set-sound')).toBe(' ○ Off ')
  expect(w.toasts.at(-1)).toBe('Could not change sound: set by your organization')

  // Auto keep-warm now pings by itself; the banner is off, so the alert posts none.
  await w.clock.advance(300_000)
  expect(w.forks).toHaveLength(1)
  expect(w.argv.some(a => a[0] === 'osascript')).toBe(false)
})
