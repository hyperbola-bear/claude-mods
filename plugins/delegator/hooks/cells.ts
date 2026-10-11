// Pure cell layout: rows of styled runs, laid out by the plugin cell by cell, and the cells each action
// covers. A `Client` paints them the same on the terminal and the desktop; a pointer lands on an action.

/** A run of cells in one look. Colours are a theme key (`success`) or hex; empty means the default. */
export type Run = { text: string; color: string; bg: string; isDim: boolean; isBold: boolean; isUnderline: boolean }

export type Look = Partial<Omit<Run, 'text'>>

/** Where an action sits: its row, and its cells from `x0` up to, not including, `x1`. */
export type Hit = { id: string; y: number; x0: number; x1: number }

export type Grid = { rows: Run[][]; hits: Hit[] }

/** What the band hands its surface module: the grid, and the keys that run an action while it has the focus. */
export type CellsProps = { rows: Run[][]; hits: Hit[]; keys: Record<string, string> }

/** A stretch of a row: its runs, and the action it runs when pressed, if any. */
export type Piece = { runs: Run[]; action: string | null }

const PLAIN: Omit<Run, 'text'> = { color: '', bg: '', isDim: false, isBold: false, isUnderline: false }

const sameLook = (a: Omit<Run, 'text'>, b: Omit<Run, 'text'>) =>
  a.color === b.color && a.bg === b.bg && a.isDim === b.isDim && a.isBold === b.isBold && a.isUnderline === b.isUnderline

/** Adds cells to a row, merging them into the run before when they look alike. */
export function put(row: Run[], text: string, look: Look = {}) {
  if (text === '') return
  const run = { ...PLAIN, ...look, text }
  const last = row.at(-1)
  if (last && sameLook(last, run)) last.text += text
  else row.push(run)
}

export const runs = (text: string, look: Look = {}): Run[] => {
  const row: Run[] = []
  put(row, text, look)
  return row
}

export const widthOf = (row: readonly Run[]) => row.reduce((n, r) => n + r.text.length, 0)

/** The row cut to `n` cells, its last cell `…` when anything was cut. */
export function cut(row: readonly Run[], n: number): Run[] {
  if (widthOf(row) <= n) return row.map(r => ({ ...r }))
  const out: Run[] = []
  let left = Math.max(0, n - 1)
  for (const r of row) {
    if (left <= 0) break
    put(out, r.text.slice(0, left), r)
    left -= Math.min(left, r.text.length)
  }
  if (n > 0) put(out, '…', { isDim: true })
  return out
}

export const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length))

export const piece = (text: string, look: Look = {}, action: string | null = null): Piece => ({ runs: runs(text, look), action })

/**
 * One row `width` cells across: the left pieces from the left edge, the right pieces against the right
 * edge, `gap` cells between pieces. The left side gives way first: its last pieces are cut to fit.
 */
export function line(width: number, left: readonly Piece[], right: readonly Piece[] = [], gap = 1): { row: Run[]; spans: { action: string; x0: number; x1: number }[] } {
  const join = (pieces: readonly Piece[]) => {
    const row: Run[] = []
    const spans: { action: string; x0: number; x1: number }[] = []
    pieces.forEach((p, i) => {
      if (i > 0) put(row, ' '.repeat(gap))
      const x0 = widthOf(row)
      for (const r of p.runs) put(row, r.text, r)
      if (p.action) spans.push({ action: p.action, x0, x1: widthOf(row) })
    })
    return { row, spans }
  }
  const r = join(right)
  const rightWidth = widthOf(r.row)
  const room = Math.max(0, width - rightWidth - (rightWidth > 0 && left.length > 0 ? gap : 0))
  const l = join(left)
  const leftRow = cut(l.row, room)
  const leftSpans = l.spans.filter(s => s.x1 <= widthOf(leftRow))
  const row = [...leftRow]
  put(row, ' '.repeat(Math.max(0, width - widthOf(leftRow) - rightWidth)))
  const offset = widthOf(row)
  for (const run of r.row) put(row, run.text, run)
  return { row, spans: [...leftSpans, ...r.spans.map(s => ({ ...s, x0: s.x0 + offset, x1: s.x1 + offset }))] }
}

/** Builds a grid row by row. */
export function builder() {
  const g: Grid = { rows: [], hits: [] }
  return {
    grid: g,
    /** Adds a row and the actions on it. */
    add(row: Run[], spans: readonly { action: string; x0: number; x1: number }[] = []) {
      const y = g.rows.length
      g.rows.push(row)
      for (const s of spans) g.hits.push({ id: s.action, y, x0: s.x0, x1: s.x1 })
    },
    /** Adds another grid's rows below, its actions moved down with them. */
    append(other: Grid, dx = 0) {
      const y0 = g.rows.length
      for (const row of other.rows) g.rows.push(dx > 0 ? [...runs(' '.repeat(dx)), ...row] : row)
      for (const h of other.hits) g.hits.push({ ...h, y: h.y + y0, x0: h.x0 + dx, x1: h.x1 + dx })
    },
  }
}

/** Words wrapped to `width` cells, as rows in one look. */
export function wrap(text: string, width: number, look: Look = {}): Run[][] {
  const rows: Run[][] = []
  let cur = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (cur && cur.length + 1 + word.length > width) {
      rows.push(runs(cur, look))
      cur = word
    } else {
      cur = cur ? `${cur} ${word}` : word
    }
  }
  if (cur) rows.push(runs(cur, look))
  return rows
}

/** The action at a cell, or null. */
export const hitAt = (g: Pick<Grid, 'hits'>, x: number, y: number): string | null => g.hits.find(h => h.y === y && x >= h.x0 && x < h.x1)?.id ?? null

/** The actions in reading order, once each, for the arrow keys. */
export function order(g: Pick<Grid, 'hits'>): string[] {
  const seen = new Set<string>()
  const sorted = [...g.hits].sort((a, b) => a.y - b.y || a.x0 - b.x0)
  return sorted.filter(h => (seen.has(h.id) ? false : (seen.add(h.id), true))).map(h => h.id)
}

/** The rows with the cells of one action underlined: the one under the pointer or the keys. */
export function underlined(g: Grid, action: string | null): Run[][] {
  if (action === null) return g.rows
  const marks = g.hits.filter(h => h.id === action)
  return g.rows.map((row, y) => {
    const here = marks.filter(h => h.y === y)
    if (here.length === 0) return row
    const out: Run[] = []
    let x = 0
    for (const r of row) {
      for (const ch of r.text) {
        const isIn = here.some(h => x >= h.x0 && x < h.x1) && ch !== ' '
        put(out, ch, { ...r, isUnderline: r.isUnderline || isIn })
        x += 1
      }
    }
    return out
  })
}

/** The rows as plain text. */
export const plain = (g: Pick<Grid, 'rows'>) => g.rows.map(r => r.map(run => run.text).join(''))

/** The text an action covers. */
export function textOf(g: Grid, action: string): string | null {
  const h = g.hits.find(x => x.id === action)
  return h ? (plain(g)[h.y] ?? '').slice(h.x0, h.x1) : null
}
