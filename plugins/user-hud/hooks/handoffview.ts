// Pure layout of the Handoff pane as one grid of cells: the actions, where the note is, and the note itself
// as wrapped text, its headings bold and its code dim, so it reads the same on every surface.
import type { HandoffState } from '../types'
import { builder, line, piece, put, runs, wrap } from './cells.ts'
import type { Look, Run } from './cells.ts'
import { age } from './handoff.ts'
import type { Band } from './panelgrid.ts'

/** The most of a note the pane draws: a grid is plain data with a size limit. */
export const NOTE_CHARS = 20_000
export const NOTE_ROWS = 300

/** A note's lines as cells: headings bold, code dim, everything else wrapped as text; at most `NOTE_ROWS`. */
export function noteRows(text: string, width: number): Run[][] {
  const rows: Run[][] = []
  let isCode = false
  const body = text.length > NOTE_CHARS ? `${text.slice(0, NOTE_CHARS)}\n…` : text
  for (const raw of body.split('\n')) {
    if (/^\s*```/.test(raw)) {
      isCode = !isCode
      continue
    }
    const look: Look = isCode ? { isDim: true } : /^#{1,6}\s/.test(raw) ? { isBold: true } : {}
    const text = isCode ? raw : raw.replace(/^#{1,6}\s+/, '')
    if (text.trim() === '') rows.push([])
    else if (isCode) rows.push(runs(text.length > width ? `${text.slice(0, width - 1)}…` : text, look))
    else {
      // A list item's continuation lines line up under its text.
      const indent = /^(\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?)/.exec(text)?.[1]?.length ?? 0
      const wrapped = wrap(text, Math.max(10, width - indent), look)
      wrapped.forEach((row, i) => {
        if (i > 0 && indent > 0) {
          const r: Run[] = []
          put(r, ' '.repeat(indent))
          for (const run of row) put(r, run.text, run)
          rows.push(r)
        } else rows.push(row)
      })
    }
    if (rows.length >= NOTE_ROWS) {
      rows.length = NOTE_ROWS
      rows.push(runs('…', { isDim: true }))
      break
    }
  }
  return rows
}

export function handoffPaneGrid(ho: HandoffState, now: number, width: number): Band {
  const b = builder()
  const file = ho.files[ho.index]
  if (!file) {
    const where = ho.hasCommand ? ' with your /handoff command' : ' (it goes to .claude/handoffs/)'
    for (const row of wrap(`No handoff note found in this project. Press h to write one${where}.`, width, { isDim: true })) b.add(row)
    const a = line(width, [piece(' h: Write a handoff ', { bg: 'claude' }, 'handoff')])
    b.add(a.row, a.spans)
    return { ...b.grid, keys: { h: 'handoff' }, width }
  }
  const pieces = [piece(' c: Continue from this ', { bg: 'claude', isBold: true }, 'handoff:continue')]
  const keys: Record<string, string> = { c: 'handoff:continue', r: 'handoff:rescan' }
  if (ho.index < ho.files.length - 1) {
    pieces.push(piece(' o: Older ', { bg: 'subtle' }, 'handoff:older'))
    keys.o = 'handoff:older'
  }
  if (ho.index > 0) {
    pieces.push(piece(' n: Newer ', { bg: 'subtle' }, 'handoff:newer'))
    keys.n = 'handoff:newer'
  }
  pieces.push(piece(' r: Rescan ', { bg: 'subtle' }, 'handoff:rescan'))
  const a = line(width, pieces)
  b.add(a.row, a.spans)
  // Where the note is: its end kept when the path is too long, as the file's name is what matters.
  const where = `${file.path} · ${age(file.mtimeMs, now)}${ho.files.length > 1 ? ` · ${ho.index + 1} of ${ho.files.length}` : ''}`
  b.add(runs(where.length > width ? `…${where.slice(where.length - width + 1)}` : where, { color: 'suggestion' }))
  if (ho.error) for (const row of wrap(ho.error, width, { color: 'error' })) b.add(row)
  b.add([])
  if (ho.text !== null) for (const row of noteRows(ho.text, width)) b.add(row)
  else if (!ho.error) b.add(runs('Loading…', { isDim: true }))
  return { ...b.grid, keys, width }
}
