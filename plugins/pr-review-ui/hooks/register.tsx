/**
 * pr-review-ui: PR reviews as points, with the code beside them.
 *
 * A prompt that asks for a review ("review <PR link>", a PR link alone,
 * "review pr", "review pr 418", "pr review") hands the model the review
 * format, and the mod starts checking the PR out into a review worktree: a
 * folder of its own on the PR head with HEAD moved back to the merge base, so
 * the PR reads as uncommitted edits. When the review arrives it is drawn as
 * points, point 1 open, and point 1's code shows at once, with nothing to
 * click. Picking a point (a click, or 1-9, a and d on the band) moves it.
 * Where the code shows follows the terminal (`auto`):
 *
 *   - in an editor's terminal (VS Code and its forks, JetBrains, Zed,
 *     Neovim): the editor opens the worktree's file at the point's line, the
 *     PR's changes in its own change marks;
 *   - in Ghostty or kitty, with terminal-browser installed: the PR's Files
 *     tab, those lines highlighted;
 *   - anywhere else (and in the desktop app): the code pane, the PR's change
 *     drawn like git diff with the changed words marked. From 144 columns it
 *     docks beside the transcript; narrower, the code shows under the open
 *     point and moves into the pane once the terminal is widened.
 *
 * The first session after install, and /review-setup, ask before installing
 * anything the review can use and this machine lacks (the GitHub CLI,
 * Ghostty, terminal-browser).
 *
 * The band draws whatever other plugins put above the prompt under its own row
 * (it calls `next`), so it sits beside user-hd's band rather than replacing it.
 *
 * Reaches: process.run (gh, git, brew, claude, uname, open, the editor's
 * command line), the `browser` noun terminal-browser adds (when installed),
 * fs reads (review files) and writes (PR-head copies when no worktree can be
 * made), the store (which setup questions were answered).
 */
import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register, RenderSurface, RenderViewport, UiPane } from 'claude-code'

import type { CodeLine, CodeRef, Finding, ReviewState, Snippet, Worktree } from '../types'
import { ghError } from './gh.ts'
import {
  CONTEXT,
  SEVERITIES,
  SEVERITY_COLOR,
  SEVERITY_TAG,
  blobUrl,
  fitLine,
  hunkRows,
  inDiff,
  isTarget,
  linkify,
  looksLikeReview,
  parseDiff,
  parseFindings,
  parseHead,
  parseSource,
  prLineAnchor,
  refKey,
  refLabel,
  refsIn,
  reviewContext,
  reviewKey,
  reviewRequest,
  rowsFromText,
  slashReview,
  splitPath,
  suggestionRows,
  verdictTone,
  windowRows,
} from './review.ts'
import type { Hunk, ReviewAsk } from './review.ts'
import { offerSetup, wasAsked } from './setup.ts'
import type { SetupIo, SetupMode, Stored } from './setup.ts'
import { IDE_NAME, PANE_FLOOR, cacheDirs, headCopyPath, ideCommands, ideOf, pickView, prFiles, shortRef } from './view.ts'
import type { TermEnv, View } from './view.ts'
import { PR_FIELDS, failure, fileRows, parsePrInfo, prepareWorktree, removeWorktree } from './worktree.ts'
import type { PrInfo, Prepared, Run } from './worktree.ts'

const REVIEW_PANE = 'review'

const EMPTY_REVIEW: ReviewState = {
  key: null,
  source: null,
  findings: [],
  current: 0,
  section: 0,
  urls: {},
  snippets: {},
  expand: {},
  files: [],
  meta: null,
  verdict: '',
  view: null,
  ideNote: null,
  paneSeq: 0,
  error: null,
}

const EMPTY_WORKTREE: Worktree = { url: '', status: 'idle', path: '', repo: '', note: '' }

const browserA = atom({ plugin: 'pr-review-ui', key: 'hasBrowser' } as const, false)
const reviewA = atom({ plugin: 'pr-review-ui', key: 'review' } as const, EMPTY_REVIEW)
const worktreeA = atom({ plugin: 'pr-review-ui', key: 'worktree' } as const, EMPTY_WORKTREE)

type Cfg = {
  ghPath: string
  codeView: 'auto' | View
  ideCommand: string
  autoReview: boolean
  offerSetup: boolean
}

export function readCfg(o: Record<string, unknown>): Cfg {
  const view = o.codeView === 'browser' || o.codeView === 'pane' || o.codeView === 'ide' ? o.codeView : 'auto'
  return {
    ghPath: typeof o.ghPath === 'string' && o.ghPath.trim() ? o.ghPath.trim() : 'gh',
    codeView: view,
    ideCommand: typeof o.ideCommand === 'string' ? o.ideCommand.trim() : '',
    autoReview: typeof o.autoReview === 'boolean' ? o.autoReview : true,
    offerSetup: typeof o.offerSetup === 'boolean' ? o.offerSetup : true,
  }
}

// Module state: set by register(); lost on a reload, which only costs refetching.
let cfg: Cfg = readCfg({})
let term: TermEnv = {}
let askpassNode: string | undefined
let tmpDir = '/tmp'
let home = ''
let isTerminal = true
let isMac = false
/** What the last drawing measured: the conversation's width, and whether the terminal docks panes. */
let viewport: { columns: number; isFullscreen?: boolean } = { columns: 0 }
/** Whether the code pane has drawn since it last opened, so the transcript can drop the code under the point. */
let isPaneDrawn = false
let setupJob: Promise<unknown> | null = null
const diffCache = new Map<string, Map<string, Hunk[]>>()
const headCache = new Map<string, string>()
const fileCache = new Map<string, string>()
const rowsCache = new Map<string, CodeLine[]>()
const infoCache = new Map<string, PrInfo>()
const worktreeJobs = new Map<string, Promise<Prepared>>()
const inflight = new Set<string>()
/** Reviews whose code was already shown by itself once, so a later step or redraw does not show it again. */
const shown = new Set<string>()

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)
const plain = (s: string) => s.replace(/`/g, '')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function noteViewport(v: RenderViewport | undefined) {
  if (v && v.columns > 0) viewport = { columns: v.columns, isFullscreen: v.isFullscreen }
}

// ---------- gh, git, files ----------

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

async function exists($: EngineInterface, path: string): Promise<boolean> {
  try {
    await $.fs.stat(path)
    return true
  } catch {
    return false
  }
}

async function readText($: EngineInterface, path: string): Promise<string | null> {
  try {
    const text = await $.fs.read(path)
    return typeof text === 'string' ? text : null
  } catch {
    return null
  }
}

const sessionRoot = async ($: EngineInterface) => (await $.session.root().catch(() => '')).replace(/\/$/, '')

/** Runs a host command for the worktree and file helpers: its output, or one line saying what went wrong. */
function runner($: EngineInterface): Run {
  return async (argv, timeoutMs = 30_000) => {
    try {
      const r = await $.process.run(argv, { timeoutMs })
      return r.exitCode === 0 ? { isOk: true, out: r.stdout } : { isOk: false, err: failure(r.stderr, argv, r.exitCode) }
    } catch {
      return { isOk: false, err: `could not run ${argv[0]}` }
    }
  }
}

// ---------- setup ----------

const SETUP_KEY = 'setup'

function setupIo($: EngineInterface): SetupIo {
  return {
    run: async (argv, timeoutMs) => {
      try {
        const r = await $.process.run(argv, { timeoutMs })
        return { exitCode: r.exitCode, stderr: r.stderr }
      } catch {
        return { exitCode: 127, stderr: `could not run ${argv[0]}` }
      }
    },
    exists: path => exists($, path),
    ask: (question, options) => $.ui.ask(question, { header: 'pr-review-ui', options }),
    toast: (text, timeoutMs) => $.ui.toast(text, { timeoutMs }),
    status: text => $.ui.status(text),
    load: () => $.store.get(SETUP_KEY),
    save: (value: Stored) => $.store.set(SETUP_KEY, value),
  }
}

async function runSetup($: EngineInterface, mode: SetupMode, isBackground = false): Promise<string[]> {
  while (setupJob) await setupJob.catch(() => undefined)
  const job = offerSetup(setupIo($), { ghPath: cfg.ghPath, hasBrowser: await read($, browserA), isMac, home }, mode, isBackground)
  setupJob = job
  try {
    return await job
  } finally {
    if (setupJob === job) setupJob = null
  }
}

// ---------- the PR and its review worktree ----------

/** The PR a URL, a number in this repository, or the current branch (null) names, read with gh. */
async function prInfo($: EngineInterface, target: string | null): Promise<PrInfo | null> {
  const cached = target ? infoCache.get(target) : undefined
  if (cached) return cached
  const root = await sessionRoot($)
  const r = await gh($, ['pr', 'view', ...(target ? [target] : []), '--json', PR_FIELDS], root || undefined)
  if (!r.isOk) return null
  const info = parsePrInfo(r.stdout)
  if (!info) return null
  infoCache.set(info.url, info)
  if (target) infoCache.set(target, info)
  headCache.set(info.url, info.headSha)
  return info
}

const askTarget = (ask: ReviewAsk) => (ask.kind === 'url' ? ask.url : ask.kind === 'number' ? String(ask.number) : null)

/** Starts checking the PR out into its review worktree, once per PR; answers the folder it will be. */
function startWorktree($: EngineInterface, info: PrInfo): string {
  if (!home) return ''
  const dir = cacheDirs(home, info.host, info.repo, info.number, info.headSha).worktree
  if (worktreeJobs.has(info.url)) return dir
  const job = (async (): Promise<Prepared> => {
    const note = `Checking out #${info.number} into the review worktree…`
    await update($, worktreeA, () => ({ url: info.url, status: 'preparing' as const, path: dir, repo: '', note }))
    $.ui.status(`pr-review-ui: ${note}`)
    let result: Prepared
    try {
      result = await prepareWorktree(runner($), path => exists($, path), { gh: cfg.ghPath, home, root: await sessionRoot($), info })
    } catch {
      result = { isOk: false, note: 'the checkout stopped unexpectedly' }
    } finally {
      $.ui.status(undefined)
    }
    await update($, worktreeA, s =>
      s.url !== info.url
        ? s
        : result.isOk
          ? { url: info.url, status: 'ready' as const, path: result.path, repo: result.repo, note: '' }
          : { url: info.url, status: 'failed' as const, path: '', repo: '', note: result.note },
    )
    if (!result.isOk) $.ui.toast(`No review worktree (${result.note}): the code comes from GitHub instead.`, { timeoutMs: 10_000 })
    return result
  })()
  worktreeJobs.set(info.url, job)
  return dir
}

/**
 * As a review is asked for: its worktree starts, and on a wide terminal (or
 * the desktop app) the code pane opens to say so. Answers the worktree folder.
 */
async function prepareReview($: EngineInterface, info: PrInfo): Promise<string> {
  const dir = startWorktree($, info)
  const isWide = !isTerminal || (viewport.isFullscreen !== false && viewport.columns >= PANE_FLOOR)
  const view = pickView(cfg.codeView, term, { isTerminal, hasBrowser: await read($, browserA), isPr: true, hasIdeCommand: cfg.ideCommand !== '' })
  if (view === 'pane' && isWide) await $.ui.open({ id: REVIEW_PANE, title: 'Review code' }).catch(() => undefined)
  return dir
}

/** The PR's review worktree, once it is ready (or why there is none). */
async function worktreeFor($: EngineInterface, url: string): Promise<Prepared | null> {
  if (!worktreeJobs.has(url)) {
    const info = await prInfo($, url)
    if (!info) return null
    startWorktree($, info)
  }
  const job = worktreeJobs.get(url)
  return job ? job.catch((): Prepared => ({ isOk: false, note: 'the checkout stopped unexpectedly' })) : null
}

// ---------- review: points and their code ----------

async function activateReview($: EngineInterface, text: string, shouldShow: boolean) {
  const key = reviewKey(text)
  const source = parseSource(text)
  const findings = parseFindings(text)
  if (!source) return
  const st = await read($, reviewA)
  const { verdict } = parseHead(text)
  if (st.key !== key) await update($, reviewA, s => ({ ...EMPTY_REVIEW, key, source, findings, verdict, paneSeq: s.paneSeq }))
  if (source.kind === 'pr') void loadPr($, key, source.url)
  if (findings.length === 0) {
    // Nothing to show code for: the pane, if open, says so and lists the PR's files.
    void loadFiles($, key)
    return
  }
  if (shouldShow && !shown.has(key)) {
    shown.add(key)
    await showCurrent($, false)
  }
}

async function loadPr($: EngineInterface, key: string, url: string) {
  const info = await prInfo($, url)
  if (!info) return
  startWorktree($, info)
  await update($, reviewA, s => (s.key === key ? { ...s, meta: info.meta } : s))
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
 * command led here: an asked pane opens at any width. Unasked, a pane on a
 * narrow terminal waits and docks once the terminal is widened; until then
 * the code shows under the open point.
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
  // On the terminal's main screen a pane opened unasked would not be a sidebar: the code stays under the point until v.
  if (!isAsked && isTerminal && viewport.isFullscreen === false) return
  const opened = await $.ui.open({ id: REVIEW_PANE, title: 'Review code' })
  if (!opened.isPlaced) isPaneDrawn = false
  await update($, reviewA, s => ({ ...s, paneSeq: s.paneSeq + 1 }))
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
 * The file an editor opens for a code location: the review worktree's (or,
 * for a local review, the working tree's), else a read-only copy of the file
 * at the PR head under the temp folder.
 */
async function editorFile($: EngineInterface, key: string, ref: CodeRef): Promise<{ path: string; note: string | null } | null> {
  const st = await read($, reviewA)
  const src = st.source
  if (st.key !== key || !src) return null
  if (src.kind === 'local') return { path: `${src.root.replace(/\/$/, '')}/${ref.path}`, note: null }
  const wt = await worktreeFor($, src.url)
  if (wt?.isOk) return { path: `${wt.path}/${ref.path}`, note: null }
  const sha = await prHead($, src.url)
  if (!sha) return null
  const text = await headFile($, src, ref.path, sha)
  if (text === null) return null
  const copy = headCopyPath(tmpDir, src.repo, src.number, sha, ref.path)
  try {
    await $.fs.write(copy, text)
  } catch {
    return null
  }
  return { path: copy, note: 'a read-only copy of the PR head, with no change marks: the review worktree could not be made' }
}

async function openInEditor($: EngineInterface, file: string, line: number, isAnyEditor: boolean): Promise<boolean> {
  const tries = ideCommands(ideOf(term), file, line, { command: cfg.ideCommand, askpassNode, bundleId: term.bundleId, nvim: term.nvim })
  if (isAnyEditor && tries.length === 0) tries.push(['code', '-g', `${file}:${line}`], ['open', file])
  for (const argv of tries) {
    try {
      const r = await $.process.run(argv, { timeoutMs: 15_000 })
      if (r.exitCode === 0) return true
    } catch {
      // try the next way of reaching an editor
    }
  }
  return false
}

const EDITOR_HELP: Record<string, string> = {
  jetbrains: 'Could not open the IDE: set Editor command in /config (pr-review-ui) to its launcher, e.g. idea or goland.',
  vscode: "Could not open VS Code: run Shell Command: Install 'code' command in PATH, or set Editor command in /config.",
  zed: 'Could not open Zed: install its command line (Zed menu, Install CLI), or set Editor command in /config.',
  nvim: 'Could not reach Neovim through $NVIM: set Editor command in /config.',
}

async function openInIde($: EngineInterface, key: string, ref: CodeRef): Promise<boolean> {
  const target = await editorFile($, key, ref)
  if (!target) return false
  if (await openInEditor($, target.path, ref.line, false)) {
    await update($, reviewA, s => (s.key === key ? { ...s, ideNote: target.note } : s))
    return true
  }
  $.ui.toast(`${EDITOR_HELP[ideOf(term) ?? 'vscode'] ?? EDITOR_HELP.vscode} Showing the pane instead.`, { timeoutMs: 10_000 })
  return false
}

/** The pane's Open in editor: any editor that answers, even outside an editor's terminal. */
async function openFromPane($: EngineInterface) {
  const st = await read($, reviewA)
  const ref = st.findings[st.current]?.sections[st.section]
  if (!st.key || !ref) return
  const target = await editorFile($, st.key, ref)
  if (!target || !(await openInEditor($, target.path, ref.line, true))) {
    $.ui.toast('No editor answered: set Editor command in /config (pr-review-ui), e.g. code, cursor, zed or idea.', { timeoutMs: 10_000 })
  }
}

/** Done: the review closes, its pane closes, and its worktree goes. */
async function finishReview($: EngineInterface) {
  const wt = await read($, worktreeA)
  await update($, reviewA, () => EMPTY_REVIEW)
  await $.ui.close({ id: REVIEW_PANE }).catch(() => undefined)
  if (wt.status === 'ready' && wt.repo && wt.path) {
    const isRemoved = await removeWorktree(runner($), wt.repo, wt.path)
    $.ui.toast(isRemoved ? 'Review done: the review worktree is removed.' : `Review done. The review worktree is still at ${wt.path}.`)
    for (const k of [...rowsCache.keys()]) if (k.startsWith(`${wt.path}|`)) rowsCache.delete(k)
  }
  if (wt.url) worktreeJobs.delete(wt.url)
  await update($, worktreeA, () => EMPTY_WORKTREE)
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

async function cachedRows(key: string, load: () => Promise<CodeLine[] | null>): Promise<CodeLine[] | null> {
  const cached = rowsCache.get(key)
  if (cached) return cached
  const rows = await load()
  if (rows) rowsCache.set(key, rows)
  return rows
}

function changeNote(rows: readonly CodeLine[], isPr: boolean): string {
  const adds = rows.filter(r => r.k === '+').length
  const dels = rows.filter(r => r.k === '-').length
  if (adds === 0 && dels === 0) return isPr ? 'not changed in this PR' : 'unchanged'
  if (dels === 0 && adds === rows.length) return isPr ? 'new in this PR' : 'new file'
  return isPr ? 'changed in this PR' : 'uncommitted change'
}

/** A code location's whole file as rows, and where they came from. */
async function codeOf($: EngineInterface, st: ReviewState, ref: CodeRef): Promise<{ rows: CodeLine[]; note: string } | { error: string }> {
  const src = st.source
  if (!src) return { error: 'No review source.' }
  const run = runner($)
  const load = (root: string) => cachedRows(`${root}|${ref.path}`, () => fileRows(run, p => readText($, p), root, ref.path))
  if (src.kind === 'local') {
    const rows = await load(src.root.replace(/\/$/, ''))
    return rows ? { rows, note: changeNote(rows, false) } : { error: `Could not read ${ref.path} under ${src.root}.` }
  }
  const wt = await worktreeFor($, src.url)
  if (wt?.isOk) {
    const rows = await load(wt.path)
    if (rows) return { rows, note: `${changeNote(rows, true)} · review worktree` }
  }
  // GitHub only: the PR's hunk, or the file at the head.
  const files = await prDiff($, src.url)
  if (!files) return { error: 'Could not read the PR diff with gh.' }
  const hunk = hunkRows(files, ref)
  if (hunk) return { rows: hunk, note: 'changed in this PR · from GitHub' }
  const sha = await prHead($, src.url)
  if (!sha) return { error: 'Could not find the PR head commit.' }
  const text = await headFile($, src, ref.path, sha)
  if (text === null) return { error: `Could not read ${ref.path} at the PR head with gh.` }
  return { rows: rowsFromText(text), note: 'not changed in this PR · from GitHub' }
}

async function fetchSnippet($: EngineInterface, st: ReviewState, ref: CodeRef): Promise<Snippet> {
  const code = await codeOf($, st, ref)
  if ('error' in code) return { kind: 'error', note: code.error }
  const win = windowRows(code.rows, ref, CONTEXT, st.expand[refKey(ref)])
  if (win.rows.length === 0) {
    const last = code.rows.reduce((n, r) => Math.max(n, r.n ?? 0), 0)
    return { kind: 'error', note: `${ref.path} has ${last} lines; line ${ref.line} is past its end.` }
  }
  return { kind: 'rows', ...win, note: code.note }
}

async function ensureSnippet($: EngineInterface, key: string, ref: CodeRef, isFresh = false) {
  const k = refKey(ref)
  const st = await read($, reviewA)
  if (st.key !== key || (!isFresh && st.snippets[k]) || inflight.has(`${key}:${k}`)) return
  inflight.add(`${key}:${k}`)
  try {
    const snippet = await fetchSnippet($, st, ref)
    await update($, reviewA, s => (s.key === key ? { ...s, snippets: { ...s.snippets, [k]: snippet } } : s))
  } finally {
    inflight.delete(`${key}:${k}`)
  }
}

/** Ten more lines above or below the code location in view. */
async function expandCode($: EngineInterface, dir: 'up' | 'down') {
  const st = await read($, reviewA)
  const ref = st.findings[st.current]?.sections[st.section]
  if (!st.key || !ref) return
  const k = refKey(ref)
  await update($, reviewA, s => {
    const was = s.expand[k] ?? { up: 0, down: 0 }
    return s.key === st.key ? { ...s, expand: { ...s.expand, [k]: { ...was, [dir]: was[dir] + 10 } } } : s
  })
  await ensureSnippet($, st.key, ref, true)
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

/** `↑ 10 more lines (36 above)`, or `↓ 3 more lines` when that is all of them. */
const moreLabel = (arrow: string, hidden: number, side: string) => {
  const n = Math.min(10, hidden)
  return `${arrow} ${n} more line${n === 1 ? '' : 's'}${hidden > n ? ` (${hidden} ${side})` : ''}`
}

const sourceLine = (src: ReviewState['source']) =>
  src?.kind === 'pr' ? `${src.repo} #${src.number}` : src?.kind === 'local' ? 'local changes' : ''

/** Where the band says the code is; '' when it is in the docked pane beside it, which says so itself. */
function whereLabel(view: ReviewState['view'], isDocked: boolean): string {
  if (view === 'ide') {
    const ide = ideOf(term)
    return `in ${ide ? IDE_NAME[ide] : 'the editor'}`
  }
  if (view === 'browser') return 'in terminal-browser'
  return view === 'pane' && !isDocked ? 'under the point' : ''
}

/**
 * Whether the code pane is beside the transcript now, or will be once the
 * resize that just happened settles. Off the terminal the pane always is.
 */
async function isPaneDocked($: EngineInterface, surface: RenderSurface, v: RenderViewport | undefined): Promise<boolean> {
  if (surface !== 'terminal') return true
  let pane: UiPane | undefined
  try {
    pane = (await $.ui.panes()).find(p => p.id === REVIEW_PANE)
  } catch {
    pane = undefined
  }
  if (pane?.isPlaced) return true
  return pane !== undefined && v?.isFullscreen !== false && (v?.columns ?? 0) >= PANE_FLOOR
}

type Els = Pick<ElementTable, 'Box' | 'Text'>

/**
 * Code rows as git diff draws them: old and new line numbers, the reviewed
 * lines marked, added and removed lines on their colors, the changed words
 * stronger, each line cut to the `columns` it has. `ref` null draws a
 * suggested change: no numbers, no marks.
 */
function codeLines({ Box, Text }: Els, rows: readonly CodeLine[], ref: CodeRef | null, keyPrefix: string, columns: number) {
  const width = Math.max(1, ...rows.map(r => String(Math.max(r.o ?? 0, r.n ?? 0)).length))
  const room = Math.max(10, columns - (ref !== null ? 2 * width + 3 : 0) - 3)
  return (
    <Box key={`${keyPrefix}:code`} flexDirection="column">
      {rows.map((r, i) => {
        const isHit = ref !== null && isTarget(r, ref)
        const [pre, hot, post] = fitLine(r.s, r.hot, room)
        const word = r.k === '+' ? 'diffAddedWord' : 'diffRemovedWord'
        return (
          <Box key={`${keyPrefix}:${i}`} flexDirection="row">
            {ref !== null && (
              <Text color={isHit ? 'warning' : undefined} dimColor={!isHit}>
                {isHit ? '▌' : ' '}
                {String(r.o ?? '').padStart(width)} {String(r.n ?? '').padStart(width)}{' '}
              </Text>
            )}
            <Box flexDirection="row" flexGrow={1} flexShrink={1} backgroundColor={r.k === '+' ? 'diffAdded' : r.k === '-' ? 'diffRemoved' : undefined}>
              <Text dimColor={r.k === ' '}>{r.k} </Text>
              <Text wrap="truncate-end" dimColor={r.k === ' ' && !isHit} bold={isHit && r.k === ' '}>
                {hot
                  ? [
                      <Text key="pre">{pre}</Text>,
                      <Text key="hot" backgroundColor={word}>
                        {hot}
                      </Text>,
                      <Text key="post">{post}</Text>,
                    ]
                  : `${pre}${post}` || ' '}
              </Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

export const register: Register = (on, options) => {
  cfg = readCfg((options ?? {}) as Record<string, unknown>)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'point',
      description: 'Review: show point N of the last review (at code location M) beside the conversation',
      argumentHint: '<point> [code location]',
    })
    await $.command.register({
      name: 'review-setup',
      description: 'Review: offer to install what pr-review-ui uses and this machine lacks (GitHub CLI, Ghostty, terminal-browser)',
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
      nvim: await $.env.get('NVIM'),
    }
    askpassNode = await $.env.get('VSCODE_GIT_ASKPASS_NODE')
    tmpDir = (await $.env.get('TMPDIR')) || '/tmp'
    home = (await $.env.get('HOME')) || ''
    const surfaces = await $.session.surfaces().catch((): readonly RenderSurface[] => [])
    isTerminal = surfaces.length === 0 || surfaces.includes('terminal')
    const uname = await $.process.run(['uname', '-s'], { timeoutMs: 5000 }).catch(() => null)
    isMac = uname?.exitCode === 0 && uname.stdout.trim() === 'Darwin'
    // The first session after install asks about what is missing; later ones stay quiet.
    if (cfg.offerSetup && e.isInteractive && !wasAsked(await $.store.get(SETUP_KEY).catch(() => undefined))) {
      $.clock.after(1500, () => void runSetup($, 'first-run').catch(() => undefined))
    }
    return started
  })

  // A prompt that asks for a review: offer what is missing, start the worktree, hand the model the format.
  on('prompt.submit', async ($, e, next) => {
    const slash = slashReview(e.text)
    const ask = slash ?? (cfg.autoReview ? reviewRequest(e.text) : null)
    if (!ask) return next(e)
    if (cfg.offerSetup) await runSetup($, 'review', true).catch(() => [])
    if (ask.kind === 'local') return next(e)
    const info = await prInfo($, askTarget(ask))
    if (slash) {
      // The skill carries the format itself: just get the code ready.
      if (info) await prepareReview($, info)
      return next(e)
    }
    if (!info) {
      if (ask.kind === 'url') return next({ ...e, context: [...(e.context ?? []), reviewContext(ask.url)] })
      $.ui.toast(ask.kind === 'number' ? `gh found no PR #${ask.number} in this repository.` : 'gh found no PR for this branch: paste the PR link to review it.')
      return next(e)
    }
    const dir = await prepareReview($, info)
    return next({ ...e, context: [...(e.context ?? []), reviewContext(info.url, dir || undefined)] })
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

  on('command.run', { command: 'review-setup' }, async $ => {
    const lines = await runSetup($, 'command')
    return { text: lines.join('\n') || 'Nothing installed.' }
  })

  // The person closed the code pane: the code goes back under the open point.
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === REVIEW_PANE) {
      isPaneDrawn = false
      await update($, reviewA, s => ({ ...s, paneSeq: s.paneSeq + 1 }))
    }
    return closed
  }).catch(($, e, next) => next(e))

  // ---------- the review, drawn as points ----------

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const text = e.props.text
    if (e.props.isSummary || !looksLikeReview(text)) return next(e)
    const source = parseSource(text)
    const findings = parseFindings(text)
    const head = parseHead(text)
    if (!source || (findings.length === 0 && head.verdict === '')) return next(e)
    noteViewport(e.viewport)
    const key = reviewKey(text)
    const st = await read($, reviewA)
    const isActive = st.key === key
    const current = isActive ? st.current : -1
    const section = isActive ? st.section : 0
    const meta = isActive ? st.meta : null
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = els
    const width = Math.max(40, (e.viewport?.columns ?? 100) - 6)
    /** The columns the reply has, the ● before it taken off. */
    const conversation = Math.max(40, (e.viewport?.columns ?? 100) - 2)
    const numWidth = String(Math.max(1, ...findings.map(f => f.n))).length

    // The open point's text, its `path:line` refs turned into links that show that code.
    const hrefs = new Map<string, CodeRef>()
    const open = current >= 0 ? findings[current] : undefined
    const linked: Record<string, string> = {}
    if (open) {
      const parts: Record<string, string> = open.fields ? { ...open.fields, rest: open.rest } : { rest: open.rest }
      const byRef = await hrefsFor(source, Object.values(parts).join('\n'))
      for (const [name, part] of Object.entries(parts)) {
        const l = linkify(part, r => byRef.get(refKey(r)) ?? '')
        linked[name] = l.text
        for (const [h, r] of l.hrefs) if (h) hrefs.set(h, r)
      }
    }
    const pressable = [...hrefs.keys()].slice(0, 256)
    const md = (mdKey: string, f: Finding, i: number, body: string) => (
      <Markdown
        key={mdKey}
        text={body}
        pressableLinks={pressable}
        onLinkPress={link => {
          const r = hrefs.get(link.href)
          const j = r ? f.sections.findIndex(s => refKey(s) === refKey(r)) : -1
          void pickIn($, text, i, Math.max(0, j))
        }}
      />
    )
    const label = (name: string) => (
      <Box key={`label:${name}`} width={9} flexShrink={0}>
        <Text dimColor>{name}</Text>
      </Box>
    )
    const badge = (f: Finding) => (
      <Text key={`badge:${f.n}`} color={SEVERITY_COLOR[f.severity]} inverse bold>
        {` ${SEVERITY_TAG[f.severity].padEnd(4)} `}
      </Text>
    )

    // Narrow, or with no pane yet: the code shows under the open point.
    const ref = open?.sections[section]
    const showInline = open !== undefined && st.view === 'pane' && !(await isPaneDocked($, e.surface, e.viewport))
    const inline = async () => {
      if (!ref) return null
      const snippet = st.snippets[refKey(ref)]
      const wt = await read($, worktreeA)
      if (!snippet) return <Text key="inline" dimColor>{wt.status === 'preparing' ? wt.note : 'Loading code…'}</Text>
      if (snippet.kind === 'error')
        return (
          <Text key="inline" color="error" wrap="wrap">
            {snippet.note}
          </Text>
        )
      return (
        <Box key="inline" flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          <Text dimColor wrap="truncate-end">
            {refLabel(ref)} · {snippet.note}
          </Text>
          {codeLines(els, windowRows(snippet.rows, ref, 3).rows, ref, 'inline', conversation - (numWidth + 3) - 4)}
          <Text dimColor wrap="wrap">
            v opens the code pane; from {PANE_FLOOR} columns it docks beside the review.
          </Text>
        </Box>
      )
    }
    const inlineCode = showInline ? await inline() : null

    const chips = (f: Finding, i: number) => (
      <Box key={`chips:${i}`} flexDirection="row" flexWrap="wrap" columnGap={2}>
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

    const field = (f: Finding, i: number, name: 'Problem' | 'Impact' | 'Fix') => {
      const part = name.toLowerCase()
      return (
        <Box key={`field:${i}:${part}`} flexDirection="row">
          {label(name)}
          <Box flexGrow={1} flexShrink={1}>
            {md(`body:${i}:${part}`, f, i, linked[part] ?? '')}
          </Box>
        </Box>
      )
    }

    const point = (f: Finding, i: number) => {
      const isOpen = i === current
      const row = (
        <Box key={`head:${i}`} flexDirection="row" columnGap={1}>
          <Box flexShrink={0}>
            <Text color={isOpen ? 'suggestion' : undefined} dimColor={!isOpen && current >= 0}>
              {isOpen ? '▾' : '▸'} {String(f.n).padStart(numWidth)}
            </Text>
          </Box>
          <Box flexShrink={0}>{badge(f)}</Box>
          <Box flexGrow={1} flexShrink={1}>
            {isOpen ? (
              <Text key={`pt:${i}`} bold wrap="wrap">
                {plain(f.title)}
              </Text>
            ) : (
              <Button key={`pt:${i}`} plain label={short(plain(f.title), Math.max(20, width - 26))} onPress={() => void pickIn($, text, i)} />
            )}
          </Box>
          {f.area !== '' && (
            <Box flexShrink={0}>
              <Text dimColor>{f.area}</Text>
            </Box>
          )}
        </Box>
      )
      if (!isOpen) return row
      return (
        <Box key={`open:${i}`} flexDirection="column">
          {row}
          <Box flexDirection="column" paddingLeft={numWidth + 3}>
            {f.fields ? [field(f, i, 'Problem'), field(f, i, 'Impact'), field(f, i, 'Fix')] : f.rest !== '' && md(`body:${i}`, f, i, linked.rest ?? '')}
            {f.suggestion.length > 0 && (
              <Box key={`sug:${i}`} paddingLeft={f.fields ? 9 : 0}>
                {codeLines(els, suggestionRows(f.suggestion), null, `sug:${i}`, conversation - (numWidth + 3) - (f.fields ? 9 : 0))}
              </Box>
            )}
            {f.fields && f.rest !== '' && md(`body:${i}:rest`, f, i, linked.rest ?? '')}
            {chips(f, i)}
            {inlineCode}
          </Box>
        </Box>
      )
    }

    const tone = verdictTone(head.verdict)
    const verdictColor = tone === 'bad' ? 'error' : tone === 'warn' ? 'warning' : tone === 'good' ? 'success' : undefined
    const title = meta?.title || head.title
    const counts = SEVERITIES.map(sev => [sev, findings.filter(f => f.severity === sev).length] as const).filter(([, n]) => n > 0)
    // The lead's first paragraph reads as a dim line; anything after it (what a clean review checked) as markdown, refs linked.
    const [lead = '', ...rest] = head.intro.split(/\n\s*\n/)
    const introRefs = await hrefsFor(source, rest.join('\n\n'))
    const more = linkify(rest.join('\n\n'), r => introRefs.get(refKey(r)) ?? '').text
    const planColor = (g: string) => (/merge/i.test(g) ? 'error' : /traffic|prod|deploy/i.test(g) ? 'warning' : undefined)

    return (
      <Box flexDirection="row">
        {e.props.isFirstOfReply && <Text color="claude">● </Text>}
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text wrap="wrap">
            <Text bold>{source.kind === 'pr' ? 'Review' : 'Local review'}</Text>
            <Text dimColor> · </Text>
            {sourceLine(source)}
            {title ? <Text dimColor> · </Text> : null}
            {title ? plain(title) : null}
          </Text>
          {meta && (
            <Text dimColor wrap="wrap">
              {meta.head} → {meta.base} · @{meta.author} · {meta.changedFiles} files +{meta.additions} −{meta.deletions}
            </Text>
          )}
          <Box key="verdict" flexDirection="row" flexWrap="wrap" columnGap={2}>
            {head.verdict ? (
              <Text color={verdictColor} bold>
                {tone === 'bad' ? '✗' : tone === 'good' ? '✓' : '●'} {cap(head.verdict)}
              </Text>
            ) : (
              <Text>{findings.length} points</Text>
            )}
            {findings.length === 0 && <Text dimColor>no points</Text>}
            {counts.map(([sev, n]) => (
              <Text key={`count:${sev}`}>
                <Text color={SEVERITY_COLOR[sev]} inverse bold>{` ${SEVERITY_TAG[sev]} `}</Text> {n}
              </Text>
            ))}
          </Box>
          {lead !== '' && (
            <Text key="intro" dimColor wrap="wrap">
              {plain(lead)}
            </Text>
          )}
          {more !== '' && <Markdown key="more" text={more} />}
          {findings.length > 0 && (
            <Box key="points" flexDirection="column" marginTop={1}>
              {findings.map(point)}
            </Box>
          )}
          {(head.plan.length > 0 || head.closing !== '') && (
            <Box key="close" flexDirection="column" marginTop={1}>
              {head.plan.length > 0 && (
                <Box key="plan" flexDirection="row">
                  {label('Plan')}
                  <Box flexDirection="row" flexWrap="wrap" columnGap={3} flexGrow={1} flexShrink={1}>
                    {head.plan.map((g, gi) => (
                      <Box key={`plan:${gi}`} flexDirection="row" columnGap={1}>
                        <Text color={planColor(g.label)} dimColor={!planColor(g.label)}>
                          {g.label}
                        </Text>
                        {g.points.map(n => {
                          const idx = findings.findIndex(f => f.n === n)
                          return idx < 0 ? (
                            <Text key={`pn:${gi}:${n}`}>{n}</Text>
                          ) : (
                            <Button key={`plan:${gi}:${n}`} plain label={String(n)} onPress={() => void pickIn($, text, idx)} />
                          )
                        })}
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}
              {head.closing !== '' && (
                <Box key="closing" flexDirection="row">
                  {label(head.plan.length > 0 ? 'Verdict' : 'Summary')}
                  <Box flexGrow={1} flexShrink={1}>
                    <Markdown key="summary" text={head.closing} />
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </Box>
      </Box>
    )
  })

  // ---------- band above the prompt ----------

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    noteViewport(e.viewport)
    const beneath = await next(e)
    if (e.props.hasSurvey) return beneath
    const review = await read($, reviewA)
    const { Box, Text, Button } = $.ui.resolve(e)
    const f = review.findings[review.current]
    const ref = f?.sections[review.section]
    const rk = review.key
    if (rk === null) return beneath
    const tag = review.source?.kind === 'pr' ? `#${review.source.number}` : 'Review'
    if (review.findings.length === 0) {
      const tone = verdictTone(review.verdict)
      return (
        <Box flexDirection="column">
          <Box key="review" flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Text dimColor>{tag}</Text>
            <Text color={tone === 'good' ? 'success' : tone === 'bad' ? 'error' : undefined}>
              {tone === 'good' ? '✓' : '●'} {cap(review.verdict || 'reviewed')}
            </Text>
            <Text dimColor>· no points │</Text>
            <Button key="donereview" plain label="done" hotkey="x" dimColor onPress={() => void finishReview($)} />
          </Box>
          {beneath}
        </Box>
      )
    }
    if (!f || !ref) return beneath
    const { dir, file } = splitPath(ref.path)
    const where = whereLabel(review.view, review.view !== 'pane' || (await isPaneDocked($, e.surface, e.viewport)))
    return (
      <Box flexDirection="column">
        <Box key="review" flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Text dimColor>{tag}</Text>
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
          <Button key="prevpt" plain label="‹" hotkey="a" dimColor onPress={() => void select($, rk, review.current - 1)} />
          <Button key="nextpt" plain label="›" hotkey="d" dimColor onPress={() => void select($, rk, review.current + 1)} />
          <Text dimColor>│</Text>
          <Text>
            <Text dimColor>{dir}</Text>
            <Text bold>{file}</Text>
            <Text dimColor>
              :{ref.line}
              {ref.endLine > ref.line ? `-${ref.endLine}` : ''}
            </Text>
          </Text>
          {f.sections.length > 1 && (
            <Button key="nextsec" plain label={`code ${review.section + 1}/${f.sections.length}`} hotkey="s" dimColor onPress={() => void stepSection($, 1)} />
          )}
          {where !== '' && <Text dimColor>│ {where}</Text>}
          <Button key="showcode" plain label="show" hotkey="v" dimColor onPress={() => void showCurrent($, true)} />
          <Button key="donereview" plain label="done" hotkey="x" dimColor onPress={() => void finishReview($)} />
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
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    if (!isPaneDrawn) {
      isPaneDrawn = true
      // The transcript drops the code under the point now that the pane is up.
      try {
        $.clock.after(0, () => void update($, reviewA, s => ({ ...s, paneSeq: s.paneSeq + 1 })))
      } catch {
        // redrawn on the next change instead
      }
    }
    const st = await read($, reviewA)
    const wt = await read($, worktreeA)
    const f = st.findings[st.current]
    const ref = f?.sections[st.section]
    const fileList = (touched: ReadonlySet<string>, width: number) =>
      st.files.length > 0 && (
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
                <Text color="success"> +{pf.adds}</Text>
                <Text color="error"> −{pf.dels}</Text>
              </Text>
            )
          })}
          {st.files.length > 14 && <Text dimColor>  …{st.files.length - 14} more</Text>}
        </Box>
      )
    if (st.key !== null && st.source && st.findings.length === 0) {
      return (
        <Box flexDirection="column">
          <Text bold wrap="wrap">
            {sourceLine(st.source)}: {st.verdict || 'reviewed'}, no points
          </Text>
          <Text dimColor wrap="wrap">
            {wt.status === 'ready' ? `Nothing to fix. The PR is checked out in ${wt.path}; done (x on the band) removes it.` : 'Nothing to fix.'}
          </Text>
          {fileList(new Set(), Math.max(30, e.props.bodyColumns))}
        </Box>
      )
    }
    if (st.key === null || !st.source || !f || !ref) {
      if (!wt.url) return <Text dimColor>No review yet. Paste a PR link and say review, and its code shows here.</Text>
      const pr = /\/pull\/(\d+)/.exec(wt.url)?.[1] ?? ''
      return (
        <Box flexDirection="column">
          <Text bold>Review of #{pr}</Text>
          <Text dimColor wrap="wrap">
            {wt.status === 'preparing'
              ? wt.note
              : wt.status === 'ready'
                ? `The PR is checked out in ${wt.path}. Point 1's code shows here as soon as the review arrives.`
                : wt.status === 'failed'
                  ? `No review worktree (${wt.note}): the code will come from GitHub.`
                  : 'Waiting for the review.'}
          </Text>
        </Box>
      )
    }
    const key = st.key
    const src = st.source
    const snippet = st.snippets[refKey(ref)]
    const { dir, file } = splitPath(ref.path)
    const width = Math.max(30, e.props.bodyColumns)
    const touched = new Set(f.sections.map(s => s.path))

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Button key="prev" label="◀ Prev" hotkey="a" onPress={() => void select($, key, st.current - 1)} />
          <Button key="next" label="Next ▶" hotkey="d" variant="primary" onPress={() => void select($, key, st.current + 1)} />
          <Button key="editor" label="Open in editor" hotkey="e" dimColor onPress={() => void openFromPane($)} />
          {src.kind === 'pr' && (
            <Button key="github" label="GitHub" hotkey="o" dimColor onPress={p => void prLineAnchor(src.url, ref).then(url => openUrl($, url, p.surface))} />
          )}
          <Text dimColor>
            {st.current + 1} / {st.findings.length}
          </Text>
        </Box>

        <Box flexDirection="row" columnGap={1}>
          <Box flexShrink={0}>
            <Text color={SEVERITY_COLOR[f.severity]} inverse bold>{` ${SEVERITY_TAG[f.severity]} `}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text bold wrap="wrap">
              {f.n}. {plain(f.title)}
            </Text>
          </Box>
        </Box>

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
            {snippet && snippet.kind === 'rows' ? `  ·  ${snippet.note}` : ''}
          </Text>
        </Text>

        {!snippet && <Text dimColor>{src.kind === 'pr' && wt.status === 'preparing' ? wt.note : 'Loading code…'}</Text>}
        {snippet?.kind === 'error' && (
          <Text color="error" wrap="wrap">
            {snippet.note}
          </Text>
        )}
        {snippet?.kind === 'rows' && snippet.above > 0 && (
          <Button key="moreup" plain dimColor label={moreLabel('↑', snippet.above, 'above')} onPress={() => void expandCode($, 'up')} />
        )}
        {snippet?.kind === 'rows' && codeLines(els, snippet.rows, ref, 'pane', width)}
        {snippet?.kind === 'rows' && snippet.below > 0 && (
          <Button key="moredown" plain dimColor label={moreLabel('↓', snippet.below, 'below')} onPress={() => void expandCode($, 'down')} />
        )}

        {fileList(touched, width)}
      </Box>
    )
  })
}
