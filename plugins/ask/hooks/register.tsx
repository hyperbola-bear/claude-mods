/**
 * ask: a side chat in a pane that reads the main chat and answers with
 * pictures when they explain better.
 *
 * `/ask [question]` opens the pane (a tab once other panes are open) and asks;
 * `/draw <thing>` asks for a diagram. In the pane, Enter asks, `d` turns draw
 * mode on for every question, and the answers scroll: the newest one is
 * brought into view from its question down, and once a question is sent the
 * focus leaves the field for the question's ❯ mark (press it to copy that
 * answer), so the arrows, PgUp and PgDn (and the wheel) move through the
 * answers; `i` goes back to the field.
 *
 * Context flows one way unless the person says otherwise:
 *   - main to pane: each question is a `$.model.fork` of the main chat's
 *     transcript, tools and all, so the pane knows everything said and done
 *     so far, served from the main chat's prompt cache;
 *   - pane to main: nothing, so the main chat's context does not grow with
 *     every side question. `s` (or an answer's "send to chat") appends that
 *     exchange as a user-role note the model reads, with a dim line in the
 *     transcript saying what was sent.
 *
 * Answers are markdown with ```mermaid blocks, drawn where the pane is: box
 * drawings sized to the terminal pane's columns, SVG in the desktop app (see
 * diagram.ts for which types are vector drawings there). A terminal diagram
 * too wide for the pane is cut at its edge, and `o` opens the newest
 * answer's diagrams full size in the browser, drawn by Mermaid itself.
 *
 * Reaches: model.fork, model.complete (before the first turn), session.append,
 * session.messages, the pane, the clipboard, and for `o` fs.write and
 * process.run (mkdir, uname, open or xdg-open) under ~/.cache/ask.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Exchange } from '../types'
import {
  LIVE_SYSTEM,
  asksForPicture,
  diagramsOf,
  footer,
  forkPrompt,
  livePrompt,
  segments,
  sendNote,
  sentNotice,
  transcriptText,
} from './answer.ts'
import type { PaneView } from './answer.ts'
import { diagramPage, drawAscii, drawSvg } from './diagram.ts'

export const PANE = 'ask'
const exchanges = atom({ plugin: 'ask', key: 'exchanges' } as const, [] as Exchange[])
const drawMode = atom({ plugin: 'ask', key: 'isDraw' } as const, false)

export const DEFAULTS = { liveModel: 'haiku', keep: 30 } as const

let cfg: { liveModel: string; keep: number } = { ...DEFAULTS }
// Where the pane was last drawn, so the prompt can size diagrams to it.
let view: PaneView = { surface: 'terminal', columns: 60 }
// Exchanges sent before the running main turn began: its requests hold them.
let sentBeforeTurn: number[] = []
// Questions sent from the field: its key, so a new field starts empty.
let asked = 0
// The element holding the pane's focus ring, as the last `ui.focus` landed it.
let ring: string | undefined

/** Long enough for a state write's redraw to land. */
const FRAME_MS = 60

const fieldKey = () => `q${asked}`
const questionKey = (id: number) => `x${id}q`
const sendKey = (id: number) => `x${id}s`

async function edit($: EngineInterface, id: number, change: Partial<Exchange>) {
  await update($, exchanges, xs => xs.map(x => (x.id === id ? { ...x, ...change } : x)))
}

async function open($: EngineInterface) {
  await $.ui.open({ id: PANE, title: 'ask', focus: true })
}

/**
 * Shows an exchange from its question down. The terminal keeps the element
 * holding the focus in view, so the ring goes to the question's mark first:
 * left on the field or the buttons under the answers, it would hold the view
 * at the bottom. Nothing when the pane is not drawn.
 */
async function reveal($: EngineInterface, id: number) {
  const moved = await $.ui.focus({ requestId: PANE, key: questionKey(id) }).catch(err => ({ deny: String(err) }))
  // The mod's own `ui.focus` hook is left out of its own call, so the move is noted here.
  if (!moved.deny) ring = questionKey(id)
  await $.ui.scroll({ in: PANE, to: { key: `x${id}` }, block: 'start' }).catch(() => undefined)
}

/** Sends one exchange to the main chat, at the person's word: a note the model reads, and a notice they see. */
async function send($: EngineInterface, x: Exchange) {
  if (x.a === null || x.kind === 'error') return
  if (x.sent) {
    $.ui.toast('Already sent to the chat')
    return
  }
  const r = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: sendNote(x) }] } })
  if ('deny' in r && r.deny) {
    $.ui.toast(`Not sent: ${r.deny}`)
    return
  }
  // A dim line in the transcript, so the person sees what went in; the model never reads it.
  $.ui.log(sentNotice(x))
  await edit($, x.id, { sent: 'sent' })
  $.ui.toast('Sent to the chat: Claude reads it on its next step')
}

type Answer = { a: string; kind: NonNullable<Exchange['kind']>; note?: string }

async function answer($: EngineInterface, x: Exchange, earlier: Exchange[]): Promise<Answer> {
  const fork = await $.model.fork({ prompt: forkPrompt(x.q, x.isDraw, view, earlier) })
  if (fork.isAnswered) {
    const u = fork.usage
    const note = `read ${u.cache_read_input_tokens} · new ${u.input_tokens + u.cache_creation_input_tokens} · out ${u.output_tokens}`
    return { a: fork.text, kind: 'fork', note }
  }
  if (fork.reason !== 'nothing-to-fork') return { a: `(no answer: ${fork.reason})`, kind: 'error' }
  // Before the first turn there is no main chat to fork.
  const transcript = transcriptText(await $.session.messages())
  const live = await $.model.complete({
    model: cfg.liveModel,
    system: LIVE_SYSTEM,
    prompt: livePrompt(transcript, x.q, x.isDraw, view),
    maxTokens: 2000,
  })
  if (!live.isAnswered) return { a: `(no answer: ${live.reason})`, kind: 'error' }
  return { a: live.text, kind: 'live', note: `${transcript.length} chars of transcript, uncached` }
}

/** Runs past the hook that started it: the answer lands whenever the fork does. */
async function ask($: EngineInterface, question: string, isDraw: boolean) {
  const q = question.trim()
  if (q === '') return
  const askedAt = await $.clock.now()
  const draw = isDraw || (await read($, drawMode)) || asksForPicture(q)
  let made: Exchange | null = null
  let earlier: Exchange[] = []
  await update($, exchanges, xs => {
    earlier = xs.filter(one => one.a !== null && one.kind !== 'error' && one.sent !== 'seen').slice(-8)
    made = { id: Math.max(0, ...xs.map(one => one.id)) + 1, q, a: null, isDraw: draw, askedAt }
    return [...xs, made].slice(-cfg.keep)
  })
  const x = made as Exchange | null
  if (!x) return
  await reveal($, x.id)

  let got: Answer
  try {
    got = await answer($, x, earlier)
  } catch (err) {
    got = { a: `(no answer: ${err instanceof Error ? err.message : String(err)})`, kind: 'error' }
  }
  await edit($, x.id, { ...got, ms: (await $.clock.now()) - askedAt })
  // Brought into view again unless the person has moved on (typing the next question, reading another),
  // once the answer's rows are laid out: the state write redraws on the next frame.
  if (ring === questionKey(x.id)) {
    await $.clock.sleep(FRAME_MS)
    await reveal($, x.id)
  }
}

/** The newest answer's diagrams in the browser, full size, drawn by Mermaid itself. */
async function openDiagrams($: EngineInterface) {
  const last = (await read($, exchanges)).filter(x => x.a !== null && diagramsOf(x.a).length > 0).at(-1)
  if (!last?.a) return
  const home = (await $.env.get('HOME')) ?? '/tmp'
  const dir = `${home}/.cache/ask`
  const file = `${dir}/ask-${last.askedAt}-${last.id}.html`
  await $.process.run(['mkdir', '-p', dir])
  await $.fs.write(file, diagramPage(last.q, diagramsOf(last.a)))
  const uname = await $.process.run(['uname'])
  await $.process.run([uname.stdout.trim() === 'Darwin' ? 'open' : 'xdg-open', file])
  $.ui.toast(`Opened the diagrams: ${file}`)
}

export const register: Register = (on, options) => {
  cfg = {
    liveModel: typeof options.liveModel === 'string' && options.liveModel !== '' ? options.liveModel : DEFAULTS.liveModel,
    keep: typeof options.keep === 'number' && options.keep >= 1 ? Math.floor(options.keep) : DEFAULTS.keep,
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ask',
      description: 'Side chat in a pane that reads the main chat; answers can draw diagrams',
      argumentHint: '[question]',
      immediate: true,
    })
    await $.command.register({
      name: 'draw',
      description: 'Ask the ask pane for a diagram (flowchart, sequence, state, class, ER)',
      argumentHint: '<what to draw>',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'ask' }, async ($, e) => {
    await open($)
    void ask($, e.args, false)
    return {}
  })

  on('command.run', { command: 'draw' }, async ($, e) => {
    await open($)
    void ask($, e.args.trim() === '' ? 'Draw what the main chat is working on right now.' : e.args, true)
    return {}
  })

  // A sent exchange is in the main chat's requests from the next turn on; once
  // that turn ends a fork holds it, so the pane stops carrying it in its prompt.
  on('turn.start', async ($, e, next) => {
    sentBeforeTurn = (await read($, exchanges)).filter(x => x.sent === 'sent').map(x => x.id)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const held = sentBeforeTurn
    sentBeforeTurn = []
    if (held.length > 0) await update($, exchanges, all => all.map((x): Exchange => (held.includes(x.id) ? { ...x, sent: 'seen' } : x)))
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await update($, exchanges, () => [])
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const { Box, Text, Markdown, Button, Code } = el
    const xs = await read($, exchanges)
    const isDraw = await read($, drawMode)
    const width = Math.max(20, e.props.bodyColumns - 1)
    view = { surface: e.surface, columns: width }
    const isTerminal = e.surface === 'terminal'
    const hasDiagram = xs.some(x => x.a !== null && diagramsOf(x.a).length > 0)
    const canSend = xs.some(x => x.a !== null && x.kind !== 'error' && !x.sent)

    const unDrawn = (source: string, reason: string, i: string) => (
      <Box key={`u${i}`} flexDirection="column" marginY={1}>
        <Code source={source} language="mermaid" />
        <Text dimColor>{`not drawn here (${reason}): o opens it full size`}</Text>
      </Box>
    )

    const picture = (source: string, i: string) => {
      if (e.surface !== 'terminal') {
        const { Svg } = $.ui.resolve(e)
        const drawn = drawSvg(source, width)
        if (drawn.kind === 'error') return unDrawn(source, drawn.reason, i)
        return (
          <Box key={`d${i}`} marginY={1}>
            <Svg source={drawn.svg} alt={source} />
          </Box>
        )
      }
      const drawn = drawAscii(source, width)
      if (drawn.kind === 'error') return unDrawn(source, drawn.reason, i)
      return (
        <Box key={`d${i}`} flexDirection="column" marginY={1}>
          {drawn.lines.map((line, n) => (
            <Text key={`l${i}-${n}`} color="claude" wrap="truncate-end">
              {line === '' ? ' ' : line}
            </Text>
          ))}
          {drawn.isClipped && <Text dimColor>{`${drawn.width} columns wide, cut at ${width}: o opens it full size`}</Text>}
        </Box>
      )
    }

    const rows = xs.map(x => (
      <Box key={`x${x.id}`} flexDirection="column" marginTop={1} width={width}>
        <Box flexDirection="row" gap={1}>
          <Button key={questionKey(x.id)} plain label="❯" onPress={() => undefined} />
          <Text bold wrap="wrap">{`${x.q}${x.isDraw ? '  ✎' : ''}`}</Text>
        </Box>
        {x.a === null ? (
          <Text dimColor>{x.isDraw ? 'drawing…' : 'thinking…'}</Text>
        ) : (
          segments(x.a).map((seg, i) =>
            seg.kind === 'text' ? <Markdown key={`m${x.id}-${i}`} text={seg.text} /> : picture(seg.source, `${x.id}-${i}`),
          )
        )}
        {x.a !== null && (
          <Box flexDirection="row" gap={2} flexWrap="wrap">
            <Text dimColor>{footer(x)}</Text>
            {x.kind !== 'error' && !x.sent && <Button key={sendKey(x.id)} plain dimColor label="→ send to chat" onPress={() => undefined} />}
          </Box>
        )}
      </Box>
    ))

    const pending = xs.filter(x => x.a === null).length
    const header =
      xs.length === 0
        ? 'Ask about this session. Answers come from a fork of the main chat, so they know everything so far, and nothing goes back to it unless you send it (s). Ask for a picture ("draw the request flow", or d for draw mode) and it is drawn here.'
        : `${xs.length} question${xs.length === 1 ? '' : 's'}${pending ? ` · ${pending} answering` : ''} · reads the main chat${isDraw ? ' · draw mode' : ''}`

    return (
      <Box flexDirection="column" width={width}>
        <Text dimColor wrap="wrap">{header}</Text>
        {rows}
        <Box marginTop={1} flexDirection="column">
          {'Input' in el && (
            <el.Input
              key={fieldKey()}
              label="❯ "
              placeholder={isDraw ? 'what should it draw?' : 'ask about the session'}
              submitLabel={isDraw ? 'draw' : 'ask'}
              autoFocus
              onSubmit={() => undefined}
            />
          )}
          <Box flexDirection="row" gap={2}>
            <Button key="ask" plain hotkey="i" label="ask" onPress={() => undefined} />
            <Button key="draw" plain hotkey="d" label={isDraw ? 'draw: on' : 'draw: off'} onPress={() => undefined} />
            {canSend && <Button key="send" plain hotkey="s" label="send to chat" onPress={() => undefined} />}
            {xs.length > 0 && <Button key="copy" plain hotkey="c" label="copy" onPress={() => undefined} />}
            {hasDiagram && <Button key="open" plain hotkey="o" label="open full size" onPress={() => undefined} />}
            {xs.length > 0 && <Button key="clear" plain hotkey="x" label="clear" onPress={() => undefined} />}
          </Box>
          {isTerminal && <Text dimColor>↑↓ PgUp PgDn scroll · Esc back to the chat · ctrl+x tab comes back</Text>}
        </Box>
      </Box>
    )
  })

  // Answered here rather than in the elements' closures: a closure belongs to
  // one drawing, and a submit that lands during a redraw would find none.
  on('ui.input', { plugin: 'ask' }, async ($, e, next) => {
    if (e.kind !== 'submit' || !e.element.startsWith('q')) return next(e)
    if (e.value.trim() !== '') {
      asked += 1
      // The ring leaves the field for the question's mark, so the arrows and page keys scroll the answers.
      void ask($, e.value, false)
    }
    return { element: e.element, value: e.value }
  })

  // The person's moves (Tab, a click, i): where the ring is decides whether a new answer may take it.
  on('ui.focus', { requestId: PANE }, ($, e, next) => {
    ring = e.element
    return next(e)
  })

  on('ui.press', { plugin: 'ask' }, async ($, e, next) => {
    const pressed = /^x(\d+)([qs])$/.exec(e.element)
    if (pressed) {
      const x = (await read($, exchanges)).find(one => one.id === Number(pressed[1]))
      if (x && pressed[2] === 's') await send($, x)
      else if (x?.a) {
        const r = await $.ui.copy({ text: x.a, surface: e.surface })
        $.ui.toast(r.isCopied ? 'Copied the answer' : `Not copied: ${r.reason}`)
      }
      return { element: e.element }
    }
    switch (e.element) {
      case 'ask':
        await $.ui.focus({ requestId: PANE, key: fieldKey() })
        break
      case 'draw':
        await update($, drawMode, isOn => !isOn)
        await $.ui.focus({ requestId: PANE, key: fieldKey() })
        break
      case 'send': {
        // The newest answer: the one the person most likely just read.
        const last = (await read($, exchanges)).filter(x => x.a !== null && x.kind !== 'error').at(-1)
        if (last) await send($, last)
        break
      }
      case 'copy': {
        const last = (await read($, exchanges)).filter(x => x.a !== null).at(-1)
        if (last?.a) {
          const r = await $.ui.copy({ text: last.a, surface: e.surface })
          $.ui.toast(r.isCopied ? 'Copied the last answer' : `Not copied: ${r.reason}`)
        }
        break
      }
      case 'open':
        await openDiagrams($)
        break
      case 'clear':
        await update($, exchanges, () => [])
        break
      default:
        return next(e)
    }
    return { element: e.element }
  })
}
