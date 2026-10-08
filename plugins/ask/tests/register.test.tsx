import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const

const PANE = (bodyColumns = 60) => ({
  title: 'ask',
  isFocused: true,
  bodyColumns,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
})

const USAGE = { input_tokens: 30, output_tokens: 210, cache_read_input_tokens: 72_000, cache_creation_input_tokens: 12 }

const FLOW = ['flowchart LR', '  P[ask pane] --> F{first turn done?}', '  F -- yes --> K[fork the main chat]', '  F -- no --> L[live completion]'].join('\n')

const DRAWN = ['The pane forks the main chat:', '', '```mermaid', FLOW, '```', '', 'The answer stays in the pane.'].join('\n')

type World = {
  forks: string[]
  completes: { model: string; prompt: string }[]
  /** What the next forks answer, in turn; then `fork`. */
  replies: object[]
  fork: object
  complete: object
  opens: string[]
  toasts: string[]
  logs: string[]
  argv: string[][]
  writes: { path: string; text: string }[]
  clock: ReturnType<typeof mock.clock>
  session: ReturnType<typeof mock.session>
}

function world(on: On): World {
  const w: World = {
    forks: [],
    completes: [],
    replies: [],
    fork: { isAnswered: true, text: DRAWN, usage: USAGE },
    complete: { isAnswered: true, text: 'live answer', usage: USAGE },
    opens: [],
    toasts: [],
    logs: [],
    argv: [],
    writes: [],
    clock: mock.clock(on, { now: Date.parse('2026-10-08T09:00:00Z') }),
    session: mock.session(on),
  }
  mock.env(on, { HOME: '/home/p' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('model.fork', ($, e) => {
    w.forks.push(e.prompt)
    return { value: (w.replies.shift() ?? w.fork) as never }
  })
  on('model.complete', ($, e) => {
    w.completes.push({ model: e.model, prompt: e.prompt })
    return { value: w.complete as never }
  })
  on('session.messages', () => ({ value: [{ role: 'user' as const, text: 'hello', toolUses: [] }] }))
  on('ui.open', ($, e) => {
    w.opens.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.scroll', () => ({}))
  on('ui.focus', () => ({}))
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    w.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  on('fs.write', ($, e) => {
    w.writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    w.argv.push([...e.argv])
    const stdout = e.argv[0] === 'uname' ? 'Darwin\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return w
}

const start = async ($: Engine, w: World) => {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await w.clock.settle()
}

const askCmd = async ($: Engine, w: World, args: string, command = 'ask') => {
  await $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  await w.clock.settle()
}

/** What the main chat's model was given from the pane. */
const shared = (w: World) =>
  w.session
    .appended()
    .map(row => row.message.content.map(b => ('text' in b ? b.text : '')).join(''))
    .filter(text => text.startsWith('[ask pane]'))

const turn = async ($: Engine, w: World, id: string) => {
  await $.turn.start({ text: 'keep going', turnId: id })
  return async () => {
    await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: id, reason: 'answer' })
    await w.clock.settle()
  }
}

test('/ask opens the pane, forks the main chat and draws the answer with its diagram; nothing goes back to the main chat', async ($, on) => {
  const w = world(on)
  await start($, w)
  await askCmd($, w, 'how does the pane get its answers?')
  expect(w.opens).toEqual(['ask'])
  expect(w.forks).toHaveLength(1)
  expect(w.forks[0]).toContain('Side question: how does the pane get its answers?')
  expect(w.forks[0]).toContain('```mermaid')

  const pane = await $.ui.mount({ plugin: 'ask', surface: 'terminal', component: 'Pane', requestId: 'ask', props: PANE(60) })
  expect(await pane.find({ type: 'Text', text: 'how does the pane get its answers?' })).toBeTruthy()
  expect((await pane.find({ type: 'Button', key: 'x1q' }))?.text).toBe('❯')
  expect((await pane.find({ type: 'Markdown', key: 'm1-0' }))?.text).toBe('The pane forks the main chat:')
  expect((await pane.find({ type: 'Markdown', key: 'm1-2' }))?.text).toBe('The answer stays in the pane.')
  // The LR flowchart is too wide for 59 columns, so it is drawn top-down.
  const lines = await pane.findAll({ type: 'Text', text: /[┌│└◇]/ })
  expect(lines.length).toBeGreaterThan(5)
  expect(lines.some(l => (l.text ?? '').includes('first turn done?'))).toBe(true)
  expect(lines.every(l => [...(l.text ?? '')].length <= 59)).toBe(true)
  expect(await pane.find({ type: 'Text', text: /^fork · \d+\.\d s · read 72000 · new 42 · out 210$/ })).toBeTruthy()
  expect(await pane.find({ type: 'Button', key: 'open' })).toBeTruthy()
  expect((await pane.find({ type: 'Button', key: 'x1s' }))?.text).toBe('→ send to chat')

  expect(w.session.appended()).toHaveLength(0)
})

test('s sends the newest answer to the main chat as context, once, with a line in the transcript', async ($, on) => {
  const w = world(on)
  await start($, w)
  await askCmd($, w, 'first question')
  await askCmd($, w, 'how does the pane get its answers?')
  const pane = await $.ui.mount({ plugin: 'ask', surface: 'terminal', component: 'Pane', requestId: 'ask', props: PANE(60) })
  await pane.press({ key: 'send' })
  expect(shared(w)).toHaveLength(1)
  expect(shared(w)[0]).toContain('context they chose to share')
  expect(shared(w)[0]).toContain('Question: how does the pane get its answers?')
  expect(shared(w)[0]).toContain(FLOW)
  expect(w.session.appended()).toHaveLength(1)
  expect(w.logs).toEqual(['sent "how does the pane get its answers?" and its answer to the chat as context'])
  expect(w.toasts.at(-1)).toBe('Sent to the chat: Claude reads it on its next step')
  expect(await pane.find({ type: 'Text', text: /· sent to the chat$/ })).toBeTruthy()
  expect(await pane.find({ type: 'Button', key: 'x2s' })).toBe(undefined)

  // The first answer's own button sends that one; after that there is nothing left to send.
  await pane.press({ key: 'x1s' })
  expect(shared(w)).toHaveLength(2)
  expect(shared(w)[1]).toContain('Question: first question')
  expect(await pane.find({ type: 'Button', key: 'send' })).toBe(undefined)
})

test('the desktop draws the diagram as an SVG picture that follows its theme', async ($, on) => {
  const w = world(on)
  await start($, w)
  await askCmd($, w, 'draw the flow')
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const pane = await $.ui.mount({ plugin: 'ask', surface, component: 'Pane', requestId: 'ask', props: PANE(90) })
    const svg = await pane.find({ type: 'Svg' })
    expect(svg).toBeTruthy()
    expect(String((svg?.props as { source?: string } | undefined)?.source)).toContain('prefers-color-scheme: dark')
    expect(await pane.find({ type: 'Text', text: /[┌│└]/ })).toBe(undefined)
    await pane.unmount()
  }
})

test('a question that starts "draw", /draw and draw mode all ask for a picture first', async ($, on) => {
  const w = world(on)
  await start($, w)
  await askCmd($, w, 'Draw the cache flow')
  await askCmd($, w, 'the states of a review', 'draw')
  await askCmd($, w, '', 'draw')
  expect(w.forks.every(p => p.includes('asked for a picture'))).toBe(true)
  expect(w.forks[2]).toContain('Side question: Draw what the main chat is working on right now.')

  const pane = await $.ui.mount({ plugin: 'ask', surface: 'terminal', component: 'Pane', requestId: 'ask', props: PANE() })
  await pane.press({ key: 'draw' })
  expect((await pane.find({ type: 'Button', key: 'draw' }))?.text).toContain('draw: on')
  await askCmd($, w, 'how is auth wired?')
  expect(w.forks[3]).toContain('asked for a picture')
})

test('the pane carries its own earlier questions into each fork, until a sent one is in a finished main turn', async ($, on) => {
  const w = world(on)
  await start($, w)
  await askCmd($, w, 'what is it doing?')
  await askCmd($, w, 'and after that?')
  expect(w.forks[1]).toContain('Q: what is it doing?')

  // Turns come and go: an exchange that stayed in the pane is still carried.
  const end = await turn($, w, 't1')
  await end()
  await askCmd($, w, 'third')
  expect(w.forks[2]).toContain('Q: what is it doing?')

  // Sent mid-turn, it may miss that turn's requests: still carried after it.
  const pane = await $.ui.mount({ plugin: 'ask', surface: 'terminal', component: 'Pane', requestId: 'ask', props: PANE() })
  const end2 = await turn($, w, 't2')
  await pane.press({ key: 'x1s' })
  await end2()
  await askCmd($, w, 'fourth')
  expect(w.forks[3]).toContain('Q: what is it doing?')

  // A turn that began after it was sent holds it: the main chat has it now.
  const end3 = await turn($, w, 't3')
  await end3()
  await askCmd($, w, 'fifth')
  expect(w.forks[4]).not.toContain('Q: what is it doing?')
  expect(w.forks[4]).toContain('Q: and after that?')
})

test('before the first turn there is nothing to fork: a live completion over the transcript answers', async ($, on) => {
  const w = world(on)
  await start($, w)
  w.replies = [{ isAnswered: false, reason: 'nothing-to-fork', usage: USAGE }]
  await askCmd($, w, 'what is this repo?')
  expect(w.completes).toHaveLength(1)
  expect(w.completes[0]?.model).toBe('haiku')
  expect(w.completes[0]?.prompt).toContain('USER: hello')
  const pane = await $.ui.mount({ plugin: 'ask', surface: 'terminal', component: 'Pane', requestId: 'ask', props: PANE() })
  expect((await pane.find({ type: 'Markdown', key: 'm1-0' }))?.text).toBe('live answer')
  expect(await pane.find({ type: 'Text', text: /^live · .* chars of transcript, uncached$/ })).toBeTruthy()
})

test('a failed fork says why and offers nothing to send', async ($, on) => {
  const w = world(on)
  await start($, w)
  w.replies = [{ isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded_error', usage: USAGE }]
  await askCmd($, w, 'anything?')
  const pane = await $.ui.mount({ plugin: 'ask', surface: 'terminal', component: 'Pane', requestId: 'ask', props: PANE() })
  expect((await pane.find({ type: 'Markdown', key: 'm1-0' }))?.text).toBe('(no answer: api-error)')
  expect(await pane.find({ type: 'Button', key: 'x1s' })).toBe(undefined)
  expect(await pane.find({ type: 'Button', key: 'send' })).toBe(undefined)
  expect(w.session.appended()).toHaveLength(0)
})

test('Enter in the field asks, and the next question gets a fresh field', async ($, on) => {
  const w = world(on)
  await start($, w)
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: 'ask', surface, component: 'Pane', requestId: 'ask', props: PANE() })
    const field = await pane.find({ type: 'Input' })
    expect(field).toBeTruthy()
    await pane.input({ key: field?.key ?? '', text: `typed on ${surface}` })
    await w.clock.settle()
    expect(w.forks.at(-1)).toContain(`Side question: typed on ${surface}`)
    // A new field, empty, for the next question.
    const next = await pane.find({ type: 'Input' })
    expect(next?.key).not.toBe(field?.key)
    await pane.unmount()
  }
})

test('o opens the newest diagrams full size in the browser; copy and clear act on the answers', async ($, on) => {
  const w = world(on)
  await start($, w)
  await askCmd($, w, 'draw it')
  const pane = await $.ui.mount({ plugin: 'ask', surface: 'terminal', component: 'Pane', requestId: 'ask', props: PANE() })
  await pane.press({ key: 'open' })
  expect(w.writes).toHaveLength(1)
  expect(w.writes[0]?.path).toMatch(/^\/home\/p\/\.cache\/ask\/ask-\d+-1\.html$/)
  expect(w.writes[0]?.text).toContain('<pre class="mermaid">flowchart LR')
  expect(w.argv).toContainEqual(['open', w.writes[0]?.path ?? ''])

  await pane.press({ key: 'clear' })
  expect(await pane.find({ type: 'Text', text: /^Ask about this session/ })).toBeTruthy()
  expect(await pane.find({ type: 'Button', key: 'open' })).toBe(undefined)
})

test('/clear empties the pane', async ($, on) => {
  const w = world(on)
  await start($, w)
  await askCmd($, w, 'one')
  await $.session.end({ reason: 'clear', sessionId: 's', resume: undefined as never })
  const pane = await $.ui.mount({ plugin: 'ask', surface: 'terminal', component: 'Pane', requestId: 'ask', props: PANE() })
  expect(await pane.find({ type: 'Text', text: /^Ask about this session/ })).toBeTruthy()
})
