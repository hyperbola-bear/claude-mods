import { expect, test } from 'claude-code/testing'

import { asksForPicture, footer, forkPrompt, segments, sendNote, sentNotice, transcriptText } from '../hooks/answer.ts'
import { boxArtSvg } from '../hooks/boxart.ts'
import { diagramPage, drawAscii, drawSvg } from '../hooks/diagram.ts'
import type { Exchange } from '../types'

const FLOW_LR = [
  'flowchart LR',
  '  A[Prompt typed] --> B{Cache warm?}',
  '  B -- yes --> C[Read the prefix]',
  '  B -- no --> D[Write the prefix]',
  '  C --> E[Answer streams]',
  '  D --> E',
].join('\n')

const SEQUENCE = ['sequenceDiagram', '  You->>Pane: question', '  Pane->>Main: fork', '  Main-->>Pane: answer'].join('\n')

const ANSWER = ['It forks the main chat:', '', '```mermaid', SEQUENCE, '```', '', 'Then the answer stays in the pane.'].join('\n')

const ex = (over: Partial<Exchange>): Exchange => ({ id: 1, q: 'q', a: 'a', isDraw: false, askedAt: 0, ...over })

test('an answer splits into its text and its mermaid diagrams, in order', async () => {
  expect(segments(ANSWER)).toEqual([
    { kind: 'text', text: 'It forks the main chat:' },
    { kind: 'diagram', source: SEQUENCE },
    { kind: 'text', text: 'Then the answer stays in the pane.' },
  ])
  expect(segments('no pictures here')).toEqual([{ kind: 'text', text: 'no pictures here' }])
  expect(segments('```ts\nconst a = 1\n```')).toEqual([{ kind: 'text', text: '```ts\nconst a = 1\n```' }])
})

test("the fork prompt sizes diagrams to the pane, asks for a picture in draw mode, and carries the pane's own earlier questions", async () => {
  const earlier = [ex({ q: 'what changed?', a: 'two files' }), ex({ id: 2, q: 'broken', a: '(no answer)', kind: 'error' })]
  const terminal = forkPrompt('how does auth work?', false, { surface: 'terminal', columns: 58 }, earlier)
  expect(terminal).toContain('58 columns wide')
  expect(terminal).toContain('```mermaid')
  expect(terminal).toContain('Earlier questions in this pane, which the main chat does not have:')
  expect(terminal).toContain('Q: what changed?\nA: two files')
  expect(terminal).not.toContain('broken')
  expect(terminal.endsWith('Side question: how does auth work?')).toBe(true)
  expect(terminal).not.toContain('asked for a picture')

  const desktop = forkPrompt('the flow', true, { surface: 'desktop', columns: 90 }, [])
  expect(desktop).toContain('SVG picture')
  expect(desktop).toContain('asked for a picture')
  expect(desktop).not.toContain('Earlier questions')
})

test('an exchange the person sends reaches the main chat as shared context, and the transcript says what was sent', async () => {
  const note = sendNote({ q: 'draw the cache flow', a: ANSWER })
  expect(note.startsWith('[ask pane]')).toBe(true)
  expect(note).toContain('context they chose to share, not a request to act on')
  expect(note).toContain('Question: draw the cache flow')
  expect(note).toContain(SEQUENCE)
  expect(sentNotice({ q: 'draw the cache flow' })).toBe('sent "draw the cache flow" and its answer to the chat as context')
  expect(sentNotice({ q: 'x'.repeat(100) })).toContain(`"${'x'.repeat(79)}…"`)
})

test('the footer says where an answer came from, and whether it was sent to the chat', async () => {
  expect(footer(ex({ kind: 'fork', ms: 1840, note: 'read 900' }))).toBe('fork · 1.8 s · read 900')
  expect(footer(ex({ kind: 'fork', ms: 500, sent: 'sent' }))).toBe('fork · 0.5 s · sent to the chat')
  expect(footer(ex({ kind: 'live', ms: 100, sent: 'seen' }))).toBe('live · 0.1 s · sent to the chat')
  expect(footer(ex({ kind: 'error' }))).toBe('error')
})

test('draw, diagram, sketch and visualize ask for a picture', async () => {
  expect(asksForPicture('Draw the request flow')).toBe(true)
  expect(asksForPicture('  diagram the states')).toBe(true)
  expect(asksForPicture('visualise the cache')).toBe(true)
  expect(asksForPicture('what did it draw from?')).toBe(false)
})

test('the live transcript keeps the newest text when it is long', async () => {
  const long = transcriptText([{ role: 'user', text: 'x'.repeat(70000) }, { role: 'assistant', text: 'the end' }])
  expect(long.length).toBe(60001)
  expect(long.endsWith('ASSISTANT: the end')).toBe(true)
  expect(transcriptText([{ role: 'user', text: '  ' }])).toBe('')
})

test('a sideways flowchart too wide for the pane is turned top-down to fit', async () => {
  const wide = drawAscii(FLOW_LR, 200)
  const narrow = drawAscii(FLOW_LR, 40)
  if (wide.kind !== 'lines' || narrow.kind !== 'lines') throw new Error('not drawn')
  expect(wide.isClipped).toBe(false)
  expect(wide.width).toBeGreaterThan(40)
  expect(narrow.isClipped).toBe(false)
  expect(narrow.width).toBeLessThanOrEqual(40)
  expect(narrow.lines.join('\n')).toContain('Cache warm?')
  expect(narrow.lines.some(l => l.includes('▼'))).toBe(true)
})

test('a diagram that cannot fit comes back whole and marked clipped; an unknown type is an error', async () => {
  const tiny = drawAscii(FLOW_LR, 10)
  expect(tiny.kind === 'lines' && tiny.isClipped).toBe(true)
  const pie = drawAscii('pie title Pets\n  "Dogs": 3', 60)
  expect(pie.kind).toBe('error')
})

test("on the desktop a sequence diagram is beautiful-mermaid's own drawing and a flowchart its box drawing redrawn as strokes", async () => {
  const seq = drawSvg(SEQUENCE)
  expect(seq.kind === 'svg' && seq.from).toBe('layout')
  const flow = drawSvg(FLOW_LR)
  if (flow.kind !== 'svg') throw new Error('not drawn')
  expect(flow.from).toBe('grid')
  expect(flow.svg).toContain('>Cache warm?</text>')
  expect(flow.svg).not.toMatch(/[─│┌┐└┘├┤┬┴┼◇►▼]/)
  expect(flow.svg).toContain('prefers-color-scheme: dark')
  for (const drawn of [seq, flow]) {
    if (drawn.kind === 'svg') {
      expect(drawn.svg.startsWith('<svg')).toBe(true)
      expect(drawn.svg).not.toContain('@import')
      expect(drawn.svg.length).toBeLessThan(131072)
    }
  }
})

test('box art becomes strokes from each cell center to the edges it joins, with arrowheads and words on the grid', async () => {
  // ┌──┐ over │ok├─►│: the arrow's head reaches the border in the next cell.
  const svg = boxArtSvg(['┌──┐', '│ok├─►│', '└──┘', '<&>'], '')
  // ┌ at row 0, col 0: center (16.2, 21), right edge 20.4, bottom edge 30.
  expect(svg).toContain('M16.2 21L20.4 21')
  expect(svg).toContain('M16.2 21L16.2 30')
  // ► at col 5 (center 58.2, row 1 center 39), pointing at │ in col 6: tip at its center, 66.6.
  expect(svg).toContain('<path class="h" d="M66.6 39L60.6 42.2L60.6 35.8Z"/>')
  expect(svg).toContain('>ok</text>')
  expect(svg).toContain('>&lt;&amp;&gt;</text>')
  expect(svg).not.toMatch(/[─│┌┐└┘├►]/)
})

test('an edge label written over its line reads as words on a patch of background', async () => {
  const svg = boxArtSvg(['├──answered─while─idle──►│'], '')
  expect(svg).toContain('>answered while idle</text>')
  expect(svg).toContain('<rect class="under"')
})

test('rounded corners curve, dashes dash, decision corners and state dots get their marks', async () => {
  const svg = boxArtSvg(['╭─◇', '╎ ●'], '')
  expect(svg).toMatch(/M\d+(\.\d)? \d+(\.\d)?Q16\.2 21 /)
  expect(svg).toContain('<path class="d" d="M16.2 39L16.2 30')
  expect(svg).toContain('<path class="mark"')
  expect(svg).toContain('<circle class="dot"')
})

test('the full-size page draws every diagram with Mermaid in the browser', async () => {
  const page = diagramPage('cache <flow>', [SEQUENCE, 'pie title X\n "a": 1'])
  expect(page).toContain('<title>ask: cache &lt;flow&gt;</title>')
  expect(page.match(/<pre class="mermaid">/g)?.length).toBe(2)
  expect(page).toContain('mermaid@11.4.1')
  expect(page).toContain('Main--&gt;&gt;Pane')
})
