import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const

const PANE = (bodyColumns = 60, placement: 'dock' | 'inline' = 'dock', bodyRows = 40) => ({
  title: 'ask',
  isFocused: true,
  bodyColumns,
  placement,
  scroll: { offset: 0, bodyRows },
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
  /** Holds the next fork's answer back until it resolves. */
  gate: Promise<void> | null
  complete: object
  opens: string[]
  toasts: string[]
  logs: string[]
  argv: string[][]
  writes: { path: string; text: string }[]
  /** Where each scroll left the surface's window. */
  windows: number[]
  clock: ReturnType<typeof mock.clock>
  session: ReturnType<typeof mock.session>
}

function world(on: On): World {
  const w: World = {
    forks: [],
    completes: [],
    replies: [],
    fork: { isAnswered: true, text: DRAWN, usage: USAGE },
    gate: null,
    complete: { isAnswered: true, text: 'live answer', usage: USAGE },
    opens: [],
    toasts: [],
    logs: [],
    argv: [],
    writes: [],
    windows: [],
    clock: mock.clock(on, { now: Date.parse('2026-10-08T09:00:00Z') }),
    session: mock.session(on),
  }
  mock.env(on, { HOME: '/home/p' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('model.fork', async ($, e) => {
    w.forks.push(e.prompt)
    const value = (w.replies.shift() ?? w.fork) as never
    const gate = w.gate
    w.gate = null
    await gate
    return { value }
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
  on('ui.scroll', ($, e) => {
    w.windows.push(e.offset)
    return {}
  })
  on('ui.focus', () => ({}))
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    w.logs.push(e.text)
    return { value: undefined }
  })
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
  expect((await pane.find({ type: 'Markdown', key: 'm1-0-0' }))?.text).toBe('The pane forks the main chat:')
  expect((await pane.find({ type: 'Markdown', key: 'm1-2-0' }))?.text).toBe('The answer stays in the pane.')
  // The LR flowchart is too wide for 59 columns, so it is drawn top-down.
  const lines = await pane.findAll({ type: 'Text', text: /[┌│└◇]/ })
  expect(lines.length).toBeGreaterThan(5)
  expect(lines.some(l => (l.text ?? '').includes('first turn done?'))).toBe(true)
  expect(lines.every(l => [...(l.text ?? '')].length <= 59)).toBe(true)
  expect(await pane.find({ type: 'Text', text: /^fork · \d+\.\d s · read 72000 · new 42 · out 210$/ })).toBeTruthy()
  expect(await pane.find({ type: 'Button', key: 'open' })).toBeTruthy()
  // A faint line sets the question apart from its answer; sending is the bar's, not the answer's.
  expect(await pane.find({ type: 'Text', text: '─'.repeat(59) })).toBeTruthy()
  expect(await pane.find({ type: 'Button', text: '→ send to chat' })).toBe(undefined)
  expect(await pane.find({ type: 'Button', key: 'send' })).toBeTruthy()

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

  // Picking the first answer's ❯ points s at it; after that there is nothing left to send.
  await pane.press({ key: 'x1q' })
  await pane.press({ key: 'send' })
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
  await pane.press({ key: 'x1q' })
  await pane.press({ key: 'send' })
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
  expect((await pane.find({ type: 'Markdown', key: 'm1-0-0' }))?.text).toBe('live answer')
  expect(await pane.find({ type: 'Text', text: /^live · .* chars of transcript, uncached$/ })).toBeTruthy()
})

test('a failed fork says why and offers nothing to send', async ($, on) => {
  const w = world(on)
  await start($, w)
  w.replies = [{ isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded_error', usage: USAGE }]
  await askCmd($, w, 'anything?')
  const pane = await $.ui.mount({ plugin: 'ask', surface: 'terminal', component: 'Pane', requestId: 'ask', props: PANE() })
  expect((await pane.find({ type: 'Markdown', key: 'm1-0-0' }))?.text).toBe('(no answer: api-error)')
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

const reply = (text: string) => ({ isAnswered: true, text, usage: USAGE })

test('r takes back the newest question and answer, and only that: the next fork no longer carries it', async ($, on) => {
  const w = world(on)
  await start($, w)
  await askCmd($, w, 'first question')
  await askCmd($, w, 'second question')
  const pane = await $.ui.mount({ plugin: 'ask', surface: 'terminal', component: 'Pane', requestId: 'ask', props: PANE(60) })
  expect((await pane.find({ type: 'Button', key: 'rewind' }))?.props.hotkey).toBe('r')

  await pane.press({ key: 'rewind' })
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: 'second question' })).toBe(undefined)
  expect(await pane.find({ type: 'Text', text: 'first question' })).toBeTruthy()
  expect(w.toasts.at(-1)).toBe('Took back "second question" and its answer')

  await askCmd($, w, 'third question')
  expect(w.forks.at(-1)).toContain('Q: first question')
  expect(w.forks.at(-1)).not.toContain('second question')
})

test('/ask-rewind steps back one exchange at a time, and says when nothing is left', async ($, on) => {
  const w = world(on)
  await start($, w)
  await askCmd($, w, 'first question')
  await askCmd($, w, 'second question')
  const rewind = () => $.command.run({ command: 'ask-rewind', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  expect((await rewind()).text).toBe('Took back "second question" and its answer')
  expect((await rewind()).text).toBe('Took back "first question" and its answer')
  expect((await rewind()).text).toBe('Nothing to rewind')
  const pane = await $.ui.mount({ plugin: 'ask', surface: 'terminal', component: 'Pane', requestId: 'ask', props: PANE(60) })
  expect(await pane.find({ type: 'Button', key: 'rewind' })).toBe(undefined)
})

test('an answer still coming when its question is taken back is dropped, and never lands on a newer question', async ($, on) => {
  const w = world(on)
  await start($, w)
  w.replies = [reply('the old answer'), reply('the new answer')]
  let release = () => {}
  w.gate = new Promise(done => {
    release = done
  })
  await askCmd($, w, 'taken back')
  const pane = await $.ui.mount({ plugin: 'ask', surface: 'terminal', component: 'Pane', requestId: 'ask', props: PANE(60) })
  await pane.press({ key: 'rewind' })
  await askCmd($, w, 'asked instead')
  release()
  await w.clock.settle()
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: 'taken back' })).toBe(undefined)
  expect(await pane.find({ type: 'Markdown', text: 'the new answer' })).toBeTruthy()
  expect(await pane.find({ type: 'Markdown', text: 'the old answer' })).toBe(undefined)
})

test('an exchange already sent leaves the pane, and the person is told the main chat keeps it', async ($, on) => {
  const w = world(on)
  await start($, w)
  await askCmd($, w, 'shared question')
  const pane = await $.ui.mount({ plugin: 'ask', surface: 'terminal', component: 'Pane', requestId: 'ask', props: PANE(60) })
  await pane.press({ key: 'send' })
  await pane.press({ key: 'rewind' })
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: 'shared question' })).toBe(undefined)
  expect(w.toasts.at(-1)).toBe('Took back "shared question" here; the main chat keeps it, as it was sent')
  expect(shared(w)).toHaveLength(1)
})

test('/clear empties the pane', async ($, on) => {
  const w = world(on)
  await start($, w)
  await askCmd($, w, 'one')
  await $.session.end({ reason: 'clear', sessionId: 's', resume: undefined as never })
  const pane = await $.ui.mount({ plugin: 'ask', surface: 'terminal', component: 'Pane', requestId: 'ask', props: PANE() })
  expect(await pane.find({ type: 'Text', text: /^Ask about this session/ })).toBeTruthy()
})

const WIDE_TABLE = [
  'Three countries so far:',
  '',
  '| Country | Host | Result | How we know |',
  '|---|---|---|---|',
  '| NO | `no.fd-api.com` | **Affected** | 1 of 6,000 UAT receipts obfuscated (jq0e-2644-fhww), plus 3 of 5,000 earlier |',
  '| AT | `mj.fd-api.com` | **Not affected** | support@foodora.at readable on all 20 recent AT receipts, no Cloudflare markup |',
].join('\n')

test('a table wider than the pane is drawn fitted to it on both surfaces, and as a list where too narrow; one that fits stays markdown', async ($, on) => {
  const w = world(on)
  w.fork = { isAnswered: true, text: WIDE_TABLE, usage: USAGE }
  await start($, w)
  await askCmd($, w, 'which countries?')
  const at = (surface: 'terminal' | 'desktop', columns: number) => $.ui.mount({ plugin: 'ask', surface, component: 'Pane', requestId: 'ask', props: PANE(columns) })
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await at(surface, 90)
    const lines = (await pane.findAll({ type: 'Text' })).map(t => String(t.text)).filter(t => /^[│┌├└]/.test(t))
    expect(lines.length, surface).toBeGreaterThan(6)
    for (const l of lines) expect(l.length, `${surface}: ${l}`).toBeLessThanOrEqual(89)
    expect(await pane.find({ type: 'Markdown', text: /\| Country \|/ })).toBe(undefined)
    await pane.unmount()
    const narrow = await at(surface, 50)
    expect(await narrow.find({ type: 'Markdown', text: /^\*\*NO\*\*\n- Host: `no\.fd-api\.com`/ })).toBeTruthy()
    await narrow.unmount()
    const wide = await at(surface, 160)
    expect(await wide.find({ type: 'Markdown', text: /^\| Country \|/ })).toBeTruthy()
    await wide.unmount()
  }
  // The next question is told the width the pane was last drawn at.
  await askCmd($, w, 'and TR?')
  expect(w.forks.at(-1)).toContain('Keep every table within 159 columns')
})

const LONG = Array.from({ length: 12 }, (_, i) => `Line ${i + 1} of a long answer.`).join('\n\n')

/** A person's scroll over the pane, as the surface sends it. */
const scrollBy = ($: Engine, by: number, bodyRows: number) =>
  $.ui.scroll({ component: 'Pane', requestId: 'ask', offset: 1, by, bodyRows, contentRows: bodyRows + 2, origin: { kind: 'person' } })

/** The answers' first row in view: the desktop spaces in half rows, so its margin is twice the rows. */
const windowTop = async (pane: { surface: string; find: (q: { type: string; key: string }) => Promise<{ props?: object } | undefined> }) =>
  -Number(((await pane.find({ type: 'Box', key: 'window' }))?.props as { marginTop?: number } | undefined)?.marginTop ?? NaN) /
  (pane.surface === 'terminal' ? 1 : 2)

test('docked, the pane is its body tall with the bar last, and a scroll moves the answers while the window goes back to its row', async ($, on) => {
  const w = world(on)
  w.fork = { isAnswered: true, text: LONG, usage: USAGE }
  await start($, w)
  for (const q of ['one', 'two', 'three']) await askCmd($, w, q)
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: 'ask', surface, component: 'Pane', requestId: 'ask', props: PANE(60, 'dock', 16) })
    const root = (await pane.drawn()) as { props?: { height?: number } }
    // A spare row below the body, so the surface has room to send a move down.
    expect(root.props?.height, surface).toBe(17)
    // The newest question is brought to the top while it is answered.
    const newest = await windowTop(pane)
    expect(newest, surface).toBeGreaterThan(20)

    // Home: the answers go to the top; the window is parked one row down, with room to move up next time.
    w.windows = []
    await scrollBy($, -100, 16)
    await w.clock.settle()
    expect(await windowTop(pane), surface).toBe(0)
    expect(w.windows, surface).toEqual([1])

    // The wheel moves a row a tick, a page key less than the body (the bar stays), and nothing goes past the end.
    await scrollBy($, 3, 16)
    expect(await windowTop(pane), surface).toBe(3)
    await scrollBy($, 16, 16)
    const paged = await windowTop(pane)
    expect(paged - 3, surface).toBeGreaterThan(3)
    expect(paged - 3, surface).toBeLessThan(16)
    await scrollBy($, 100, 16)
    const end = await windowTop(pane)
    await scrollBy($, 5, 16)
    expect(await windowTop(pane), surface).toBe(end)
    await pane.unmount()
  }
})

test('inline, the bar follows the answers and the engine scrolls the window', async ($, on) => {
  const w = world(on)
  await start($, w)
  await askCmd($, w, 'one')
  const pane = await $.ui.mount({ plugin: 'ask', surface: 'terminal', component: 'Pane', requestId: 'ask', props: PANE(60, 'inline', 16) })
  expect(((await pane.drawn()) as { props?: { height?: number } }).props?.height).toBe(undefined)
  expect(await pane.find({ type: 'Box', key: 'window' })).toBe(undefined)
  w.windows = []
  await $.ui.scroll({ component: 'Pane', requestId: 'ask', offset: 4, by: 3, bodyRows: 16, contentRows: 40, origin: { kind: 'person' } })
  expect(w.windows).toEqual([4])
})

test('s and c act on the answer whose ❯ was picked, else the newest; the field puts them back on the newest', async ($, on) => {
  const w = world(on)
  w.replies = [reply('first answer'), reply('second answer')]
  await start($, w)
  await askCmd($, w, 'first')
  await askCmd($, w, 'second')
  const pane = await $.ui.mount({ plugin: 'ask', surface: 'terminal', component: 'Pane', requestId: 'ask', props: PANE() })
  await pane.press({ key: 'x1q' })
  await pane.press({ key: 'send' })
  expect(shared(w)[0]).toContain('Question: first')
  await $.ui.focus({ component: 'Pane', requestId: 'ask', plugin: 'ask', element: 'q0', origin: { kind: 'person' } })
  await pane.press({ key: 'send' })
  expect(shared(w)[1]).toContain('Question: second')
})
