// Pure review logic: the review format and what triggers it, parsing a review
// reply, diff hunks, code rows and their windows. No `$` here.
import type { CodeLine, CodeRef, Fields, Finding, PlanGroup, ReviewHead, ReviewSource, Severity } from '../types'

/** The format every review is asked for; the parser below reads exactly this. */
export const REVIEW_FORMAT = [
  'Format the review exactly like this, because pr-review-ui draws it:',
  '- First line: `**PR review:** <the PR URL>` (for local changes: `**Local review:** <absolute repo root>`).',
  '- Then a blank line and `**Verdict:** <ready to merge | ready after nits | changes requested> · <the PR title>`.',
  '- Then one or two sentences: what the PR does and what blocks it.',
  '- Then one section per finding, most severe first, each opening with a heading exactly like',
  '  `### [1] high · correctness · `path/to/file.ts:42-48` — Short title`',
  '  where the severity is critical, high, medium, low or nit; the area is correctness, security, reliability,',
  '  performance, data, tests or naming; the path is relative to the repository root; the line numbers are in the',
  '  new (head) version of the file (a single line `file.ts:42` is fine); the title says what is wrong in under 70 characters.',
  '- Under each heading, three bullets in this order:',
  '  `- **Problem:** what the code does, naming the line.`',
  '  `- **Impact:** what goes wrong, for whom, and when.`',
  '  `- **Fix:** one sentence.`',
  '  then, when it helps, a ```diff block of at most 8 lines with the change.',
  '  When the point also involves other code, name each place as `path:line` in backticks: every one becomes',
  '  a code location the reader can step to, in the order you name them, after the heading\'s own. Never put one in a code block.',
  '- End with `### Summary`: a line like `**Before merge:** 1, 2 · **Before production traffic:** 3, 4 · **Any time:** 5`',
  '  (leave out empty groups), then one sentence: whether it is ready to merge.',
  '- With nothing to fix, keep the first line, the verdict, the lead and the summary, and write no numbered sections.',
].join('\n')

const PR_URL = /https?:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/pull\/\d+/i

/** What a typed prompt asks to have reviewed. */
export type ReviewAsk = { kind: 'url'; url: string } | { kind: 'number'; number: number } | { kind: 'branch' }

const REVIEW_WORD = /\b(?:re-?view\w*|cr|look\s+over|go\s+(?:over|through))\b/i
const PR_PHRASE = /\b(?:re-?view|cr)\s+(?:(?:the|this|my|that|a|our)\s+)?(?:pr|pull\s+request)\b(?:\s+(?:number\s+)?#?(\d+)\b)?|\b(?:pr|pull\s+request)\s+re-?view\b|\bre-?view\s+#(\d+)\b/i

/**
 * The review a typed prompt asks for: a GitHub pull request link with a word
 * like review (or the link alone), or a phrase like "review pr", "review pr
 * 418", "review #418" or "pr review" (this repository's PR by number, or the
 * current branch's). Slash commands and shell escapes are left alone.
 */
export function reviewRequest(text: string): ReviewAsk | null {
  const t = text.trim()
  if (t.startsWith('/') || t.startsWith('!')) return null
  const url = PR_URL.exec(t)?.[0]
  if (url) {
    const isAlone = t.replace(PR_URL, '').replace(/[\s.,;:!?<>()]/g, '') === ''
    return isAlone || REVIEW_WORD.test(t) ? { kind: 'url', url } : null
  }
  const m = PR_PHRASE.exec(t)
  if (!m) return null
  const n = Number(m[1] ?? m[2] ?? 0)
  return n > 0 ? { kind: 'number', number: n } : { kind: 'branch' }
}

/** What the skill's own command (`/pr-review-ui:pr-review <PR>`) reviews: a PR, or the local changes. */
export function slashReview(text: string): ReviewAsk | { kind: 'local' } | null {
  const m = /^\/(?:pr-review-ui:)?pr-review(?:\s+([\s\S]*))?$/i.exec(text.trim())
  if (!m) return null
  const arg = (m[1] ?? '').trim()
  if (!arg) return { kind: 'local' }
  const url = PR_URL.exec(arg)?.[0]
  if (url) return { kind: 'url', url }
  const n = /^#?(\d+)$/.exec(arg)
  return n?.[1] ? { kind: 'number', number: Number(n[1]) } : null
}

/** What rides along with such a prompt, so the review comes back in the format the mod draws. */
export function reviewContext(url: string, worktree?: string): string {
  return [
    `pr-review-ui: this prompt asks for a review of ${url}. Review it as the pr-review-ui:pr-review skill describes`,
    '(load that skill), so the review shows as points with each point\'s code beside the conversation.',
    ...(worktree
      ? [`The PR's files at its head are being checked out in ${worktree}: once it exists, read whole files there when the diff alone does not show enough. Do not edit or commit there.`]
      : []),
    '',
    REVIEW_FORMAT,
    `The first line is \`**PR review:** ${url}\`.`,
  ].join('\n')
}

const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'nit']

const HEADER_LINE = /^\s*\*\*(PR|Local) review:\*\*\s*(\S+)/im
const VERDICT_LINE = /^\s*\*\*Verdict:\*\*\s*(.+)$/im
const FINDING_LINE = /^#{2,4}\s*\[(\d+)\]\s*([a-z]+)\b(.*)$/i
const REF = /`?([\w./@+-]*[\w@+-][./][\w./@+-]*):(\d+)(?:\s*[-–]\s*(\d+))?`?/
const FIELD = /^\s*[-*]\s+\*\*(Problem|Impact|Fix)\s*:?\s*\*\*\s*:?\s*(.*)$/i
const SEPARATORS = /^[\s·|:–—-]+|[\s·|:–—-]+$/g

/** Cheap test for the render hook: does this reply look like a review in our format (points, or a verdict with none)? */
export const looksLikeReview = (text: string) => HEADER_LINE.test(text) && (/^#{2,4}\s*\[\d+\]/m.test(text) || VERDICT_LINE.test(text))

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

/** A heading's text after `[n] severity`: its area, its code reference and its title. */
export function splitHeading(rest: string): { ref: CodeRef | null; area: string; title: string } {
  const m = REF.exec(rest)
  const ref = m ? parseRef(m[0]) : null
  if (!m || !ref) return { ref: null, area: '', title: '' }
  const before = rest.slice(0, m.index).replace(SEPARATORS, '')
  const after = rest.slice(m.index + m[0].length).replace(SEPARATORS, '')
  const isArea = /^[a-z][a-z-]{1,19}$/i.test(before)
  return { ref, area: isArea ? before.toLowerCase() : '', title: after || (isArea ? '' : before) }
}

/**
 * A point's body read as the standard writes it: the Problem, Impact and Fix
 * bullets, its first ```diff block as the suggested change, and the rest as
 * markdown. A body without those bullets is prose, kept whole.
 */
export function parseBody(body: string): { fields: Fields | null; suggestion: string[]; rest: string } {
  const parts: Record<string, string[]> = {}
  const rest: string[] = []
  let suggestion: string[] = []
  let field: string | null = null
  let fence: { indent: number; lang: string; lines: string[] } | null = null
  for (const line of body.split('\n')) {
    if (fence) {
      if (/^\s*```/.test(line)) {
        if (fence.lang === 'diff' && suggestion.length === 0) suggestion = fence.lines.filter(l => !l.startsWith('@@'))
        else rest.push(`\`\`\`${fence.lang}`, ...fence.lines, '```')
        fence = null
      } else {
        fence.lines.push(line.slice(Math.min(fence.indent, line.length - line.trimStart().length)))
      }
      continue
    }
    const open = /^(\s*)```\s*([\w+-]*)/.exec(line)
    if (open) {
      fence = { indent: open[1]?.length ?? 0, lang: (open[2] ?? '').toLowerCase(), lines: [] }
      field = null
      continue
    }
    const fm = FIELD.exec(line)
    if (fm && fm[1]) {
      field = fm[1].toLowerCase()
      parts[field] = [fm[2] ?? '']
      continue
    }
    if (field && /^\s+\S/.test(line) && !/^\s*[-*]\s/.test(line)) {
      parts[field]?.push(line.trim())
      continue
    }
    if (line.trim() !== '') field = null
    rest.push(line)
  }
  if (fence) rest.push(`\`\`\`${fence.lang}`, ...fence.lines)
  if (!parts.problem && !parts.impact && !parts.fix) return { fields: null, suggestion: [], rest: body.trim() }
  const join = (k: string) => (parts[k] ?? []).join(' ').trim()
  return {
    fields: { problem: join('problem'), impact: join('impact'), fix: join('fix') },
    suggestion,
    rest: rest.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
  }
}

export function parseFindings(text: string): Finding[] {
  const lines = text.split('\n')
  const out: Finding[] = []
  let open: Omit<Finding, 'body' | 'fields' | 'suggestion' | 'rest' | 'sections'> | null = null
  let body: string[] = []
  const close = () => {
    if (open) {
      const raw = body.join('\n').trim()
      out.push({ ...open, body: raw, ...parseBody(raw), sections: sectionsOf(open, raw) })
    }
    open = null
    body = []
  }
  lines.forEach(raw => {
    const m = FINDING_LINE.exec(raw)
    if (m && m[1] && m[2] && m[3] !== undefined) {
      close()
      const severity = m[2].toLowerCase() as Severity
      const { ref, area, title } = splitHeading(m[3])
      if (!ref || !SEVERITIES.includes(severity)) return
      open = { n: Number(m[1]), severity, area, ...ref, title: title || `${ref.path}:${ref.line}` }
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

const PLAN_ITEM = /\*\*([^*]+?):?\*\*:?\s*((?:#?\d+(?:\s*(?:,|and|&)\s*)?)+)/gi

/** The summary's merge plan (`**Before merge:** 1, 2 · ...`) and the words left over. */
export function parsePlan(summary: string): { plan: PlanGroup[]; closing: string } {
  const plan: PlanGroup[] = []
  const rest: string[] = []
  for (const line of summary.split('\n')) {
    const items = [...line.matchAll(PLAN_ITEM)]
      .map(m => ({ label: (m[1] ?? '').trim(), points: [...(m[2] ?? '').matchAll(/\d+/g)].map(x => Number(x[0])) }))
      .filter(g => g.points.length > 0)
    if (items.length > 0 && /before|any ?time|follow|later/i.test(line)) plan.push(...items)
    else rest.push(line)
  }
  return { plan, closing: rest.join('\n').trim() }
}

/** The verdict and title, the lead sentences, the merge plan and the closing words. */
export function parseHead(text: string): ReviewHead {
  const v = (VERDICT_LINE.exec(text)?.[1] ?? '').split(/\s+·\s+/)
  const verdict = (v[0] ?? '').replace(/[*_]/g, '').trim().toLowerCase()
  const title = v.slice(1).join(' · ').trim()
  const first = text.search(/^#{2,4}\s/m)
  const intro = (first >= 0 ? text.slice(0, first) : '')
    .split('\n')
    .filter(l => !HEADER_LINE.test(l) && !/^\s*\*\*Verdict:\*\*/i.test(l))
    .join('\n')
    .trim()
  return { verdict, title, intro, ...parsePlan(parseSummary(text)) }
}

/** How the verdict reads at a glance: blocked, nearly there, or good to go. */
export function verdictTone(verdict: string): 'bad' | 'warn' | 'good' | 'none' {
  if (/change|block|not ready|reject/.test(verdict)) return 'bad'
  if (/nit|after|minor|comment/.test(verdict)) return 'warn'
  if (/ready|approve|lgtm|good/.test(verdict)) return 'good'
  return 'none'
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
 * The text with each backticked `path:line` turned into a link the review
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

// ---------- diffs and code rows ----------

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

export const CONTEXT = 5

/** Whether a row is one of the reference's lines (a removed line counts where it sat). */
export const isTarget = (r: CodeLine, ref: CodeRef) => r.p >= ref.line && r.p <= ref.endLine

/**
 * The rows around a reference: `ctx` lines either side plus what was asked
 * for, and how many new-file lines stay hidden above and below.
 */
export function windowRows(rows: readonly CodeLine[], ref: CodeRef, ctx = CONTEXT, more = { up: 0, down: 0 }): { rows: CodeLine[]; above: number; below: number } {
  const lo = ref.line - ctx - more.up
  const hi = ref.endLine + ctx + more.down
  let first = -1
  let last = -1
  rows.forEach((r, i) => {
    if (r.p >= lo && r.p <= hi) {
      if (first < 0) first = i
      last = i
    }
  })
  if (first < 0) return { rows: [], above: 0, below: 0 }
  const count = (from: number, to: number) => rows.slice(from, to).filter(r => r.n !== null).length
  return { rows: rows.slice(first, last + 1), above: count(0, first), below: count(last + 1, rows.length) }
}

/** The PR's hunk around a reference, as rows, for when only the diff is at hand. */
export function hunkRows(files: Map<string, Hunk[]>, ref: CodeRef): CodeLine[] | null {
  for (const h of files.get(ref.path) ?? []) {
    const [a, b] = newSpan(h)
    if (ref.endLine >= a && ref.line <= b) return rowsFromHunks([h])
  }
  return null
}

/** The suggested change's lines as rows, changed words marked. */
export function suggestionRows(lines: readonly string[]): CodeLine[] {
  return markWords(lines.map((raw, i) => ({ o: null, n: null, p: i, k: raw[0] === '+' || raw[0] === '-' ? raw[0] : ' ', s: raw.slice(1) })))
}

/**
 * A code line as it fits in `max` cells: tabs as two spaces, split into the
 * part before, inside and after its changed words, cut with … when too long.
 * `max` 0 leaves it whole.
 */
export function fitLine(s: string, hot: readonly [number, number] | undefined, max: number): [string, string, string] {
  const tabs = (t: string) => t.replace(/\t/g, '  ')
  const [a, b] = hot && hot[1] > hot[0] ? hot : [s.length, s.length]
  const parts: [string, string, string] = [tabs(s.slice(0, a)), tabs(s.slice(a, b)), tabs(s.slice(b))]
  if (max <= 0 || parts.join('').length <= max) return parts
  let room = Math.max(0, max - 1)
  const cut = parts.map(p => {
    const kept = p.slice(0, room)
    room -= kept.length
    return kept
  }) as [string, string, string]
  cut[cut[2] ? 2 : cut[1] ? 1 : 0] += '…'
  return cut
}

/** GitHub's anchor for a line in a PR's Files tab: `diff-<sha256(path)>R<line>`. */
export async function prLineAnchor(url: string, ref: CodeRef): Promise<string> {
  const bytes = new TextEncoder().encode(ref.path)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
  const range = ref.endLine > ref.line ? `R${ref.line}-R${ref.endLine}` : `R${ref.line}`
  return `${url}/files#diff-${hex}${range}`
}

/** The theme color each severity draws in, and its short tag. */
export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'suggestion',
  nit: 'subtle',
}

export const SEVERITY_TAG: Record<Severity, string> = {
  critical: 'CRIT',
  high: 'HIGH',
  medium: 'MED',
  low: 'LOW',
  nit: 'NIT',
}

export { SEVERITIES }
