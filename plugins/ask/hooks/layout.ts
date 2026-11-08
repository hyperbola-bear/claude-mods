/**
 * The pane's own scrolling. Docked, the pane draws exactly its body's height
 * and moves the answers itself, so the command bar stays at the bottom. The
 * engine reports no element heights, so the answers' rows are estimated from
 * their text, and the scroll stops a little past where they seem to end.
 *
 * The tree keeps a spare row above and below the body: a surface only sends
 * the wheel and the scroll keys when its window has room to move that way,
 * and every move is answered by parking the window back on row `PARKED`.
 */

/** Where the window over the tree is kept, so it can move either way. */
export const PARKED = 1

/**
 * Spacing units a row of text takes. The terminal and VS Code space in
 * cells; the desktop draws a unit of margin as half a row (measured on the
 * Code tab: a row of text 20px, a unit of margin 10px), and the phones use a
 * scale of their own like it.
 */
export const spacePerRow = (surface: string): number => (surface === 'terminal' || surface === 'vscode' ? 1 : 2)

/**
 * The columns text wraps at, for estimating its rows. The desktop's
 * proportional font fits about 1.3 times the columns it reports (32 to 38
 * characters a line at 28 columns, measured); a little less is assumed, as a
 * guess too short would leave the last rows out of reach.
 */
export const textColumns = (surface: string, width: number): number =>
  surface === 'terminal' || surface === 'vscode' ? width : Math.floor(width * 1.25)

/** Extra rows past the estimated end, so an answer drawn taller than guessed can still be read to its end. */
export const SLACK = 2

/** Rows of one line of plain text, wrapped at spaces to `width` columns. */
function lineRows(line: string, width: number): number {
  const words = line.trim().split(/\s+/).filter(w => w !== '')
  if (words.length === 0) return 1
  let rows = 1
  let used = 0
  for (const word of words) {
    const n = [...word].length
    if (used === 0) {
      rows += Math.floor(Math.max(0, n - 1) / width)
      used = ((n - 1) % width) + 1
    } else if (used + 1 + n <= width) {
      used += 1 + n
    } else {
      rows += 1 + Math.floor(Math.max(0, n - 1) / width)
      used = ((n - 1) % width) + 1
    }
  }
  return rows
}

/** Rows of plain text: each line wrapped, a blank line one row. */
export function textRows(text: string, width: number): number {
  const w = Math.max(1, width)
  return text.split('\n').reduce((sum, line) => sum + lineRows(line, w), 0)
}

const LIST_ITEM = /^\s*(?:\d+[.)]|[-*+])\s+/

/**
 * Rows of markdown as drawn: the marks that draw nothing dropped, a code
 * block's lines one row each, runs of blank lines one row, and none between
 * the items of a list (it is drawn tight). A list item wraps under its text.
 */
export function markdownRows(markdown: string, width: number): number {
  const lines = markdown.split('\n')
  let rows = 0
  let isCode = false
  let wasBlank = true
  let wasItem = false
  for (const [i, raw] of lines.entries()) {
    if (/^\s*```/.test(raw)) {
      isCode = !isCode
      continue
    }
    if (isCode) {
      rows += 1
      wasBlank = false
      continue
    }
    const line = raw
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\*\*|__|`/g, '')
    if (line.trim() === '') {
      const next = lines.slice(i + 1).find(l => l.trim() !== '')
      if (!wasBlank && !(wasItem && next !== undefined && LIST_ITEM.test(next))) rows += 1
      wasBlank = true
      continue
    }
    const marker = LIST_ITEM.exec(line)?.[0]
    if (marker) {
      const indent = [...marker].length
      rows += lineRows(line.slice(marker.length), Math.max(1, width - indent))
      wasItem = true
    } else {
      rows += lineRows(line, Math.max(1, width))
      wasItem = wasItem && /^\s/.test(raw)
    }
    wasBlank = false
  }
  return Math.max(1, rows)
}

/** Pixels of one row on the desktop, and of one column, for sizing an SVG picture in rows. */
const ROW_PX = 20
const COLUMN_PX = 8.4

/** Rows an SVG picture takes on the desktop, scaled down to the pane's width when wider. */
export function svgRows(svg: string, width: number): number {
  const box = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(svg)
  const w = Number(box?.[1] ?? /\bwidth="([\d.]+)/.exec(svg)?.[1] ?? 0)
  const h = Number(box?.[2] ?? /\bheight="([\d.]+)/.exec(svg)?.[1] ?? 0)
  if (!(w > 0 && h > 0)) return 12
  const scale = Math.min(1, (width * COLUMN_PX) / w)
  return Math.max(1, Math.ceil((h * scale) / ROW_PX))
}

/** Rows a row of items takes once it wraps: each item `width` columns, `gap` between. */
export function wrappedRows(widths: readonly number[], width: number, gap: number): number {
  let rows = 1
  let used = 0
  for (const w of widths) {
    if (used > 0 && used + gap + w > width) {
      rows += 1
      used = 0
    }
    used += (used > 0 ? gap : 0) + w
  }
  return rows
}

/** How the answers lay out under the window, from the last drawing. */
export type Metrics = {
  /** The answers' estimated rows, header included. */
  total: number
  /** The rows the answers show at once, above the bar. */
  visible: number
  /** Each exchange's first row (its margin), by id. */
  starts: ReadonlyMap<number, number>
}

export const lastOffset = (m: Metrics): number => Math.max(0, m.total - m.visible + SLACK)

export const clampOffset = (offset: number, m: Metrics): number => Math.max(0, Math.min(Math.round(offset), lastOffset(m)))

/**
 * Where a person's scroll leaves the answers. A page key moves a page of
 * answers (the engine counts the bar in its body), Home and End go to an end.
 */
export function scrolled(offset: number, by: number, e: { bodyRows: number; contentRows: number }, m: Metrics): number {
  if (by !== 0 && Math.abs(by) >= e.contentRows) return by < 0 ? 0 : lastOffset(m)
  const step = by !== 0 && Math.abs(by) === e.bodyRows ? Math.sign(by) * Math.max(1, m.visible - 2) : by
  return clampOffset(offset + step, m)
}

/** The offset that shows an exchange: unchanged when it is already in view, else its first row at the top. */
export function inView(offset: number, start: number | undefined, m: Metrics): number {
  if (start === undefined) return offset
  if (start >= offset && start < offset + Math.max(1, m.visible - 2)) return offset
  return clampOffset(start, m)
}
