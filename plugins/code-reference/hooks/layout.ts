// Rows of styled text, laid out by the mod itself at the width it is given:
// the reply (wrapped prose, the boxes under each section, the code under one
// when the pane is closed) and the pane (one header line, the rest code).
// Both surface modules draw these rows as Text, so the terminal and the
// desktop app show the same cells. No `$` here.
import type { CodeLine, CodeView, Place } from '../types'
import { splitPath } from './code.ts'
import type { Block, Doc, Inline } from './doc.ts'

/** A run of one style; `hit` names what a click on it does; `soft` marks a syntax colour, the first thing dropped when a drawing runs out of room. */
export type Span = { t: string; fg?: string; bg?: string; b?: boolean; d?: boolean; u?: boolean; i?: boolean; hit?: string; soft?: boolean }
export type Row = Span[]

/** The code shown under a section while the pane is closed; `signs` whether the window it came from has changed lines. */
export type InlineCode = { place: Place; view: CodeView | null; tag: string; signs?: boolean }

/** What the reply's surface module is handed. */
export type ReplyProps = { key: string; doc: Doc; current: number | null; inline: InlineCode | null; cols: number }

/** What the pane's surface module is handed. */
export type PaneProps = {
  place: Place | null
  view: CodeView | null
  /** Where the code comes from, for the header: `local`, `uncommitted edits`, `PR #12 worktree`. */
  tag: string
  /** A line above the code saying what went wrong (the GitHub page did not load), with retry. */
  note: string | null
  isPr: boolean
  /** What the pane says with no place to show. */
  empty: string
  cols: number
  rows: number
}

const DIM = { fg: 'inactive', d: true } as const
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'

export const S = (t: string, style: Omit<Span, 't'> = {}): Span => ({ t, ...style })
export const width = (row: Row) => row.reduce((n, s) => n + s.t.length, 0)
export const pad = (row: Row, w: number, style: Omit<Span, 't'> = {}): Row => {
  const n = w - width(row)
  return n > 0 ? [...row, S(' '.repeat(n), style)] : row
}
const sup = (n: number) => String(n).split('').map(d => SUP[Number(d)] ?? '').join('')
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s)
export const placeId = (n: number) => `place:${n}`

/** `review.ts:42-54`, `review.ts:92`, `review.ts`: what a box and the pane's header call a place. */
export const lines = (p: Place) => (p.line > 0 ? `:${p.line}${p.endLine > p.line ? `-${p.endLine}` : ''}` : '')

/** Each place's name in a box: its file, or more of its path where two files share a name. */
function names(places: readonly Place[]): Map<number, string> {
  const out = new Map<number, string>()
  for (const p of places) {
    const file = splitPath(p.path).file
    const clash = places.some(q => q.path !== p.path && splitPath(q.path).file === file)
    out.set(p.n, clash ? p.path.split('/').slice(-2).join('/') : file)
  }
  return out
}

// ---------- prose ----------

type Ch = { c: string; st: Omit<Span, 't'> }

/** How a run looks: links to places in the accent, the shown one in Claude's color, the hovered one lit. */
function styleOf(run: Inline, current: number | null, hover: string | null): { st: Omit<Span, 't'>; mark?: Omit<Span, 't'> } {
  if (run.k === 'code') return { st: { fg: 'permission' } }
  if (run.k === 'bold') return { st: { b: true } }
  if (run.k === 'italic') return { st: { i: true } }
  if (run.k === 'url') return { st: { fg: 'suggestion', u: true, hit: `url:${run.href ?? ''}` } }
  if (run.k === 'place' && run.n !== undefined) {
    const id = placeId(run.n)
    const on = current === run.n
    const fg = on ? 'claude' : 'suggestion'
    return { st: { fg, u: true, b: on, bg: hover === id && !on ? 'userMessageBackground' : undefined, hit: id }, mark: { fg, hit: id } }
  }
  return { st: {} }
}

/** Runs wrapped at `w`: words break on spaces and keep their style; a word longer than the row is cut across rows. */
export function wrap(runs: readonly Inline[], w: number, current: number | null, hover: string | null, base: Omit<Span, 't'> = {}): Row[] {
  const chars: Ch[] = []
  for (const run of runs) {
    const { st, mark } = styleOf(run, current, hover)
    const style = { ...base, ...st }
    for (const c of run.t.replace(/\s+/g, ' ')) chars.push({ c, st: style })
    if (mark && run.n !== undefined) for (const c of sup(run.n)) chars.push({ c, st: mark })
  }
  const words: Ch[][] = []
  let word: Ch[] = []
  for (const ch of chars) {
    if (ch.c === ' ') {
      if (word.length) words.push(word)
      word = []
    } else word.push(ch)
  }
  if (word.length) words.push(word)
  const room = Math.max(1, w)
  const out: Ch[][] = []
  let row: Ch[] = []
  words.forEach((wd, i) => {
    if (row.length && row.length + 1 + wd.length > room) {
      out.push(row)
      row = []
    }
    if (row.length) {
      const prev = words[i - 1] as Ch[]
      const same = prev[prev.length - 1]?.st === wd[0]?.st
      row.push({ c: ' ', st: same && wd[0] ? wd[0].st : base })
    }
    let rest = wd
    while (row.length + rest.length > room) {
      const take = room - row.length
      row.push(...rest.slice(0, take))
      out.push(row)
      row = []
      rest = rest.slice(take)
    }
    row.push(...rest)
  })
  if (row.length) out.push(row)
  return out.map(cs => {
    const spans: Span[] = []
    let from: Omit<Span, 't'> | null = null
    for (const ch of cs) {
      const last = spans[spans.length - 1]
      if (last && from === ch.st) last.t += ch.c
      else {
        spans.push(S(ch.c, ch.st))
        from = ch.st
      }
    }
    return spans
  })
}

// ---------- code ----------

const KEYWORDS = new Set(
  'as async await break case catch class const continue def default defer do elif else enum export extends false final finally fn for from func function go if impl import in interface is let match mut new nil none null of package pub raise return self static struct super switch this throw true try type undefined use var void while with yield'.split(' '),
)
const TOKEN = /(\/\/.*$|#(?![\w[{(]).*$|--\s.*$)|('(?:[^'\\]|\\.)*'?|"(?:[^"\\]|\\.)*"?|`(?:[^`\\]|\\.)*`?)|([A-Za-z_$][\w$]*)|(\d[\w.]*)/g

/** A line of code as colored runs: comments, strings, keywords, numbers. */
export function tokens(text: string): { t: string; fg: string }[] {
  const s = text.replace(/\t/g, '  ')
  const lead = s.trimStart()
  if (lead.startsWith('*') || lead.startsWith('/*')) return [{ t: s, fg: 'inactive' }]
  const out: { t: string; fg: string }[] = []
  let last = 0
  for (const m of s.matchAll(TOKEN)) {
    const at = m.index ?? 0
    if (at > last) out.push({ t: s.slice(last, at), fg: 'text' })
    last = at + m[0].length
    if (m[1]) out.push({ t: m[1], fg: 'inactive' })
    else if (m[2]) out.push({ t: m[2], fg: 'success' })
    else if (m[3]) out.push({ t: m[3], fg: KEYWORDS.has(m[3]) ? 'merged' : 'text' })
    else out.push({ t: m[0], fg: 'warning' })
  }
  if (last < s.length) out.push({ t: s.slice(last), fg: 'text' })
  return out
}

/** Whether a row is one of the place's lines (a removed line counts where it sat). */
export const isTarget = (r: CodeLine, p: Place | null) => p !== null && p.line > 0 && r.p >= p.line && r.p <= p.endLine

/**
 * One code line in `w` cells: the mark on the place's lines, the line number,
 * a + or - on a changed line (when `signs`), the code colored and cut to fit,
 * an added or removed line on its color across the row, the changed words stronger.
 */
export function codeRow(r: CodeLine, p: Place | null, numW: number, w: number, signs: boolean): Row {
  const isHit = isTarget(r, p)
  const bg = r.k === '+' ? 'diffAdded' : r.k === '-' ? 'diffRemoved' : undefined
  const word = r.k === '+' ? 'diffAddedWord' : 'diffRemovedWord'
  const lit = isHit || r.k !== ' '
  const row: Row = [S(isHit ? '▌' : ' ', { fg: 'claude' }), S(String(r.n ?? r.o ?? '').padStart(numW) + ' ', lit ? { fg: 'text', d: r.k === '-' } : DIM)]
  if (signs) row.push(S(r.k === ' ' ? '  ' : `${r.k} `, { fg: 'text', bg }))
  const room = w - width(row)
  const [a, b] = r.hot && r.hot[1] > r.hot[0] ? r.hot : [-1, -1]
  let at = 0
  let left = room
  const full = r.s.replace(/\t/g, '  ').length
  if (full > room) left -= 1
  for (const tok of tokens(r.s)) {
    for (let i = 0; i < tok.t.length && left > 0; ) {
      // Split a token where the changed words start or end.
      const edge = [a, b].filter(x => x > at + i).sort((x, y) => x - y)[0] ?? Infinity
      const take = Math.min(tok.t.length - i, edge - (at + i), left)
      const inHot = at + i >= a && at + i < b
      row.push(S(tok.t.slice(i, i + take), { fg: tok.fg, bg: inHot ? word : bg, d: !lit, soft: true }))
      i += take
      left -= take
    }
    at += tok.t.length
  }
  if (full > room) row.push(S('…', { fg: 'inactive', bg }))
  return pad(row, w, bg ? { bg } : {})
}

// ---------- the reply ----------

/** A section's places as one row of boxes sharing their walls, the number in the top edge; wrapped onto more rows when they do not fit. */
export function boxRows(ns: readonly number[], places: readonly Place[], w: number, current: number | null, hover: string | null): Row[] {
  const named = names(places)
  const cells = ns.map(n => places.find(p => p.n === n)).filter((p): p is Place => p !== undefined).map(p => ({ p, name: named.get(p.n) ?? p.path, loc: lines(p) }))
  const look = (n: number) => (current === n ? 2 : hover === placeId(n) ? 1 : 0)
  const edge = (k: number): Omit<Span, 't'> => (k === 2 ? { fg: 'claude' } : k === 1 ? { fg: 'text' } : DIM)
  const groups: (typeof cells)[] = []
  let group: typeof cells = []
  let used = 1
  for (const c of cells) {
    const cw = Math.min(c.name.length + c.loc.length, w - 3) + 3
    if (group.length && used + cw > w) {
      groups.push(group)
      group = []
      used = 1
    }
    group.push(c)
    used += cw
  }
  if (group.length) groups.push(group)
  const out: Row[] = []
  for (const g of groups) {
    const top: Row = []
    const mid: Row = []
    const bot: Row = []
    g.forEach((c, k) => {
      const H = { hit: placeId(c.p.n) }
      const own = { ...edge(look(c.p.n)), ...H }
      const prev = g[k - 1]
      const wall = edge(Math.max(look(c.p.n), prev ? look(prev.p.n) : 0))
      const label = cut(c.name + c.loc, w - 3)
      const name = label.slice(0, Math.min(c.name.length, label.length))
      const cw = label.length + 2
      const num = String(c.p.n)
      const on = look(c.p.n) === 2
      top.push(S(k === 0 ? '╭' : '┬', wall), S('─ ', own), S(num, on ? { fg: 'claude', b: true, ...H } : { fg: look(c.p.n) ? 'text' : 'inactive', ...H }), S(` ${'─'.repeat(Math.max(0, cw - 3 - num.length))}`, own))
      mid.push(S('│', wall), S(' ', H), S(name, { b: true, ...H }), S(label.slice(name.length), { d: true, ...H }), S(' ', H))
      bot.push(S(k === 0 ? '╰' : '┴', wall), S('─'.repeat(cw), own))
    })
    const last = g[g.length - 1]
    const end = edge(last ? look(last.p.n) : 0)
    top.push(S('╮', end))
    mid.push(S('│', end))
    bot.push(S('╯', end))
    out.push(top, mid, bot)
  }
  return out
}

/** The pane's header path: the folder cut from the left to fit, the file bold, the lines dim. */
function pathSpans(p: Place, w: number): Row {
  const { dir, file } = splitPath(p.path)
  const tail = file + lines(p)
  const room = Math.max(0, w - tail.length)
  const shown = dir.length > room ? (room > 1 ? `…${dir.slice(dir.length - room + 1)}` : '') : dir
  return [S(shown, { d: true }), S(file, { b: true }), S(lines(p), { d: true })]
}

/** The rows of a view around a place: up to `max` lines from a little above it. */
function near(view: CodeView & { kind: 'rows' }, p: Place, max: number): CodeLine[] {
  const at = Math.max(0, view.rows.findIndex(r => r.p >= Math.max(1, p.line) - 2))
  return view.rows.slice(at, at + Math.min(max, Math.max(1, p.endLine - p.line + 5)))
}

/**
 * The inline code as the reply's region is handed it: the rows its box shows,
 * not the whole window the pane scrolls through, so the props stay small.
 */
export function trimInline(code: InlineCode): InlineCode {
  const { place: p, view } = code
  if (!view || view.kind !== 'rows') return code
  return { ...code, signs: view.rows.some(r => r.k !== ' '), view: { ...view, rows: near(view, p, 16) } }
}

/** The code under the section while the pane is closed, boxed in the shown place's color. */
export function codeBox(code: InlineCode, w: number): Row[] {
  const { place: p, view } = code
  const C = { fg: 'claude' }
  const inner = w - 4
  const tag = ` ${code.tag} `
  const head: Row = [S(String(p.n), { fg: 'claude', b: true }), S('  '), ...pathSpans(p, Math.max(8, inner - tag.length - 8))]
  const out: Row[] = [[S('╭─ ', C), ...head, S(` ${'─'.repeat(Math.max(0, w - 6 - width(head) - tag.length))}`, C), S(tag, { d: true }), S('─╮', C)]]
  const body = (row: Row) => out.push([S('│ ', C), ...pad(row, inner), S(' │', C)])
  if (!view) body([S('Loading code…', { d: true })])
  else if (view.kind === 'error') for (const r of wrap([{ t: view.note, k: 'text' }], inner, null, null, { fg: 'error' })) body(r)
  else {
    const rows = near(view, p, 16)
    const numW = Math.max(1, ...rows.map(r => String(r.n ?? r.o ?? '').length))
    const signs = code.signs ?? view.rows.some(r => r.k !== ' ')
    for (const r of rows) body(codeRow(r, p, numW, inner, signs))
  }
  const left: Row = [S('╰─ ', C), S('‹ prev', { fg: 'suggestion', hit: 'prev' }), S('  ', C), S('next ›', { fg: 'suggestion', hit: 'next' }), S(' ', C)]
  const right: Row = [S(' ', C), S('open in pane', { fg: 'suggestion', hit: 'pane' }), S(' · ', { d: true }), S('editor', { fg: 'suggestion', hit: 'editor' }), S(' ─╯', C)]
  out.push([...left, S('─'.repeat(Math.max(0, w - width(left) - width(right))), C), ...right])
  return out
}

/** One block's rows at width `w`. */
function blockRows(b: Block, doc: Doc, w: number, current: number | null, hover: string | null, inline: InlineCode | null): Row[] {
  if (b.kind === 'heading') return wrap(b.inl, w, current, hover, { b: true })
  if (b.kind === 'para') return wrap(b.inl, w, current, hover)
  if (b.kind === 'quote') return wrap(b.inl, w - 2, current, hover, { d: true }).map(r => [S('│ ', DIM), ...r])
  if (b.kind === 'item') {
    const lead = '  '.repeat(b.indent) + b.bullet + ' '
    return wrap(b.inl, w - lead.length, current, hover).map((r, i) => [S(i === 0 ? lead : ' '.repeat(lead.length), { d: b.bullet === '•' }), ...r])
  }
  if (b.kind === 'rule') return [[S('─'.repeat(w), DIM)]]
  if (b.kind === 'raw') return b.lines.map(l => [S(cut(l, w))])
  if (b.kind === 'fence') {
    const isDiff = b.lang === 'diff' || b.lines.some(l => /^@@ /.test(l))
    return b.lines.map(l => {
      if (isDiff && (l.startsWith('+') || l.startsWith('-'))) {
        const k = l[0] as '+' | '-'
        return codeRow({ o: null, n: null, p: 0, k, s: l.slice(1) }, null, 0, w, true).slice(1)
      }
      if (isDiff && l.startsWith('@@')) return [S(cut(`  ${l}`, w), DIM)]
      const room = w - 2
      const full = l.replace(/\t/g, '  ').length
      let left = full > room ? room - 1 : room
      const row: Row = [S('  ')]
      for (const t of tokens(l)) {
        if (left <= 0) break
        const part = t.t.slice(0, left)
        row.push(S(part, { fg: t.fg, soft: true }))
        left -= part.length
      }
      if (full > room) row.push(S('…', DIM))
      return row
    })
  }
  const out: Row[] = [[S('─'.repeat(w), DIM)], ...boxRows(b.ns, doc.places, w, current, hover)]
  if (inline && b.ns.includes(inline.place.n)) out.push([], ...codeBox(inline, w))
  return out
}

/**
 * The whole reply: a dim line naming it, then its blocks, one blank row
 * between them (none between the items of a list), each section's boxes under
 * its prose. The first row carries the reply's bullet; the rest are indented to match.
 */
export function replyRows(p: ReplyProps, w: number, hover: string | null): Row[] {
  const inner = Math.max(10, w - 2)
  const { doc } = p
  const out: Row[] = []
  const what = doc.target ? (/^https?:/.test(doc.target) ? doc.target.replace(/^https?:\/\/[^/]+\//, '').replace('/pull/', ' #') : splitPath(doc.target.replace(/\/+$/, '')).file) : ''
  const count = doc.places.length
  const about = `${what ? ` · ${what}` : ''} · ${count} ${count === 1 ? 'place' : 'places'} in the code`
  out.push([S('code-reference', { fg: 'claude' }), S(cut(about, Math.max(0, inner - 14)), { d: true })])
  doc.blocks.forEach((b, i) => {
    const prev = doc.blocks[i - 1]
    if (!(b.kind === 'item' && prev?.kind === 'item')) out.push([])
    out.push(...blockRows(b, doc, inner, p.current, hover, p.inline))
  })
  return out.map((r, i) => [S(i === 0 ? '● ' : '  ', { fg: 'text' }), ...r])
}

// ---------- the pane ----------

/** The first row a view shows for a place, before any scrolling: the place a little below the top. */
export function anchorOf(view: CodeView & { kind: 'rows' }, p: Place, room: number): number {
  if (p.line <= 0) return 0
  const at = Math.max(0, view.rows.findIndex(r => r.p >= p.line))
  const len = p.endLine - p.line + 1
  const before = len >= room ? 1 : Math.min(8, Math.max(2, Math.floor((room - len) / 3)))
  return Math.max(0, at - before)
}

/**
 * The pane at `w` by `h`: one header line (the place's number and path, where
 * the code comes from, ↑ ↓ to scroll, editor, GitHub for a PR), a line saying
 * what went wrong when something did, and code in every other row. `scroll`
 * moves the code from where the place puts it; the answer says where it landed.
 */
export function paneRows(p: PaneProps, w: number, h: number, scroll: number): { rows: Row[]; start: number; room: number } {
  const out: Row[] = []
  if (!p.place) {
    for (const r of wrap([{ t: p.empty, k: 'text' }], w, null, null, { d: true })) out.push(r)
    return { rows: out, start: 0, room: 0 }
  }
  const place = p.place
  const right: Row = [S(p.tag, { d: true }), S('   '), S('↑', { fg: 'suggestion', hit: 'up' }), S(' '), S('↓', { fg: 'suggestion', hit: 'down' }), S('   '), S('editor', { fg: 'suggestion', hit: 'editor' })]
  if (p.isPr) right.push(S('   '), S('github', { fg: 'suggestion', hit: 'github' }))
  const left: Row = [S(String(place.n), { fg: 'claude', b: true }), S('  ')]
  const path = pathSpans(place, Math.max(8, w - width(left) - width(right) - 2))
  out.push([...left, ...path, S(' '.repeat(Math.max(2, w - width(left) - width(path) - width(right)))), ...right])
  if (p.note) {
    const msg = cut(p.note, Math.max(10, w - 10))
    out.push([S('! ', { fg: 'warning' }), S(msg, { fg: 'warning' }), S(' '.repeat(Math.max(1, w - 2 - msg.length - 5))), S('retry', { fg: 'suggestion', hit: 'retry' })])
  }
  const room = Math.max(1, h - out.length)
  if (!p.view) {
    out.push([S('Loading code…', { d: true })])
    return { rows: out, start: 0, room }
  }
  if (p.view.kind === 'error') {
    out.push(...wrap([{ t: p.view.note, k: 'text' }], w, null, null, { fg: 'error' }))
    return { rows: out, start: 0, room }
  }
  const view = p.view
  const start = Math.max(0, Math.min(anchorOf(view, place, room) + scroll, view.rows.length - room))
  const shown = view.rows.slice(start, start + room)
  const numW = Math.max(1, ...shown.map(r => String(r.n ?? r.o ?? '').length))
  const signs = view.rows.some(r => r.k !== ' ')
  for (const r of shown) out.push(codeRow(r, place, numW, w, signs))
  return { rows: out, start, room }
}

/** What a click at cell (x, y) lands on: the `hit` of the span there. */
export function hitAt(rows: readonly Row[], x: number, y: number): string | null {
  const row = rows[y]
  if (!row) return null
  let at = 0
  for (const s of row) {
    if (x >= at && x < at + s.t.length) return s.hit ?? null
    at += s.t.length
  }
  return null
}
