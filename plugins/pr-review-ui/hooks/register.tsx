/**
 * pr-review-ui: PR reviews as points, with the code beside them.
 *
 * A review written in REVIEW_FORMAT (the bundled pr-review skill) is drawn in
 * the transcript as points: the one being reviewed open, the rest folded to a
 * line. Picking a point (a click, or 1-9 on the band, even from an empty
 * prompt) opens its first code location in terminal-browser beside the
 * conversation: the PR's Files tab with those lines highlighted, or the file at
 * the PR head when the PR did not change them. A point's other code locations
 * are one press away (s). Without terminal-browser (or for a local review) a
 * code pane of this mod's own shows the same lines.
 *
 * The band draws whatever other plugins put above the prompt under its own row
 * (it calls `next`), so it sits beside user-hd's band rather than replacing it.
 *
 * Reaches: process.run (gh, git, open), the `browser` noun terminal-browser
 * adds (when installed), fs reads (local review files). Writes no files.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { CodeRef, Finding, ReviewState, Snippet } from '../types'
import { ghError } from './gh.ts'
import {
  SEVERITY_COLOR,
  blobUrl,
  diffSnippet,
  inDiff,
  linkify,
  looksLikeReview,
  parseDiff,
  parseFindings,
  parseSource,
  parseSummary,
  prLineAnchor,
  reviewContext,
  reviewRequest,
  refKey,
  refLabel,
  refsIn,
  reviewKey,
  severityCounts,
  sourceSnippet,
  splitPath,
} from './review.ts'
import type { Hunk } from './review.ts'

const REVIEW_PANE = 'review'

const EMPTY_REVIEW: ReviewState = { key: null, source: null, findings: [], current: 0, section: 0, urls: {}, snippets: {}, error: null }

const browserA = atom({ plugin: 'pr-review-ui', key: 'hasBrowser' } as const, false)
const reviewA = atom({ plugin: 'pr-review-ui', key: 'review' } as const, EMPTY_REVIEW)

type Cfg = {
  ghPath: string
  codeView: 'auto' | 'browser' | 'pane'
  autoReview: boolean
}

export function readCfg(o: Record<string, unknown>): Cfg {
  const view = o.codeView === 'browser' || o.codeView === 'pane' ? o.codeView : 'auto'
  return {
    ghPath: typeof o.ghPath === 'string' && o.ghPath.trim() ? o.ghPath.trim() : 'gh',
    codeView: view,
    autoReview: typeof o.autoReview === 'boolean' ? o.autoReview : true,
  }
}

// Module state: set by register(); lost on a reload, which only costs refetching.
let cfg: Cfg = readCfg({})
const diffCache = new Map<string, Map<string, Hunk[]>>()
const headCache = new Map<string, string>()
const fileCache = new Map<string, string>()
const inflight = new Set<string>()

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)

// ---------- gh ----------

type GhResult = { isOk: true; stdout: string } | { isOk: false; error: string }

async function gh($: EngineInterface, args: string[]): Promise<GhResult> {
  try {
    const r = await $.process.run([cfg.ghPath, ...args], { timeoutMs: 30_000 })
    return r.exitCode === 0 ? { isOk: true, stdout: r.stdout } : { isOk: false, error: ghError(r.stderr, r.exitCode) }
  } catch {
    return { isOk: false, error: `Could not run ${cfg.ghPath}: install the GitHub CLI (brew install gh) and run gh auth login.` }
  }
}

const hostArgs = (host: string) => (host && host !== 'github.com' ? ['--hostname', host] : [])

async function openUrl($: EngineInterface, url: string, surface: RenderSurface) {
  try {
    const r = await $.process.run(['open', url], { timeoutMs: 5000 })
    if (r.exitCode === 0) return
  } catch {
    // fall through to copying
  }
  const copied = await $.ui.copy({ text: url, surface })
  $.ui.toast(copied.isCopied ? 'Could not open a browser; link copied.' : url)
}

// ---------- review: points and their code ----------

async function activateReview($: EngineInterface, text: string, shouldShow: boolean) {
  const key = reviewKey(text)
  const source = parseSource(text)
  const findings = parseFindings(text)
  if (!source || findings.length === 0) return
  const st = await read($, reviewA)
  if (st.key !== key) await update($, reviewA, () => ({ ...EMPTY_REVIEW, key, source, findings }))
  if (shouldShow) await showCurrent($)
}

/** Picks a point, at its first code location unless told which. */
async function select($: EngineInterface, key: string, index: number, section = 0) {
  const st = await read($, reviewA)
  if (st.key !== key || st.findings.length === 0) return
  const i = Math.max(0, Math.min(st.findings.length - 1, index))
  const sections = st.findings[i]?.sections.length ?? 1
  const j = Math.max(0, Math.min(sections - 1, section))
  await update($, reviewA, s => (s.key === key ? { ...s, current: i, section: j } : s))
  await showCurrent($)
}

async function stepSection($: EngineInterface, delta: number) {
  const st = await read($, reviewA)
  const f = st.findings[st.current]
  if (!st.key || !f) return
  const n = f.sections.length
  await select($, st.key, st.current, (((st.section + delta) % n) + n) % n)
}

async function useBrowser($: EngineInterface, st: ReviewState): Promise<boolean> {
  if (cfg.codeView === 'pane' || st.source?.kind !== 'pr') return false
  if (cfg.codeView === 'browser') return true
  return read($, browserA)
}

/** Shows the current point's current code location: in terminal-browser, else in the code pane. */
async function showCurrent($: EngineInterface) {
  const st = await read($, reviewA)
  const ref = st.findings[st.current]?.sections[st.section]
  if (!st.key || !ref) return
  if (await useBrowser($, st)) {
    const url = await urlFor($, st.key, ref)
    if (url && (await openInBrowser($, url))) return
  }
  void ensureSnippet($, st.key, ref)
  await $.ui.open({ id: REVIEW_PANE, title: 'Review code' })
}

/** The GitHub page for a code location: the Files tab when the diff shows those lines, else the file at the PR head. */
async function urlFor($: EngineInterface, key: string, ref: CodeRef): Promise<string | null> {
  const st = await read($, reviewA)
  const src = st.source
  if (st.key !== key || !src || src.kind !== 'pr') return null
  const k = refKey(ref)
  const known = st.urls[k]
  if (known) return known
  const files = await prDiff($, src.url)
  let url: string
  if (files && inDiff(files, ref)) url = await prLineAnchor(src.url, ref)
  else {
    const sha = await prHead($, src.url)
    url = sha ? blobUrl(src.url, src.repo, sha, ref) : await prLineAnchor(src.url, ref)
  }
  await update($, reviewA, s => (s.key === key ? { ...s, urls: { ...s.urls, [k]: url } } : s))
  return url
}

async function openInBrowser($: EngineInterface, url: string): Promise<boolean> {
  try {
    // @ts-ignore `browser` is the noun terminal-browser adds; absent when it is not installed.
    const opened = await $.browser.open({ url })
    if (opened && opened.ok === false) {
      $.ui.toast(`terminal-browser: ${String(opened.error).slice(0, 160)}. Showing the code in the pane instead.`)
      return false
    }
    return true
  } catch {
    await update($, browserA, () => false)
    $.ui.toast('terminal-browser is not available here: showing the code in the pane instead.')
    return false
  }
}

async function prDiff($: EngineInterface, url: string): Promise<Map<string, Hunk[]> | null> {
  const cached = diffCache.get(url)
  if (cached) return cached
  const r = await gh($, ['pr', 'diff', url])
  if (!r.isOk) return null
  const files = parseDiff(r.stdout)
  diffCache.set(url, files)
  return files
}

async function prHead($: EngineInterface, url: string): Promise<string | null> {
  const cached = headCache.get(url)
  if (cached) return cached
  const r = await gh($, ['pr', 'view', url, '--json', 'headRefOid'])
  if (!r.isOk) return null
  let sha = ''
  try {
    sha = String(JSON.parse(r.stdout).headRefOid ?? '')
  } catch {
    return null
  }
  if (sha) headCache.set(url, sha)
  return sha || null
}

async function fetchSnippet($: EngineInterface, st: ReviewState, ref: CodeRef): Promise<Snippet> {
  const src = st.source
  if (!src) return { kind: 'error', note: 'No review source.' }
  if (src.kind === 'local') {
    const diff = await $.process.run(['git', 'diff', 'HEAD', '--', ref.path], { cwd: src.root, timeoutMs: 10_000 }).catch(() => null)
    const fromDiff = diff && diff.exitCode === 0 ? diffSnippet(parseDiff(diff.stdout), ref) : null
    if (fromDiff) return { ...fromDiff, note: 'uncommitted change' }
    try {
      const text = await $.fs.read(`${src.root.replace(/\/$/, '')}/${ref.path}`)
      return sourceSnippet(typeof text === 'string' ? text : '', ref, 'working tree')
    } catch {
      return { kind: 'error', note: `Could not read ${ref.path} under ${src.root}.` }
    }
  }
  const files = await prDiff($, src.url)
  if (!files) return { kind: 'error', note: 'Could not read the PR diff with gh.' }
  const fromDiff = diffSnippet(files, ref)
  if (fromDiff) return fromDiff
  const sha = await prHead($, src.url)
  if (!sha) return { kind: 'error', note: 'Could not find the PR head commit.' }
  const cacheKey = `${src.url}@${ref.path}`
  let text = fileCache.get(cacheKey)
  if (text === undefined) {
    const host = /^https?:\/\/([^/]+)\//.exec(src.url)?.[1] ?? ''
    const path = ref.path.split('/').map(encodeURIComponent).join('/')
    const r = await gh($, ['api', ...hostArgs(host), '-H', 'Accept: application/vnd.github.raw', `repos/${src.repo}/contents/${path}?ref=${sha}`])
    if (!r.isOk) return { kind: 'error', note: `${ref.path}: ${r.error}` }
    text = r.stdout
    fileCache.set(cacheKey, text)
  }
  return sourceSnippet(text, ref, 'not changed in this PR (head version)')
}

async function ensureSnippet($: EngineInterface, key: string, ref: CodeRef) {
  const k = refKey(ref)
  const st = await read($, reviewA)
  if (st.key !== key || st.snippets[k] || inflight.has(`${key}:${k}`)) return
  inflight.add(`${key}:${k}`)
  try {
    const snippet = await fetchSnippet($, st, ref)
    await update($, reviewA, s => (s.key === key ? { ...s, snippets: { ...s.snippets, [k]: snippet } } : s))
  } finally {
    inflight.delete(`${key}:${k}`)
  }
}

/** Link targets for the backticked refs in a point's body: the line on GitHub, or the local file. */
async function hrefsFor(src: ReturnType<typeof parseSource>, text: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!src) return out
  for (const { ref } of refsIn(text)) {
    const k = refKey(ref)
    if (out.has(k)) continue
    out.set(k, src.kind === 'pr' ? await prLineAnchor(src.url, ref) : `file://${src.root.replace(/\/$/, '')}/${ref.path}#L${ref.line}`)
  }
  return out
}

/** Picks a point of the review drawn from `text`, making that review the current one first. */
async function pickIn($: EngineInterface, text: string, index: number, section = 0) {
  const key = reviewKey(text)
  if ((await read($, reviewA)).key !== key) await activateReview($, text, false)
  await select($, key, index, section)
}

const sourceLine = (src: ReviewState['source']) =>
  src?.kind === 'pr' ? `${src.repo} #${src.number}` : src?.kind === 'local' ? 'local changes' : ''

export const register: Register = (on, options) => {
  cfg = readCfg((options ?? {}) as Record<string, unknown>)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'point',
      description: 'Review: show point N of the last review (at code location M) beside the conversation',
      argumentHint: '<point> [code location]',
    })
    const commands = await $.command.list().catch(() => [])
    await update($, browserA, () => commands.some(c => c.name === 'browser'))
    return started
  })

  // "review <PR link>" in a typed prompt: hand the model the review format, so no slash command is needed.
  on('prompt.submit', async ($, e, next) => {
    const url = cfg.autoReview ? reviewRequest(e.text) : null
    if (!url) return next(e)
    return next({ ...e, context: [...(e.context ?? []), reviewContext(url)] })
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && looksLikeReview(e.answer)) void activateReview($, e.answer, true)
    return next(e)
  })

  on('command.run', { command: 'point' }, async ($, e) => {
    const st = await read($, reviewA)
    if (st.key === null) return { text: 'No review in this session yet: ask for one with /pr-review-ui:pr-review <PR URL>.' }
    const [a, b] = e.args.trim().split(/\s+/).map(Number)
    const index = st.findings.findIndex(f => f.n === a)
    if (!a || index < 0) return { text: `Points: ${st.findings.map(f => f.n).join(', ')}. Usage: /point <point> [code location].` }
    await select($, st.key, index, b && b > 0 ? b - 1 : 0)
    const f = st.findings[index]
    return { text: f ? `Point ${f.n}: ${f.title}` : 'Point shown.' }
  })

  // ---------- the review, drawn as points ----------

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const text = e.props.text
    if (e.props.isSummary || !looksLikeReview(text)) return next(e)
    const source = parseSource(text)
    const findings = parseFindings(text)
    if (!source || findings.length === 0) return next(e)
    const key = reviewKey(text)
    const st = await read($, reviewA)
    const current = st.key === key ? st.current : -1
    const section = st.key === key ? st.section : 0
    const summary = parseSummary(text)
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const width = Math.max(40, (e.viewport?.columns ?? 100) - 6)

    // The open point's body, its `path:line` refs turned into links that show that code.
    const hrefs = new Map<string, CodeRef>()
    const openFinding = current >= 0 ? findings[current] : undefined
    let linkedBody = ''
    if (openFinding) {
      const byRef = await hrefsFor(source, openFinding.body)
      const linked = linkify(openFinding.body, r => byRef.get(refKey(r)) ?? '')
      linkedBody = linked.text
      for (const [h, r] of linked.hrefs) if (h) hrefs.set(h, r)
    }

    const body = (f: Finding, i: number) => (
      <Markdown
        key={`body:${i}`}
        text={linkedBody}
        pressableLinks={[...hrefs.keys()].slice(0, 256)}
        onLinkPress={link => {
          const r = hrefs.get(link.href)
          const j = r ? f.sections.findIndex(s => refKey(s) === refKey(r)) : -1
          void pickIn($, text, i, Math.max(0, j))
        }}
      />
    )

    const point = (f: Finding, i: number) => {
      const isOpen = i === current
      const head = (
        <Box key={`head:${i}`} flexDirection="row" gap={1}>
          <Text color={SEVERITY_COLOR[f.severity]} bold>
            {f.severity.padEnd(6)}
          </Text>
          <Button
            key={`pt:${i}`}
            plain
            dimColor={!isOpen && current >= 0}
            label={short(`${isOpen ? '▾' : '▸'} ${f.n}. ${f.title}`, width - 8)}
            onPress={() => void pickIn($, text, i)}
          />
        </Box>
      )
      if (!isOpen) return head
      return (
        <Box key={`open:${i}`} flexDirection="column">
          {head}
          <Box flexDirection="column" paddingLeft={7}>
            {f.body !== '' && body(f, i)}
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              <Text dimColor>Code:</Text>
              {f.sections.map((r, j) => (
                <Button
                  key={`sec:${i}:${j}`}
                  label={refLabel(r)}
                  variant={j === section ? 'primary' : undefined}
                  dimColor={j !== section}
                  onPress={() => void pickIn($, text, i, j)}
                />
              ))}
            </Box>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="row">
        {e.props.isFirstOfReply && <Text color="claude">● </Text>}
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text wrap="wrap">
            <Text bold>{source.kind === 'pr' ? 'PR review' : 'Local review'}</Text> · {sourceLine(source)} · {findings.length} points · {severityCounts(findings)}
          </Text>
          <Text dimColor wrap="wrap">
            {current >= 0
              ? 'Pick another point, or press its number on the band; its code shows beside the conversation.'
              : 'Pick a point to see its code beside the conversation.'}
          </Text>
          {findings.map(point)}
          {summary !== '' && <Markdown key="summary" text={`**Summary:** ${summary}`} />}
        </Box>
      </Box>
    )
  })

  // ---------- band above the prompt ----------

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const beneath = await next(e)
    if (e.props.hasSurvey) return beneath
    const review = await read($, reviewA)
    const { Box, Text, Button } = $.ui.resolve(e)
    const f = review.findings[review.current]
    const ref = f?.sections[review.section]
    const rk = review.key
    const reviewPart =
      rk === null || !f || !ref ? null : (
        <Box key="review" flexDirection="row" flexWrap="wrap" gap={1}>
          <Text dimColor>Point</Text>
          {review.findings.slice(0, 9).map((p, i) => (
            <Button
              key={`band:${i}`}
              label={String(p.n)}
              hotkey={String(i + 1)}
              variant={i === review.current ? 'primary' : undefined}
              dimColor={i !== review.current}
              onPress={() => void select($, rk, i)}
            />
          ))}
          <Button key="prevpt" label="◀" hotkey="k" dimColor onPress={() => void select($, rk, review.current - 1)} />
          <Button key="nextpt" label="▶" hotkey="j" dimColor onPress={() => void select($, rk, review.current + 1)} />
          {f.sections.length > 1 && (
            <Button key="nextsec" label={`code ${review.section + 1}/${f.sections.length}`} hotkey="s" onPress={() => void stepSection($, 1)} />
          )}
          <Text>
            <Text dimColor>{splitPath(ref.path).dir}</Text>
            <Text bold>{splitPath(ref.path).file}</Text>
            <Text dimColor>
              :{ref.line}
              {ref.endLine > ref.line ? `-${ref.endLine}` : ''}
            </Text>
          </Text>
          <Button key="donereview" label="Done" hotkey="x" dimColor onPress={() => void update($, reviewA, () => EMPTY_REVIEW)} />
        </Box>
      )

    if (reviewPart === null) return beneath
    return (
      <Box flexDirection="column">
        {reviewPart}
        {beneath}
      </Box>
    )
  })

  // ---------- code pane (no terminal-browser, or a local review) ----------

  on('ui.render', { component: 'Pane', requestId: REVIEW_PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const st = await read($, reviewA)
    const f = st.findings[st.current]
    const ref = f?.sections[st.section]
    if (st.key === null || !st.source || !f || !ref) {
      return <Text dimColor>No review yet. Ask for one with /pr-review-ui:pr-review and its code shows here.</Text>
    }
    const key = st.key
    const src = st.source
    const snippet = st.snippets[refKey(ref)]
    const { dir, file } = splitPath(ref.path)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          <Button key="prev" label="◀ Prev" hotkey="k" onPress={() => void select($, key, st.current - 1)} />
          <Button key="next" label="Next ▶" hotkey="j" variant="primary" onPress={() => void select($, key, st.current + 1)} />
          {src.kind === 'pr' && (
            <Button key="github" label="Open on GitHub" hotkey="o" dimColor onPress={p => void prLineAnchor(src.url, ref).then(url => openUrl($, url, p.surface))} />
          )}
          <Text dimColor>
            {st.current + 1} / {st.findings.length}
          </Text>
        </Box>
        <Text wrap="wrap">
          <Text color={SEVERITY_COLOR[f.severity]} bold>
            {f.n}. {f.severity}
          </Text>{' '}
          <Text bold>{f.title}</Text>
        </Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {f.sections.map((r, j) => (
            <Button
              key={`psec:${j}`}
              label={refLabel(r)}
              variant={j === st.section ? 'primary' : undefined}
              dimColor={j !== st.section}
              onPress={() => void select($, key, st.current, j)}
            />
          ))}
        </Box>
        <Text wrap="truncate-start">
          <Text dimColor>{dir}</Text>
          <Text bold>{file}</Text>
          <Text dimColor>
            :{ref.line}
            {ref.endLine > ref.line ? `-${ref.endLine}` : ''}
            {snippet && snippet.kind !== 'error' ? `  ·  ${snippet.note}` : ''}
          </Text>
        </Text>
        {!snippet && <Text dimColor>Loading code…</Text>}
        {snippet?.kind === 'error' && (
          <Text color="error" wrap="wrap">
            {snippet.note}
          </Text>
        )}
        {snippet?.kind === 'diff' && <Code key="code" source={snippet.code} format="diff" path={snippet.path} wrap="truncate-end" />}
        {snippet?.kind === 'source' && <Code key="code" source={snippet.code} startLine={snippet.startLine} path={snippet.path} wrap="truncate-end" />}
      </Box>
    )
  })

}
