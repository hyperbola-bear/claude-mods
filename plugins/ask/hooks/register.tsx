/**
 * ask: a side chat in a pane that reads the main chat and answers with
 * pictures when they explain better.
 *
 * `/ask [question]` opens the pane (a tab once other panes are open) and asks;
 * `/draw <thing>` asks for a diagram; `/ask-rewind` (`r` in the pane) takes
 * back the newest question and answer. Claude Code ships `/rewind`, which
 * restores the main chat and code, so that name stays its own. In the pane,
 * Enter asks, and `d` turns draw mode on for every question. Each question
 * has a faint line under it, and every command sits in one bar at the bottom.
 * Docked beside the chat, the pane scrolls the answers itself, so the bar stays
 * put while the wheel, the arrows, PgUp and PgDn move them (layout.ts). The
 * newest question is brought to the top while its answer comes in, and once
 * it is sent the focus leaves the field for the question's ❯ mark (press it to
 * copy that answer); `s` and `c` act on the answer whose ❯ holds the focus,
 * else the newest. `i` goes back to the field.
 *
 * Context flows one way unless the person says otherwise:
 *   - main to pane: each question is a `$.model.fork` of the main chat's
 *     transcript, tools and all, so the pane knows everything said and done
 *     so far, served from the main chat's prompt cache;
 *   - pane to main: nothing, so the main chat's context does not grow with
 *     every side question. `s` appends that
 *     exchange as a user-role note the model reads, with a dim line in the
 *     transcript saying what was sent.
 *
 * Answers are markdown with ```mermaid blocks, drawn where the pane is: box
 * drawings sized to the terminal pane's columns, SVG in the desktop app (see
 * diagram.ts for which types are vector drawings there). The answer is told
 * the pane's width, and a table still wider than the pane (it was resized, or
 * the answer ran over) is drawn here with its cells wrapped to fit, or as a
 * list where the pane is too narrow for its columns. A terminal diagram
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
  rewoundNotice,
  segments,
  sendNote,
  sentNotice,
  transcriptText,
} from './answer.ts'
import type { PaneView } from './answer.ts'
import { diagramPage, drawAscii, drawSvg } from './diagram.ts'
import { PARKED, clampOffset, inView, markdownRows, scrolled, spacePerRow, svgRows, textColumns, textRows, wrappedRows } from './layout.ts'
import type { Metrics } from './layout.ts'
import { fittedTable, naturalWidth, tableAsList, tableParts } from './tables.ts'

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
// The newest exchange's id. Never reused: an answer still coming must not land on a newer question.
let lastId = 0
// The element holding the pane's focus ring, as the last `ui.focus` landed it.
let ring: string | undefined
// The ❯ the focus last landed on, the answer `s` and `c` act on; the field clears it. A bar button keeps it.
let picked: number | null = null
// Docked, the pane scrolls the answers itself: their first row in view, and how they laid out when last drawn.
let isPinned = false
let offset = 0
let metrics: Metrics = { total: 0, visible: 1, starts: new Map() }
// An exchange kept at the top until the person scrolls: the newest question, while its answer comes in.
let follow: number | null = null

/** Long enough for a state write's redraw to land. */
const FRAME_MS = 60

const fieldKey = () => `q${asked}`
const questionKey = (id: number) => `x${id}q`

const questionOf = (key: string | undefined): number | null => {
  const m = key === undefined ? null : /^x(\d+)q$/.exec(key)
  return m ? Number(m[1]) : null
}

/** The answer `s` and `c` act on: the one whose ❯ was picked, else the newest that `fits`. */
function chosen(xs: readonly Exchange[], fits: (x: Exchange) => boolean): Exchange | undefined {
  const onPick = xs.find(x => x.id === picked)
  return onPick && fits(onPick) ? onPick : xs.filter(fits).at(-1)
}
const isAnswered = (x: Exchange) => x.a !== null
const isSendable = (x: Exchange) => x.a !== null && x.kind !== 'error' && !x.sent

async function edit($: EngineInterface, id: number, change: Partial<Exchange>) {
  await update($, exchanges, xs => xs.map(x => (x.id === id ? { ...x, ...change } : x)))
}

async function open($: EngineInterface) {
  await $.ui.open({ id: PANE, title: 'ask', focus: true })
}

/**
 * Shows an exchange from its question down, and puts the focus on its ❯ so
 * the keys leave the field. Docked, the pane keeps it at the top until the
 * person scrolls; inline, the engine scrolls to it. Nothing when the pane is
 * not drawn.
 */
async function reveal($: EngineInterface, id: number) {
  follow = id
  $.ui.invalidate('ui.render')
  const moved = await $.ui.focus({ requestId: PANE, key: questionKey(id) }).catch(err => ({ deny: String(err) }))
  // The mod's own `ui.focus` hook is left out of its own call, so the move is noted here.
  if (!moved.deny) {
    ring = questionKey(id)
    picked = id
  }
  if (!isPinned) await $.ui.scroll({ in: PANE, to: { key: `x${id}` }, block: 'start' }).catch(() => undefined)
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
    lastId = Math.max(lastId, ...xs.map(one => one.id)) + 1
    made = { id: lastId, q, a: null, isDraw: draw, askedAt }
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
  // Inline, brought into view again once the answer's rows are laid out (the state write redraws on the next
  // frame), unless the person has moved on: typing the next question, reading another. Docked, `follow` holds it.
  if (!isPinned && ring === questionKey(x.id)) {
    await $.clock.sleep(FRAME_MS)
    await reveal($, x.id)
  }
}

/**
 * Takes back the newest exchange, answered or not: it leaves the pane and what later questions carry. An
 * answer still coming finds no exchange and is dropped. Says what it did.
 */
async function rewind($: EngineInterface): Promise<string> {
  const xs = await read($, exchanges)
  const x = xs.at(-1)
  if (!x) return 'Nothing to rewind'
  // The last exchange takes rewind and clear out of the bar with it.
  const isRingLeaving = xs.length === 1 || ring === questionKey(x.id)
  if (follow === x.id) follow = null
  if (picked === x.id) picked = null
  await update($, exchanges, all => all.filter(one => one.id !== x.id))
  // An element removed with the ring on it takes the focus out of the pane, so it comes back once the redraw lands.
  if (isRingLeaving) void $.clock.sleep(FRAME_MS).then(() => $.ui.focus({ requestId: PANE, key: fieldKey() })).catch(() => undefined)
  return rewoundNotice(x)
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
    await $.command.register({
      name: 'ask-rewind',
      description: 'Take back the newest question and answer in the ask pane, keeping the rest',
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

  on('command.run', { command: 'ask-rewind' }, async $ => ({ text: await rewind($) }))

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
    if (e.reason === 'clear') {
      offset = 0
      follow = null
      picked = null
      await update($, exchanges, () => [])
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const { Box, Text, Markdown, Button, Code } = el
    const xs = await read($, exchanges)
    const isDraw = await read($, drawMode)
    const width = Math.max(20, e.props.bodyColumns - 1)
    view = { surface: e.surface, columns: width }
    isPinned = e.props.placement === 'dock'
    const isTerminal = e.surface === 'terminal'
    const hasDiagram = xs.some(x => x.a !== null && diagramsOf(x.a).length > 0)
    const columns = textColumns(e.surface, width)

    // Each piece of an answer with the rows it takes, so the pane can scroll the answers itself.
    const unDrawn = (source: string, reason: string, i: string) => ({
      rows: source.split('\n').length + 3,
      node: (
        <Box key={`u${i}`} flexDirection="column" marginY={1} width={width}>
          <Code source={source} language="mermaid" />
          <Text dimColor>{`not drawn here (${reason}): o opens it full size`}</Text>
        </Box>
      ),
    })

    /** Prose, and its tables fitted to the pane: whole where they fit, their cells wrapped where not, else a list. */
    const prose = (text: string, i: string) =>
      tableParts(text).map((part, n) => {
        const key = `${i}-${n}`
        if (part.kind === 'markdown') return { rows: markdownRows(part.text, columns), node: <Markdown key={`m${key}`} text={part.text} /> }
        if (naturalWidth(part.rows) <= width) return { rows: part.rows.length + 3, node: <Markdown key={`m${key}`} text={part.source} /> }
        const drawn = fittedTable(part.rows, width)
        if (!drawn) {
          const list = tableAsList(part.rows)
          return {
            rows: markdownRows(list, columns) + 2,
            node: (
              <Box key={`l${key}`} flexDirection="column" marginY={1} width={width}>
                <Markdown text={list} />
              </Box>
            ),
          }
        }
        return {
          rows: drawn.header.length + drawn.body.length + 2,
          node: (
            <Box key={`t${key}`} flexDirection="column" marginY={1} width={width}>
              {drawn.header.map((line, y) => (
                <Text key={`t${key}h${y}`} bold={y > 0} wrap="truncate-end">
                  {line}
                </Text>
              ))}
              {drawn.body.map((line, y) => (
                <Text key={`t${key}b${y}`} wrap="truncate-end">
                  {line}
                </Text>
              ))}
            </Box>
          ),
        }
      })

    const picture = (source: string, i: string) => {
      if (e.surface !== 'terminal') {
        const { Svg } = $.ui.resolve(e)
        const drawn = drawSvg(source, width)
        if (drawn.kind === 'error') return unDrawn(source, drawn.reason, i)
        return {
          rows: svgRows(drawn.svg, width) + 2,
          node: (
            <Box key={`d${i}`} marginY={1} width={width}>
              <Svg source={drawn.svg} alt={source} />
            </Box>
          ),
        }
      }
      const drawn = drawAscii(source, width)
      if (drawn.kind === 'error') return unDrawn(source, drawn.reason, i)
      return {
        rows: drawn.lines.length + (drawn.isClipped ? 1 : 0) + 2,
        node: (
          <Box key={`d${i}`} flexDirection="column" marginY={1} width={width}>
            {drawn.lines.map((line, n) => (
              <Text key={`l${i}-${n}`} color="claude" wrap="truncate-end">
                {line === '' ? ' ' : line}
              </Text>
            ))}
            {drawn.isClipped && <Text dimColor>{`${drawn.width} columns wide, cut at ${width}: o opens it full size`}</Text>}
          </Box>
        ),
      }
    }

    const pending = xs.filter(x => x.a === null).length
    const header =
      xs.length === 0
        ? 'Ask about this session. Answers come from a fork of the main chat, so they know everything so far, and nothing goes back to it unless you send it (s). Ask for a picture ("draw the request flow", or d for draw mode) and it is drawn here.'
        : `${xs.length} question${xs.length === 1 ? '' : 's'}${pending ? ` · ${pending} answering` : ''} · reads the main chat${isDraw ? ' · draw mode' : ''}`

    let at = textRows(header, columns)
    const starts = new Map<number, number>()
    const blocks = xs.map(x => {
      const answer =
        x.a === null
          ? [{ rows: 1, node: <Text key="wait" dimColor>{x.isDraw ? 'drawing…' : 'thinking…'}</Text> }]
          : segments(x.a).flatMap((seg, i) => (seg.kind === 'text' ? prose(seg.text, `${x.id}-${i}`) : [picture(seg.source, `${x.id}-${i}`)]))
      const question = `${x.q}${x.isDraw ? '  ✎' : ''}`
      starts.set(x.id, at)
      at += 1 + textRows(`❯ ${question}`, columns) + 1 + answer.reduce((sum, a) => sum + a.rows, 0) + (x.a === null ? 0 : textRows(footer(x), columns))
      return (
        <Box key={`x${x.id}`} flexDirection="column" marginTop={1} width={width} flexShrink={0}>
          <Box flexDirection="row" gap={1} width={width}>
            <Button key={questionKey(x.id)} plain label="❯" onPress={() => undefined} />
            <Text bold wrap="wrap">
              {question}
            </Text>
          </Box>
          <Text dimColor wrap="truncate">
            {'─'.repeat(width)}
          </Text>
          {answer.map(a => a.node)}
          {x.a !== null && (
            <Text dimColor wrap="wrap">
              {footer(x)}
            </Text>
          )}
        </Box>
      )
    })

    const commands = [
      { key: 'ask', hotkey: 'i', label: 'ask', isShown: true },
      { key: 'draw', hotkey: 'd', label: isDraw ? 'draw: on' : 'draw: off', isShown: true },
      { key: 'send', hotkey: 's', label: 'send to chat', isShown: chosen(xs, isSendable) !== undefined },
      { key: 'copy', hotkey: 'c', label: 'copy', isShown: xs.some(isAnswered) },
      { key: 'open', hotkey: 'o', label: 'open full size', isShown: hasDiagram },
      { key: 'rewind', hotkey: 'r', label: 'rewind', isShown: xs.length > 0 },
      { key: 'clear', hotkey: 'x', label: 'clear', isShown: xs.length > 0 },
    ].filter(c => c.isShown)
    const hint = isTerminal ? '↑↓ scroll · Esc back to the chat' : null
    const hasField = 'Input' in el
    const barRows =
      (isPinned ? 1 : 0) + (hasField ? (isTerminal ? 1 : 2) : 0) + wrappedRows([...commands.map(c => c.label.length + 4), ...(hint ? [hint.length] : [])], width, 2)

    const bar = (
      <Box key="bar" flexDirection="column" flexShrink={0} marginTop={isPinned ? 0 : 1} width={width}>
        {isPinned && (
          <Text dimColor wrap="truncate">
            {'═'.repeat(width)}
          </Text>
        )}
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
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} width={width}>
          {commands.map(c => (
            <Button key={c.key} plain hotkey={c.hotkey} label={c.label} onPress={() => undefined} />
          ))}
          {hint && <Text dimColor>{hint}</Text>}
        </Box>
      </Box>
    )

    const answers = (
      <Box key="answers" flexDirection="column" flexShrink={0} width={width}>
        <Text dimColor wrap="wrap">
          {header}
        </Text>
        {blocks}
      </Box>
    )

    if (!isPinned) {
      return (
        <Box flexDirection="column" width={width}>
          {answers}
          {bar}
        </Box>
      )
    }

    // Docked: exactly the body's rows, the answers moved under a window of their own and the bar below them.
    // The surface's window sits on `parked`, a spare row above and below so it has room to report a move either way.
    const bodyRows = e.props.scroll.bodyRows
    const parked = e.props.scroll.offset
    metrics = { total: at, visible: Math.max(1, bodyRows - barRows), starts }
    const held = follow === null ? undefined : starts.get(follow)
    offset = held === undefined ? clampOffset(offset, metrics) : clampOffset(held, metrics)
    return (
      <Box flexDirection="column" height={parked + bodyRows + 1} width={width}>
        {parked > 0 && <Box key="above" height={parked} flexShrink={0} />}
        <Box key="body" flexDirection="column" height={bodyRows} flexShrink={0} width={width}>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden" width={width}>
            <Box key="window" flexDirection="column" marginTop={-offset * spacePerRow(e.surface)} flexShrink={0} width={width}>
              {answers}
            </Box>
          </Box>
          {bar}
        </Box>
        <Box key="below" height={1} flexShrink={0} />
      </Box>
    )
  })

  // Docked, the person's scroll moves the answers rather than the window, which goes back to its parked row.
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    if (!isPinned || e.origin.kind !== 'person') return next(e)
    const to = scrolled(offset, e.by, e, metrics)
    follow = null
    if (to !== offset) {
      offset = to
      $.ui.invalidate('ui.render')
    }
    return next({ ...e, offset: PARKED })
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
    const id = questionOf(e.element)
    if (id !== null) {
      picked = id
      // Docked, a ❯ the person moves to is brought into view, as the engine would for a window it scrolls.
      const to = inView(offset, metrics.starts.get(id), metrics)
      if (isPinned && to !== offset) {
        offset = to
        follow = null
        $.ui.invalidate('ui.render')
      }
    } else if (e.element?.startsWith('q')) picked = null
    return next(e)
  })

  on('ui.press', { plugin: 'ask' }, async ($, e, next) => {
    const pressed = questionOf(e.element)
    if (pressed !== null) {
      const x = (await read($, exchanges)).find(one => one.id === pressed)
      picked = pressed
      if (x?.a) {
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
        const x = chosen(await read($, exchanges), isSendable)
        if (x) await send($, x)
        break
      }
      case 'copy': {
        const x = chosen(await read($, exchanges), isAnswered)
        if (x?.a) {
          const r = await $.ui.copy({ text: x.a, surface: e.surface })
          $.ui.toast(r.isCopied ? 'Copied the answer' : `Not copied: ${r.reason}`)
        }
        break
      }
      case 'open':
        await openDiagrams($)
        break
      case 'rewind':
        $.ui.toast(await rewind($))
        break
      case 'clear':
        offset = 0
        follow = null
        picked = null
        await update($, exchanges, () => [])
        break
      default:
        return next(e)
    }
    return { element: e.element }
  })
}
