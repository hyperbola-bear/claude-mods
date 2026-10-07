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

const WIDE = { columns: 180, rows: 50, isFullscreen: true }
const NARROW = { columns: 100, rows: 50, isFullscreen: true }

const PR_URL = 'https://github.com/acme/billing/pull/12'
const SHA = 'abc1234def5678'
const HOME = '/home/p'
const WT = `${HOME}/.cache/pr-review-ui/review/acme-billing-12-abc1234`

type World = {
  /** What rode along with each submitted prompt. */
  contexts: (readonly string[] | undefined)[]
  /** URLs the stand-in terminal-browser opened. */
  opened: string[]
  submits: string[]
  toasts: string[]
  statuses: string[]
  argv: string[][]
  opens: string[]
  closes: string[]
  writes: string[]
  /** Questions asked, and the answers to give them in turn ('Not now' once they run out). */
  asks: string[]
  answers: string[]
  commands: string[]
  /** Files by absolute path. */
  files: Record<string, string>
  /** Paths that exist for fs.stat. */
  existing: Set<string>
  /** What the turn's model step answers. */
  answer: string
  /** Whether the code pane is placed (drawn) once open. */
  isPlaced: boolean
  /** What `gh pr view --json <fields>` answers; null: no PR. */
  pr: Record<string, unknown> | null
  /** What `git diff` in the review worktree answers, per path. */
  wtDiff: Record<string, string>
  isMac: boolean
  /** Command lines that are not installed. */
  absent: string[]
  /** What `git remote -v` says the session's folder is. */
  remote: string
  /** Editor command lines that succeed. */
  editors: string[]
  clock: ReturnType<typeof mock.clock>
}

/** Ghostty, where terminal-browser can draw. */
const GHOSTTY = { TERM_PROGRAM: 'ghostty', TERM: 'xterm-ghostty', HOME }
const ITERM = { TERM_PROGRAM: 'iTerm.app', TERM: 'xterm-256color', HOME }
const VSCODE_APP = '/Applications/Visual Studio Code.app'
const VSCODE = {
  TERM_PROGRAM: 'vscode',
  TERM: 'xterm-256color',
  TMPDIR: '/tmp/x/',
  HOME,
  VSCODE_GIT_ASKPASS_NODE: `${VSCODE_APP}/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)`,
}
const INTELLIJ = { TERMINAL_EMULATOR: 'JetBrains-JediTerm', TERM: 'xterm-256color', TMPDIR: '/tmp/x', HOME, __CFBundleIdentifier: 'com.jetbrains.intellij' }
const ZED = { TERM_PROGRAM: 'zed', TERM: 'xterm-256color', HOME }
const NVIM = { TERM_PROGRAM: 'ghostty', TERM: 'xterm-256color', HOME, NVIM: '/tmp/nvim.p/0' }
const VSCODE_CLI = `${VSCODE_APP}/Contents/Resources/app/bin/code`
const HEAD_COPY = '/tmp/x/pr-review-ui/acme-billing-12-abc123/infra/iam.tf'

const PR_JSON = {
  url: PR_URL,
  number: 12,
  title: 'Stream billing events through Firehose',
  headRefOid: SHA,
  headRefName: 'feat/firehose',
  baseRefName: 'main',
  author: { login: 'mlee' },
  additions: 93,
  deletions: 15,
  changedFiles: 7,
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

/** The whole of infra/iam.tf against the merge base: line 42 replaced by three. */
const IAM_WHOLE = [
  'diff --git a/infra/iam.tf b/infra/iam.tf',
  '--- a/infra/iam.tf',
  '+++ b/infra/iam.tf',
  '@@ -1,60 +1,62 @@',
  ...Array.from({ length: 41 }, (_, i) => ` l${i + 1}`),
  '-      "iam:CreateRole",',
  '+      "iam:CreateRole",',
  '+      "iam:PassRole",',
  '+      "iam:TagRole",',
  ...Array.from({ length: 18 }, (_, i) => ` l${i + 43}`),
].join('\n')

/** The world beneath the plugin: clock, store, gh, git, files and the UI calls. */
function world(on: On, env: Record<string, string> = GHOSTTY, surfaces: readonly ('terminal' | 'desktop')[] = ['terminal'], store: Record<string, unknown> = { setup: { isAsked: true } }): World {
  const w: World = {
    contexts: [], opened: [], submits: [], toasts: [], statuses: [], argv: [], opens: [], closes: [], writes: [], asks: [], answers: [], commands: [],
    files: {}, existing: new Set(), answer: 'done', isPlaced: true, pr: null, wtDiff: { 'infra/iam.tf': IAM_WHOLE }, isMac: false, absent: [],
    editors: [VSCODE_CLI], remote: 'git@github.com:acme/billing.git',
    clock: mock.clock(on, { now: Date.parse('2026-10-07T06:00:00Z') }),
  }
  mock.store(on, store)
  mock.env(on, env)
  on('session.surfaces', () => ({ value: surfaces }))
  on('fs.write', ($, e) => {
    w.writes.push(e.path)
    return { value: undefined }
  })
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: w.answer,
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: { model: 'claude-opus-5-5', input_tokens: 40, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 2_000 },
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
  on('ui.status', ($, e) => {
    w.statuses.push(e.text ?? '')
    return { value: undefined }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.open', ($, e) => {
    w.opens.push(e.id)
    return { value: { isPlaced: w.isPlaced } as never }
  })
  on('ui.close', ($, e) => {
    w.closes.push(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: w.opens.includes('review') && w.opens.length > w.closes.length ? [{ id: 'review', title: 'Review code', isShown: true, isFocused: false, isPlaced: w.isPlaced }] : [],
  }))
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
    const question = e.questions[0]?.question ?? ''
    w.asks.push(question)
    return { result: { questions: e.questions, answers: { [question]: w.answers.shift() ?? 'Not now' } } } as never
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: w.commands.map(name => ({ name, description: '', source: 'user' as const })) }))
  on('prompt.submit', ($, e) => {
    w.contexts.push(e.context)
    w.submits.push(e.text)
    return { text: e.text }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.root', () => ({ value: '/work' }))
  on('fs.stat', ($, e) => (w.existing.has(e.path) ? { value: { kind: 'dir' as const, size: 1, mtimeMs: 0, isLink: false } } : { deny: 'missing' }))
  on('fs.read', ($, e) => {
    const f = w.files[e.path]
    return f === undefined ? { deny: `missing ${e.path}` } : { value: f }
  })
  on('process.run', ($, e) => {
    w.argv.push([...e.argv])
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const fail = (stderr = 'not on this machine') => ({ value: { exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } })
    const args = e.argv.join(' ')
    if (w.absent.some(a => args.startsWith(a))) return fail('command not found')
    if (args === 'uname -s') return w.isMac ? out('Darwin\n') : fail()
    if (args === 'gh --version' || args === 'brew --version') return out('1.0\n')
    if (args.startsWith('brew install') || args.startsWith('claude plugin')) return out('')
    if (args.startsWith('gh pr diff')) return out(DIFF)
    if (args.includes('pr view') && args.includes('headRefName')) return w.pr ? out(JSON.stringify(w.pr)) : fail('no pull requests found for branch')
    if (args.includes('pr view') && args.includes('headRefOid')) return out(JSON.stringify({ headRefOid: 'abc123' }))
    if (args.includes('/contents/')) return out(Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n'))
    if (args === 'git -C /work remote -v') return out(`origin\t${w.remote} (fetch)\norigin\t${w.remote} (push)\n`)
    if (args === 'git -C /work rev-parse --show-toplevel') return out('/work\n')
    if (args.startsWith('git -C /work fetch')) return out('')
    if (args === 'git -C /work rev-parse refs/pr-review-ui/12/head') return out(`${SHA}\n`)
    if (args === 'git -C /work merge-base refs/pr-review-ui/12/head refs/pr-review-ui/12/base') return out('base999\n')
    if (args.startsWith('git -C /work worktree')) {
      if (args.includes('worktree add')) w.existing.add(WT)
      if (args.includes('worktree remove')) w.existing.delete(WT)
      return out(args.includes('list') ? `worktree /work\nHEAD 1\n\nworktree ${WT}\nHEAD base999\n` : '')
    }
    if (args.startsWith(`git -C ${WT} reset`) || args.startsWith(`git -C ${WT} add`)) return out('')
    if (args === `git -C ${WT} rev-parse HEAD`) return out('base999\n')
    if (args.startsWith(`git -C ${WT} diff`)) return out(w.wtDiff[e.argv.at(-1) ?? ''] ?? '')
    if (w.editors.includes(e.argv[0] ?? '')) return out('')
    return fail()
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
  `**PR review:** ${PR_URL}`,
  '',
  '**Verdict:** changes requested · Stream billing events through Firehose',
  '',
  'Adds the Firehose sink. The IAM pattern stops the first deploy.',
  '',
  '### [1] high · correctness · `infra/iam.tf:42-44` — PassRole scoped to a pattern the roles do not match',
  '',
  '- **Problem:** The pattern is `*billing-worker*`, but the Firehose role is named differently (`infra/firehose.tf:17`).',
  '- **Impact:** The first apply fails with a 403.',
  '- **Fix:** Widen the pattern:',
  '',
  '```diff',
  '-      "iam:CreateRole",',
  '+      "iam:CreateRole", "iam:PassRole",',
  '```',
  '',
  '### [2] medium · reliability · `infra/iam.tf:45` — Missing iam:UntagRole',
  '',
  '- **Problem:** Terraform untags on destroy.',
  '- **Impact:** Destroy fails.',
  '- **Fix:** Add iam:UntagRole.',
  '',
  '### Summary',
  '',
  '**Before merge:** 1 · **Any time:** 2',
  '',
  'One blocking issue.',
].join('\n')

/** A review as 1.1.0 asked for it: still drawn, its body as prose. */
const OLD_REVIEW = [
  `**PR review:** ${PR_URL}`,
  '',
  '### [1] high · `infra/iam.tf:42-44` — PassRole scoped to a pattern the roles do not match',
  '',
  'The Firehose role is named differently, see `infra/firehose.tf:17`.',
  '',
  '### Summary',
  '',
  'One blocking issue.',
].join('\n')

const MESSAGE = { text: REVIEW, isFirstOfReply: true }

const FILES_ANCHOR = /^https:\/\/github\.com\/acme\/billing\/pull\/12\/files#diff-[0-9a-f]{64}R/

async function review($: Engine, w: World, text = REVIEW) {
  await $.turn.complete({ answer: text, durationMs: 10, isAborted: false, turnId: 't2', reason: 'answer' })
  await w.clock.settle()
}

const start = async ($: Engine, w: World) => {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await w.clock.settle()
}

const TYPED = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })
const editorRuns = (w: World) => w.argv.filter(a => !['gh', 'git', 'uname', 'brew', 'claude'].includes(a[0] ?? ''))
const gitRuns = (w: World) => w.argv.filter(a => a[0] === 'git').map(a => a.join(' '))

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

test('a review is drawn as points in the standard layout: verdict, tags, Problem, Impact and Fix, the plan', { plugins: [fakeBrowser] }, async ($, on) => {
  const w = world(on)
  w.commands = ['browser']
  await start($, w)
  await review($, w)
  expect(w.opened).toHaveLength(1)
  expect(w.opened[0]).toMatch(FILES_ANCHOR)
  expect(w.opened[0]).toMatch(/R42-R44$/)
  for (const surface of SURFACES) {
    const msg = await $.ui.mount({ plugin: 'pr-review-ui', surface, component: 'AssistantMessage', props: MESSAGE, viewport: WIDE })
    expect(await msg.find({ type: 'Text', text: /^Review · acme\/billing #12 · Stream billing events through Firehose$/ })).toBeTruthy()
    expect(await msg.find({ type: 'Text', text: '✗ Changes requested' })).toBeTruthy()
    expect(await msg.find({ type: 'Text', text: ' HIGH ' })).toBeTruthy()
    expect(await msg.find({ type: 'Text', text: ' MED  ' })).toBeTruthy()
    expect(await msg.find({ type: 'Text', text: 'PassRole scoped to a pattern the roles do not match' })).toBeTruthy() // open: the whole title, bold
    expect(await msg.find({ type: 'Button', key: 'pt:0' })).toBe(undefined)
    expect((await msg.find({ type: 'Button', key: 'pt:1' }))?.text).toBe('Missing iam:UntagRole')
    expect(await msg.find({ type: 'Text', text: '▾ 1' })).toBeTruthy()
    expect(await msg.find({ type: 'Text', text: '▸ 2' })).toBeTruthy()
    expect(await msg.find({ type: 'Text', text: 'correctness' })).toBeTruthy()
    expect(await msg.find({ type: 'Text', text: 'Problem' })).toBeTruthy()
    expect((await msg.find({ type: 'Markdown', key: 'body:0:problem' }))?.text).toContain('[infra/firehose.tf:17](')
    expect((await msg.find({ type: 'Markdown', key: 'body:0:fix' }))?.text).toBe('Widen the pattern:')
    expect(await msg.find({ type: 'Text', text: '"iam:CreateRole", "iam:PassRole",' })).toBeTruthy() // the suggested change
    expect(await msg.find({ type: 'Markdown', key: 'body:1:problem' })).toBe(undefined)
    expect(await msg.find({ type: 'Text', text: '▸ infra/iam.tf:42-44' })).toBeTruthy()
    expect((await msg.findAll({ type: 'Button', text: /^infra\// })).map(b => b.text)).toEqual(['infra/firehose.tf:17'])
    expect(await msg.find({ type: 'Text', text: 'Before merge' })).toBeTruthy()
    expect(await msg.find({ type: 'Button', key: 'plan:1:2' })).toBeTruthy()
    expect((await msg.find({ type: 'Markdown', key: 'summary' }))?.text).toBe('One blocking issue.')
    expect(await msg.find({ type: 'Text', text: 'Adds the Firehose sink. The IAM pattern stops the first deploy.' })).toBeTruthy()
    await msg.unmount()
  }
  expect(w.opens).not.toContain('review')
})

test('a review in the 1.1.0 format still draws, its body as prose', { plugins: [fakeBrowser] }, async ($, on) => {
  const w = world(on)
  w.commands = ['browser']
  await start($, w)
  await review($, w, OLD_REVIEW)
  const msg = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'terminal', component: 'AssistantMessage', props: { text: OLD_REVIEW, isFirstOfReply: true }, viewport: WIDE })
  expect((await msg.find({ type: 'Markdown', key: 'body:0' }))?.text).toContain('[infra/firehose.tf:17](')
  expect(await msg.find({ type: 'Text', text: '1 points' })).toBeTruthy()
  expect(await msg.find({ type: 'Text', text: 'Summary' })).toBeTruthy()
})

test('picking a point opens its first code location; a and d step points, s steps code locations', { plugins: [fakeBrowser] }, async ($, on) => {
  const w = world(on)
  w.commands = ['browser']
  await start($, w)
  await review($, w)
  const band = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'terminal', component: 'AbovePrompt', props: BAND() })
  expect((await band.find({ type: 'Button', key: 'band:0' }))?.props.hotkey).toBe('1')
  expect((await band.find({ type: 'Button', key: 'prevpt' }))?.props.hotkey).toBe('a')
  expect((await band.find({ type: 'Button', key: 'nextpt' }))?.props.hotkey).toBe('d')
  expect((await band.find({ type: 'Button', key: 'nextsec' }))?.props.hotkey).toBe('s')
  expect(await band.find({ type: 'Text', text: 'iam.tf' })).toBeTruthy()
  expect(await band.find({ type: 'Text', text: '│ in terminal-browser' })).toBeTruthy()
  expect(await band.find({ type: 'Text', text: /under the point/ })).toBe(undefined)

  await band.press({ key: 'nextsec' })
  expect(w.opened.at(-1)).toBe('https://github.com/acme/billing/blob/abc123/infra/firehose.tf#L17')
  await band.press({ key: 'nextpt' })
  expect(w.opened.at(-1)).toMatch(/R45$/)
  await band.press({ key: 'prevpt' })
  expect(w.opened.at(-1)).toMatch(/R42-R44$/) // back on point 1, at its first location again

  const msg = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'terminal', component: 'AssistantMessage', props: MESSAGE, viewport: WIDE })
  await msg.press({ key: 'sec:0:1' })
  expect(w.opened.at(-1)).toContain('/blob/abc123/infra/firehose.tf#L17')
  await msg.press({ key: 'pt:1' })
  expect(w.opened.at(-1)).toMatch(/R45$/)
  expect(await msg.find({ type: 'Text', text: '▾ 2' })).toBeTruthy()
  await msg.press({ key: 'plan:0:1' })
  expect(w.opened.at(-1)).toMatch(/R42-R44$/)
  expect(w.argv.filter(a => a.join(' ').startsWith('gh pr diff'))).toHaveLength(1)
})

test('a ref in the open point is a link to that code location', { plugins: [fakeBrowser] }, async ($, on) => {
  const w = world(on)
  w.commands = ['browser']
  await start($, w)
  await review($, w)
  const msg = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'terminal', component: 'AssistantMessage', props: MESSAGE, viewport: WIDE })
  const body = await msg.find({ type: 'Markdown', key: 'body:0:problem' })
  const href = /\[infra\/firehose\.tf:17\]\(([^)]+)\)/.exec(body?.text ?? '')?.[1] ?? ''
  await msg.press({ key: 'body:0:problem', link: { href } })
  expect(w.opened.at(-1)).toContain('/blob/abc123/infra/firehose.tf#L17')
})

test('typing review with a PR link checks the PR out into a review worktree and opens the pane, with nothing to click', async ($, on) => {
  const w = world(on, ITERM)
  w.pr = PR_JSON
  w.files[`${WT}/infra/firehose.tf`] = Array.from({ length: 30 }, (_, i) => `f${i + 1}`).join('\n')
  await start($, w)
  const band = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'terminal', component: 'AbovePrompt', props: BAND(), viewport: WIDE })
  await band.unmount()
  await $.prompt.submit(TYPED(`review ${PR_URL}`))
  await w.clock.settle()
  expect(w.contexts[0]?.at(-1)).toContain(`\`**PR review:** ${PR_URL}\``)
  expect(w.contexts[0]?.at(-1)).toContain(WT)
  expect(w.opens).toEqual(['review']) // the pane opens with the prompt, from 144 columns
  expect(gitRuns(w)).toEqual([
    'git -C /work remote -v',
    'git -C /work rev-parse --show-toplevel',
    'git -C /work fetch --no-tags --quiet origin +refs/pull/12/head:refs/pr-review-ui/12/head +refs/heads/main:refs/pr-review-ui/12/base',
    'git -C /work rev-parse refs/pr-review-ui/12/head',
    'git -C /work merge-base refs/pr-review-ui/12/head refs/pr-review-ui/12/base',
    'git -C /work worktree prune',
    `git -C /work worktree add --detach --quiet ${WT} ${SHA}`,
    `git -C ${WT} reset --quiet --mixed base999`,
    `git -C ${WT} add --intent-to-add .`,
    'git -C /work worktree list --porcelain',
  ])
  const waiting = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'terminal', component: 'Pane', requestId: 'review', props: PANE_PROPS })
  expect(await waiting.find({ type: 'Text', text: /The PR is checked out in .*acme-billing-12-abc1234/ })).toBeTruthy()
  await waiting.unmount()

  await review($, w)
  expect(w.opens.filter(id => id === 'review').length).toBeGreaterThanOrEqual(2)
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: 'pr-review-ui', surface, component: 'Pane', requestId: 'review', props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: /changed in this PR · review worktree/ })).toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /^▌\s+43 $/ })).toBeTruthy() // the reviewed lines carry a marker, on both sides' numbers
    expect(await pane.find({ type: 'Text', text: /^▌42\s+$/ })).toBeTruthy() // the removed line, old number only
    expect(await pane.find({ type: 'Text', text: /^ 40 40 $/ })).toBeTruthy() // context does not
    expect(await pane.find({ type: 'Text', text: '      "iam:PassRole",' })).toBeTruthy()
    expect((await pane.find({ type: 'Button', key: 'moreup' }))?.text).toBe('↑ 10 more lines (36 above)')
    expect((await pane.find({ type: 'Button', key: 'prev' }))?.props.hotkey).toBe('a')
    expect((await pane.find({ type: 'Button', key: 'next' }))?.props.hotkey).toBe('d')
    await pane.unmount()
  }
  const pane = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'terminal', component: 'Pane', requestId: 'review', props: PANE_PROPS })
  await pane.press({ key: 'moreup' })
  await pane.redraw()
  expect((await pane.find({ type: 'Button', key: 'moreup' }))?.text).toBe('↑ 10 more lines (26 above)')
  expect(await pane.find({ type: 'Text', text: /^ 27 27 $/ })).toBeTruthy()
  await pane.press({ key: 'psec:1' })
  await w.clock.settle()
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: /not changed in this PR · review worktree/ })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: 'f17' })).toBeTruthy()
  await pane.press({ key: 'next' })
  expect(await pane.find({ type: 'Text', text: /Missing iam:UntagRole/ })).toBeTruthy()

  // Done: the pane closes and the worktree goes.
  const doneBand = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'terminal', component: 'AbovePrompt', props: BAND() })
  await doneBand.press({ key: 'donereview' })
  expect(w.closes).toContain('review')
  expect(gitRuns(w).at(-1)).toBe(`git -C /work worktree remove --force ${WT}`)
  expect(w.toasts.some(t => t.includes('review worktree is removed'))).toBe(true)
})

test('review pr, review pr 12 and pr review find the PR with gh; with no PR the prompt passes untouched', async ($, on) => {
  const w = world(on, ITERM)
  w.pr = PR_JSON
  await start($, w)
  await $.prompt.submit(TYPED('review pr'))
  expect(w.argv.find(a => a.includes('pr') && a.includes('view'))).toEqual(['gh', 'pr', 'view', '--json', 'url,number,title,headRefOid,headRefName,baseRefName,author,additions,deletions,changedFiles'])
  expect(w.contexts[0]?.at(-1)).toContain(`\`**PR review:** ${PR_URL}\``)
  await $.prompt.submit(TYPED('review PR #12 please'))
  expect(w.argv.filter(a => a.includes('view')).at(-1)?.slice(0, 4)).toEqual(['gh', 'pr', 'view', '12'])
  w.pr = null
  await $.prompt.submit(TYPED('pr review'))
  expect(w.contexts[2]).toBe(undefined)
  expect(w.toasts.some(t => t.includes('no PR for this branch'))).toBe(true)
  await $.prompt.submit(TYPED('what is in https://github.com/acme/billing/pull/12'))
  expect(w.contexts[3]).toBe(undefined)
  await $.prompt.submit(TYPED(`review ${PR_URL}`)) // gh cannot read it: the format still rides along
  expect(w.contexts[4]?.at(-1)).toContain(`\`**PR review:** ${PR_URL}\``)
})

test('the skill command gets the worktree ready and leaves the prompt to the skill', async ($, on) => {
  const w = world(on, ITERM)
  w.pr = PR_JSON
  await start($, w)
  await $.prompt.submit(TYPED(`/pr-review-ui:pr-review ${PR_URL}`))
  await w.clock.settle()
  expect(w.contexts[0]).toBe(undefined)
  expect(gitRuns(w)).toContain(`git -C /work worktree add --detach --quiet ${WT} ${SHA}`)
})

const CLEAN = [
  `**PR review:** ${PR_URL}`,
  '',
  '**Verdict:** ready to merge · Stream billing events through Firehose',
  '',
  'Records every event the sink sends. I found nothing that blocks it.',
  '',
  'Things I checked:',
  '- **Loop at `infra/iam.tf:42`:** it always ends.',
  '',
  '### Summary',
  '',
  'Ready to merge.',
].join('\n')

test('a review with no points draws its verdict, lead and summary, and the band offers done', async ($, on) => {
  const w = world(on, ITERM)
  w.pr = PR_JSON
  await start($, w)
  await review($, w, CLEAN)
  expect(editorRuns(w)).toEqual([])
  for (const surface of SURFACES) {
    const msg = await $.ui.mount({ plugin: 'pr-review-ui', surface, component: 'AssistantMessage', props: { text: CLEAN, isFirstOfReply: true }, viewport: WIDE })
    expect(await msg.find({ type: 'Text', text: '✓ Ready to merge' })).toBeTruthy()
    expect(await msg.find({ type: 'Text', text: 'no points' })).toBeTruthy()
    expect(await msg.find({ type: 'Text', text: 'Records every event the sink sends. I found nothing that blocks it.' })).toBeTruthy()
    expect((await msg.find({ type: 'Markdown', key: 'more' }))?.text).toContain('[infra/iam.tf:42](https://github.com/acme/billing/pull/12/files#diff-')
    expect((await msg.find({ type: 'Markdown', key: 'summary' }))?.text).toBe('Ready to merge.')
    await msg.unmount()
  }
  const band = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'terminal', component: 'AbovePrompt', props: BAND() })
  expect(await band.find({ type: 'Text', text: '✓ Ready to merge' })).toBeTruthy()
  expect(await band.find({ type: 'Button', key: 'band:0' })).toBe(undefined)
  const pane = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'terminal', component: 'Pane', requestId: 'review', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: 'acme/billing #12: ready to merge, no points' })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /The PR is checked out in .*; done \(x on the band\) removes it\./ })).toBeTruthy()
  await band.press({ key: 'donereview' })
  expect(gitRuns(w).at(-1)).toBe(`git -C /work worktree remove --force ${WT}`)
})

test('when the session is in another repository, the PR is cloned once into the cache, in full', async ($, on) => {
  const w = world(on, ITERM)
  w.pr = PR_JSON
  w.remote = 'git@github.com:acme/other.git'
  await start($, w)
  await review($, w)
  expect(w.argv.find(a => a[1] === 'repo' && a[2] === 'clone')).toEqual([
    'gh', 'repo', 'clone', 'https://github.com/acme/billing', `${HOME}/.cache/pr-review-ui/repos/github.com/acme/billing`, '--', '--no-checkout',
  ])
})

test('under 144 columns the code shows under the open point, and moves to the pane once the terminal is wide', async ($, on) => {
  const w = world(on, ITERM)
  w.isPlaced = false // opened unasked on a narrow terminal: it waits
  await start($, w)
  await review($, w)
  expect(w.opens).toContain('review')
  expect(w.toasts.some(t => t.includes('wider terminal'))).toBe(false)
  const narrow = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'terminal', component: 'AssistantMessage', props: MESSAGE, viewport: NARROW })
  expect(await narrow.find({ type: 'Text', text: /^infra\/iam\.tf:42-44 · changed in this PR · from GitHub$/ })).toBeTruthy()
  expect(await narrow.find({ type: 'Text', text: '      "iam:PassRole",' })).toBeTruthy()
  await narrow.unmount()
  const narrowBand = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'terminal', component: 'AbovePrompt', props: BAND(), viewport: NARROW })
  expect(await narrowBand.find({ type: 'Text', text: '│ under the point' })).toBeTruthy()
  await narrowBand.unmount()
  // Widened: the waiting pane docks by itself, so the code leaves the transcript.
  const wide = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'terminal', component: 'AssistantMessage', props: MESSAGE, viewport: WIDE })
  expect(await wide.find({ type: 'Text', text: /^infra\/iam\.tf:42-44 · / })).toBe(undefined)
  await wide.unmount()
  w.isPlaced = true
  const docked = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'terminal', component: 'AssistantMessage', props: MESSAGE, viewport: NARROW })
  expect(await docked.find({ type: 'Text', text: /^infra\/iam\.tf:42-44 · / })).toBe(undefined)
  // The desktop app always has its pane.
  const desk = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'desktop', component: 'AssistantMessage', props: MESSAGE, viewport: NARROW })
  expect(await desk.find({ type: 'Text', text: /^infra\/iam\.tf:42-44 · / })).toBe(undefined)
})

test('on the main screen no pane opens by itself: the code shows under the point until show opens one', async ($, on) => {
  const w = world(on, ITERM)
  await start($, w)
  const band = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'terminal', component: 'AbovePrompt', props: BAND(), viewport: { columns: 200, rows: 50, isFullscreen: false } })
  await review($, w)
  expect(w.opens).toEqual([])
  const msg = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'terminal', component: 'AssistantMessage', props: MESSAGE, viewport: { columns: 200, rows: 50, isFullscreen: false } })
  expect(await msg.find({ type: 'Text', text: /^infra\/iam\.tf:42-44 · / })).toBeTruthy()
  await band.redraw()
  await band.press({ key: 'showcode' })
  expect(w.opens).toEqual(['review'])
})

test('in VS Code the editor opens the review worktree at the line, following each point', async ($, on) => {
  const w = world(on, VSCODE)
  w.pr = PR_JSON
  await start($, w)
  await review($, w)
  expect(editorRuns(w)).toEqual([[VSCODE_CLI, '-r', '-g', `${WT}/infra/iam.tf:42`]])
  expect(w.opens).not.toContain('review')
  expect(w.writes).toEqual([])
  const band = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'terminal', component: 'AbovePrompt', props: BAND() })
  expect(await band.find({ type: 'Text', text: '│ in VS Code' })).toBeTruthy()
  expect(await band.find({ type: 'Text', text: /The editor shows/ })).toBe(undefined)
  await band.press({ key: 'nextsec' })
  expect(editorRuns(w).at(-1)).toEqual([VSCODE_CLI, '-r', '-g', `${WT}/infra/firehose.tf:17`])
  await band.press({ key: 'nextpt' })
  expect(editorRuns(w).at(-1)).toEqual([VSCODE_CLI, '-r', '-g', `${WT}/infra/iam.tf:45`])
})

test('with no worktree, the editor opens a read-only copy of the PR head and says so', async ($, on) => {
  const w = world(on, VSCODE)
  await start($, w)
  await review($, w)
  expect(w.writes).toEqual([HEAD_COPY])
  expect(editorRuns(w)).toEqual([[VSCODE_CLI, '-r', '-g', `${HEAD_COPY}:42`]])
  const band = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'terminal', component: 'AbovePrompt', props: BAND() })
  expect(await band.find({ type: 'Text', text: /The editor shows a read-only copy of the PR head/ })).toBeTruthy()
})

test('outside VS Code itself, code on the PATH is used; with no editor at all, the pane', async ($, on) => {
  const w = world(on, { ...VSCODE, VSCODE_GIT_ASKPASS_NODE: '' })
  w.pr = PR_JSON
  w.editors = ['code']
  await start($, w)
  await review($, w)
  expect(editorRuns(w)).toEqual([['code', '-r', '-g', `${WT}/infra/iam.tf:42`]])
  w.editors = []
  await $.command.run({ command: 'point', args: '2', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
  expect(w.toasts.some(t => t.includes('Could not open VS Code'))).toBe(true)
  expect(w.opens).toContain('review')
})

test('in a JetBrains terminal, the IDE that runs it opens the worktree file at the line', async ($, on) => {
  const w = world(on, INTELLIJ)
  w.pr = PR_JSON
  w.editors = ['open']
  await start($, w)
  await review($, w)
  expect(editorRuns(w)).toEqual([['open', '-nb', 'com.jetbrains.intellij', '--args', '--line', '42', `${WT}/infra/iam.tf`]])
})

test('in a Zed terminal, zed opens the worktree file at the line', async ($, on) => {
  const w = world(on, ZED)
  w.pr = PR_JSON
  w.editors = ['zed']
  await start($, w)
  await review($, w)
  expect(editorRuns(w)).toEqual([['zed', `${WT}/infra/iam.tf:42`]])
})

test("in Neovim's terminal, the file opens in the window beside it", async ($, on) => {
  const w = world(on, NVIM)
  w.pr = PR_JSON
  w.editors = ['nvim']
  await start($, w)
  await review($, w)
  const run = editorRuns(w)[0] ?? []
  expect(run.slice(0, 4)).toEqual(['nvim', '--server', '/tmp/nvim.p/0', '--remote-expr'])
  expect(run[4]).toContain(`edit +42 ' . fnameescape('${WT}/infra/iam.tf')`)
})

test('an editor command set in config is used anywhere', { options: { ideCommand: 'goland' } }, async ($, on) => {
  const w = world(on, GHOSTTY)
  w.pr = PR_JSON
  w.editors = ['goland']
  await start($, w)
  await review($, w)
  expect(editorRuns(w)).toEqual([['goland', '--line', '42', `${WT}/infra/iam.tf`]])
})

test('the desktop app uses the pane, even in VS Code', async ($, on) => {
  const w = world(on, VSCODE, ['desktop'])
  await start($, w)
  await review($, w)
  expect(editorRuns(w)).toEqual([])
  expect(w.opens).toContain('review')
})

test('when terminal-browser is listed but cannot open, the pane takes over', async ($, on) => {
  const w = world(on)
  w.commands = ['browser'] // listed, but no browser noun behind it
  await start($, w)
  await review($, w)
  expect(w.toasts.some(t => t.includes('terminal-browser is not available'))).toBe(true)
  expect(w.opens).toContain('review')
})

test('without a worktree the pane shows the PR hunk from GitHub, then the file at the head', async ($, on) => {
  const w = world(on, ITERM)
  await start($, w)
  await review($, w)
  const pane = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'terminal', component: 'Pane', requestId: 'review', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: /changed in this PR · from GitHub/ })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /^▌\s+43 $/ })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: 'Files in this PR' })).toBeTruthy()
  await pane.press({ key: 'psec:1' })
  await w.clock.settle()
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: 'line 17' })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /not changed in this PR · from GitHub/ })).toBeTruthy()
})

test('/point jumps to a point and code location', { plugins: [fakeBrowser] }, async ($, on) => {
  const w = world(on)
  w.commands = ['browser']
  await start($, w)
  await review($, w)
  const out = await $.command.run({ command: 'point', args: '1 2', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
  expect(out.text).toContain('Point 1')
  expect(w.opened.at(-1)).toContain('firehose.tf#L17')
  const bad = await $.command.run({ command: 'point', args: '9', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
  expect(bad.text).toContain('Points: 1, 2')
})

test('replies that are not reviews are left to the engine', async ($, on) => {
  const w = world(on)
  on('ui.render', { component: 'AssistantMessage' }, () => ({ type: 'Text', props: {}, children: ['engine'] }) as never)
  await start($, w)
  const msg = await $.ui.mount({ plugin: 'pr-review-ui', surface: 'terminal', component: 'AssistantMessage', props: { text: 'Just an answer about `main.ts:3`.', isFirstOfReply: true } })
  expect(await msg.find({ type: 'Markdown' })).toBe(undefined)
})

test('the review row sits above what other plugins draw, and leaves the band alone with no review', { plugins: [fakeBrowser, otherBand] }, async ($, on) => {
  const w = world(on)
  w.commands = ['browser']
  await start($, w)
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

test('the trigger can be turned off', { options: { autoReview: false } }, async ($, on) => {
  const w = world(on)
  await start($, w)
  await $.prompt.submit(TYPED(`review ${PR_URL}`))
  expect(w.contexts[0]).toBe(undefined)
})

test('the first session asks before installing each missing tool, and remembers the answers', async ($, on) => {
  const w = world(on, GHOSTTY, ['terminal'], {})
  w.isMac = true
  w.absent = ['gh --version', 'ghostty --version']
  w.answers = ['Install', "Don't ask again", 'Not now']
  await start($, w)
  expect(w.asks).toHaveLength(0) // a moment after the session starts, not during it
  await w.clock.advance(2000)
  expect(w.asks).toHaveLength(3)
  expect(w.asks[0]).toContain('brew install gh')
  expect(w.asks[1]).toContain('brew install --cask ghostty')
  expect(w.asks[2]).toContain('terminal-browser')
  expect(w.argv.filter(a => a[0] === 'brew' && a[1] === 'install')).toEqual([['brew', 'install', 'gh']])
  expect(w.toasts.some(t => t.includes('The GitHub CLI is installed'))).toBe(true)
  // A review asks only about what it needs (gh, still missing here); Ghostty is never asked again.
  w.answers = ['Not now']
  await $.prompt.submit(TYPED(`review ${PR_URL}`))
  expect(w.asks).toHaveLength(4)
  expect(w.asks[3]).toContain('brew install gh')
  const out = await $.command.run({ command: 'review-setup', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
  expect(w.asks).toHaveLength(7) // asked for: everything missing, Ghostty included
  expect(out.text).toContain('not installed')
})

test('nothing is asked when the plugin is told not to offer setup', { options: { offerSetup: false } }, async ($, on) => {
  const w = world(on, GHOSTTY, ['terminal'], {})
  w.absent = ['gh --version']
  await start($, w)
  await w.clock.advance(2000)
  await $.prompt.submit(TYPED(`review ${PR_URL}`))
  expect(w.asks).toEqual([])
})
