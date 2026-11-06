/**
 * Markdown tables fitted to the pane. A table that fits is left to the
 * Markdown element; one wider than the pane, which the pane would wrap into
 * broken borders, is drawn here instead: its cells wrapped inside columns
 * that share the width, or, too narrow for that, one entry a row.
 */

/** Prose as markdown, or a table: its cells, the header row first, and the markdown it was written as. */
export type Part = { kind: 'markdown'; text: string } | { kind: 'table'; rows: string[][]; source: string }

/** Narrower than this, a column's words break mid-word too often to read: the table becomes a list. */
export const MIN_COLUMN = 8

const isRow = (line: string): boolean => /^\s*\|.*\|\s*$/.test(line)
const isRule = (line: string): boolean => /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(line)

/** A table row's cells: split on `|` that no backslash escapes, the outer bars dropped. */
function cellsOf(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return inner.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'))
}

/** The text as markdown and the tables in it, in order; a fenced code block is never a table. */
export function tableParts(text: string): Part[] {
  const lines = text.split('\n')
  const parts: Part[] = []
  let prose: string[] = []
  let fence = false
  const flush = () => {
    if (prose.join('\n').trim() !== '') parts.push({ kind: 'markdown', text: prose.join('\n') })
    prose = []
  }
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (!fence && isRow(line) && isRule(lines[i + 1] ?? '')) {
      flush()
      const start = i
      const rows = [cellsOf(line)]
      i += 2
      while (i < lines.length && isRow(lines[i]!)) rows.push(cellsOf(lines[i++]!))
      const source = lines.slice(start, i).join('\n')
      i -= 1
      const n = rows[0]!.length
      parts.push({ kind: 'table', rows: rows.map(r => Array.from({ length: n }, (_, k) => r[k] ?? '')), source })
      continue
    }
    prose.push(line)
  }
  flush()
  return parts
}

/** A cell's words without the markdown marks a drawn table cannot show: bold, code, links. */
export const plainCell = (s: string): string =>
  s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(^|[\s(])\*(\S.*?\S|\S)\*(?=[\s).,;:!?]|$)/g, '$1$2')

/** Cells the text takes: one a character, two for the wide ones (CJK, most emoji). */
export function widthOf(s: string): number {
  let n = 0
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    n += (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0x1f300 && c <= 0x1faff) ? 2 : 1
  }
  return n
}

/** Cells a box table takes with columns this wide: `│ a │ b │`. */
const tableWidth = (columns: readonly number[]): number => columns.reduce((n, c) => n + c + 3, 1)

/** The width a table's markdown would draw at, its cells as they show. */
export const naturalWidth = (rows: readonly string[][]): number => tableWidth(naturals(rows))

const naturals = (rows: readonly string[][]): number[] => rows[0]!.map((_, k) => Math.max(1, ...rows.map(r => widthOf(plainCell(r[k] ?? '')))))

/** A column is first given room for its longest word, up to this; past it a word breaks. */
const WORD_ROOM = 16

/** Taller than this, a row reads better as an entry of a list. */
export const MAX_ROW_LINES = 6

const longestWord = (rows: readonly string[][], k: number): number =>
  Math.max(1, ...rows.flatMap(r => plainCell(r[k] ?? '').split(/\s+/).map(widthOf)))

/**
 * Each column's width within `width`: first room for its longest word (the
 * whole column where it is short), lowered evenly from the widest where even
 * that does not fit; then the room left shared by how much more each wants.
 * Null where a column would come out under `MIN_COLUMN` cells, or too narrow
 * for a word of up to `WORD_ROOM` cells, which it would break.
 */
export function columnWidths(rows: readonly string[][], width: number): number[] | null {
  const want = naturals(rows)
  const room = width - tableWidth(want.map(() => 0))
  let out = want.map((w, k) => Math.min(w, Math.max(MIN_COLUMN, Math.min(WORD_ROOM, longestWord(rows, k)))))
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0)
  if (sum(out) > room) {
    let level = Math.max(...out)
    while (level > 0 && sum(out.map(w => Math.min(w, level))) > room) level -= 1
    out = out.map(w => Math.min(w, level))
    const left = room - sum(out)
    // What the even lowering leaves over goes to the columns it cut, one cell each.
    for (let k = 0, n = left; n > 0 && k < out.length; k += 1) if (out[k]! < want[k]!) (out[k] = out[k]! + 1), (n -= 1)
  }
  // A column that would break a word it has room to hold (up to WORD_ROOM) reads worse than a list.
  if (out.some((w, k) => w < Math.min(MIN_COLUMN, want[k]!) || w < Math.min(WORD_ROOM, longestWord(rows, k)))) return null
  let extra = room - sum(out)
  const need = out.map((w, k) => want[k]! - w)
  const total = sum(need)
  if (extra > 0 && total > 0) {
    const share = need.map(n => Math.min(n, Math.floor((extra * n) / total)))
    out = out.map((w, k) => w + share[k]!)
    extra -= sum(share)
    for (const k of need.map((n, k) => ({ n, k })).sort((a, b) => b.n - a.n).map(x => x.k)) {
      if (extra <= 0) break
      if (out[k]! < want[k]!) (out[k] = out[k]! + 1), (extra -= 1)
    }
  }
  return out
}

/** The text in lines of at most `width` cells, at spaces where it can, mid-word where a word is longer. */
export function wrapCell(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word
    while (widthOf(w) > width) {
      if (line !== '') {
        lines.push(line)
        line = ''
      }
      let head = ''
      for (const ch of w) {
        if (widthOf(head + ch) > width) break
        head += ch
      }
      lines.push(head)
      w = w.slice(head.length)
    }
    if (line === '') line = w
    else if (widthOf(line) + 1 + widthOf(w) <= width) line += ` ${w}`
    else {
      lines.push(line)
      line = w
    }
  }
  if (line !== '' || lines.length === 0) lines.push(line)
  return lines
}

const padTo = (s: string, width: number): string => s + ' '.repeat(Math.max(0, width - widthOf(s)))

/** The table drawn in box lines no wider than `width`, its header's lines first; null where its columns or rows would not read. */
export function fittedTable(rows: readonly string[][], width: number): { header: string[]; body: string[] } | null {
  const widths = columnWidths(rows, width)
  if (!widths) return null
  const rule = (l: string, m: string, r: string) => l + widths.map(w => '─'.repeat(w + 2)).join(m) + r
  const lines = (row: readonly string[]): string[] => {
    const cells = row.map((c, k) => wrapCell(plainCell(c), widths[k]!))
    const height = Math.max(...cells.map(c => c.length))
    return Array.from({ length: height }, (_, y) => `│ ${cells.map((c, k) => padTo(c[y] ?? '', widths[k]!)).join(' │ ')} │`)
  }
  const rest = rows.slice(1)
  const drawn = rows.map(lines)
  if (drawn.some(r => r.length > MAX_ROW_LINES)) return null
  const body: string[] = [rule('├', '┼', '┤')]
  rest.forEach((_, i) => {
    if (i > 0) body.push(rule('├', '┼', '┤'))
    body.push(...drawn[i + 1]!)
  })
  body.push(rule('└', '┴', '┘'))
  return { header: [rule('┌', '┬', '┐'), ...drawn[0]!], body }
}

/** The table as markdown a narrow pane wraps cleanly: each row its first cell in bold, then the others by their header. */
export function tableAsList(rows: readonly string[][]): string {
  const [head, ...rest] = rows
  return rest
    .map(r => [`**${r[0] ?? ''}**`, ...r.slice(1).flatMap((c, k) => (c === '' ? [] : [`- ${head![k + 1] ?? ''}: ${c}`]))].join('\n'))
    .join('\n\n')
}
