// Pure band layout: the closed row, or the open panel above it (cards, the settings behind `s`, or the modules
// behind the settings' Modules row), as one
// grid of cells and the actions on it, so a `Client` paints the band the same on the terminal and the desktop.
import type { CardId, HudView, SelectorStyle, Sessions } from '../types'
import { BATTERY_COLORS, batteryRuns, levelOf } from './battery.ts'
import { builder, cut, fits, folded, keyed, line, pad, piece, pill, put, runs, spanOf, widthOf, wrap } from './cells.ts'
import type { Grid, Piece, Run, Span } from './cells.ts'
import { DEFAULT_ORDER, MODULE_CARD, hintedRule } from './hud.ts'
import type { ModuleId, Modules } from './hud.ts'
import { MODULE_TITLES, modulesPaneGrid } from './modulesview.ts'
import { fittedStyle, layout } from './selectorgrid.ts'
import type { GridField } from './selectorgrid.ts'
import { CARD_SESSIONS, sessionChips, sessionsCard } from './sessionsview.ts'

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
  /** The cards top to bottom, as the person ordered the modules. */
  order: readonly CardId[]
  /** The cards kept in full while any other card can fold or go: next steps unless the person says otherwise. */
  keepOpen: readonly CardId[]
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
  /** The context card's total, `1.2M`; null before anything was counted. */
  tokens: { total: string | null } | null
  /** How full the context window is, a whole percentage; null before a response reported it, or with tokens off. */
  context: number | null
  /** The context window's size, worded (`200k`); null while unknown. */
  contextWindow: string | null
  /** The cache card: its state with the pie, the life bar, and what is cached. */
  cache: { status: Run[]; bar: Run[]; detail: string | null } | null
  settings: Setting[]
  /** Which modules are on, their order, and which stay open, for the modules behind the settings. */
  modules: { on: Modules; order: readonly ModuleId[]; open: readonly ModuleId[] }
  handoff: { hasNewest: boolean; note: string } | null
  /**
   * Next steps: the prompts suggested after the last reply, or a dim note while they are asked for. Expanded,
   * they take the panel's whole width, each wrapped in full, under the other cards.
   */
  next: { items: string[]; note: string | null; isExpanded?: boolean } | null
  sessions: { list: Sessions; now: number } | null
  /** The guesses still to mark, oldest first. */
  guesses: { id: string; text: string }[] | null
  /** Guesses across the panel's whole width, every one in full (`g` switches), as next steps expand. */
  isGuessesExpanded?: boolean
}

export type Band = Grid & { keys: Record<string, string>; width: number }

/** A card of the open panel, as it draws with rows to spare and as one row. */
export type Card = { id: CardId; full: Grid; folded: Grid }

export const CARD_ORDER: readonly CardId[] = DEFAULT_ORDER.flatMap(id => MODULE_CARD[id] ?? [])

export const PANEL_MAX = 132

const COLUMN_GAP = 2

/** The open panel's width, its columns (one to three, one per 36 cells), and each card's width. */
export function cardLayout(columns: number): { width: number; count: number; card: number } {
  const width = Math.max(1, Math.min(columns, PANEL_MAX))
  const count = Math.max(1, Math.min(3, Math.floor((width + COLUMN_GAP) / 36)))
  return { width, count, card: Math.floor((width - COLUMN_GAP * (count - 1)) / count) }
}


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
  'next:toggle': 'n',
  'assume:toggle': 'g',
  settings: 's',
  'modules:default': 'd',
}

const text = (s: string, look = {}): Piece => piece(s, look)

const MARK = '#fff3ec'

/** The four diamonds, `❖`, in cream on Claude's orange: yellow while another session needs you. */
function mark(needsYou: boolean): Run[] {
  const r: Run[] = []
  put(r, ' ', { bg: 'claude' })
  put(r, '❖', { color: needsYou ? 'warning' : MARK, bg: 'claude', isBold: true })
  return r
}

function tab(isOpen: boolean, needsYou: boolean, isMarkOnly = false): Piece {
  const r = mark(needsYou)
  put(r, isMarkOnly ? ' ' : ` user-hud ${isOpen ? '▾' : '▴'} `, { bg: 'claude', isBold: !isMarkOnly })
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

/** The closed row: the least needed piece shortens, then goes, until the row fits; last the tab shrinks to its mark. */
function closedRow(v: BandView): Band {
  const needsYou = needsYouOf(v)
  const chips = closedChips(v)
  // Which form each chip is drawn in; one past its last form, it is left out.
  const form = chips.map(() => 0)
  let isMarkOnly = false
  const pieces = () => [...chips.flatMap((c, i) => c.forms.slice(form[i], (form[i] ?? 0) + 1)), tab(false, needsYou, isMarkOnly)]
  while (rowWidth(pieces()) > v.columns) {
    const lowest = chips
      .map((c, i) => ({ c, i }))
      .filter(({ c, i }) => (form[i] ?? 0) < c.forms.length)
      .sort((a, b) => a.c.priority - b.c.priority)[0]
    if (!lowest) {
      isMarkOnly = true
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

/**
 * The context folded to one row, every cell of it opening the Tokens pane: the name, the battery, the total, and
 * `t: details` while it fits, so the breakdown stays in reach when the card's rule is folded away.
 */
function contextFolded(v: BandView, w: number): Line {
  const left = [piece('CONTEXT', { isDim: true }, 'tokens'), v.context === null ? piece('—', { isDim: true }, 'tokens') : { runs: batteryRuns(v.context), action: 'tokens' }]
  const total = v.tokens?.total ? [piece(v.tokens.total, { isDim: true }, 'tokens')] : []
  const withHint = [...total, keyed('t', 'details', 'tokens')]
  return line(w, left, fits(w, left, withHint) ? withHint : total)
}

function contextCard(v: BandView, w: number): Card | null {
  if (!v.tokens) return null
  const fill = v.context === null ? text('known after a reply', { isDim: true }) : { runs: batteryRuns(v.context), action: null }
  const total = v.tokens.total
  const usage = [text(total ? `${total} used` : 'counting from the next request', { isDim: true })]
  return {
    id: 'context',
    full: gridOf([
      hintedRule('CONTEXT', w, [keyed('t', 'details', 'tokens')]),
      line(w, [fill], v.contextWindow ? [text(`of ${v.contextWindow}`, { isDim: true })] : []),
      line(w, usage),
    ]),
    folded: gridOf([contextFolded(v, w)]),
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
  const folded = line(w, [text('CACHE', { isDim: true }), { runs: chip, action: null }, ...bar], foldedRight)
  return { id: 'cache', full: gridOf(lines), folded: gridOf([folded]) }
}

/** Guesses shown in full: the rest wait for these to be marked. */
const CARD_GUESSES = 3

function guessesCard(v: BandView, w: number): Card | null {
  const gs = v.guesses
  if (!gs) return null
  if (gs.length === 0) {
    const none = text('nothing to check', { isDim: true })
    return { id: 'assume', full: gridOf([hintedRule('CHECK MY GUESSES', w), line(w, [none])]), folded: gridOf([line(w, [text('GUESSES', { isDim: true }), none])]) }
  }
  const rows = gs.slice(0, CARD_GUESSES).map(g => line(w, guessRow(g)))
  // A guess past the three shown, or one cut short, is worth reading in full before marking: `g` shows them all.
  const hidden = gs.length - CARD_GUESSES
  const isCut = gs.slice(0, CARD_GUESSES).some(g => !fits(w, guessRow(g)))
  const hint = hidden > 0 ? [keyed('g', `+${hidden} more`, 'assume:toggle')] : isCut ? [keyed('g', 'expand', 'assume:toggle')] : []
  const rule = hintedRule('CHECK MY GUESSES', w, hint)
  return {
    id: 'assume',
    full: gridOf([rule, ...rows]),
    folded: gridOf([line(w, [text('GUESSES', { isDim: true }), piece(`? ${gs.length} to check`, { color: 'claude' }, 'assume:review')], [keyed('a', 'review', 'assume:review')])]),
  }
}

/** A guess as its card draws it: `✓` marks it right, `✗` wrong, then its text. */
const guessRow = (g: { id: string; text: string }): Piece[] => [piece('✓', { color: 'success' }, `assume:right:${g.id}`), piece('✗', { color: 'error' }, `assume:wrong:${g.id}`), text(` ${g.text}`)]

/** The cells before a guess's text: `✓ ✗  `. */
const GUESS_INDENT = 5

/**
 * Guesses expanded across the panel's `width`: every one in full, wrapped under its own start, with its `✓` and
 * `✗`; `g: collapse` on the rule. At most `rows` rows, the last cut where they run over.
 */
export function expandedGuesses(gs: readonly { id: string; text: string }[], width: number, rows: number): Grid {
  const b = builder()
  const rule = hintedRule('CHECK MY GUESSES', width, [keyed('g', 'collapse', 'assume:toggle')])
  b.add(rule.row, rule.spans)
  for (const g of gs) {
    wrap(g.text, Math.max(1, width - GUESS_INDENT)).forEach((r, j) => {
      const row: Run[] = []
      const spans: Span[] = []
      if (j === 0) {
        put(row, '✓', { color: 'success' })
        put(row, ' ')
        put(row, '✗', { color: 'error' })
        put(row, '  ')
        spans.push({ action: `assume:right:${g.id}`, x0: 0, x1: 1 }, { action: `assume:wrong:${g.id}`, x0: 2, x1: 3 })
      } else put(row, ' '.repeat(GUESS_INDENT))
      for (const run of r) put(row, run.text, run)
      put(row, ' '.repeat(Math.max(0, width - widthOf(row))))
      b.add(row, spans)
    })
  }
  return cutToRows(b.grid, width, rows)
}

/** A grid kept to `rows` rows, its last one ending in `…` where rows were left out. */
function cutToRows(g: Grid, width: number, rows: number): Grid {
  if (g.rows.length <= rows) return g
  const kept = g.rows.slice(0, Math.max(0, rows))
  const last = kept.at(-1)
  if (last) {
    const marked = [...last]
    put(marked, ' …', { isDim: true })
    kept[kept.length - 1] = cut(marked, width)
  }
  return { rows: kept, hits: g.hits.filter(h => h.y < kept.length) }
}

/** Folded, a card's row starts with its name, as CONTEXT, SESSIONS and the others do. */
const NEXT_NAME = text('NEXT STEPS', { isDim: true })

/** Next steps suggested after a reply, at most. */
const NEXT_STEPS = 3

/** A next step as its card draws it: the star, then the step's number and its prompt. */
const nextStep = (t: string, i: number): Piece[] => [text('✦', { color: 'claude' }), keyed(`${i + 1}`, t, `next:${i}`)]

/** Whether any step is cut at `w` cells, so the card offers to expand. */
const isNextCut = (items: readonly string[], w: number) => items.some((t, i) => !fits(w, nextStep(t, i)))

function nextCard(v: BandView, w: number): Card | null {
  const nx = v.next
  if (!nx) return null
  const star = text('✦', { color: 'claude' })
  if (nx.items.length === 0) {
    const note = [star, text(nx.note ?? 'suggested after each reply', { isDim: true })]
    return { id: 'next', full: gridOf([hintedRule('NEXT STEPS', w), line(w, note)]), folded: gridOf([line(w, [NEXT_NAME, ...note])]) }
  }
  const rest = nx.items.slice(1).map((_, i) => piece(`${i + 2}`, { color: 'claude', isBold: true }, `next:${i + 1}`))
  const expand = isNextCut(nx.items, w) ? [keyed('n', 'expand', 'next:toggle')] : []
  return {
    id: 'next',
    full: gridOf([hintedRule('NEXT STEPS', w, expand), ...nx.items.map((t, i) => line(w, nextStep(t, i)))]),
    folded: gridOf([line(w, [NEXT_NAME, star, keyed('1', nx.items[0]!, 'next:0')], rest)]),
  }
}

/** The cells before a step's prompt: `✦ 1: `, three steps at most so one digit. */
const STEP_INDENT = 5

/**
 * Next steps expanded across the panel's `width`: each prompt in full, wrapped under its own start, the whole of
 * it pressing the step; `n: collapse` on the rule. At most `rows` rows, the last cut where they run over.
 */
export function expandedNext(items: readonly string[], width: number, rows: number): Grid {
  const b = builder()
  const rule = hintedRule('NEXT STEPS', width, [keyed('n', 'collapse', 'next:toggle')])
  b.add(rule.row, rule.spans)
  items.forEach((t, i) => {
    const action = `next:${i}`
    wrap(t, Math.max(1, width - STEP_INDENT)).forEach((r, j) => {
      const row: Run[] = []
      if (j === 0) {
        put(row, '✦ ', { color: 'claude' })
        put(row, `${i + 1}`, { color: 'claude', isBold: true })
        put(row, ': ')
      } else put(row, ' '.repeat(STEP_INDENT))
      for (const run of r) put(row, run.text, run)
      const x1 = widthOf(row)
      put(row, ' '.repeat(Math.max(0, width - x1)))
      b.add(row, [{ action, x0: j === 0 ? 2 : STEP_INDENT, x1 }])
    })
  })
  return cutToRows(b.grid, width, rows)
}

const CARDS: Record<CardId, (v: BandView, w: number) => Card | null> = {
  sessions: (v, w) => (v.sessions ? { id: 'sessions', ...sessionsCard(v.sessions.list, v.sessions.now, w) } : null),
  context: contextCard,
  model: modelCard,
  cache: cacheCard,
  assume: guessesCard,
  next: nextCard,
}

/** A sample of the longest cache detail, to know at a width whether Keep warm takes a row of its own. */
const CACHE_DETAIL_SAMPLE = '1.2M cached · hit 100% · 1h'

/**
 * Rows each card takes in full, whatever it holds right now: a card short of content keeps blank rows, so no card
 * moves when another fills or empties. More content than this (the overage rows) still grows a card.
 */
function spaceOf(id: CardId, w: number): number {
  switch (id) {
    case 'sessions':
      return 2 + CARD_SESSIONS
    case 'assume':
      return 1 + CARD_GUESSES
    case 'next':
      return 1 + NEXT_STEPS
    case 'context':
      return 3
    case 'cache':
      return fits(w, [text(CACHE_DETAIL_SAMPLE)], [pill('w: Keep warm', 'keepwarm', 'subtle')]) ? 3 : 4
    case 'model':
      return 0
  }
}

/** The grid with blank rows under it, up to `rows`. */
function padded(g: Grid, rows: number): Grid {
  if (g.rows.length >= rows) return g
  const b = builder()
  b.append(g)
  while (b.grid.rows.length < rows) b.add([])
  return b.grid
}

/** The cards whose modules are on, each in its own space, in order from the lead card round. */
export function cardsOf(v: BandView, w: number): Card[] {
  const list = v.order.map(id => CARDS[id](v, w))
    .filter((c): c is Card => c !== null)
    .map(c => ({ ...c, full: padded(c.full, spaceOf(c.id, w)) }))
  const i = v.lead ? list.findIndex(c => c.id === v.lead) : -1
  return i > 0 ? [...list.slice(i), ...list.slice(0, i)] : list
}

/** The tiles in rows of `count`, left to right, each row in full or folded to one row a tile. */
type TileRow = { tiles: Card[]; isFolded: boolean }

const rowsOf = (cards: readonly Card[], count: number, isFolded: boolean): TileRow[] =>
  Array.from({ length: Math.ceil(cards.length / count) }, (_, i) => ({ tiles: cards.slice(i * count, (i + 1) * count), isFolded }))

/** A blank row between two rows of tiles, unless both are folded. */
const gapBefore = (rows: readonly TileRow[], i: number) => (i > 0 && !(rows[i]!.isFolded && rows[i - 1]!.isFolded) ? 1 : 0)

/** Every tile in full is as tall as the tallest of them; folded tiles do not count. */
const tileHeight = (rows: readonly TileRow[]) => Math.max(0, ...rows.flatMap(r => (r.isFolded ? [] : r.tiles.map(t => t.full.rows.length))))

/** Rows the tile rows take: the tile height a row in full, one a row folded, and the blank rows between them. */
const heightOf = (rows: readonly TileRow[]) => rows.reduce((n, r, i) => n + (r.isFolded ? 1 : tileHeight(rows)) + gapBefore(rows, i), 0)

/**
 * The order cards fold in, by how little each loses: folded, the pickers still name the model and effort with
 * `m` a key away, the cache keeps its countdown and Keep warm, the context its battery, the sessions their
 * counts; guesses folded cannot be marked, and next steps folded hide all but the first.
 */
const FOLD_ORDER: readonly CardId[] = ['model', 'cache', 'context', 'sessions', 'assume', 'next']

/** A row folds as early as the card in it that folds first. */
const foldRank = (r: TileRow) => Math.min(...r.tiles.map(t => FOLD_ORDER.indexOf(t.id)))

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
const spacer = text(' ')

/** Write and Read handoff for the bottom bar, longest first: the note goes, then the word handoff, then both buttons. */
function handoffForms(v: BandView): Piece[][] {
  const ho = v.handoff
  if (!ho) return [[]]
  const write = (label: string) => [text('✦', { color: 'claude' }), keyed('h', label, 'handoff')]
  const read = ho.hasNewest ? [spacer, text('◆', { color: 'suggestion' }), keyed('r', 'Read', 'readhandoff')] : []
  const note = [text(ho.note, { isDim: true })]
  return [
    [spacer, ...write('Write handoff'), ...read, spacer, ...note],
    [spacer, ...write('Write handoff'), ...read],
    [spacer, ...write('Write'), ...read],
    [],
  ]
}

/** The tiles laid in rows: their tile height, the rows (each in full or folded), and whether they fit. */
type Fitted = { cards: Card[]; height: number; rows: TileRow[]; fits: boolean }

/**
 * `cards` in rows of `count`, every tile in full as tall as the tallest, the rows folding in `FOLD_ORDER` (the
 * last row first among equals) until they fit in `budget` rows; a row holding a `kept` card stays in full.
 */
function fitted(cards: Card[], count: number, budget: number, kept: readonly CardId[]): Fitted {
  let rows = rowsOf(cards, count, false)
  const folding = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !r.tiles.some(t => kept.includes(t.id)))
    .sort((a, b) => foldRank(a.r) - foldRank(b.r) || b.i - a.i)
  for (const { i } of folding) {
    if (heightOf(rows) <= budget) break
    rows = rows.with(i, { ...rows[i]!, isFolded: true })
  }
  return { cards, height: tileHeight(rows), rows, fits: heightOf(rows) <= budget }
}

/**
 * The tiles that fit. The cards kept open, and the card pressed to the front (a folded guesses card cannot be
 * marked), stay in full while anything else can give way: the other rows fold, then the last other cards go.
 * Short of that the card pressed to the front folds, and only where the band cannot hold the kept cards in full
 * at all do they fold too, still shown while any other card can go behind `+N more`.
 */
function fitTiles(all: readonly Card[], count: number, budget: number, lead: CardId | null, keepOpen: readonly CardId[]): Fitted {
  const shown: CardId[] = lead && !keepOpen.includes(lead) ? [...keepOpen, lead] : [...keepOpen]
  for (const kept of [shown, [...keepOpen], []]) {
    let cards = [...all]
    while (cards.length > 0) {
      const f = fitted(cards, count, budget, kept)
      if (f.fits) return f
      const other = cards.findLastIndex(c => !shown.includes(c.id))
      const last = other >= 0 ? other : cards.findLastIndex(c => !kept.includes(c.id))
      if (last < 0) break
      cards = cards.toSpliced(last, 1)
    }
  }
  return { cards: [], height: 0, rows: [], fits: true }
}

/**
 * The cards as tiles of one size, in rows that line up: every tile as tall as the tallest, so each keeps the
 * same space whatever it holds. Short of rows, the rows fold to one row a tile, the ones that lose least first
 * (the pickers' row before the rest), while the rows of the cards kept open (next steps, unless the person says
 * otherwise) and the card pressed to the front stay in full; then the last tiles go, behind `+N more`. Which fold
 * hangs on their order and the rows, never on what they hold.
 */
function cardsPanel(v: BandView): Band {
  const { width, count, card } = cardLayout(v.columns)
  const nx = v.next
  const gs = v.guesses
  // Expanded guesses and next steps take their rows first, a blank row above each; the other cards fit in what is
  // left. With both expanded, the guesses come first and the next steps get the rows left after them.
  const guessesOut = v.isGuessesExpanded && gs && gs.length > 0 ? expandedGuesses(gs, width, v.maxRows - 1) : null
  const afterGuesses = v.maxRows - 1 - (guessesOut ? guessesOut.rows.length + 1 : 0)
  const nextOut = nx?.isExpanded && nx.items.length > 0 && afterGuesses > 1 ? expandedNext(nx.items, width, afterGuesses - 1) : null
  const all = cardsOf(v, card).filter(c => !(guessesOut && c.id === 'assume') && !(nextOut && c.id === 'next'))
  const budget = afterGuesses - (nextOut ? nextOut.rows.length + 1 : 0)
  const { cards, height, rows } = fitTiles(all, count, Math.max(0, budget), v.lead, v.keepOpen)
  const b = builder()
  rows.forEach((r, i) => {
    if (gapBefore(rows, i)) b.add(runs(' '.repeat(width)))
    b.append(sideBySide(r.tiles.map(t => (r.isFolded ? t.folded : padded(t.full, height))), r.isFolded ? 1 : height, card, width))
  })
  for (const out of [guessesOut, nextOut]) {
    if (!out) continue
    if (b.grid.rows.length > 0) b.add(runs(' '.repeat(width)))
    b.append(out)
  }
  const hidden = all.filter(c => !cards.includes(c))
  const tabPiece = [tab(true, needsYouOf(v))]
  // Narrow, `+N more` shortens to `+N`, then Settings to its key, before the handoff buttons or anything is cut.
  const lefts = (['more', 'n', 'key'] as const).map(form => {
    const left: Piece[] = v.settings.length > 0 ? [gear, form === 'key' ? piece('s', { color: 'claude', isBold: true }, 'settings') : keyed('s', 'Settings', 'settings')] : []
    if (hidden[0]) left.push(pill(form === 'more' ? `+${hidden.length} more` : `+${hidden.length}`, `more:${hidden[0].id}`, 'subtle'))
    return left
  })
  const left = lefts.find(l => fits(width, l, tabPiece)) ?? lefts.at(-1)!
  const handoff = handoffForms(v).find(f => fits(width, [...left, ...f], tabPiece)) ?? []
  return finish(gridOf([b.grid, bottomBar(v, width, [...left, ...handoff])]), width)
}

function settingRow(s: Setting, width: number): Line {
  const mark = s.kind === 'choice' ? text('◇', { isDim: true }) : s.isOn ? text('●', { color: 'success' }) : text('○', { isDim: true })
  const value = s.kind === 'toggle' ? (s.isOn ? '● On' : '○ Off') : s.value
  const right = [pill(value, `set:${s.key}`, s.kind === 'toggle' && s.isOn ? 'success' : 'subtle')]
  const left = [mark, text(pad(s.label, 16), { isBold: true }), text(s.desc, { isDim: true })]
  // Narrow, the description goes rather than end in an ellipsis; the label and its value stay.
  return line(width, fits(width, left, right) ? left : [mark, text(s.label, { isBold: true })], right)
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

/**
 * The modules behind the settings: each one's switch and `▲ ▼` for its card, as the Modules pane draws them, with
 * `s: Back` to the settings. Short of rows the closing hint goes first, then the rows give way to one switch each.
 */
function modulesPanel(v: BandView): Band {
  const { width } = cardLayout(v.columns)
  const budget = v.maxRows - 1
  const pane = modulesPaneGrid(v.modules.on, v.modules.order, width, v.modules.open)
  const b = builder()
  const kept = pane.rows.length <= budget ? pane.rows.length : pane.rows.length - 1 <= budget ? pane.rows.length - 1 : 0
  if (kept > 0) b.append({ rows: pane.rows.slice(0, kept), hits: pane.hits.filter(h => h.y < kept) })
  else {
    const pills = v.modules.order.map(id => pill(`${v.modules.on[id] ? '●' : '○'} ${MODULE_TITLES[id]}`, `module:toggle:${id}`, v.modules.on[id] ? 'success' : 'subtle'))
    for (const l of folded(pills, width).slice(0, Math.max(0, budget))) b.add(l.row, l.spans)
  }
  const back = bottomBar(v, width, [gear, keyed('s', 'Back', 'settings')])
  b.add(back.row, back.spans)
  return finish(b.grid, width)
}

/** The band: the closed row, or the open panel's cards, settings, or the modules behind them. */
export function bandGrid(v: BandView): Band {
  if (!v.isOpen) return closedRow(v)
  if (v.view === 'modules') return modulesPanel(v)
  return v.view === 'settings' && v.settings.length > 0 ? settingsPanel(v) : cardsPanel(v)
}
