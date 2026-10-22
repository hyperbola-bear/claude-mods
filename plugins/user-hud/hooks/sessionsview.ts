// Pure layout of the other sessions: the card in the open panel, the pieces on the closed row, and the
// Sessions pane, each a grid of cells.
import type { SessionGroup, SessionInfo, Sessions } from '../types'
import { builder, fits, keyed, line, piece, put } from './cells.ts'
import type { Grid, Look, Piece, Run } from './cells.ts'
import { hintedRule } from './hud.ts'
import type { Band } from './panelgrid.ts'
import { ageOf } from './sessions.ts'

/** Wide enough to say where each session runs, `cli` or `app`. */
export const ENTRY_MIN_WIDTH = 52

const CARD_SESSIONS = 3

type Kind = SessionGroup | 'self'

const DOTS: Record<Kind, { glyph: string; look: Look }> = {
  needs: { glyph: '●', look: { color: 'warning' } },
  working: { glyph: '●', look: { color: 'suggestion' } },
  done: { glyph: '✓', look: { color: 'success' } },
  asleep: { glyph: '·', look: { isDim: true } },
  self: { glyph: '●', look: { color: 'claude' } },
}

const TITLE_LOOKS: Partial<Record<Kind, Look>> = { needs: { isBold: true }, asleep: { isDim: true } }

const counts = (s: Sessions) => ({ needs: s.byGroup.needs.length, working: s.byGroup.working.length, done: s.byGroup.done.length, asleep: s.byGroup.asleep.length })

/** One session: its dot, its title, and on the right where it runs (when there is room) and how long ago. */
function sessionRow(s: SessionInfo, kind: Kind, width: number, now: number) {
  const right: Piece[] = []
  if (width >= ENTRY_MIN_WIDTH) right.push(piece(s.entry, { isDim: true }))
  right.push(piece(ageOf(s.statusAt, now).padStart(3), kind === 'needs' ? { color: 'warning' } : { isDim: true }))
  return line(width, [piece(DOTS[kind].glyph, DOTS[kind].look), piece(s.title, TITLE_LOOKS[kind] ?? {})], right)
}

/** `● 1 needs you`, yellow while one does and dim at none. */
function needsPiece(n: number, isShort: boolean): Piece {
  const r: Run[] = []
  put(r, '●', { color: 'warning', isDim: n === 0 })
  put(r, isShort ? `${n}` : ` ${n} needs you`, n > 0 ? { color: 'warning', isBold: true } : { isDim: true })
  return { runs: r, action: 'sessions' }
}

export function sessionsCard(s: Sessions, now: number, width: number): { full: Grid; folded: Grid } {
  const n = counts(s)
  const full = builder()
  const rule = hintedRule('SESSIONS', width, [keyed('e', 'expand', 'sessions')])
  full.add(rule.row, rule.spans)
  const counted = [needsPiece(n.needs, false), piece(`● ${n.working} working`, { color: 'suggestion' }), piece(`✓ ${n.done} done`, { color: 'success' })]
  const asleep = [piece(`${n.asleep} asleep`, { isDim: true })]
  // Narrow, the count asleep goes first, then the gaps close up, so the three counts stay whole.
  const [right, gap] = fits(width, counted, asleep, 2) ? [asleep, 2] : fits(width, counted, [], 2) ? [[], 2] : [[], 1]
  const summary = line(width, counted, right, gap)
  full.add(summary.row, summary.spans)
  const ranked: [SessionInfo, Kind][] = [
    ...s.byGroup.needs.map(x => [x, 'needs'] as [SessionInfo, Kind]),
    ...s.byGroup.working.map(x => [x, 'working'] as [SessionInfo, Kind]),
    ...s.byGroup.done.map(x => [x, 'done'] as [SessionInfo, Kind]),
  ]
  for (const [x, kind] of ranked.slice(0, CARD_SESSIONS)) {
    const r = sessionRow(x, kind, width, now)
    full.add(r.row, r.spans)
  }
  const folded = builder()
  const f = line(
    width,
    [piece('SESSIONS', { isDim: true }, 'sessions')],
    [needsPiece(n.needs, true), piece(`●${n.working}`, { color: 'suggestion' }), piece(`✓${n.done}`, { color: 'success' }), piece(`${n.asleep} asleep`, { isDim: true })],
  )
  folded.add(f.row, f.spans)
  return { full: full.grid, folded: folded.grid }
}

/** The closed row's session pieces, each longest first: who needs you (none while nobody does), and what the rest do. */
export function sessionChips(s: Sessions): { needs: Piece[] | null; summary: Piece[] } {
  const n = counts(s)
  const summary = (isShort: boolean): Piece => {
    const r: Run[] = []
    put(r, isShort ? `●${n.working}` : `● ${n.working} working`, { color: 'suggestion' })
    put(r, isShort ? ' ' : ' · ', { isDim: true })
    put(r, isShort ? `✓${n.done}` : `✓ ${n.done} done`, { color: 'success' })
    return { runs: r, action: 'sessions' }
  }
  return { needs: n.needs > 0 ? [needsPiece(n.needs, false), needsPiece(n.needs, true)] : null, summary: [summary(false), summary(true)] }
}

/** The Sessions pane: who needs you, who is working, what finished lately, the ones asleep on request, and this one. */
export function sessionsPaneGrid(s: Sessions, now: number, width: number, isAsleepShown: boolean): Band {
  const n = counts(s)
  const b = builder()
  const add = (l: ReturnType<typeof line>) => b.add(l.row, l.spans)
  const live = n.needs + n.working + n.done + n.asleep + (s.self ? 1 : 0)
  add(hintedRule('SESSIONS', width, [piece(`${live} live ·`, { isDim: true }), keyed('e', 'close', 'sessions:close')]))
  const head = (title: string, count: number, note?: string) =>
    add(line(width, [piece(`${title} · ${count}`, { isBold: true }), ...(note ? [piece(note, { isDim: true })] : [])]))
  const list = (kind: Kind, items: readonly SessionInfo[], empty: string) => {
    if (items.length === 0) add(line(width, [piece(`  ${empty}`, { isDim: true })]))
    for (const x of items) add(sessionRow(x, kind, width, now))
  }
  head('NEEDS YOU', n.needs)
  list('needs', s.byGroup.needs, 'nothing is waiting on you')
  head('WORKING', n.working)
  list('working', s.byGroup.working, 'no other session is running a turn')
  head('DONE', n.done, 'in the last 8h')
  list('done', s.byGroup.done, 'none finished lately')
  add(line(width, [piece(`ASLEEP · ${n.asleep}`, { isBold: true }), piece('idle over 8h', { isDim: true })], [keyed('z', isAsleepShown ? 'hide' : 'show', 'sessions:asleep')]))
  if (isAsleepShown) for (const x of s.byGroup.asleep) add(sessionRow(x, 'asleep', width, now))
  if (s.self) {
    head('THIS SESSION', 1)
    add(sessionRow(s.self, 'self', width, now))
  }
  return { ...b.grid, keys: { e: 'sessions:close', z: 'sessions:asleep' }, width }
}
