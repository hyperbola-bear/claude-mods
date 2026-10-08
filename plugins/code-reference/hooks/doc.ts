// A reply read the way code-reference draws it: its blocks of markdown, the
// places in the code its links name, numbered 1 to N in the order the text
// names them, and after each section a row of those places. No `$` here.
import type { CodeRef, Place, Source } from '../types'
import { refKey } from './code.ts'

/** A run of text within a line: plain, code, bold, italic, a link to a place (by its number) or to a web page. */
export type Inline = { t: string; k: 'text' | 'code' | 'bold' | 'italic' | 'place' | 'url'; n?: number; href?: string }

export type Block =
  | { kind: 'heading'; inl: Inline[] }
  | { kind: 'para'; inl: Inline[] }
  | { kind: 'item'; bullet: string; indent: number; inl: Inline[] }
  | { kind: 'quote'; inl: Inline[] }
  | { kind: 'fence'; lang: string; lines: string[] }
  | { kind: 'raw'; lines: string[] }
  | { kind: 'rule' }
  /** The places a section names, drawn as a row of boxes under it. */
  | { kind: 'places'; ns: number[] }

/** A reply as drawn: what its header names (a root folder or a PR URL; '' with no header), its blocks and its places. */
export type Doc = { target: string; blocks: Block[]; places: Place[] }

const HEADER = /^\s*\*\*Code reference:\*\*\s*<?([^\s>]+)>?\s*$/i
const PR_URL = /^https?:\/\/[^/\s]+\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/i

/** Whether a reply opens with the code-reference header. */
export function isCodeReference(text: string): boolean {
  const first = text.split('\n').find(l => l.trim() !== '') ?? ''
  return HEADER.test(first)
}

/** What a header's target names: a pull request, or a folder (relative targets fall back to `root`). */
export function sourceOf(target: string, root: string): Source | null {
  const pr = PR_URL.exec(target)
  if (pr && pr[1] && pr[2]) return { kind: 'pr', url: pr[0], repo: pr[1], number: Number(pr[2]) }
  if (target.startsWith('/')) return { kind: 'local', root: target.replace(/\/+$/, '') || '/' }
  return root ? { kind: 'local', root } : null
}

const REF = /^(?:file:\/\/)?((?:[^\s:#()`]*[\w@+-])?[./][^\s:#()`]*[\w@+-])(?::(\d+)(?:\s*[-–]\s*(\d+))?|#L(\d+)(?:-L?(\d+))?)?$/

/**
 * A link target or a backticked name as a place: `src/a.ts:12-30`, `src/a.ts:12`,
 * `src/a.ts#L12-L30`, or a path alone (the whole file). An absolute path under
 * `root` is made relative to it. `needsLine` keeps a bare `a.ts` from counting.
 */
export function parseRef(target: string, root: string, needsLine = false): CodeRef | null {
  if (/^[a-z][\w+.-]*:\/\//i.test(target) && !target.startsWith('file://')) return null
  const m = REF.exec(target.trim())
  if (!m || !m[1]) return null
  const start = m[2] ?? m[4]
  const end = m[3] ?? m[5]
  if (needsLine && !start) return null
  let path = decodeURIComponent(m[1]).replace(/^\.\//, '')
  const base = root.replace(/\/+$/, '')
  if (base && path.startsWith(`${base}/`)) path = path.slice(base.length + 1)
  const line = start ? Number(start) : 0
  return { path, line, endLine: Math.max(line, end ? Number(end) : line) }
}

type Pending = Inline & { ref?: CodeRef }

const INLINE = /\[([^\]\n]+)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*|__([^_\n]+)__|(?<![\w*])\*([^*\s][^*\n]*)\*(?![\w*])|(?<![\w_])_([^_\s][^_\n]*)_(?![\w_])|<(https?:\/\/[^>\s]+)>/g

/** A line's runs: links to places keep their ref until the sections are numbered. */
function inlines(text: string, root: string): Pending[] {
  const out: Pending[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) out.push({ t: text.slice(last, at), k: 'text' })
    last = at + m[0].length
    if (m[1] !== undefined && m[2] !== undefined) {
      const label = m[1].replace(/[`*_]/g, '')
      if (/^https?:\/\//i.test(m[2])) {
        out.push({ t: label, k: 'url', href: m[2] })
        continue
      }
      const ref = parseRef(m[2], root)
      out.push(ref ? { t: label, k: 'place', ref } : { t: label, k: 'text' })
    } else if (m[3] !== undefined) {
      const ref = parseRef(m[3], root, true)
      out.push(ref ? { t: m[3], k: 'place', ref } : { t: m[3], k: 'code' })
    } else if (m[4] !== undefined || m[5] !== undefined) out.push({ t: m[4] ?? m[5] ?? '', k: 'bold' })
    else if (m[6] !== undefined || m[7] !== undefined) out.push({ t: m[6] ?? m[7] ?? '', k: 'italic' })
    else if (m[8] !== undefined) out.push({ t: m[8], k: 'url', href: m[8] })
  }
  if (last < text.length) out.push({ t: text.slice(last), k: 'text' })
  return out
}

type Raw =
  | { kind: 'heading' | 'para' | 'quote'; inl: Pending[] }
  | { kind: 'item'; bullet: string; indent: number; inl: Pending[] }
  | { kind: 'fence'; lang: string; lines: string[] }
  | { kind: 'raw'; lines: string[] }
  | { kind: 'rule' }

function blocksOf(lines: readonly string[], root: string): Raw[] {
  const out: Raw[] = []
  let para: string[] = []
  let item: { bullet: string; indent: number; text: string[] } | null = null
  let quote: string[] = []
  const flush = () => {
    if (para.length) out.push({ kind: 'para', inl: inlines(para.join(' '), root) })
    if (item) out.push({ kind: 'item', bullet: item.bullet, indent: item.indent, inl: inlines(item.text.join(' '), root) })
    if (quote.length) out.push({ kind: 'quote', inl: inlines(quote.join(' '), root) })
    para = []
    item = null
    quote = []
  }
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    const fence = /^\s*(`{3,}|~{3,})\s*([\w+-]*)/.exec(line)
    if (fence && fence[1]) {
      flush()
      const close = fence[1]
      const body: string[] = []
      i += 1
      while (i < lines.length && !(lines[i] ?? '').trimStart().startsWith(close)) {
        body.push(lines[i] ?? '')
        i += 1
      }
      const indent = Math.min(...body.filter(l => l.trim()).map(l => l.length - l.trimStart().length), 99)
      out.push({ kind: 'fence', lang: (fence[2] ?? '').toLowerCase(), lines: body.map(l => l.slice(Math.min(indent, l.length - l.trimStart().length))) })
      continue
    }
    if (line.trim() === '') {
      flush()
      continue
    }
    const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading) {
      flush()
      out.push({ kind: 'heading', inl: inlines(heading[1] ?? '', root) })
      continue
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush()
      out.push({ kind: 'rule' })
      continue
    }
    if (/^\s*\|/.test(line)) {
      flush()
      const last = out[out.length - 1]
      if (last?.kind === 'raw') last.lines.push(line.trim())
      else out.push({ kind: 'raw', lines: [line.trim()] })
      continue
    }
    const bullet = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (bullet) {
      flush()
      const b = bullet[2] ?? '-'
      item = { bullet: /^\d/.test(b) ? b : '•', indent: Math.min(3, Math.floor((bullet[1] ?? '').length / 2)), text: [bullet[3] ?? ''] }
      continue
    }
    const q = /^\s*>\s?(.*)$/.exec(line)
    if (q) {
      if (!quote.length) flush()
      quote.push(q[1] ?? '')
      continue
    }
    if (item) item.text.push(line.trim())
    else if (quote.length) quote.push(line.trim())
    else para.push(line.trim())
  }
  flush()
  return out
}

/**
 * The reply as drawn. Sections are the parts between headings (the lead before
 * the first heading counts as one); a reply with no headings makes each
 * paragraph or list its own section. Each section ends in the row of the places
 * it names, numbered on from the section before; a place named twice in one
 * section keeps its number. Null when the reply names no place and has no header.
 */
export function parseDoc(text: string, root: string): Doc | null {
  const lines = text.split('\n')
  const at = lines.findIndex(l => l.trim() !== '')
  const head = at >= 0 ? HEADER.exec(lines[at] ?? '') : null
  const target = head?.[1] ?? ''
  const base = target.startsWith('/') ? target : root
  const raw = blocksOf(head ? lines.slice(at + 1) : lines, base)
  const hasHeadings = raw.some(b => b.kind === 'heading')
  const places: Place[] = []
  const blocks: Block[] = []
  let section: Map<string, number> = new Map()
  const close = () => {
    if (section.size) blocks.push({ kind: 'places', ns: [...new Set(section.values())] })
    section = new Map()
  }
  const number = (inl: Pending[]): Inline[] =>
    inl.map(({ ref, ...run }) => {
      if (!ref) return run
      const k = refKey(ref)
      let n = section.get(k)
      if (n === undefined) {
        n = places.length + 1
        places.push({ ...ref, n, phrase: run.t })
        section.set(k, n)
      }
      return { ...run, n }
    })
  raw.forEach((b, i) => {
    const next = raw[i + 1]
    if (b.kind === 'heading') close()
    if (b.kind === 'heading' || b.kind === 'para' || b.kind === 'quote') blocks.push({ kind: b.kind, inl: number(b.inl) })
    else if (b.kind === 'item') blocks.push({ kind: 'item', bullet: b.bullet, indent: b.indent, inl: number(b.inl) })
    else blocks.push(b)
    // With no headings, a paragraph, a quote or a whole list is a section.
    const endsGroup = b.kind !== 'item' || next?.kind !== 'item'
    if (!hasHeadings && endsGroup && b.kind !== 'fence' && b.kind !== 'raw' && b.kind !== 'rule') close()
  })
  close()
  if (places.length === 0 && !head) return null
  return { target, blocks, places }
}
