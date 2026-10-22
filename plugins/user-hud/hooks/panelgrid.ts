// Pure band layout: the closed row, or the open panel above it (cards, or the settings behind `s`), as one
// grid of cells and the actions on it, so a `Client` paints the band the same on the terminal and the desktop.
import type { CardId, HudView, SelectorStyle, Sessions } from '../types'
import { BATTERY_COLORS, batteryRuns, levelOf } from './battery.ts'
import { builder, cut, fits, keyed, line, pad, piece, pill, put, runs, spanOf, widthOf } from './cells.ts'
import type { Grid, Piece, Run, Span } from './cells.ts'
import { hintedRule } from './hud.ts'
import { fittedStyle, layout } from './selectorgrid.ts'
import type { GridField } from './selectorgrid.ts'
import { sessionChips, sessionsCard } from './sessionsview.ts'

/** One settings row: a toggle (On/Off) or a choice that cycles through its values. */
export type Setting = { key: string; label: string; desc: string; kind: 'toggle' | 'choice'; isOn: boolean; value: string }

/** Everything the band shows, as plain values; the hooks module works them out, this lays them out. */
export type BandView = {
  isOpen: boolean
  view: HudView
  /** The band region's width: the closed row may take all of it, the open panel up to `PANEL_MAX`. */
  columns: number
  /** Rows the open panel may take, its bottom bar included. */
  maxRows: number
  /** The card the panel starts with; null for the usual order. */
  lead: CardId | null
  /** The cache countdown chip, a pie of the time left before it; empty when nothing is cached. */
  chip: Run[]
  /** The plan window past its limit, worded (`5-hour limit 103%`); null when not on overage. */
  overage: string | null
  /** `1.2M tokens`; null before anything was counted. */
  usedTokens: string | null
  /** The model in its colour, a dot, the effort letter by letter; and the same shortened, `Opus · XH`. */
  setup: Run[]
  setupShort: Run[]
  /** Keep warm: not offered, offered quietly (the cache is warm), or urged (it is cooling). */
  keepWarm: 'none' | 'quiet' | 'urged'
  isPinging: boolean
  /** Each part of the panel, null where its module is off: the panel leaves its card out. */
  pickers: { style: SelectorStyle; fields: GridField[] } | null
  /** The context card's token bar, `tokenBarCells` of the card's width, and the total. */
  tokens: { segments: { color: string; cells: number }[]; total: string } | null
  /** How full the context window is, a whole percentage; null before a response reported it, or with tokens off. */
  context: number | null
  /** The context window's size, worded (`200k`); null while unknown. */
  contextWindow: string | null
  /** The cache card: its state with the pie, the life bar, and what is cached. */
  cache: { status: Run[]; bar: Run[]; detail: string | null } | null
  settings: Setting[]
  handoff: { hasNewest: boolean; note: string } | null
  /** Next steps: the prompts suggested after the last reply, or a dim note while they are asked for. */
  next: { items: string[]; note: string | null } | null
  sessions: { list: Sessions; now: number } | null
  /** The guesses still to mark, oldest first. */
  guesses: { id: string; text: string }[] | null
}

export type Band = Grid & { keys: Record<string, string>; width: number }

/** A card of the open panel, as it draws with rows to spare and as one row. */
export type Card = { id: CardId; full: Grid; folded: Grid }

export const CARD_ORDER: readonly CardId[] = ['sessions', 'context', 'model', 'cache', 'assume', 'next', 'handoff']

export const PANEL_MAX = 132

const COLUMN_GAP = 2

/** The open panel's width, its columns (one to three, one per 36 cells), and each card's width. */
export function cardLayout(columns: number): { width: number; count: number; card: number } {
  const width = Math.max(1, Math.min(columns, PANEL_MAX))
  const count = Math.max(1, Math.min(3, Math.floor((width + COLUMN_GAP) / 36)))
  return { width, count, card: Math.floor((width - COLUMN_GAP * (count - 1)) / count) }
}

/** Cells of the context card's token bar at a card width, with room left for the total beside it. */
export const tokenBarCells = (card: number) => Math.max(0, Math.min(16, card - 12))

const HOTKEYS: Record<string, string> = {
  sessions: 'e',
  tokens: 't',
  styles: 'm',
  keepwarm: 'w',
  'assume:review': 'a',
  handoff: 'h',
  readhandoff: 'r',
  'next:0': '1',
  'next:1': '2',
  'next:2': '3',
  settings: 's',
}

const text = (s: string, look = {}): Piece => piece(s, look)

const FACE = '#fff3ec'

/** Clawd's face in four cells, its eyes the empty quadrants: yellow while another session needs you. */
function face(needsYou: boolean): Run[] {
  const r: Run[] = []
  put(r, ' ', { bg: 'claude' })
  put(r, '▐', { color: FACE, bg: 'claude' })
  put(r, '▛▜', { color: FACE, bg: needsYou ? 'warning' : 'claude' })
  put(r, '▌', { color: FACE, bg: 'claude' })
  return r
}

function tab(isOpen: boolean, needsYou: boolean, isFaceOnly = false): Piece {
  const r = face(needsYou)
  put(r, isFaceOnly ? ' ' : ` user-hud ${isOpen ? '▾' : '▴'} `, { bg: 'claude', isBold: !isFaceOnly })
  return { runs: r, action: 'panel' }
}

const keepWarm = (v: BandView): Piece | null => (v.keepWarm === 'none' ? null : pill('w: Keep warm', 'keepwarm', v.keepWarm === 'urged' ? 'warning' : 'subtle'))

const needsYouOf = (v: BandView) => (v.sessions?.list.byGroup.needs.length ?? 0) > 0

/** The row cut to `width` cells, an ellipsis on the right of a cut row: the band sits against the right edge. */
export function clipped<G extends Grid>(g: G, width: number): G {
  if (g.rows.every(r => widthOf(r) <= width)) return g
  const hits = g.hits.filter(h => h.x0 < width).map(h => ({ ...h, x1: Math.min(h.x1, width) }))
  return { ...g, rows: g.rows.map(r => cut(r, width)), hits }
}

/** The grid cut to `width`, with the hotkey of every action it draws. */
function finish(g: Grid, width: number): Band {
  const c = clipped(g, width)
  const keys: Record<string, string> = {}
  for (const h of c.hits) {
    const key = HOTKEYS[h.id]
    if (key) keys[key] = h.id
  }
  return { ...c, keys, width: Math.min(width, Math.max(0, ...c.rows.map(widthOf))) }
}

/** A piece of the closed row: its forms, longest first, and how much it is needed (the lowest goes first). */
type Chip = { priority: number; forms: Piece[] }

function closedChips(v: BandView): Chip[] {
  const chips: Chip[] = []
  const s = v.sessions ? sessionChips(v.sessions.list) : null
  if (s?.needs) chips.push({ priority: 9, forms: s.needs })
  if (v.chip.length > 0) chips.push({ priority: 8, forms: [{ runs: v.chip, action: null }] })
  if (v.overage) chips.push({ priority: 7.5, forms: [text('⚠ overage', { color: 'warning' })] }, { priority: 7.25, forms: [pill('New chat', 'newchat', 'subtle')] })
  if (v.context !== null) {
    const withLabel = runs('context ', { isDim: true })
    for (const r of batteryRuns(v.context)) put(withLabel, r.text, r)
    const percent = runs(`${Math.round(v.context)}%`, { color: BATTERY_COLORS[levelOf(Math.round(v.context))] })
    chips.push({ priority: 7, forms: [withLabel, batteryRuns(v.context), percent].map(r => ({ runs: r, action: null })) })
  }
  if (s) chips.push({ priority: 6, forms: s.summary })
  const guesses = v.guesses?.length ?? 0
  if (guesses > 0) chips.push({ priority: 5, forms: [piece(`? ${guesses} to check`, { color: 'claude' }, 'assume:review'), piece(`?${guesses}`, { color: 'claude' }, 'assume:review')] })
  const next = v.next?.items.length ?? 0
  if (next > 0) chips.push({ priority: 4, forms: [piece(`✦ ${next} next`, { color: 'claude' }, 'panel'), piece(`✦${next}`, { color: 'claude' }, 'panel')] })
  if (v.setup.length > 0) chips.push({ priority: 3, forms: [{ runs: v.setup, action: null }, { runs: v.setupShort, action: null }] })
  if (v.usedTokens) chips.push({ priority: 2, forms: [text(v.usedTokens, { isDim: true })] })
  const kw = v.keepWarm === 'urged' && !v.isPinging ? keepWarm(v) : null
  if (kw) chips.push({ priority: 7.75, forms: [kw] })
  return chips
}

const rowWidth = (ps: readonly Piece[]) => spanOf(ps, 2)

/** The closed row: the least needed piece shortens, then goes, until the row fits; last the tab shrinks to its face. */
function closedRow(v: BandView): Band {
  const needsYou = needsYouOf(v)
  const chips = closedChips(v)
  // Which form each chip is drawn in; one past its last form, it is left out.
  const form = chips.map(() => 0)
  let isFaceOnly = false
  const pieces = () => [...chips.flatMap((c, i) => c.forms.slice(form[i], (form[i] ?? 0) + 1)), tab(false, needsYou, isFaceOnly)]
  while (rowWidth(pieces()) > v.columns) {
    const lowest = chips
      .map((c, i) => ({ c, i }))
      .filter(({ c, i }) => (form[i] ?? 0) < c.forms.length)
      .sort((a, b) => a.c.priority - b.c.priority)[0]
    if (!lowest) {
      isFaceOnly = true
      break
    }
    form[lowest.i] = (form[lowest.i] ?? 0) + 1
  }
  const ps = pieces()
  const b = builder()
  const l = line(rowWidth(ps), [], ps, 2)
  b.add(l.row, l.spans)
  return finish(b.grid, v.columns)
}

type Line = { row: Run[]; spans: Span[] }

function gridOf(lines: readonly (Line | Grid)[]): Grid {
  const b = builder()
  for (const l of lines) {
    if ('rows' in l) b.append(l)
    else b.add(l.row, l.spans)
  }
  return b.grid
}

function contextCard(v: BandView, w: number): Card | null {
  if (!v.tokens) return null
  const fill = v.context === null ? text('known after a reply', { isDim: true }) : { runs: batteryRuns(v.context), action: null }
  const counted = v.tokens.segments.length > 0
  const bar: Run[] = []
  for (const s of v.tokens.segments) put(bar, ' '.repeat(s.cells), { bg: s.color })
  const usage = counted ? [{ runs: bar, action: null }, text(`${v.tokens.total} used`, { isDim: true })] : [text('counting from the next request', { isDim: true })]
  return {
    id: 'context',
    full: gridOf([
      hintedRule('CONTEXT', w, [keyed('t', 'details', 'tokens')]),
      line(w, [fill], v.contextWindow ? [text(`of ${v.contextWindow}`, { isDim: true })] : []),
      line(w, usage),
    ]),
    folded: gridOf([line(w, [piece('CONTEXT', { isDim: true }, 'tokens'), v.context === null ? text('—', { isDim: true }) : fill], counted ? [text(v.tokens.total, { isDim: true })] : [])]),
  }
}

function modelCard(v: BandView, w: number): Card | null {
  if (!v.pickers) return null
  const style = fittedStyle(v.pickers.style, w, v.pickers.fields)
  return {
    id: 'model',
    full: gridOf([hintedRule('MODEL · EFFORT', w), layout({ style, width: w, fields: v.pickers.fields })]),
    folded: gridOf([line(w, [text('MODEL', { isDim: true }), { runs: v.setup, action: null }], [keyed('m', 'pick', 'styles')])]),
  }
}

function cacheCard(v: BandView, w: number): Card | null {
  if (!v.cache) return null
  const kw = v.isPinging ? null : keepWarm(v)
  const right = v.isPinging ? [text('pinging…', { isDim: true })] : kw ? [kw] : []
  const bar = v.cache.bar.length > 0 ? [{ runs: v.cache.bar, action: null }] : []
  const lines: Line[] = [hintedRule('CACHE', w), line(w, [{ runs: v.cache.status, action: null }, ...bar])]
  const detail = v.cache.detail ? [text(v.cache.detail, { isDim: true })] : []
  // In a narrow card the button takes a row of its own rather than cutting what is cached.
  if (!fits(w, detail, right) && detail.length > 0 && right.length > 0) lines.push(line(w, detail), line(w, [], right))
  else if (detail.length > 0 || right.length > 0) lines.push(line(w, detail, right))
  if (v.overage) {
    lines.push(line(w, [text('⚠ overage', { color: 'warning' })], [pill('New chat', 'newchat', 'subtle')]))
    lines.push(line(w, [text(`${v.overage} · a new chat costs less per turn`, { isDim: true })]))
  }
  const foldedRight = [...(v.overage ? [pill('New chat', 'newchat', 'subtle')] : []), ...right]
  const chip = v.chip.length > 0 ? v.chip : v.cache.status
  return { id: 'cache', full: gridOf(lines), folded: gridOf([line(w, [{ runs: chip, action: null }, ...bar], foldedRight)]) }
}

/** Guesses shown in full: the rest wait for these to be marked. */
const CARD_GUESSES = 3

function guessesCard(v: BandView, w: number): Card | null {
  const gs = v.guesses ?? []
  if (gs.length === 0) return null
  const more = gs.length > CARD_GUESSES ? [text(`+${gs.length - CARD_GUESSES} more`, { isDim: true })] : []
  const rows = gs
    .slice(0, CARD_GUESSES)
    .map(g => line(w, [piece('✓', { color: 'success' }, `assume:right:${g.id}`), piece('✗', { color: 'error' }, `assume:wrong:${g.id}`), text(` ${g.text}`)]))
  return {
    id: 'assume',
    full: gridOf([hintedRule('CHECK MY GUESSES', w, more), ...rows]),
    folded: gridOf([line(w, [piece(`? ${gs.length} to check`, { color: 'claude' }, 'assume:review')], [keyed('a', 'review', 'assume:review')])]),
  }
}

function nextCard(v: BandView, w: number): Card | null {
  const nx = v.next
  if (!nx || (nx.items.length === 0 && !nx.note)) return null
  const star = text('✦', { color: 'claude' })
  if (nx.items.length === 0) {
    const note = line(w, [star, text(nx.note ?? '', { isDim: true })])
    return { id: 'next', full: gridOf([hintedRule('NEXT STEPS', w), note]), folded: gridOf([note]) }
  }
  const rest = nx.items.slice(1).map((_, i) => piece(`${i + 2}`, { color: 'claude', isBold: true }, `next:${i + 1}`))
  return {
    id: 'next',
    full: gridOf([hintedRule('NEXT STEPS', w), ...nx.items.map((t, i) => line(w, [star, keyed(`${i + 1}`, t, `next:${i}`)]))]),
    folded: gridOf([line(w, [star, keyed('1', nx.items[0]!, 'next:0')], rest)]),
  }
}

function handoffCard(v: BandView, w: number): Card | null {
  const ho = v.handoff
  if (!ho) return null
  const gap = text(' ')
  const row = line(w, [
    text('✦', { color: 'claude' }),
    keyed('h', 'Write', 'handoff'),
    gap,
    ...(ho.hasNewest ? [text('◆', { color: 'suggestion' }), keyed('r', 'Read', 'readhandoff'), gap] : []),
    text(ho.note, { isDim: true }),
  ])
  return { id: 'handoff', full: gridOf([hintedRule('HANDOFF', w), row]), folded: gridOf([row]) }
}

const CARDS: Record<CardId, (v: BandView, w: number) => Card | null> = {
  sessions: (v, w) => (v.sessions ? { id: 'sessions', ...sessionsCard(v.sessions.list, v.sessions.now, w) } : null),
  context: contextCard,
  model: modelCard,
  cache: cacheCard,
  assume: guessesCard,
  next: nextCard,
  handoff: handoffCard,
}

/** The cards whose modules are on and have something to show, in order from the lead card round. */
export function cardsOf(v: BandView, w: number): Card[] {
  const list = CARD_ORDER.map(id => CARDS[id](v, w)).filter((c): c is Card => c !== null)
  const i = v.lead ? list.findIndex(c => c.id === v.lead) : -1
  return i > 0 ? [...list.slice(i), ...list.slice(0, i)] : list
}

/** Each card into the shortest column, a blank row between cards in a column. */
function place(cards: readonly Grid[], count: number): { columns: Grid[]; height: number } {
  const cols = Array.from({ length: count }, () => builder())
  for (const c of cards) {
    const shortest = cols.reduce((best, col) => (col.grid.rows.length < best.grid.rows.length ? col : best), cols[0]!)
    if (shortest.grid.rows.length > 0) shortest.add([])
    shortest.append(c)
  }
  return { columns: cols.map(c => c.grid), height: Math.max(0, ...cols.map(c => c.grid.rows.length)) }
}

/** The columns side by side, each row cut to the card width. */
function sideBySide(columns: readonly Grid[], height: number, w: number, width: number): Grid {
  const b = builder()
  for (let y = 0; y < height; y += 1) {
    const row: Run[] = []
    const spans: Span[] = []
    columns.forEach((col, i) => {
      const x0 = i * (w + COLUMN_GAP)
      if (i > 0) put(row, ' '.repeat(COLUMN_GAP))
      const cell = cut(col.rows[y] ?? [], w)
      for (const r of cell) put(row, r.text, r)
      put(row, ' '.repeat(Math.max(0, w - widthOf(cell))))
      for (const h of col.hits) if (h.y === y && h.x0 < w) spans.push({ action: h.id, x0: x0 + h.x0, x1: x0 + Math.min(h.x1, w) })
    })
    put(row, ' '.repeat(Math.max(0, width - widthOf(row))))
    b.add(row, spans)
  }
  return b.grid
}

function bottomBar(v: BandView, width: number, left: readonly Piece[]): Line {
  return line(width, left, [tab(true, needsYouOf(v))])
}

const gear = text('⚙', { isDim: true })

/**
 * The cards in full if they fit; else the card pressed to the front in full and the rest folded, since a folded
 * guesses card cannot be marked; else each folded to one row; else the last ones go, behind `+N more`.
 */
function cardsPanel(v: BandView): Band {
  const { width, count, card } = cardLayout(v.columns)
  const all = cardsOf(v, card)
  const budget = v.maxRows - 1
  const folded = all.map(c => c.folded)
  const leadFull = all[0] && all[0].id === v.lead ? [all[0].full, ...folded.slice(1)] : null
  let shown = [all.map(c => c.full), leadFull].find((g): g is Grid[] => g !== null && place(g, count).height <= budget) ?? folded
  let placed = place(shown, count)
  while (placed.height > budget && shown.length > 0) {
    shown = shown.slice(0, -1)
    placed = place(shown, count)
  }
  const hidden = all.slice(shown.length)
  const left: Piece[] = v.settings.length > 0 ? [gear, keyed('s', 'Settings', 'settings')] : []
  if (hidden[0]) left.push(pill(`+${hidden.length} more`, `more:${hidden[0].id}`, 'subtle'))
  return finish(gridOf([sideBySide(placed.columns, placed.height, card, width), bottomBar(v, width, left)]), width)
}

function settingRow(s: Setting, width: number): Line {
  const mark = s.kind === 'choice' ? text('◇', { isDim: true }) : s.isOn ? text('●', { color: 'success' }) : text('○', { isDim: true })
  const value = s.kind === 'toggle' ? (s.isOn ? '● On' : '○ Off') : s.value
  return line(width, [mark, text(pad(s.label, 16), { isBold: true }), text(s.desc, { isDim: true })], [pill(value, `set:${s.key}`, s.kind === 'toggle' && s.isOn ? 'success' : 'subtle')])
}

/** Pills laid on as few rows as fit, a space between. */
function folded(pills: readonly Piece[], width: number): Line[] {
  const rows: Piece[][] = pills.length > 0 ? [[]] : []
  let used = 0
  for (const p of pills) {
    const w = widthOf(p.runs)
    if (used > 0 && used + 1 + w > width) {
      rows.push([])
      used = 0
    }
    rows.at(-1)!.push(p)
    used += (used > 0 ? 1 : 0) + w
  }
  return rows.map(r => line(width, r))
}

/** The settings behind `s`: a row each under their rule, or one pill each when the rows do not fit. */
function settingsPanel(v: BandView): Band {
  const { width } = cardLayout(v.columns)
  const budget = v.maxRows - 1
  const rows =
    v.settings.length + 1 <= budget
      ? [hintedRule('SETTINGS', width), ...v.settings.map(s => settingRow(s, width))]
      : folded(
          v.settings.map(s =>
            s.kind === 'toggle' ? pill(`${s.isOn ? '●' : '○'} ${s.label}`, `set:${s.key}`, s.isOn ? 'success' : 'subtle') : pill(s.value, `set:${s.key}`, 'subtle'),
          ),
          width,
        ).slice(0, Math.max(0, budget))
  return finish(gridOf([...rows, bottomBar(v, width, [gear, keyed('s', 'Back', 'settings')])]), width)
}

/** The band: the closed row, or the open panel's cards or settings. */
export function bandGrid(v: BandView): Band {
  if (!v.isOpen) return closedRow(v)
  return v.view === 'settings' && v.settings.length > 0 ? settingsPanel(v) : cardsPanel(v)
}
