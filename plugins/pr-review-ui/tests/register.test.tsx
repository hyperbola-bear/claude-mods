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
  /** What rode along with each submitted prompt. */
  contexts: (readonly string[] | undefined)[]
  /** URLs the stand-in terminal-browser opened. */
  opened: string[]
  read: number
  submits: string[]
  commandRuns: string[]
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
  const w: World = { contexts: [], opened: [], read: 0, submits: [], commandRuns: [], files: {}, commands: [], toasts: [], argv: [], forks: [], opens: [], clock: mock.clock(on, { now: Date.parse('2026-10-07T06:00:00Z') }) }
  mock.store(on)
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
    w.contexts.push(e.context)
    w.submits.push(e.text)
    return { text: e.text }
  })
  on('command.run', ($, e) => {
    w.commandRuns.push(e.command)
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
async function request($: Engine, w: World, read: number) {
  w.read = read
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 3 })) {
    // drain
  }
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
test('a review is drawn as points, the first open, and its first code location opens in terminal-browser', { plugins: [fakeBrowser] }, async ($, on) => {
  const w = world(on)
  w.commands = ['browser']
  await start($)
  await review($, w)
  expect(w.opened).toHaveLength(1)
  expect(w.opened[0]).toMatch(FILES_ANCHOR)
  expect(w.opened[0]).toMatch(/R42-R44$/)
  for (const surface of SURFACES) {
    const msg = await $.ui.mount({ plugin: 'pr-review-ui', surface, component: 'AssistantMessage', props: MESSAGE })
    expect((await msg.find({ type: 'Text', text: /PR review/ }))?.text).toContain('acme/billing #12 · 2 points · 1 high · 1 medium')
    expect((await msg.find({ type: 'Button', key: 'pt:0' }))?.text).toContain('▾ 1. PassRole scoped')
    expect((await msg.find({ type: 'Button', key: 'pt:1' }))?.text).toContain('▸ 2. Missing iam:UntagRole')
    expect((await msg.find({ type: 'Markdown', key: 'body:0' }))?.text).toContain('[infra/firehose.tf:17](')
    expect(await msg.find({ type: 'Markdown', key: 'body:1' })).toBe(undefined)
    expect((await msg.findAll({ type: 'Button', text: /^infra\// })).map(b => b.text)).toEqual(['infra/iam.tf:42-44', 'infra/firehose.tf:17'])
    expect((await msg.find({ type: 'Markdown', key: 'summary' }))?.text).toContain('One blocking issue.')
    await msg.unmount()
  }
  expect(w.opens).not.toContain('review')
})

test('picking a point opens its first code location; code chips and s step through the rest', { plugins: [fakeBrowser] }, async ($, on) => {
  const w = world(on)
  w.commands = ['browser']
  await start($)
  await review($, w)
  const band = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'terminal', component: 'AbovePrompt', props: BAND() })
  expect((await band.find({ type: 'Button', key: 'band:0' }))?.props.hotkey).toBe('1')
  expect((await band.find({ type: 'Button', key: 'nextsec' }))?.text).toBe('code 1/2')
  expect(await band.find({ type: 'Text', text: 'iam.tf' })).toBeTruthy()
  expect(await band.find({ type: 'Text', text: 'infra/' })).toBeTruthy()

  await band.press({ key: 'nextsec' })
  expect(w.opened.at(-1)).toBe('https://github.com/acme/billing/blob/abc123/infra/firehose.tf#L17')
  await band.press({ key: 'band:1' })
  expect(w.opened.at(-1)).toMatch(/R45$/)
  await band.press({ key: 'band:0' })
  expect(w.opened.at(-1)).toMatch(/R42-R44$/) // back on point 1, at its first location again

  const msg = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'terminal', component: 'AssistantMessage', props: MESSAGE })
  await msg.press({ key: 'sec:0:1' })
  expect(w.opened.at(-1)).toContain('/blob/abc123/infra/firehose.tf#L17')
  await msg.press({ key: 'pt:1' })
  expect(w.opened.at(-1)).toMatch(/R45$/)
  expect((await msg.find({ type: 'Button', key: 'pt:1' }))?.text).toContain('▾ 2.')
  expect((await msg.find({ type: 'Button', key: 'pt:0' }))?.text).toContain('▸ 1.')
  expect(w.argv.filter(a => a.join(' ').startsWith('gh pr diff'))).toHaveLength(1)
})

test('a ref in the open point is a link to that code location', { plugins: [fakeBrowser] }, async ($, on) => {
  const w = world(on)
  w.commands = ['browser']
  await start($)
  await review($, w)
  const msg = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'terminal', component: 'AssistantMessage', props: MESSAGE })
  const body = await msg.find({ type: 'Markdown', key: 'body:0' })
  const href = /\[infra\/firehose\.tf:17\]\(([^)]+)\)/.exec(body?.text ?? '')?.[1] ?? ''
  await msg.press({ key: 'body:0', link: { href } })
  expect(w.opened.at(-1)).toContain('/blob/abc123/infra/firehose.tf#L17')
})

test('without terminal-browser the code pane shows the same code, folder and file apart', async ($, on) => {
  const w = world(on)
  await start($)
  await review($, w)
  expect(w.opened).toHaveLength(0)
  expect(w.opens).toContain('review')
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: 'pr-review-ui', surface, component: 'Pane', requestId: 'review', props: PANE_PROPS })
    const code = await pane.find({ type: 'Code' })
    expect(code?.props.format).toBe('diff')
    expect(code?.text).toContain('+      "iam:PassRole",')
    expect(await pane.find({ type: 'Text', text: 'infra/' })).toBeTruthy()
    await pane.press({ key: 'psec:1' })
    const source = await pane.find({ type: 'Code' })
    expect(source?.props.startLine).toBe(11)
    expect(source?.text).toContain('line 17')
    await pane.press({ key: 'next' })
    expect(await pane.find({ type: 'Text', text: /Missing iam:UntagRole/ })).toBeTruthy()
    await pane.press({ key: 'prev' })
    await pane.unmount()
  }
})

test('when terminal-browser is listed but cannot open, the pane takes over', async ($, on) => {
  const w = world(on)
  w.commands = ['browser'] // listed, but no browser noun behind it
  await start($)
  await review($, w)
  expect(w.toasts.some(t => t.includes('terminal-browser is not available'))).toBe(true)
  expect(w.opens).toContain('review')
})

test('/point jumps to a point and code location', { plugins: [fakeBrowser] }, async ($, on) => {
  const w = world(on)
  w.commands = ['browser']
  await start($)
  await review($, w)
  const out = await $.command.run({ command: 'point', args: '1 2', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
  expect(out.text).toContain('Point 1')
  expect(w.opened.at(-1)).toContain('firehose.tf#L17')
  const bad = await $.command.run({ command: 'point', args: '9', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
  expect(bad.text).toContain('Points: 1, 2')
})

test('replies that are not reviews are left to the engine', async ($, on) => {
  world(on)
  on('ui.render', { component: 'AssistantMessage' }, () => ({ type: 'Text', props: {}, children: ['engine'] }) as never)
  await start($)
  const msg = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'terminal', component: 'AssistantMessage', props: { text: 'Just an answer about `main.ts:3`.', isFirstOfReply: true } })
  expect(await msg.find({ type: 'Markdown' })).toBe(undefined)
})

test('the review row sits above what other plugins draw, and leaves the band alone with no review', { plugins: [fakeBrowser, otherBand] }, async ($, on) => {
  const w = world(on)
  w.commands = ['browser']
  await start($)
  const before = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'terminal', component: 'AbovePrompt', props: BAND() })
  expect(await before.find({ type: 'Text', text: 'OTHER BAND' })).toBeTruthy()
  expect(await before.find({ type: 'Button', key: 'band:0' })).toBe(undefined)
  await before.unmount()
  await review($, w)
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: 'pr-review-ui', surface, component: 'AbovePrompt', props: BAND() })
    expect(await band.find({ type: 'Button', key: 'band:0' })).toBeTruthy()
    expect(await band.find({ type: 'Text', text: 'OTHER BAND' })).toBeTruthy()
    await band.unmount()
  }
})

const TYPED = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })

test('typing review with a PR link hands the model the review format; other prompts pass untouched', async ($, on) => {
  const w = world(on)
  await start($)
  await $.prompt.submit(TYPED('review https://github.com/acme/billing/pull/12 please'))
  expect(w.contexts[0]?.at(-1)).toContain('`**PR review:** https://github.com/acme/billing/pull/12`')
  await $.prompt.submit(TYPED('what is in https://github.com/acme/billing/pull/12'))
  expect(w.contexts[1]).toBe(undefined)
  expect(w.submits).toEqual(['review https://github.com/acme/billing/pull/12 please', 'what is in https://github.com/acme/billing/pull/12'])
})

test('the trigger can be turned off', { options: { autoReview: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await $.prompt.submit(TYPED('review https://github.com/acme/billing/pull/12'))
  expect(w.contexts[0]).toBe(undefined)
})
