// Pure review logic: the review format, parsing a review reply, diff hunks,
// code windows and which finding is on screen. No `$` here.
import type { CodeRef, Finding, ReviewSource, Severity, Snippet } from '../types'

/** The format every review is asked for; the parser below reads exactly this. */
export const REVIEW_FORMAT = [
  'Format the review exactly like this, because a code pane follows it:',
  '- First line: `**PR review:** <the PR URL>` (for local changes: `**Local review:** <absolute repo root>`).',
  '- Then one section per finding, most severe first, each opening with a heading exactly like',
  '  `### [1] high · `path/to/file.ts:42-48` — Short title`',
  '  where the severity is one of critical, high, medium, low, nit; the path is relative to the repository root;',
  '  the line numbers are in the new (head) version of the file; a single line `file.ts:42` is fine.',
  '- Under each heading: what is wrong, why it matters, and the fix (a short code block when it helps).',
  '  When the point also involves other code, name each place as `path:line` in backticks: every one becomes',
  '  a code location the reader can step to, in the order you name them, after the heading\'s own.',
  '- End with a `### Summary` section that has no number.',
].join('\n')

const PR_URL = /https?:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/pull\/\d+/i

/**
 * The PR a typed prompt asks to have reviewed: the prompt says "review" (any
 * form) and holds a GitHub pull request URL. Slash commands are left alone.
 */
export function reviewRequest(text: string): string | null {
  const t = text.trim()
  if (t.startsWith('/') || !/\breview/i.test(t)) return null
  return PR_URL.exec(t)?.[0] ?? null
}

/** What rides along with such a prompt, so the review comes back in the format the code view follows. */
export function reviewContext(url: string): string {
  return [
    `pr-review-ui: this prompt asks for a review of ${url}. Review it as the pr-review-ui:pr-review skill describes`,
    '(load that skill), so the review shows as points with each point\'s code beside the conversation.',
    '',
    REVIEW_FORMAT,
    `The first line is \`**PR review:** ${url}\`.`,
  ].join('\n')
}

const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'nit']

const HEADER_LINE = /^\s*\*\*(PR|Local) review:\*\*\s*(\S+)/im
const FINDING_LINE = /^#{2,4}\s*\[(\d+)\]\s*([a-z]+)\b(.*)$/i
const REF = /`?([\w./@+-]*[\w@+-][./][\w./@+-]*):(\d+)(?:\s*[-–]\s*(\d+))?`?/

/** Cheap test for the render hook: does this reply look like a review in our format? */
export const looksLikeReview = (text: string) => HEADER_LINE.test(text) && /^#{2,4}\s*\[\d+\]/m.test(text)

export function parseSource(text: string): ReviewSource | null {
  const m = HEADER_LINE.exec(text)
  if (!m || !m[1] || !m[2]) return null
  const target = m[2].replace(/[<>)]+$/g, '').replace(/^</, '')
  if (m[1].toLowerCase() === 'pr') {
    const pr = /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(target)
    return pr && pr[1] && pr[2] ? { kind: 'pr', url: pr[0], repo: pr[1], number: Number(pr[2]) } : null
  }
  return { kind: 'local', root: target }
}

export function parseRef(s: string): CodeRef | null {
  const m = REF.exec(s)
  if (!m || !m[1] || !m[2]) return null
  const line = Number(m[2])
  const end = m[3] ? Number(m[3]) : line
  return { path: m[1].replace(/^\.\//, ''), line, endLine: Math.max(line, end) }
}

export function parseFindings(text: string): Finding[] {
  const lines = text.split('\n')
  const out: Finding[] = []
  let open: Finding | null = null
  let body: string[] = []
  const close = () => {
    if (open) {
      const text = body.join('\n').trim()
      out.push({ ...open, body: text, sections: sectionsOf(open, text) })
    }
    open = null
    body = []
  }
  lines.forEach(raw => {
    const m = FINDING_LINE.exec(raw)
    if (m && m[1] && m[2] && m[3] !== undefined) {
      close()
      const severity = m[2].toLowerCase() as Severity
      const ref = parseRef(m[3])
      if (!ref || !SEVERITIES.includes(severity)) return
      const title = m[3]
        .replace(REF, '')
        .replace(/^[\s·|:–—-]+/, '')
        .trim()
      open = { n: Number(m[1]), severity, ...ref, title: title || `${ref.path}:${ref.line}`, body: '', sections: [] }
      return
    }
    if (/^#{1,4}\s/.test(raw)) {
      close()
      return
    }
    if (open) body.push(raw)
  })
  close()
  return out
}

export const refKey = (r: CodeRef) => `${r.path}:${r.line}-${r.endLine}`

/** A point's code locations: its heading's reference, then each backticked one in its body, each once. */
export function sectionsOf(head: CodeRef, body: string): CodeRef[] {
  const out: CodeRef[] = [{ path: head.path, line: head.line, endLine: head.endLine }]
  const seen = new Set([refKey(head)])
  let inFence = false
  for (const line of body.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence
    if (inFence) continue
    for (const { ref } of refsIn(line)) {
      if (seen.has(refKey(ref))) continue
      seen.add(refKey(ref))
      out.push(ref)
    }
  }
  return out
}

/** The text of the `### Summary` section, if the review has one. */
export function parseSummary(text: string): string {
  const m = /^#{2,4}\s*Summary\s*$/im.exec(text)
  if (!m) return ''
  const rest = text.slice(m.index + m[0].length)
  const end = rest.search(/^#{1,4}\s/m)
  return (end >= 0 ? rest.slice(0, end) : rest).trim()
}

/** "2 high · 1 medium" for the review header. */
export function severityCounts(findings: readonly Pick<Finding, 'severity'>[]): string {
  return SEVERITIES.map(s => [s, findings.filter(f => f.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s}`)
    .join(' · ')
}

/** `infra/` and `iam.tf` from `infra/iam.tf`, so a path shows its folder at a glance. */
export function splitPath(path: string): { dir: string; file: string } {
  const i = path.lastIndexOf('/')
  return i < 0 ? { dir: '', file: path } : { dir: path.slice(0, i + 1), file: path.slice(i + 1) }
}

export const refLabel = (r: CodeRef) => `${r.path}:${r.line}${r.endLine > r.line ? `-${r.endLine}` : ''}`

/** Whether the PR's diff shows those lines, so the Files tab can highlight them. */
export function inDiff(files: Map<string, Hunk[]>, ref: CodeRef): boolean {
  return (files.get(ref.path) ?? []).some(h => {
    const [a, b] = newSpan(h)
    return ref.line >= a && ref.endLine <= b
  })
}

/** The file at the PR head, lines highlighted: for code the PR did not change. */
export function blobUrl(prUrl: string, repo: string, sha: string, ref: CodeRef): string {
  const host = /^(https?:\/\/[^/]+)\//.exec(prUrl)?.[1] ?? 'https://github.com'
  const lines = ref.endLine > ref.line ? `L${ref.line}-L${ref.endLine}` : `L${ref.line}`
  return `${host}/${repo}/blob/${sha}/${ref.path.split('/').map(encodeURIComponent).join('/')}#${lines}`
}

/** A stable id for a review reply, so an old review scrolled back into view is recognised. */
export function reviewKey(text: string): string {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

/** Every `path:line` reference in the text, in order, each once. */
export function refsIn(text: string): { raw: string; ref: CodeRef }[] {
  const seen = new Set<string>()
  const out: { raw: string; ref: CodeRef }[] = []
  const all = new RegExp(REF.source, 'g')
  for (const m of text.matchAll(all)) {
    if (!m[0].startsWith('`')) continue // only backticked refs, so prose like "ratio 3:2" is left alone
    const ref = parseRef(m[0])
    if (!ref || seen.has(m[0])) continue
    seen.add(m[0])
    out.push({ raw: m[0], ref })
  }
  return out
}

/**
 * The reply with each backticked `path:line` turned into a link the pane
 * answers. `hrefFor` decides the target; a click the surface cannot hand
 * to the plugin still lands somewhere useful (the line on GitHub, or the file).
 */
export function linkify(text: string, hrefFor: (ref: CodeRef) => string): { text: string; hrefs: Map<string, CodeRef> } {
  const hrefs = new Map<string, CodeRef>()
  const lines = text.split('\n')
  let inFence = false
  const done = lines.map(line => {
    if (/^\s*```/.test(line)) inFence = !inFence
    if (inFence) return line
    return line.replace(new RegExp(REF.source, 'g'), (raw: string) => {
      if (!raw.startsWith('`') || !raw.endsWith('`')) return raw
      const ref = parseRef(raw)
      if (!ref) return raw
      const href = hrefFor(ref)
      hrefs.set(href, ref)
      return `[${raw.replace(/`/g, '')}](${href})`
    })
  })
  return { text: done.join('\n'), hrefs }
}

// ---------- diffs ----------

export type Hunk = { oldStart: number; newStart: number; lines: string[] }

/** `gh pr diff` output, by the file's new path. */
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
    if (line.startsWith('+++ ')) {
      const path = line.slice(4).trim().replace(/^b\//, '')
      if (path !== '/dev/null') {
        current = []
        files.set(path, current)
      }
      continue
    }
    if (line.startsWith('--- ')) continue
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

/**
 * The part of a hunk around new-file lines `from`..`to`, as a hunk of its own
 * with a correct `@@` header so the Code element draws it as a diff.
 */
export function trimHunk(h: Hunk, from: number, to: number): string | null {
  let oldNo = h.oldStart
  let newNo = h.newStart
  const kept: string[] = []
  let firstOld = -1
  let firstNew = -1
  let oldCount = 0
  let newCount = 0
  for (const line of h.lines) {
    const kind = line[0]
    const inWindow = newNo >= from && newNo <= to + (kind === '-' ? 1 : 0)
    if (inWindow) {
      if (firstOld < 0) {
        firstOld = oldNo
        firstNew = newNo
      }
      kept.push(line)
      if (kind !== '+') oldCount += 1
      if (kind !== '-') newCount += 1
    }
    if (kind !== '+') oldNo += 1
    if (kind !== '-') newNo += 1
  }
  if (kept.length === 0) return null
  return `@@ -${firstOld},${oldCount} +${firstNew},${newCount} @@\n${kept.join('\n')}`
}

export const CONTEXT = 6

/** The diff around a reference, when the PR changed those lines. */
export function diffSnippet(files: Map<string, Hunk[]>, ref: CodeRef): Snippet | null {
  const hunks = files.get(ref.path)
  if (!hunks) return null
  for (const h of hunks) {
    const [a, b] = newSpan(h)
    if (ref.endLine < a || ref.line > b) continue
    const code = trimHunk(h, ref.line - CONTEXT, ref.endLine + CONTEXT)
    if (code) return { kind: 'diff', code, path: ref.path, note: 'changed in this PR' }
  }
  return null
}

/** The file's lines around a reference, numbered from the window's first line. */
export function sourceSnippet(fileText: string, ref: CodeRef, note: string): Snippet {
  const lines = fileText.split('\n')
  if (ref.line > lines.length) return { kind: 'error', note: `${ref.path} has ${lines.length} lines; line ${ref.line} is past its end.` }
  const start = Math.max(1, ref.line - CONTEXT)
  const end = Math.min(lines.length, ref.endLine + CONTEXT)
  return { kind: 'source', code: lines.slice(start - 1, end).join('\n'), path: ref.path, startLine: start, note }
}

/** GitHub's anchor for a line in a PR's Files tab: `diff-<sha256(path)>R<line>`. */
export async function prLineAnchor(url: string, ref: CodeRef): Promise<string> {
  const bytes = new TextEncoder().encode(ref.path)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
  const range = ref.endLine > ref.line ? `R${ref.line}-R${ref.endLine}` : `R${ref.line}`
  return `${url}/files#diff-${hex}${range}`
}

export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'suggestion',
  nit: 'subtle',
}
