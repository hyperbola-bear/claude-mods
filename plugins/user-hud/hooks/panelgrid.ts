// Pure band layout: the corner tab row, or the open panel above it, as one grid of cells and the actions on
// it, so a `Client` paints the band the same on the terminal and the desktop.
import { builder, line, pad, piece, put, runs, widthOf } from './cells.ts'
import type { Grid, Piece, Run } from './cells.ts'
import { footerRule, sectionRule } from './hud.ts'
import { NAME_WIDTH, layout } from './selectorgrid.ts'
import type { PickerProps } from './selectorgrid.ts'

/** One settings row: a toggle (On/Off) or a choice that cycles through its values. */
export type Setting = { key: string; label: string; desc: string; kind: 'toggle' | 'choice'; isOn: boolean; value: string }

/** Everything the band shows, as plain values; the hooks module works them out, this lays them out. */
export type BandView = {
  isOpen: boolean
  /** The open panel's width in cells. */
  width: number
  /** The widest the closed row may be. */
  maxWidth: number
  /** Rows the band may take; the panel drops dividers, then folds the settings, to fit. */
  maxRows: number
  /** The cache countdown chip; empty when nothing is cached. */
  chip: Run[]
  /** The plan window past its limit, worded (`5-hour limit 103%`); null when not on overage. */
  overage: string | null
  /** `1.2M tokens`; null before anything was counted. */
  usedTokens: string | null
  /** The model in its colour, a dot, the effort letter by letter. */
  setup: Run[]
  /** Keep warm: not offered, offered quietly (the cache is warm), or urged (it is cooling). */
  keepWarm: 'none' | 'quiet' | 'urged'
  isPinging: boolean
  pickers: PickerProps
  /** The tokens row: the stacked bar's runs of cells, the total, the two largest groups. */
  tokens: { segments: { color: string; cells: number }[]; total: string; leaders: string[] }
  /** The cache line, left of Keep warm. */
  cache: Run[]
  settings: Setting[]
  handoff: { hasNewest: boolean; note: string }
}

export type Band = Grid & { keys: Record<string, string>; width: number }

type Fit = 'full' | 'tight' | 'compact'

/** A button drawn in cells: its label on a filled ground. */
const pill = (label: string, action: string, bg: string, isDim = false): Piece => piece(` ${label} `, { bg, isDim }, action)

/** An action drawn as text, its hotkey first in the accent colour: `h: Write handoff`. */
function keyed(key: string, label: string, action: string): Piece {
  const r: Run[] = []
  put(r, key, { color: 'claude', isBold: true })
  put(r, `: ${label}`)
  return { runs: r, action }
}

const text = (s: string, look = {}): Piece => piece(s, look)

const tab = (isOpen: boolean): Piece => piece(` ◆ user-hud ${isOpen ? '▾' : '▴'} `, { bg: 'claude', isBold: true }, 'panel')

const keepWarm = (v: BandView): Piece | null =>
  v.keepWarm === 'none' ? null : pill('w: Keep warm', 'keepwarm', v.keepWarm === 'urged' ? 'warning' : 'subtle', v.keepWarm === 'quiet')

/** The closed row: the cache, overage, tokens, model and effort beside the tab; the least needed go first when narrow. */
function closedRow(v: BandView): Band {
  const kw = v.keepWarm === 'urged' && !v.isPinging ? keepWarm(v) : null
  // Lowest priority first: what goes when the row is too wide.
  const optional: (Piece | null)[] = [
    v.usedTokens ? text(v.usedTokens, { isDim: true }) : null,
    v.setup.length > 0 ? { runs: v.setup, action: null } : null,
    v.overage ? pill('New chat', 'newchat', 'subtle') : null,
    v.overage ? text('⚠ overage', { color: 'warning' }) : null,
    v.chip.length > 0 ? { runs: v.chip, action: null } : null,
  ]
  const order = (kept: (Piece | null)[]) =>
    [kept[4], kept[3], kept[2], kept[0], kept[1], kw, tab(false)].filter((p): p is Piece => p !== null)
  const widthOfRow = (ps: Piece[]) => ps.reduce((n, p) => n + widthOf(p.runs), 0) + 2 * Math.max(0, ps.length - 1)
  const kept = [...optional]
  for (let i = 0; i < kept.length && widthOfRow(order(kept)) > v.maxWidth; i += 1) kept[i] = null
  const pieces = order(kept)
  const width = widthOfRow(pieces)
  const b = builder()
  const l = line(width, [], pieces, 2)
  b.add(l.row, l.spans)
  return { ...b.grid, keys: kw ? { w: 'keepwarm' } : {}, width }
}

function tokensRow(v: BandView, width: number): ReturnType<typeof line> {
  const head: Run[] = runs(pad('TOKENS', NAME_WIDTH), { isDim: true })
  if (v.tokens.segments.length === 0) put(head, 'counting from the next request', { isDim: true })
  else for (const s of v.tokens.segments) put(head, ' '.repeat(s.cells), { bg: s.color })
  const left: Piece[] = [{ runs: head, action: null }]
  if (v.tokens.segments.length > 0) left.push(text(v.tokens.total), ...v.tokens.leaders.map(l => text(`· ${l}`, { isDim: true })))
  return line(width, left, [keyed('t', 'Details', 'tokens')])
}

function settingRow(s: Setting, width: number): ReturnType<typeof line> {
  const mark = s.kind === 'choice' ? text('◇', { isDim: true }) : s.isOn ? text('●', { color: 'success' }) : text('○', { isDim: true })
  const value = s.kind === 'toggle' ? (s.isOn ? '● On' : '○ Off') : s.value
  return line(width, [mark, text(pad(s.label, 16), { isBold: true }), text(s.desc, { isDim: true })], [pill(value, `set:${s.key}`, s.kind === 'toggle' && s.isOn ? 'success' : 'subtle')])
}

/** The settings folded onto as few rows as fit: one pill each, the same actions as the full rows. */
function settingsLines(v: BandView, width: number) {
  const pills = v.settings.map(s =>
    s.kind === 'toggle' ? pill(`${s.isOn ? '●' : '○'} ${s.label}`, `set:${s.key}`, s.isOn ? 'success' : 'subtle') : pill(s.value, `set:${s.key}`, 'subtle'),
  )
  const rows: Piece[][] = [[]]
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

function openPanel(v: BandView, fit: Fit): Band {
  const W = v.width
  const b = builder()
  const rule = (title: string) => b.add(runs(sectionRule(title, W), { isDim: true }))
  b.append(layout(v.pickers))
  const t = tokensRow(v, W)
  b.add(t.row, t.spans)
  if (fit === 'full') rule('CACHE')
  const cacheRight = v.isPinging ? [text('pinging…', { isDim: true })] : [keepWarm(v)].filter((p): p is Piece => p !== null)
  const c = line(W, [{ runs: v.cache, action: null }], cacheRight)
  b.add(c.row, c.spans)
  if (v.overage) {
    const o = line(W, [text('⚠ overage', { color: 'warning' }), text(`${v.overage} · a new chat costs less per turn`, { isDim: true })], [pill('New chat', 'newchat', 'subtle')])
    b.add(o.row, o.spans)
  }
  if (fit !== 'compact') {
    rule('SETTINGS')
    for (const s of v.settings) {
      const r = settingRow(s, W)
      b.add(r.row, r.spans)
    }
  } else {
    for (const r of settingsLines(v, W)) b.add(r.row, r.spans)
  }
  if (fit === 'full') rule('HANDOFF')
  const h = line(W, [
    text('✦', { color: 'claude' }),
    keyed('h', 'Write handoff', 'handoff'),
    text(' '),
    ...(v.handoff.hasNewest ? [text('◆', { color: 'suggestion' }), keyed('r', 'Read handoff', 'readhandoff'), text(' ')] : []),
    text(v.handoff.note, { isDim: true }),
  ])
  b.add(h.row, h.spans)
  if (fit === 'full') b.add(runs(footerRule('user-hud', W), { isDim: true }))
  const tr = line(W, [], [tab(true)])
  b.add(tr.row, tr.spans)
  const keys: Record<string, string> = { h: 'handoff', t: 'tokens' }
  if (v.handoff.hasNewest) keys.r = 'readhandoff'
  if (v.keepWarm !== 'none' && !v.isPinging) keys.w = 'keepwarm'
  return { ...b.grid, keys, width: W }
}

/** The band: the closed row, or the panel at the most generous fit its rows allow. */
export function bandGrid(v: BandView): Band {
  if (!v.isOpen) return closedRow(v)
  for (const fit of ['full', 'tight'] as const) {
    const g = openPanel(v, fit)
    if (g.rows.length <= v.maxRows) return g
  }
  return openPanel(v, 'compact')
}
