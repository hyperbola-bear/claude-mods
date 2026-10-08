// Code rows: diff hunks, a file's lines against HEAD, the window around a
// place, and GitHub's addresses for lines. No `$` here.
import type { CodeLine, CodeRef } from '../types'

export const refKey = (r: CodeRef) => `${r.path}:${r.line}-${r.endLine}`

/** `review.ts:42-54`, `review.ts:92`, or `review.ts` for a whole file. */
export const refLabel = (r: CodeRef) => `${r.path}${r.line > 0 ? `:${r.line}${r.endLine > r.line ? `-${r.endLine}` : ''}` : ''}`

/** `infra/` and `iam.tf` from `infra/iam.tf`, so a path shows its folder at a glance. */
export function splitPath(path: string): { dir: string; file: string } {
  const i = path.lastIndexOf('/')
  return i < 0 ? { dir: '', file: path } : { dir: path.slice(0, i + 1), file: path.slice(i + 1) }
}

/** A stable id for a reply, so an old one scrolled back into view is recognised. */
export function textKey(text: string): string {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

// ---------- diffs ----------

export type Hunk = { oldStart: number; newStart: number; lines: string[] }

/** `git diff` / `gh pr diff` output, by the file's new path. */
export function parseDiff(diff: string): Map<string, Hunk[]> {
  const files = new Map<string, Hunk[]>()
  let current: Hunk[] | null = null
  let hunk: Hunk | null = null
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = null
      hunk = null
      continue
    }
    if (line.startsWith('+++ ') && !hunk) {
      const path = line.slice(4).trim().replace(/^b\//, '')
      if (path !== '/dev/null') {
        current = []
        files.set(path, current)
      }
      continue
    }
    if (line.startsWith('--- ') && !hunk) continue
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (h && h[1] && h[2] && current) {
      hunk = { oldStart: Number(h[1]), newStart: Number(h[2]), lines: [] }
      current.push(hunk)
      continue
    }
    if (hunk && (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-'))) hunk.lines.push(line)
  }
  return files
}

/** The span of new-file lines a hunk covers, inclusive. */
export function newSpan(h: Hunk): [number, number] {
  const count = h.lines.filter(l => !l.startsWith('-')).length
  return [h.newStart, h.newStart + Math.max(0, count - 1)]
}

/** Whether the PR's diff shows those lines, so GitHub's Files tab can highlight them. */
export function inDiff(files: Map<string, Hunk[]>, ref: CodeRef): boolean {
  return (files.get(ref.path) ?? []).some(h => {
    const [a, b] = newSpan(h)
    return ref.line >= a && ref.endLine <= b
  })
}

/** The rows of some hunks, numbered on both sides, each placed in the new file, changed words marked. */
export function rowsFromHunks(hunks: readonly Hunk[]): CodeLine[] {
  const rows: CodeLine[] = []
  for (const h of hunks) {
    let o = h.oldStart
    let n = h.newStart
    for (const raw of h.lines) {
      const k = raw[0] === '+' || raw[0] === '-' ? raw[0] : ' '
      const s = raw.slice(1)
      if (k === '+') rows.push({ o: null, n: n++, p: 0, k, s })
      else if (k === '-') rows.push({ o: o++, n: null, p: 0, k, s })
      else rows.push({ o: o++, n: n++, p: 0, k, s })
    }
  }
  return place(rows)
}

/** A file nothing changed, every line as context. */
export function rowsFromText(text: string): CodeLine[] {
  const lines = text.replace(/\n$/, '').split('\n')
  return lines.map((s, i) => ({ o: i + 1, n: i + 1, p: i + 1, k: ' ' as const, s }))
}

/** Where each row sits in the new file (a removed line sits before the next new one), and the changed words of paired lines. */
function place(rows: CodeLine[]): CodeLine[] {
  let next = 1
  for (const r of rows) if (r.n !== null) next = r.n + 1
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const r = rows[i]
    if (!r) continue
    if (r.n !== null) next = r.n
    r.p = r.n ?? next
  }
  markWords(rows)
  return rows
}

/** In each run of removed then added lines, the part of each paired line that changed. */
export function markWords(rows: CodeLine[]): CodeLine[] {
  let i = 0
  while (i < rows.length) {
    if (rows[i]?.k === ' ') {
      i += 1
      continue
    }
    const dels: CodeLine[] = []
    const adds: CodeLine[] = []
    while (i < rows.length && rows[i]?.k !== ' ') {
      const r = rows[i] as CodeLine
      ;(r.k === '-' ? dels : adds).push(r)
      i += 1
    }
    for (let j = 0; j < Math.min(dels.length, adds.length); j += 1) {
      const d = dels[j] as CodeLine
      const a = adds[j] as CodeLine
      const ranges = changedRanges(d.s, a.s)
      if (ranges) {
        d.hot = ranges[0]
        a.hot = ranges[1]
      }
    }
  }
  return rows
}

/** The changed middle of two lines, widened to whole words; null when nearly all of each changed. */
export function changedRanges(a: string, b: string): [[number, number], [number, number]] | null {
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p += 1
  let s = 0
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s += 1
  while (p > 0 && /\w/.test(a[p - 1] ?? '')) p -= 1
  while (s > 0 && /\w/.test(a[a.length - s] ?? '')) s -= 1
  const ra: [number, number] = [p, a.length - s]
  const rb: [number, number] = [p, b.length - s]
  if (ra[1] - ra[0] > a.length * 0.75 && rb[1] - rb[0] > b.length * 0.75) return null
  return [ra, rb]
}

/** The PR's hunk around a place, as rows, for when only the diff is at hand. */
export function hunkRows(files: Map<string, Hunk[]>, ref: CodeRef): CodeLine[] | null {
  for (const h of files.get(ref.path) ?? []) {
    const [a, b] = newSpan(h)
    if (ref.endLine >= a && ref.line <= b) return rowsFromHunks([h])
  }
  return null
}

/** How many lines of the file the pane is handed either side of a place at first; it asks for more past that. */
export const WINDOW = 120

/**
 * The rows within `around` new-file lines of a place (`more` further), and how
 * many new-file lines stay out above and below. A whole-file place starts at the top.
 */
export function windowRows(rows: readonly CodeLine[], ref: CodeRef, around = WINDOW, more = 0): { rows: CodeLine[]; above: number; below: number } {
  const from = ref.line > 0 ? ref.line : 1
  const to = ref.line > 0 ? ref.endLine : 1
  const lo = from - around - more
  const hi = to + around + more + (ref.line > 0 ? 0 : around)
  let first = -1
  let last = -1
  rows.forEach((r, i) => {
    if (r.p >= lo && r.p <= hi) {
      if (first < 0) first = i
      last = i
    }
  })
  if (first < 0) return { rows: [], above: 0, below: 0 }
  const count = (a: number, b: number) => rows.slice(a, b).filter(r => r.n !== null).length
  return { rows: rows.slice(first, last + 1), above: count(0, first), below: count(last + 1, rows.length) }
}

/** What a file's rows say about it, for the pane's header. */
export function changeNote(rows: readonly CodeLine[], isPr: boolean): string {
  const adds = rows.filter(r => r.k === '+').length
  const dels = rows.filter(r => r.k === '-').length
  if (adds === 0 && dels === 0) return isPr ? 'unchanged in the PR' : 'local'
  if (dels === 0 && adds === rows.length) return isPr ? 'new in the PR' : 'new, uncommitted'
  return isPr ? 'changed in the PR' : 'uncommitted edits'
}

// ---------- GitHub addresses ----------

/** GitHub's anchor for lines in a PR's Files tab: `diff-<sha256(path)>R<line>`. */
export async function prLineAnchor(url: string, ref: CodeRef): Promise<string> {
  const bytes = new TextEncoder().encode(ref.path)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
  const range = ref.line <= 0 ? '' : ref.endLine > ref.line ? `R${ref.line}-R${ref.endLine}` : `R${ref.line}`
  return `${url}/files#diff-${hex}${range}`
}

/** The file at the PR head, lines highlighted: for code the PR did not change. */
export function blobUrl(prUrl: string, repo: string, sha: string, ref: CodeRef): string {
  const host = /^(https?:\/\/[^/]+)\//.exec(prUrl)?.[1] ?? 'https://github.com'
  const lines = ref.line <= 0 ? '' : ref.endLine > ref.line ? `#L${ref.line}-L${ref.endLine}` : `#L${ref.line}`
  return `${host}/${repo}/blob/${sha}/${ref.path.split('/').map(encodeURIComponent).join('/')}${lines}`
}
