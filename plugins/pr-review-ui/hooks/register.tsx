/**
 * pr-review-ui: PR reviews as points, with the code beside them.
 *
 * A review written in REVIEW_FORMAT (the bundled pr-review skill, or any
 * prompt that says "review" and holds a PR link) is drawn in the transcript as
 * points: the one being reviewed open, the rest folded to a line. As soon as
 * the review text arrives, point 1's first code location shows beside the
 * conversation, and picking a point (a click, or 1-9 on the band, even from an
 * empty prompt) moves it. Where it shows follows the terminal (`auto`):
 *
 *   - in VS Code's or a JetBrains IDE's terminal: the IDE opens the file at the
 *     point's line, your checkout when it is on the PR head, else a read-only
 *     copy of the PR head (with a button to check the PR out);
 *   - in Ghostty or kitty, with terminal-browser installed: the GitHub page,
 *     the PR's Files tab with those lines highlighted;
 *   - anywhere else (and in the desktop app): this mod's code pane, the lines
 *     highlighted, beside a list of the PR's files.
 *
 * The band draws whatever other plugins put above the prompt under its own row
 * (it calls `next`), so it sits beside user-hd's band rather than replacing it.
 *
 * Reaches: process.run (gh, git, open, the IDE's command line), the `browser`
 * noun terminal-browser adds (when installed), fs reads (local review files)
 * and writes (read-only PR-head copies under the temp folder, for the IDE).
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
  refKey,
  refsIn,
  reviewContext,
  reviewKey,
  reviewRequest,
  severityCounts,
  sourceSnippet,
  splitPath,
} from './review.ts'
import type { Hunk } from './review.ts'
import { codeRows, headCopyPath, ideCommands, ideOf, pickView, prFiles, sameRepo, shortRef } from './view.ts'
import type { TermEnv, View } from './view.ts'

const REVIEW_PANE = 'review'

const EMPTY_REVIEW: ReviewState = {
  key: null,
  source: null,
  findings: [],
  current: 0,
  section: 0,
  urls: {},
  snippets: {},
  files: [],
  view: null,
  ideNote: null,
  canCheckout: false,
  error: null,
}

const browserA = atom({ plugin: 'pr-review-ui', key: 'hasBrowser' } as const, false)
const reviewA = atom({ plugin: 'pr-review-ui', key: 'review' } as const, EMPTY_REVIEW)

type Cfg = {
  ghPath: string
  codeView: 'auto' | View
  ideCommand: string
  autoReview: boolean
}

export function readCfg(o: Record<string, unknown>): Cfg {
  const view = o.codeView === 'browser' || o.codeView === 'pane' || o.codeView === 'ide' ? o.codeView : 'auto'
  return {
    ghPath: typeof o.ghPath === 'string' && o.ghPath.trim() ? o.ghPath.trim() : 'gh',
    codeView: view,
    ideCommand: typeof o.ideCommand === 'string' ? o.ideCommand.trim() : '',
    autoReview: typeof o.autoReview === 'boolean' ? o.autoReview : true,
  }
}

// Module state: set by register(); lost on a reload, which only costs refetching.
let cfg: Cfg = readCfg({})
let term: TermEnv = {}
let askpassNode: string | undefined
let tmpDir = '/tmp'
let isTerminal = true
const diffCache = new Map<string, Map<string, Hunk[]>>()
const headCache = new Map<string, string>()
const fileCache = new Map<string, string>()
const inflight = new Set<string>()
/** Reviews whose code was already shown by itself once, so a later step or redraw does not show it again. */
const shown = new Set<string>()
/** Reviews already told that the pane is waiting for a wider terminal. */
const toldNarrow = new Set<string>()

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)

// ---------- gh ----------

type GhResult = { isOk: true; stdout: string } | { isOk: false; error: string }

async function gh($: EngineInterface, args: string[], cwd?: string): Promise<GhResult> {
  try {
    const r = await $.process.run([cfg.ghPath, ...args], { timeoutMs: 30_000, ...(cwd ? { cwd } : {}) })
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

async function git($: EngineInterface, cwd: string, args: string[]): Promise<string | null> {
  try {
    const r = await $.process.run(['git', ...args], { cwd, timeoutMs: 10_000 })
    return r.exitCode === 0 ? r.stdout.trim() : null
  } catch {
    return null
  }
}

// ---------- review: points and their code ----------

async function activateReview($: EngineInterface, text: string, shouldShow: boolean) {
  const key = reviewKey(text)
  const source = parseSource(text)
  const findings = parseFindings(text)
  if (!source || findings.length === 0) return
  const st = await read($, reviewA)
  if (st.key !== key) await update($, reviewA, () => ({ ...EMPTY_REVIEW, key, source, findings }))
  if (shouldShow && !shown.has(key)) {
    shown.add(key)
    await showCurrent($, false)
  }
}

/** Picks a point, at its first code location unless told which. */
async function select($: EngineInterface, key: string, index: number, section = 0) {
  const st = await read($, reviewA)
  if (st.key !== key || st.findings.length === 0) return
  const i = Math.max(0, Math.min(st.findings.length - 1, index))
  const sections = st.findings[i]?.sections.length ?? 1
  const j = Math.max(0, Math.min(sections - 1, section))
  await update($, reviewA, s => (s.key === key ? { ...s, current: i, section: j } : s))
  await showCurrent($, true)
}

async function stepSection($: EngineInterface, delta: number) {
  const st = await read($, reviewA)
  const f = st.findings[st.current]
  if (!st.key || !f) return
  const n = f.sections.length
  await select($, st.key, st.current, (((st.section + delta) % n) + n) % n)
}

async function viewFor($: EngineInterface, st: ReviewState): Promise<View> {
  return pickView(cfg.codeView, term, {
    isTerminal,
    hasBrowser: await read($, browserA),
    isPr: st.source?.kind === 'pr',
    hasIdeCommand: cfg.ideCommand !== '',
  })
}

/**
 * Shows the current point's current code location where `viewFor` says,
 * falling back to the pane. `isAsked` is true when the person's press or
 * command led here: an asked pane opens at any width.
 */
async function showCurrent($: EngineInterface, isAsked: boolean) {
  const st = await read($, reviewA)
  const ref = st.findings[st.current]?.sections[st.section]
  if (!st.key || !ref) return
  const key = st.key
  const view = await viewFor($, st)
  if (view === 'browser') {
    const url = await urlFor($, key, ref)
    if (url && (await openInBrowser($, url))) {
      await update($, reviewA, s => (s.key === key ? { ...s, view: 'browser' as const } : s))
      return
    }
  }
  if (view === 'ide' && (await openInIde($, key, ref))) {
    await update($, reviewA, s => (s.key === key ? { ...s, view: 'ide' as const } : s))
    void loadFiles($, key)
    return
  }
  await update($, reviewA, s => (s.key === key ? { ...s, view: 'pane' as const } : s))
  void ensureSnippet($, key, ref)
  void loadFiles($, key)
  const opened = await $.ui.open({ id: REVIEW_PANE, title: 'Review code' })
  if (!opened.isPlaced && !isAsked && !toldNarrow.has(key)) {
    toldNarrow.add(key)
    $.ui.toast('The review code pane waits for a wider terminal: press 1 on the band, or Show code, to open it now.', { timeoutMs: 10_000 })
  }
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

/**
 * The file the IDE opens for a code location: your checkout when it is the
 * PR's repository on the PR head commit (or any local review), else a
 * read-only copy of the file at the PR head under the temp folder.
 */
async function ideFile($: EngineInterface, key: string, ref: CodeRef): Promise<{ path: string; note: string | null; canCheckout: boolean } | null> {
  const st = await read($, reviewA)
  const src = st.source
  if (st.key !== key || !src) return null
  if (src.kind === 'local') return { path: `${src.root.replace(/\/$/, '')}/${ref.path}`, note: null, canCheckout: false }
  const root = (await $.session.root().catch(() => '')).replace(/\/$/, '')
  const sha = await prHead($, src.url)
  const remote = root ? await git($, root, ['remote', 'get-url', 'origin']) : null
  const isSameRepo = remote !== null && sameRepo(remote, src.repo)
  const local = isSameRepo ? await git($, root, ['rev-parse', 'HEAD']) : null
  if (isSameRepo && sha && local === sha) return { path: `${root}/${ref.path}`, note: null, canCheckout: false }
  if (!sha) return isSameRepo ? { path: `${root}/${ref.path}`, note: 'your checkout (could not read the PR head)', canCheckout: false } : null
  const text = await headFile($, src, ref.path, sha)
  if (text === null) return null
  const copy = headCopyPath(tmpDir, src.repo, src.number, sha, ref.path)
  try {
    await $.fs.write(copy, text)
  } catch {
    return null
  }
  return {
    path: copy,
    note: isSameRepo ? 'a copy of the PR head: your checkout is on another commit' : 'a copy of the PR head: this folder is not that repository',
    canCheckout: isSameRepo,
  }
}

async function openInIde($: EngineInterface, key: string, ref: CodeRef): Promise<boolean> {
  const target = await ideFile($, key, ref)
  if (!target) return false
  const ide = ideOf(term)
  const tries = ideCommands(ide, target.path, ref.line, { command: cfg.ideCommand, askpassNode, bundleId: term.bundleId })
  for (const argv of tries) {
    try {
      const r = await $.process.run(argv, { timeoutMs: 15_000 })
      if (r.exitCode === 0) {
        await update($, reviewA, s => (s.key === key ? { ...s, ideNote: target.note, canCheckout: target.canCheckout } : s))
        return true
      }
    } catch {
      // try the next way of reaching the IDE
    }
  }
  $.ui.toast(
    ide === 'jetbrains'
      ? 'Could not open the IDE: set Editor command in /config (pr-review-ui) to its launcher, e.g. idea or goland. Showing the pane instead.'
      : "Could not open VS Code: run Shell Command: Install 'code' command in PATH, or set Editor command in /config. Showing the pane instead.",
    { timeoutMs: 10_000 },
  )
  return false
}

async function checkoutPr($: EngineInterface) {
  const st = await read($, reviewA)
  const src = st.source
  if (!st.key || !src || src.kind !== 'pr') return
  const root = (await $.session.root().catch(() => '')).replace(/\/$/, '')
  const r = await gh($, ['pr', 'checkout', src.url], root || undefined)
  if (!r.isOk) {
    $.ui.toast(`gh pr checkout failed: ${r.error}`, { timeoutMs: 10_000 })
    return
  }
  $.ui.toast(`Checked out #${src.number}: the editor now follows your checkout.`)
  await update($, reviewA, s => ({ ...s, ideNote: null, canCheckout: false }))
  await showCurrent($, true)
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

async function headFile($: EngineInterface, src: { url: string; repo: string }, path: string, sha: string): Promise<string | null> {
  const cacheKey = `${src.url}@${sha}@${path}`
  const cached = fileCache.get(cacheKey)
  if (cached !== undefined) return cached
  const host = /^https?:\/\/([^/]+)\//.exec(src.url)?.[1] ?? ''
  const enc = path.split('/').map(encodeURIComponent).join('/')
  const r = await gh($, ['api', ...hostArgs(host), '-H', 'Accept: application/vnd.github.raw', `repos/${src.repo}/contents/${enc}?ref=${sha}`])
  if (!r.isOk) return null
  fileCache.set(cacheKey, r.stdout)
  return r.stdout
}

async function loadFiles($: EngineInterface, key: string) {
  const st = await read($, reviewA)
  if (st.key !== key || st.files.length > 0 || st.source?.kind !== 'pr') return
  const files = await prDiff($, st.source.url)
  if (files) await update($, reviewA, s => (s.key === key ? { ...s, files: prFiles(files) } : s))
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
  const text = await headFile($, src, ref.path, sha)
  if (text === null) return { kind: 'error', note: `Could not read ${ref.path} at the PR head with gh.` }
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
    term = {
      termProgram: await $.env.get('TERM_PROGRAM'),
      term: await $.env.get('TERM'),
      tmux: await $.env.get('TMUX'),
      terminalEmulator: await $.env.get('TERMINAL_EMULATOR'),
      kittyWindow: await $.env.get('KITTY_WINDOW_ID'),
      bundleId: await $.env.get('__CFBundleIdentifier'),
    }
    askpassNode = await $.env.get('VSCODE_GIT_ASKPASS_NODE')
    tmpDir = (await $.env.get('TMPDIR')) || '/tmp'
    const surfaces = await $.session.surfaces().catch((): readonly RenderSurface[] => [])
    isTerminal = surfaces.length === 0 || surfaces.includes('terminal')
    return started
  })

  // "review <PR link>" in a typed prompt: hand the model the review format, so no slash command is needed.
  on('prompt.submit', async ($, e, next) => {
    const url = cfg.autoReview ? reviewRequest(e.text) : null
    if (!url) return next(e)
    return next({ ...e, context: [...(e.context ?? []), reviewContext(url)] })
  }).catch(($, e, next) => next(e))

  // The review shows its code as soon as its text arrives, while the turn may still run.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (e.agentId === undefined && looksLikeReview(result.answer)) void activateReview($, result.answer, true)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && looksLikeReview(e.answer)) void activateReview($, e.answer, true)
    return next(e)
  })

  on('command.run', { command: 'point' }, async ($, e) => {
    const st = await read($, reviewA)
    if (st.key === null) return { text: 'No review in this session yet: paste a PR link and say review.' }
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

    const chips = (f: Finding, i: number) => (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Text dimColor>Code</Text>
        {f.sections.map((r, j) =>
          j === section ? (
            <Text key={`cur:${i}:${j}`} color="suggestion" bold>
              ▸ {shortRef(r)}
            </Text>
          ) : (
            <Button key={`sec:${i}:${j}`} plain dimColor label={shortRef(r)} onPress={() => void pickIn($, text, i, j)} />
          ),
        )}
      </Box>
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
            {chips(f, i)}
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
    if (rk === null || !f || !ref) return beneath
    const { dir, file } = splitPath(ref.path)
    const where = review.view === 'ide' ? 'in the editor' : review.view === 'browser' ? 'in the browser' : review.view === 'pane' ? 'in the pane' : ''
    return (
      <Box flexDirection="column">
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
            <Text dimColor>{dir}</Text>
            <Text bold>{file}</Text>
            <Text dimColor>
              :{ref.line}
              {ref.endLine > ref.line ? `-${ref.endLine}` : ''}
              {where ? ` · ${where}` : ''}
            </Text>
          </Text>
          <Button key="showcode" label="Show code" hotkey="v" dimColor onPress={() => void showCurrent($, true)} />
          {review.view === 'ide' && review.canCheckout && <Button key="checkout" label="Check out PR" hotkey="c" dimColor onPress={() => void checkoutPr($)} />}
          <Button key="donereview" label="Done" hotkey="x" dimColor onPress={() => void update($, reviewA, () => EMPTY_REVIEW)} />
        </Box>
        {review.view === 'ide' && review.ideNote && (
          <Text key="idenote" dimColor wrap="truncate-end">
            The editor shows {review.ideNote}.
          </Text>
        )}
        {beneath}
      </Box>
    )
  })

  // ---------- code pane ----------

  on('ui.render', { component: 'Pane', requestId: REVIEW_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const st = await read($, reviewA)
    const f = st.findings[st.current]
    const ref = f?.sections[st.section]
    if (st.key === null || !st.source || !f || !ref) {
      return <Text dimColor>No review yet. Paste a PR link and say review, and its code shows here.</Text>
    }
    const key = st.key
    const src = st.source
    const snippet = st.snippets[refKey(ref)]
    const { dir, file } = splitPath(ref.path)
    const width = Math.max(30, e.props.bodyColumns)
    const rows = snippet ? codeRows(snippet, ref) : []
    const gutter = Math.max(3, ...rows.map(r => Math.max(r.oldNo.length, r.newNo.length)))
    const touched = new Set(f.sections.map(s => s.path))

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          <Button key="prev" label="◀ Prev" hotkey="k" onPress={() => void select($, key, st.current - 1)} />
          <Button key="next" label="Next ▶" hotkey="j" variant="primary" onPress={() => void select($, key, st.current + 1)} />
          {src.kind === 'pr' && (
            <Button key="github" label="GitHub" hotkey="o" dimColor onPress={p => void prLineAnchor(src.url, ref).then(url => openUrl($, url, p.surface))} />
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

        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {f.sections.map((r, j) =>
            j === st.section ? (
              <Text key={`pcur:${j}`} color="suggestion" bold>
                ▸ {shortRef(r)}
              </Text>
            ) : (
              <Button key={`psec:${j}`} plain dimColor label={shortRef(r)} onPress={() => void select($, key, st.current, j)} />
            ),
          )}
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
        {rows.length > 0 && (
          <Box key="code" flexDirection="column">
            {rows.map((r, i) => (
              <Box key={`row:${i}`} flexDirection="row">
                <Text color={r.isTarget ? 'warning' : undefined} dimColor={!r.isTarget}>
                  {r.isTarget ? '▌' : ' '}
                  {(r.newNo || r.oldNo).padStart(gutter)}{' '}
                </Text>
                <Text color={r.mark === '+' ? 'diffAdded' : r.mark === '-' ? 'diffRemoved' : undefined} dimColor={r.mark === ' '}>
                  {r.mark}{' '}
                </Text>
                <Text
                  wrap="truncate-end"
                  bold={r.isTarget}
                  dimColor={!r.isTarget && r.mark === ' '}
                  color={r.mark === '+' ? 'diffAdded' : r.mark === '-' ? 'diffRemoved' : undefined}
                >
                  {r.text === '' ? ' ' : r.text}
                </Text>
              </Box>
            ))}
          </Box>
        )}

        {st.files.length > 0 && (
          <Box key="files" flexDirection="column" marginTop={1}>
            <Text dimColor>Files in this PR</Text>
            {st.files.slice(0, 14).map((pf, i) => {
              const parts = splitPath(pf.path)
              const isHere = touched.has(pf.path)
              return (
                <Text key={`file:${i}`} wrap="truncate-start">
                  <Text color="warning">{isHere ? '● ' : '  '}</Text>
                  <Text dimColor>{short(parts.dir, Math.max(8, width - parts.file.length - 18))}</Text>
                  <Text bold={isHere}>{parts.file}</Text>
                  <Text color="diffAdded"> +{pf.adds}</Text>
                  <Text color="diffRemoved"> −{pf.dels}</Text>
                </Text>
              )
            })}
            {st.files.length > 14 && <Text dimColor>  …{st.files.length - 14} more</Text>}
          </Box>
        )}
      </Box>
    )
  })
}
