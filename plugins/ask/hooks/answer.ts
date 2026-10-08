/**
 * What the ask pane sends and reads: the side question's prompt, the note
 * the main chat gets when the person sends it an exchange, and an answer
 * split into the text it says and the diagrams it draws.
 */
import type { Exchange } from '../types'

export type Segment = { kind: 'text'; text: string } | { kind: 'diagram'; source: string }

/** Where the pane is drawn, as the last render saw it. */
export type PaneView = { surface: string; columns: number }

/** The mermaid headers the pane can draw; anything else shows as source. */
export const DRAWABLE = ['flowchart', 'graph', 'sequenceDiagram', 'stateDiagram-v2', 'stateDiagram', 'classDiagram', 'erDiagram', 'xychart-beta'] as const

const FENCE = /```mermaid[^\n]*\n([\s\S]*?)\n?```/g

/** The answer as text and diagrams, in order; blank text between them dropped. */
export function segments(answer: string): Segment[] {
  const out: Segment[] = []
  let at = 0
  for (const m of answer.matchAll(FENCE)) {
    const before = answer.slice(at, m.index).trim()
    if (before !== '') out.push({ kind: 'text', text: before })
    out.push({ kind: 'diagram', source: (m[1] ?? '').trim() })
    at = m.index + m[0].length
  }
  const rest = answer.slice(at).trim()
  if (rest !== '') out.push({ kind: 'text', text: rest })
  return out
}

export const diagramsOf = (answer: string): string[] =>
  segments(answer).flatMap(s => (s.kind === 'diagram' ? [s.source] : []))

function diagramRules(view: PaneView): string {
  const where =
    view.surface === 'terminal'
      ? `It is drawn in the pane as box-drawing characters ${view.columns} columns wide: prefer flowchart TD over LR, keep each label under 20 characters, and keep it to about 12 nodes.`
      : 'It is drawn in the pane as an SVG picture.'
  return [
    'Diagrams: when a picture explains something better than prose, or the person asks for one, include it as a fenced ```mermaid block.',
    where,
    `Use only these diagram types: ${DRAWABLE.join(', ')}. Other Mermaid types (pie, gantt, mindmap, journey, timeline) are not drawn. No styling directives (classDef, style, linkStyle).`,
  ].join(' ')
}

/**
 * The one user message a fork of the main chat answers. `earlier` is the
 * pane's own recent exchanges that the main chat does not hold (nothing goes
 * back to it unless the person sends it), so a follow-up question has them.
 */
export function forkPrompt(question: string, isDraw: boolean, view: PaneView, earlier: readonly Exchange[]): string {
  const history = earlier
    .filter(x => x.a !== null && x.kind !== 'error')
    .map(x => `Q: ${x.q}\nA: ${x.a}`)
    .join('\n\n')
  return [
    'This is a side question from the "ask" pane beside the main chat. Answer it from the conversation so far.',
    'Do not use tools, do not propose edits, and do not continue the main task. The pane scrolls, so answer fully, but lead with the answer itself.',
    diagramRules(view),
    isDraw ? 'The person asked for a picture: answer with a mermaid diagram first, then explain it in a few sentences.' : '',
    history === '' ? '' : `Earlier questions in this pane, which the main chat does not have:\n\n${history}`,
    `Side question: ${question}`,
  ]
    .filter(part => part !== '')
    .join('\n\n')
}

export const LIVE_SYSTEM =
  'You answer side questions about a Claude Code session from its transcript, in a pane beside it. No tools; do not continue the task.'

/** Before the first turn there is nothing to fork: a plain completion over the transcript's text instead. */
export function livePrompt(transcript: string, question: string, isDraw: boolean, view: PaneView): string {
  return [
    transcript === '' ? 'The session has no messages yet.' : `Transcript so far:\n\n${transcript}`,
    forkPrompt(question, isDraw, view, []),
  ].join('\n\n')
}

export const LIVE_TRANSCRIPT_CHARS = 60000

export function transcriptText(messages: readonly { role: string; text: string }[]): string {
  const text = messages
    .filter(m => m.text.trim() !== '')
    .map(m => `${m.role.toUpperCase()}: ${m.text}`)
    .join('\n\n')
  return text.length > LIVE_TRANSCRIPT_CHARS ? `…${text.slice(-LIVE_TRANSCRIPT_CHARS)}` : text
}

/** The row the main chat gets when the person sends it an exchange from the pane. */
export function sendNote(x: Pick<Exchange, 'q' | 'a'>): string {
  return [
    '[ask pane] The person sent you this exchange from the ask pane beside this chat, where a fork of this conversation answered a side question.',
    'It is context they chose to share, not a request to act on unless they ask for that.',
    `Question: ${x.q}`,
    `Answer given in the pane:\n${x.a ?? ''}`,
  ].join('\n\n')
}

/** The dim line the transcript shows when an exchange is sent (the engine puts "ask:" before it); the model never reads it. */
export const sentNotice = (x: Pick<Exchange, 'q'>): string =>
  `sent "${x.q.length > 80 ? `${x.q.slice(0, 79)}…` : x.q}" and its answer to the chat as context`

export function footer(x: Exchange): string {
  const parts: string[] = [x.kind ?? 'error']
  if (x.ms !== undefined) parts.push(`${(x.ms / 1000).toFixed(1)} s`)
  if (x.note) parts.push(x.note)
  if (x.sent) parts.push('sent to the chat')
  return parts.join(' · ')
}

/** "draw ..." or "diagram ..." asks for a picture. */
export const asksForPicture = (question: string): boolean => /^(draw|diagram|sketch|visuali[sz]e|chart)\b/i.test(question.trim())
