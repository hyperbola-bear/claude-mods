/**
 * A box drawing redrawn as vector strokes: each box-drawing character is the
 * lines it stands for, from its cell's center to the edges it joins, so the
 * strokes meet whatever the font; arrows get heads that reach the border
 * they point at, decision corners and state dots get their marks, and the
 * words stay text on the same grid.
 */

/** The edges of its cell a character joins: up, down, left, right; `-` dashed, `o` rounded. */
const LINES: Record<string, string> = {
  '─': 'lr', '━': 'lr', '═': 'lr', '╌': 'lr-', '┄': 'lr-', '╴': 'l', '╶': 'r',
  '│': 'ud', '┃': 'ud', '║': 'ud', '╎': 'ud-', '┆': 'ud-', '┊': 'ud-', '╵': 'u', '╷': 'd',
  '┌': 'rd', '╔': 'rd', '⌜': 'rd', '┐': 'ld', '╗': 'ld', '⌝': 'ld',
  '└': 'ur', '╚': 'ur', '⌞': 'ur', '┘': 'ul', '╝': 'ul', '⌟': 'ul',
  '╭': 'rdo', '╮': 'ldo', '╰': 'uro', '╯': 'ulo',
  '├': 'udr', '╟': 'udr', '┤': 'udl', '╢': 'udl', '┬': 'lrd', '┴': 'lru', '┼': 'udlr',
}

/** Arrowheads, by the way they point. */
const ARROWS: Record<string, Dir> = { '▶': 'r', '►': 'r', '▷': 'r', '◀': 'l', '◄': 'l', '◁': 'l', '▲': 'u', '△': 'u', '▼': 'd', '▽': 'd' }

/** Marks that sit where lines meet: a decision's corners, a state's start and end. */
const MARKS: Record<string, 'diamond' | 'dot' | 'ring'> = { '◇': 'diamond', '◆': 'diamond', '●': 'dot', '◉': 'dot', '○': 'ring', '◎': 'ring', '◯': 'ring' }

type Dir = 'u' | 'd' | 'l' | 'r'
const OPPOSITE: Record<Dir, Dir> = { u: 'd', d: 'u', l: 'r', r: 'l' }
const STEP: Record<Dir, [number, number]> = { u: [-1, 0], d: [1, 0], l: [0, -1], r: [0, 1] }

export const CELL = { width: 8.4, height: 18, pad: 12 }

const isDrawing = (c: string | undefined): boolean => c !== undefined && (c in LINES || c in ARROWS || c in MARKS)

const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const n = (v: number): string => (Math.round(v * 10) / 10).toString()

export function boxArtSvg(lines: readonly string[], darkTheme: string): string {
  const grid = lines.map(l => [...l])
  const cols = Math.max(0, ...grid.map(r => r.length))
  const at = (row: number, col: number): string | undefined => grid[row]?.[col]
  const joins = (c: string | undefined, d: Dir): boolean => c !== undefined && (LINES[c]?.includes(d) ?? false)
  // A mark or an arrow joins the neighbours whose own lines reach back to it.
  const reaching = (row: number, col: number): Dir[] =>
    (['u', 'd', 'l', 'r'] as Dir[]).filter(d => {
      const [dr, dc] = STEP[d]
      const other = at(row + dr, col + dc)
      return joins(other, OPPOSITE[d]) || (other !== undefined && other in ARROWS && ARROWS[other] === OPPOSITE[d])
    })

  const solid: string[] = []
  const dashed: string[] = []
  const heads: string[] = []
  const marks: string[] = []
  const words: string[] = []

  grid.forEach((row, r) => {
    const cy = CELL.pad + (r + 0.5) * CELL.height
    let c = 0
    while (c < row.length) {
      const ch = row[c] ?? ' '
      const cx = CELL.pad + (c + 0.5) * CELL.width
      const edge: Record<Dir, [number, number]> = {
        u: [cx, cy - CELL.height / 2],
        d: [cx, cy + CELL.height / 2],
        l: [cx - CELL.width / 2, cy],
        r: [cx + CELL.width / 2, cy],
      }
      const spec = LINES[ch]
      if (spec !== undefined) {
        const dirs = [...spec].filter((x): x is Dir => 'udlr'.includes(x))
        const out = spec.includes('-') ? dashed : solid
        if (spec.includes('o') && dirs.length === 2) {
          const [a, b] = dirs as [Dir, Dir]
          out.push(`M${n(edge[a][0])} ${n(edge[a][1])}Q${n(cx)} ${n(cy)} ${n(edge[b][0])} ${n(edge[b][1])}`)
        } else {
          for (const d of dirs) out.push(`M${n(cx)} ${n(cy)}L${n(edge[d][0])} ${n(edge[d][1])}`)
        }
      } else if (ch in ARROWS) {
        const to = ARROWS[ch] as Dir
        const [dr, dc] = STEP[to]
        // The head reaches the border it points at, drawn at the next cell's center.
        const beyond = at(r + dr, c + dc)
        const reach = isDrawing(beyond) ? 1 : 0.5
        const tip: [number, number] = [cx + dc * CELL.width * reach, cy + dr * CELL.height * reach]
        for (const d of reaching(r, c)) {
          if (d !== to) solid.push(`M${n(cx)} ${n(cy)}L${n(edge[d][0])} ${n(edge[d][1])}`)
        }
        const len = 6
        const half = 3.2
        const base: [number, number] = [tip[0] - dc * len, tip[1] - dr * len]
        solid.push(`M${n(cx)} ${n(cy)}L${n(base[0])} ${n(base[1])}`)
        // Across the shaft: vertical for a sideways arrow, horizontal for an upright one.
        const across: [number, number] = [dr * half, dc * half]
        heads.push(`M${n(tip[0])} ${n(tip[1])}L${n(base[0] + across[0])} ${n(base[1] + across[1])}L${n(base[0] - across[0])} ${n(base[1] - across[1])}Z`)
      } else if (ch in MARKS) {
        for (const d of reaching(r, c)) solid.push(`M${n(cx)} ${n(cy)}L${n(edge[d][0])} ${n(edge[d][1])}`)
        const kind = MARKS[ch]
        if (kind === 'diamond') marks.push(`<path class="mark" d="M${n(cx)} ${n(cy - 3.5)}L${n(cx + 3.5)} ${n(cy)}L${n(cx)} ${n(cy + 3.5)}L${n(cx - 3.5)} ${n(cy)}Z"/>`)
        else marks.push(`<circle class="${kind}" cx="${n(cx)}" cy="${n(cy)}" r="4"/>`)
      } else if (ch !== ' ') {
        // A run of words up to the next drawing character, single spaces kept inside it. An edge
        // label is written over its line, its spaces left as line: a lone ─ between words is a space.
        let end = c
        const isWord = (x: string | undefined) => x !== undefined && x !== ' ' && !isDrawing(x)
        const goesOn = (i: number): boolean => {
          const x = row[i]
          if (x === ' ') return isWord(row[i + 1])
          if (x === '─') return isWord(row[i - 1]) && isWord(row[i + 1])
          return isWord(x)
        }
        while (end < row.length && goesOn(end)) end += 1
        const text = row.slice(c, end).join('').replace(/─/g, ' ')
        const x = CELL.pad + c * CELL.width
        const w = text.length * CELL.width
        // A patch of background under the words, so a line they sit on does not cross them.
        words.push(`<rect class="under" x="${n(x - 1)}" y="${n(cy - 7.5)}" width="${n(w + 2)}" height="15"/>`)
        words.push(`<text x="${n(x)}" y="${n(cy)}" textLength="${n(w)}" lengthAdjust="spacing">${escape(text)}</text>`)
        c = end
        continue
      }
      c += 1
    }
  })

  const width = Math.ceil(cols * CELL.width + CELL.pad * 2)
  const height = Math.ceil(grid.length * CELL.height + CELL.pad * 2)
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="--bg:#FFFFFF;--fg:#27272A">`,
    '<style>',
    '  svg { --_line: color-mix(in srgb, var(--fg) 55%, var(--bg)); }',
    "  text { font: 13px ui-monospace, 'SF Mono', Menlo, Consolas, monospace; fill: var(--fg); dominant-baseline: central; white-space: pre; }",
    '  .s, .d { fill: none; stroke: var(--_line); stroke-width: 1.3; stroke-linecap: square; }',
    '  .d { stroke-dasharray: 3 3; }',
    '  .h, .dot { fill: var(--_line); }',
    '  .mark, .ring { fill: var(--bg); stroke: var(--_line); stroke-width: 1.3; }',
    '  .under { fill: var(--bg); }',
    `  ${darkTheme}`,
    '</style>',
    // Its own background, so the drawing reads the same whatever is behind it.
    `<rect width="${width}" height="${height}" rx="6" fill="var(--bg)"/>`,
    solid.length > 0 ? `<path class="s" d="${solid.join('')}"/>` : '',
    dashed.length > 0 ? `<path class="d" d="${dashed.join('')}"/>` : '',
    heads.length > 0 ? `<path class="h" d="${heads.join('')}"/>` : '',
    ...marks,
    ...words,
    '</svg>',
  ].join('')
}
