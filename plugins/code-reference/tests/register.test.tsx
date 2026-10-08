import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, Register } from 'claude-code'

import { textKey } from '../hooks/code.ts'
import { parseDoc } from '../hooks/doc.ts'
import { replyRows } from '../hooks/layout.ts'

const SURFACES = ['terminal', 'desktop'] as const
const VIEW = { columns: 88, rows: 50, isFullscreen: true }
const PANE_PROPS = { title: 'Code reference', isFocused: false, bodyColumns: 66, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} }
const PR_URL = 'https://github.com/acme/billing/pull/12'
const SHA = 'abc1234def5678'
const HOME = '/home/p'
const WT = `${HOME}/.cache/code-reference/review/acme-billing-12-abc1234`

const FILE = Array.from({ length: 900 }, (_, i) => `line ${i + 1}`).join('\n')

const REPLY = [
  '**Code reference:** /work',
  '',
  '## Prompts',
  '',
  'Every prompt passes [the hook](hooks/register.tsx:792-811), which asks [reviewRequest](hooks/review.ts:42-54).',
  '',
  '## Drawing',
  '',
  '[showCurrent](hooks/register.tsx:383-409) draws it.',
].join('\n')

const REVIEW = [`**Code reference:** ${PR_URL}`, '', 'Not ready to merge: the IAM pattern stops the first deploy.', '', '## PassRole is too narrow', '', '[The statement](infra/iam.tf:42-44) misses the role.'].join('\n')

const IAM_DIFF = ['diff --git a/infra/iam.tf b/infra/iam.tf', '--- a/infra/iam.tf', '+++ b/infra/iam.tf', '@@ -1,50 +1,51 @@', ...Array.from({ length: 41 }, (_, i) => ` l${i + 1}`), '+      "iam:PassRole",', ...Array.from({ length: 9 }, (_, i) => ` l${i + 42}`)].join('\n')

const API_PR = { html_url: PR_URL, number: 12, title: 'Firehose', head: { sha: SHA, ref: 'feat/x' }, base: { ref: 'main' }, user: { login: 'mlee' }, additions: 1, deletions: 0, changed_files: 1 }

type World = {
  contexts: (readonly string[] | undefined)[]
  submits: string[]
  toasts: string[]
  opens: string[]
  argv: string[][]
  mcp: string[]
  messages: { role: 'user' | 'assistant'; text: string; toolUses: never[] }[]
  hasGh: boolean
  /** The GitHub MCP tools a server offers, by their own names. */
  mcpTools: string[]
  isOpen: boolean
  clock: ReturnType<typeof mock.clock>
}

/** The world beneath the plugin: files on disk, git, gh, an MCP server, and the UI calls. */
function world(on: On, env: Record<string, string> = { TERM_PROGRAM: 'iTerm.app', HOME }, commands: string[] = []): World {
  const w: World = { contexts: [], submits: [], toasts: [], opens: [], argv: [], mcp: [], messages: [], hasGh: true, mcpTools: [], isOpen: false, clock: mock.clock(on, { now: Date.parse('2026-10-09T06:00:00Z') }) }
  const files: Record<string, string> = { '/work/hooks/register.tsx': FILE, '/work/hooks/review.ts': FILE, [`${WT}/infra/iam.tf`]: Array.from({ length: 51 }, (_, i) => `l${i + 1}`).join('\n') }
  const existing = new Set<string>()
  mock.store(on, { setup: { isAsked: true } })
  mock.env(on, env)
  on('session.surfaces', () => ({ value: ['terminal'] as const }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/work' }))
  on('session.messages', () => ({ value: w.messages }) as never)
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.open', ($, e) => {
    w.opens.push(e.id)
    w.isOpen = true
    return { value: { isPlaced: true } as never }
  })
  on('ui.close', () => {
    w.isOpen = false
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: w.isOpen ? [{ id: 'code-reference', title: 'Code reference', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: commands.map(name => ({ name, description: '', source: 'plugin' as const })) }))
  // The engine's own drawing of a reply the plugin leaves alone.
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  on('prompt.submit', ($, e) => {
    w.contexts.push(e.context)
    w.submits.push(e.text)
    return { text: e.text }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.list', () => ({ value: w.mcpTools.map(name => ({ name: `mcp__github__${name}`, description: '', mcp: true })) }))
  on('tool.call', ($, e) => {
    w.mcp.push(e.tool)
    return { result: {}, text: JSON.stringify(API_PR) } as never
  })
  on('fs.stat', ($, e) => (existing.has(e.path) ? { value: { kind: 'dir' as const, size: 1, mtimeMs: 0, isLink: false } } : { deny: 'missing' }))
  on('fs.read', ($, e) => (files[e.path] === undefined ? { deny: `missing ${e.path}` } : { value: files[e.path] as string }))
  on('fs.write', () => ({ value: undefined }))
  on('process.run', ($, e) => {
    w.argv.push([...e.argv])
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const fail = (stderr = 'no') => ({ value: { exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } })
    const args = e.argv.join(' ')
    if (args === 'uname -s') return out('Darwin\n')
    if (e.argv[0] === 'gh') {
      if (!w.hasGh) return { deny: 'gh: command not found' }
      if (args.includes('pr view')) return out(JSON.stringify({ url: PR_URL, number: 12, title: 'Firehose', headRefOid: SHA, headRefName: 'feat/x', baseRefName: 'main', author: { login: 'mlee' }, additions: 1, deletions: 0, changedFiles: 1 }))
      return fail()
    }
    if (args === 'git -C /work remote -v') return out('origin\tgit@github.com:acme/billing.git (fetch)\norigin\tgit@github.com:acme/billing.git (push)\n')
    if (args === 'git -C /work rev-parse --show-toplevel') return out('/work\n')
    if (args.startsWith('git -C /work fetch')) return out('')
    if (args === 'git -C /work rev-parse refs/code-reference/12/head') return out(`${SHA}\n`)
    if (args.startsWith('git -C /work merge-base')) return out('base999\n')
    if (args.startsWith('git -C /work worktree')) {
      if (args.includes('worktree add')) existing.add(WT)
      return out('')
    }
    if (args.startsWith(`git -C ${WT} diff`)) return out(e.argv.at(-1) === 'infra/iam.tf' ? IAM_DIFF : '')
    if (args.startsWith(`git -C ${WT}`)) return out(args.includes('rev-parse HEAD') ? 'base999\n' : '')
    if (args.startsWith('git -C /work diff')) return out('')
    if (args.startsWith('open ')) return out('')
    return fail()
  })
  return w
}

const start = async ($: Engine, w: World) => {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await w.clock.settle()
}

const answer = async ($: Engine, w: World, text: string) => {
  await $.turn.complete({ answer: text, durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  await w.clock.settle()
}

const TYPED = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })
const RUN = (command: string, args = '') => ({ command, args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } })

/** Where a place's box sits in the reply as the mod lays it out at 88 columns. */
function boxAt(text: string, label: string, current: number | null): { x: number; y: number } {
  const doc = parseDoc(text, '/work')
  if (!doc) throw new Error('no doc')
  const rows = replyRows({ key: textKey(text.trim()), doc, current, inline: null, cols: VIEW.columns }, VIEW.columns, null).map(r => r.map(s => s.t).join(''))
  const y = rows.findIndex(r => r.includes(`│ ${label}`))
  return { x: (rows[y] ?? '').indexOf(label) + 1, y }
}

test('a code-reference reply is one region drawing the same rows in the terminal and the desktop app', async ($, on) => {
  const w = world(on)
  await start($, w)
  await answer($, w, REPLY)
  expect(w.opens).toEqual(['code-reference'])
  const drawn: Record<string, string> = {}
  for (const surface of SURFACES) {
    const msg = await $.ui.mount({ plugin: 'code-reference', surface, component: 'AssistantMessage', props: { text: REPLY, isFirstOfReply: true }, viewport: VIEW })
    expect(await msg.find({ type: 'Client', key: 'reply' })).toBeTruthy()
    expect(await msg.find({ type: 'Text', text: 'review.ts', in: 'reply' })).toBeTruthy()
    expect(await msg.find({ type: 'Text', text: '¹', in: 'reply' })).toBeTruthy()
    expect(await msg.find({ type: 'Markdown' })).toBe(undefined)
    drawn[surface] = JSON.stringify(await msg.drawn({ in: 'reply' }))
    await msg.unmount()
  }
  expect(drawn.terminal).toBe(drawn.desktop)
  // Another reply is left to the engine.
  const plain = await $.ui.mount({ plugin: 'code-reference', surface: 'terminal', component: 'AssistantMessage', props: { text: 'Plain words about [a file](hooks/a.ts:1).', isFirstOfReply: true }, viewport: VIEW })
  expect(await plain.find({ type: 'Client' })).toBe(undefined)
})

test("the pane shows the first place: one header line, then the file around it, read from disk", async ($, on) => {
  const w = world(on)
  await start($, w)
  await answer($, w, REPLY)
  const drawn: Record<string, string> = {}
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: 'code-reference', surface, component: 'Pane', requestId: 'code-reference', props: PANE_PROPS, viewport: VIEW })
    expect(await pane.find({ type: 'Text', text: 'register.tsx', in: 'pane' })).toBeTruthy()
    expect(await pane.find({ type: 'Text', text: 'local', in: 'pane' })).toBeTruthy()
    expect(await pane.find({ type: 'Text', text: 'line 792', in: 'pane' })).toBeTruthy()
    expect(await pane.find({ type: 'Text', text: '▌', in: 'pane' })).toBeTruthy()
    drawn[surface] = JSON.stringify(await pane.drawn({ in: 'pane' }))
    await pane.unmount()
  }
  expect(drawn.terminal).toBe(drawn.desktop)
  expect(w.argv.some(a => a.join(' ').startsWith('git -C /work diff --no-color --no-ext-diff -U100000 HEAD -- hooks/register.tsx'))).toBe(true)
})

test('a click on a box shows that place; d and a step through every place in order', async ($, on) => {
  const w = world(on)
  await start($, w)
  await answer($, w, REPLY)
  const msg = await $.ui.mount({ plugin: 'code-reference', surface: 'terminal', component: 'AssistantMessage', props: { text: REPLY, isFirstOfReply: true }, viewport: VIEW })
  const pane = await $.ui.mount({ plugin: 'code-reference', surface: 'terminal', component: 'Pane', requestId: 'code-reference', props: PANE_PROPS, viewport: VIEW })
  const at = boxAt(REPLY, 'review.ts:42-54', 1)
  await msg.pointer({ type: 'down', x: at.x, y: at.y, button: 'left', in: 'reply' })
  await w.clock.settle()
  expect(await pane.find({ type: 'Text', text: 'review.ts', in: 'pane' })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: 'line 42', in: 'pane' })).toBeTruthy()
  await msg.key({ key: 'd', in: 'reply' })
  await w.clock.settle()
  expect(await pane.find({ type: 'Text', text: 'line 383', in: 'pane' })).toBeTruthy()
  await msg.key({ key: 'd', in: 'reply' })
  await w.clock.settle()
  expect(await pane.find({ type: 'Text', text: 'line 792', in: 'pane' })).toBeTruthy() // round to the first
})

/** Closes the pane as another plugin (or the person) would. */
const closer = {
  name: 'closer',
  register: ((on: On) => {
    on('session.start', async ($, e, next) => {
      const started = await next(e)
      await $.command.register({ name: 'close-pane', description: 'close the code pane' })
      return started
    })
    on('command.run', { command: 'close-pane' }, async $ => {
      await $.ui.close({ id: 'code-reference' })
      return { text: 'closed' }
    })
  }) as Register,
}

test('with the pane closed, the code shows under its section', { plugins: [closer] }, async ($, on) => {
  const w = world(on)
  await start($, w)
  await answer($, w, REPLY)
  await $.command.run(RUN('close-pane'))
  await w.clock.settle()
  const msg = await $.ui.mount({ plugin: 'code-reference', surface: 'desktop', component: 'AssistantMessage', props: { text: REPLY, isFirstOfReply: true }, viewport: VIEW })
  expect(await msg.find({ type: 'Text', text: 'open in pane', in: 'reply' })).toBeTruthy()
  expect(await msg.find({ type: 'Text', text: 'line 792', in: 'reply' })).toBeTruthy()
  await msg.post({ key: textKey(REPLY.trim()), act: 'pane' }, { in: 'reply' })
  await w.clock.settle()
  expect(w.opens).toEqual(['code-reference', 'code-reference'])
  expect(await msg.find({ type: 'Text', text: 'open in pane', in: 'reply' })).toBe(undefined)
})

test('prompts: /code-reference <question> sends the question with the format; "use /code-reference" adds it in passing', async ($, on) => {
  const w = world(on)
  await start($, w)
  await $.prompt.submit(TYPED('/code-reference how does the band work'))
  expect(w.submits.at(-1)).toBe('how does the band work')
  expect(w.contexts.at(-1)?.join('\n')).toContain('`**Code reference:** /work`')
  await $.prompt.submit(TYPED('explain how x works with y and use /code-reference'))
  expect(w.submits.at(-1)).toBe('explain how x works with y and use /code-reference')
  expect(w.contexts.at(-1)?.join('\n')).toContain('Link every place in the code')
  await $.prompt.submit(TYPED('what is in this repo?'))
  expect(w.contexts.at(-1)).toBe(undefined)
})

test('/code-reference alone draws the last reply in place when it names files, else asks for it again with links', async ($, on) => {
  const w = world(on)
  await start($, w)
  const said = 'The band is drawn by [the render hook](hooks/register.tsx:792-811).'
  // The turn's answer, then a closing line with no files: the answer is the one drawn.
  w.messages = [{ role: 'user', text: 'how is the band drawn?', toolUses: [] }, { role: 'assistant', text: said, toolUses: [] }, { role: 'assistant', text: 'Done.', toolUses: [] }]
  const done = await $.command.run(RUN('code-reference'))
  expect('text' in done ? done.text : '').toBe('The code for the last reply: 1 place.')
  await w.clock.settle()
  const msg = await $.ui.mount({ plugin: 'code-reference', surface: 'terminal', component: 'AssistantMessage', props: { text: said, isFirstOfReply: true }, viewport: VIEW })
  expect(await msg.find({ type: 'Client', key: 'reply' })).toBeTruthy()
  // An older turn named files; the last one did not: it is asked for again.
  w.messages = [{ role: 'assistant', text: said, toolUses: [] }, { role: 'user', text: 'and the pane?', toolUses: [] }, { role: 'assistant', text: 'The band sits above the prompt.', toolUses: [] }]
  await $.command.run(RUN('code-reference'))
  await w.clock.settle()
  expect(w.submits.at(-1)).toContain('Say your last reply again in the code-reference format')
  expect(w.submits.at(-1)).toContain('**Code reference:** /work')
})

test('a review: the PR is checked out into a worktree and its code shows with the changes marked', async ($, on) => {
  const w = world(on)
  await start($, w)
  await $.prompt.submit(TYPED(`review ${PR_URL}`))
  expect(w.contexts.at(-1)?.join('\n')).toContain(`\`**Code reference:** ${PR_URL}\``)
  expect(w.contexts.at(-1)?.join('\n')).toContain(WT)
  await answer($, w, REVIEW)
  const pane = await $.ui.mount({ plugin: 'code-reference', surface: 'desktop', component: 'Pane', requestId: 'code-reference', props: PANE_PROPS, viewport: VIEW })
  expect(await pane.find({ type: 'Text', text: 'changed in the PR', in: 'pane' })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: '+ ', in: 'pane' })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: 'github', in: 'pane' })).toBeTruthy()
})

test('without gh, the PR is read through a GitHub MCP server', async ($, on) => {
  const w = world(on)
  w.hasGh = false
  w.mcpTools = ['get_pull_request', 'get_file_contents']
  await start($, w)
  await $.prompt.submit(TYPED(`review ${PR_URL}`))
  expect(w.mcp).toEqual(['mcp__github__get_pull_request'])
  expect(w.contexts.at(-1)?.join('\n')).toContain(WT)
  // The clone the worktree hangs off is the session's own, so no clone is made; nothing ran gh after it was found missing.
  expect(w.argv.filter(a => a[0] === 'gh' && a[1] === 'pr')).toHaveLength(1)
})

/** A stand-in for terminal-browser whose pages never load. */
const brokenBrowser = {
  name: 'terminal-browser',
  register: ((on: On) => {
    on('engine.create' as never, (async ($: unknown, e: unknown, next: (e: unknown) => Promise<Record<string, unknown>>) => {
      const built = await next(e)
      const served = () => {
        throw new Error('served by hooks')
      }
      return { ...built, browser: { open: served, close: served } }
    }) as never)
    on('browser.open' as never, (() => ({ value: { ok: false, error: 'timed out' } })) as never)
  }) as Register,
}

test("when terminal-browser can't load the PR page, the pane keeps the code and says so, with retry", { plugins: [brokenBrowser] }, async ($, on) => {
  const w = world(on, { TERM_PROGRAM: 'ghostty', TERM: 'xterm-ghostty', HOME }, ['browser'])
  await start($, w)
  await $.prompt.submit(TYPED(`review ${PR_URL}`))
  await answer($, w, REVIEW)
  const pane = await $.ui.mount({ plugin: 'code-reference', surface: 'terminal', component: 'Pane', requestId: 'code-reference', props: PANE_PROPS, viewport: VIEW })
  await pane.post({ act: 'github' }, { in: 'pane' })
  await w.clock.settle()
  expect(await pane.find({ type: 'Text', text: "The PR page didn't load in terminal-browser.", in: 'pane' })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: 'retry', in: 'pane' })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: 'l42', in: 'pane' })).toBeTruthy()
})
