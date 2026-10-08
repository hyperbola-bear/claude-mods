/**
 * code-reference: replies that point at code, the code beside them.
 *
 * Ask with /code-reference: `/code-reference how does x work with y`, "…and
 * use /code-reference" anywhere in a prompt, or /code-reference alone after a
 * reply. A pull request link with "review" (or `/code-reference <PR link>`)
 * asks for a review the same way. The model is handed the format: prose in
 * sections, every place in the code linked on the words that describe it.
 *
 * The reply is drawn by the mod: the prose wrapped, each link underlined with
 * its number, and under each section a row of boxes, one per place. Clicking
 * a link or a box shows that place in the code pane: one header line, the
 * rest of the pane code, read from disk (the session's folder, or for a PR
 * the review worktree), changed lines marked like git diff. With the pane
 * closed, the code shows under the section instead.
 *
 * Both the reply and the pane are Client regions whose rows the mod lays out
 * itself (layout.ts) and draws as Text, so the terminal and the desktop app
 * show the same cells; clicks come back as the cell under the pointer.
 *
 * A pull request is read with gh, else a GitHub MCP server's tools, else plain
 * git (refs/pull/<n>/head), and checked out into a review worktree: a folder
 * of its own on the PR head with HEAD at the merge base, so the PR reads as
 * uncommitted edits. Its code comes from GitHub only when no copy is on disk.
 *
 * Reaches: process.run (gh, git, brew and claude for setup, uname, open,
 * the editor's command line), the GitHub MCP server's tools when connected,
 * terminal-browser's `$.browser` (for a PR's page, when asked), fs reads
 * (code), fs writes (PR-head copies for the editor when no worktree can be
 * made), session.messages (the last reply), prompt.submit, the store (setup).
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface, RenderViewport } from 'claude-code'

import type { CodeLine, CodeView, Place, RefState, Source, Worktree } from '../types'
import { WINDOW, blobUrl, changeNote, hunkRows, inDiff, parseDiff, prLineAnchor, refKey, refLabel, rowsFromText, textKey, windowRows } from './code.ts'
import type { Hunk } from './code.ts'
import { isCodeReference, parseDoc, sourceOf } from './doc.ts'
import type { Doc } from './doc.ts'
import { drawRows } from './draw.tsx'
import { explainContext, mentionsCommand, parseCommand, reviewContext, reviewRequest, rewritePrompt } from './format.ts'
import type { ReviewAsk } from './format.ts'
import { ghError } from './gh.ts'
import { paneRows } from './layout.ts'
import type { InlineCode, PaneProps, ReplyProps } from './layout.ts'
import { offerSetup, wasAsked } from './setup.ts'
import type { SetupIo, SetupMode, Stored } from './setup.ts'
import { readGithubFile, readPr } from './source.ts'
import type { GithubIo, PrTarget } from './source.ts'
import { cacheDirs, canDrawImages, headCopyPath, ideCommands, ideOf } from './view.ts'
import type { TermEnv } from './view.ts'
import { failure, fileRows, prepareWorktree, removeWorktree } from './worktree.ts'
import type { PrInfo, Prepared, Run } from './worktree.ts'

const PANE = 'code-reference'
const PANE_TITLE = 'Code reference'

const EMPTY: RefState = {
  key: null,
  source: null,
  places: [],
  current: 0,
  code: {},
  more: {},
  isPaneClosed: false,
  browserNote: null,
  meta: null,
  adopted: [],
  paneSeq: 0,
}

const EMPTY_WORKTREE: Worktree = { url: '', status: 'idle', path: '', repo: '', note: '' }

const refA = atom({ plugin: 'code-reference', key: 'ref' } as const, EMPTY)
const browserA = atom({ plugin: 'code-reference', key: 'hasBrowser' } as const, false)
const worktreeA = atom({ plugin: 'code-reference', key: 'worktree' } as const, EMPTY_WORKTREE)

type Cfg = { ghPath: string; ideCommand: string; autoReview: boolean; offerSetup: boolean }

export function readCfg(o: Record<string, unknown>): Cfg {
  return {
    ghPath: typeof o.ghPath === 'string' && o.ghPath.trim() ? o.ghPath.trim() : 'gh',
    ideCommand: typeof o.ideCommand === 'string' ? o.ideCommand.trim() : '',
    autoReview: typeof o.autoReview === 'boolean' ? o.autoReview : true,
    offerSetup: typeof o.offerSetup === 'boolean' ? o.offerSetup : true,
  }
}

// Module state: set by register(); lost on a reload, which only costs reading things again.
let cfg: Cfg = readCfg({})
let term: TermEnv = {}
let askpassNode: string | undefined
let tmpDir = '/tmp'
let home = ''
let isTerminal = true
let isMac = false
/** Whether gh runs here; null until asked. */
let hasGh: boolean | null = null
/** What the last drawing measured: whether the terminal docks panes. */
let viewport: { columns: number; isFullscreen?: boolean } = { columns: 0 }
let setupJob: Promise<unknown> | null = null
/** Each reply drawn, by key: what it says and where its code is, for a click on it. */
const docs = new Map<string, { doc: Doc; source: Source }>()
const rowsCache = new Map<string, CodeLine[]>()
const diffCache = new Map<string, Map<string, Hunk[]>>()
const infoCache = new Map<string, PrInfo>()
const worktreeJobs = new Map<string, Promise<Prepared>>()
const inflight = new Set<string>()
/** Replies whose code was already shown by itself once, so a redraw does not show it again. */
const shown = new Set<string>()

const keyOf = (text: string) => textKey(text.trim())

function noteViewport(v: RenderViewport | undefined) {
  if (v && v.columns > 0) viewport = { columns: v.columns, isFullscreen: v.isFullscreen }
}

// ---------- processes, files, GitHub ----------

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

/** The GitHub MCP tool whose own name is `name` (`mcp__github__get_pull_request`), if a connected server has one. */
async function mcpTool($: EngineInterface, name: string): Promise<string | null> {
  const tools = await $.tool.list().catch(() => [])
  const all = tools.filter(t => t.mcp && t.name.endsWith(`__${name}`))
  return (all.find(t => /github/i.test(t.name)) ?? all[0])?.name ?? null
}

function githubIo($: EngineInterface): GithubIo {
  return {
    gh: async (args, cwd) => {
      if (hasGh === false) return { isOk: false, err: 'gh is not installed' }
      try {
        const r = await $.process.run([cfg.ghPath, ...args], { timeoutMs: 30_000, ...(cwd ? { cwd } : {}) })
        hasGh = true
        return r.exitCode === 0 ? { isOk: true, out: r.stdout } : { isOk: false, err: ghError(r.stderr, r.exitCode) }
      } catch {
        hasGh = false
        return { isOk: false, err: 'gh is not installed' }
      }
    },
    mcp: async (name, args) => {
      const tool = await mcpTool($, name)
      if (!tool) return null
      try {
        const r = await $.tool.call({ tool, ...args } as Parameters<typeof $.tool.call>[0])
        return 'text' in r && typeof r.text === 'string' && !r.isError ? r.text : null
      } catch {
        return null
      }
    },
    git: runner($),
  }
}

async function openUrl($: EngineInterface, url: string, surface: RenderSurface) {
  if (!/^https?:\/\//i.test(url)) return
  const run = runner($)
  if ((await run([isMac ? 'open' : 'xdg-open', url], 5000)).isOk) return
  const copied = await $.ui.copy({ text: url, surface })
  $.ui.toast(copied.isCopied ? 'Could not open a browser; link copied.' : url)
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
    ask: (question, options) => $.ui.ask(question, { header: 'code-reference', options }),
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

/** A PR, read with gh, a GitHub MCP server or git, whichever answers first. */
async function prInfo($: EngineInterface, target: PrTarget): Promise<PrInfo | null> {
  const name = target.kind === 'url' ? target.url : target.kind === 'number' ? `#${target.number}` : ''
  const cached = name ? infoCache.get(name) : undefined
  if (cached) return cached
  const got = await readPr(githubIo($), target, await sessionRoot($))
  if (!got.isOk) {
    $.ui.toast(`code-reference could not read the PR: ${got.note}`, { timeoutMs: 10_000 })
    return null
  }
  infoCache.set(got.info.url, got.info)
  if (name) infoCache.set(name, got.info)
  return got.info
}

/** Starts checking the PR out into its review worktree, once per PR; answers the folder it will be. */
function startWorktree($: EngineInterface, info: PrInfo): string {
  if (!home) return ''
  const dir = cacheDirs(home, info.host, info.repo, info.number, info.headSha).worktree
  if (worktreeJobs.has(info.url)) return dir
  const job = (async (): Promise<Prepared> => {
    const note = `Checking out #${info.number} into the review worktree…`
    await update($, worktreeA, () => ({ url: info.url, status: 'preparing' as const, path: dir, repo: '', note }))
    $.ui.status(`code-reference: ${note}`)
    let result: Prepared
    try {
      result = await prepareWorktree(runner($), path => exists($, path), { gh: hasGh === false ? null : cfg.ghPath, home, root: await sessionRoot($), info })
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
  // Awaited by whoever needs the folder; a job cut short by an unload rejects with no one waiting.
  job.catch(() => undefined)
  worktreeJobs.set(info.url, job)
  return dir
}

/** The PR's review worktree, once it is ready (or why there is none). */
async function worktreeFor($: EngineInterface, url: string): Promise<Prepared | null> {
  if (!worktreeJobs.has(url)) {
    const info = await prInfo($, { kind: 'url', url })
    if (!info) return null
    startWorktree($, info)
  }
  const job = worktreeJobs.get(url)
  return job ? job.catch((): Prepared => ({ isOk: false, note: 'the checkout stopped unexpectedly' })) : null
}

async function prDiff($: EngineInterface, url: string): Promise<Map<string, Hunk[]> | null> {
  const cached = diffCache.get(url)
  if (cached) return cached
  const r = await githubIo($).gh(['pr', 'diff', url])
  if (!r.isOk) return null
  const files = parseDiff(r.out)
  diffCache.set(url, files)
  return files
}

// ---------- the reply, its places and their code ----------

/** Makes the reply in `text` the one whose code shows; with `shouldShow`, shows its first place. */
async function activate($: EngineInterface, text: string, shouldShow: boolean) {
  const root = await sessionRoot($)
  const doc = parseDoc(text, root)
  const source = doc ? sourceOf(doc.target, root) : null
  if (!doc || !source) return
  const key = keyOf(text)
  docs.set(key, { doc, source })
  if ((await read($, refA)).key !== key) await focus($, key)
  if (source.kind === 'pr') void loadPr($, key, source.url).catch(() => undefined)
  if (shouldShow && doc.places.length > 0 && !shown.has(key)) {
    shown.add(key)
    await show($, false)
  }
}

/** Switches to a reply already drawn. */
async function focus($: EngineInterface, key: string) {
  const d = docs.get(key)
  if (!d) return
  await update($, refA, s => (s.key === key ? s : { ...EMPTY, adopted: s.adopted, paneSeq: s.paneSeq, key, source: d.source, places: d.doc.places }))
}

async function loadPr($: EngineInterface, key: string, url: string) {
  const info = await prInfo($, { kind: 'url', url })
  if (!info) return
  startWorktree($, info)
  await update($, refA, s => (s.key === key ? { ...s, meta: info.meta } : s))
}

/**
 * Shows the current place: its code loads, and the pane opens unless the
 * person closed it. `isAsked`: the person's click or command led here. A pane
 * opened unasked on the terminal's main screen would not sit beside the
 * transcript, so there the code stays under the section.
 */
async function show($: EngineInterface, isAsked: boolean) {
  const st = await read($, refA)
  const place = st.places[st.current]
  if (!st.key || !place) return
  void ensureCode($, st.key, place).catch(() => undefined)
  if (st.isPaneClosed && !isAsked) return
  if (!isAsked && isTerminal && viewport.isFullscreen === false) return
  await $.ui.open({ id: PANE, title: PANE_TITLE }).catch(() => undefined)
  await update($, refA, s => ({ ...s, isPaneClosed: false, paneSeq: s.paneSeq + 1 }))
}

/** Shows place number `n` of the reply `key`. */
async function pick($: EngineInterface, key: string, n: number) {
  await focus($, key)
  const st = await read($, refA)
  const i = st.places.findIndex(p => p.n === n)
  if (st.key !== key || i < 0) return
  await update($, refA, s => (s.key === key ? { ...s, current: i, browserNote: null } : s))
  await show($, true)
}

async function step($: EngineInterface, delta: number) {
  const st = await read($, refA)
  const n = st.places.length
  if (!st.key || n === 0) return
  await update($, refA, s => ({ ...s, current: (((s.current + delta) % n) + n) % n, browserNote: null }))
  await show($, true)
}

async function cachedRows(key: string, load: () => Promise<CodeLine[] | null>): Promise<CodeLine[] | null> {
  const cached = rowsCache.get(key)
  if (cached) return cached
  const rows = await load()
  if (rows) rowsCache.set(key, rows)
  return rows
}

/** A place's whole file as rows, and what the pane's header says about them. */
async function fileOf($: EngineInterface, source: Source, place: Place): Promise<{ rows: CodeLine[]; note: string } | { error: string }> {
  const run = runner($)
  const load = (root: string) => cachedRows(`${root}|${place.path}`, () => fileRows(run, p => readText($, p), root, place.path))
  if (source.kind === 'local') {
    const rows = await load(source.root)
    return rows ? { rows, note: changeNote(rows, false) } : { error: `Could not read ${place.path}${place.path.startsWith('/') ? '' : ` under ${source.root}`}.` }
  }
  const wt = await worktreeFor($, source.url)
  if (wt?.isOk) {
    const rows = await load(wt.path)
    if (rows) return { rows, note: changeNote(rows, true) }
  }
  // No copy on disk: the PR's hunk, or the file at the head, from GitHub.
  const files = await prDiff($, source.url)
  const hunk = files ? hunkRows(files, place) : null
  if (hunk) return { rows: hunk, note: 'from GitHub' }
  const info = await prInfo($, { kind: 'url', url: source.url })
  const text = info ? await readGithubFile(githubIo($), info.host, info.repo, info.headSha, place.path) : null
  return text === null ? { error: `No copy of ${place.path} on disk, and GitHub did not answer for it.` } : { rows: rowsFromText(text), note: 'from GitHub' }
}

async function viewOf($: EngineInterface, st: RefState, place: Place): Promise<CodeView> {
  if (!st.source) return { kind: 'error', note: 'No reply to show code for.' }
  const file = await fileOf($, st.source, place)
  if ('error' in file) return { kind: 'error', note: file.error }
  const last = file.rows.reduce((n, r) => Math.max(n, r.n ?? 0), 0)
  if (place.line > last) return { kind: 'error', note: `${place.path} has ${last} lines; line ${place.line} is past its end.` }
  const win = windowRows(file.rows, place, WINDOW, st.more[refKey(place)] ?? 0)
  return { kind: 'rows', ...win, note: file.note }
}

async function ensureCode($: EngineInterface, key: string, place: Place, isFresh = false) {
  const k = refKey(place)
  const st = await read($, refA)
  if (st.key !== key || (!isFresh && st.code[k]) || inflight.has(`${key}:${k}`)) return
  inflight.add(`${key}:${k}`)
  try {
    const view = await viewOf($, st, place)
    await update($, refA, s => (s.key === key ? { ...s, code: { ...s.code, [k]: view } } : s))
  } finally {
    inflight.delete(`${key}:${k}`)
  }
}

/** More of the file around the place in view, once the pane scrolled to the end of what it had. */
async function more($: EngineInterface) {
  const st = await read($, refA)
  const place = st.places[st.current]
  if (!st.key || !place) return
  const k = refKey(place)
  await update($, refA, s => (s.key === st.key ? { ...s, more: { ...s.more, [k]: (s.more[k] ?? 0) + 200 } } : s))
  await ensureCode($, st.key, place, true)
}

/** The file an editor opens for a place: on disk, or a read-only copy of the PR head's under the temp folder. */
async function editorFile($: EngineInterface, st: RefState, place: Place): Promise<string | null> {
  const src = st.source
  if (!src) return null
  if (src.kind === 'local') return place.path.startsWith('/') ? place.path : `${src.root}/${place.path}`
  const wt = await worktreeFor($, src.url)
  if (wt?.isOk) return `${wt.path}/${place.path}`
  const info = await prInfo($, { kind: 'url', url: src.url })
  const text = info ? await readGithubFile(githubIo($), info.host, info.repo, info.headSha, place.path) : null
  if (!info || text === null) return null
  const copy = headCopyPath(tmpDir, src.repo, src.number, info.headSha, place.path)
  try {
    await $.fs.write(copy, text)
  } catch {
    return null
  }
  return copy
}

async function openEditor($: EngineInterface) {
  const st = await read($, refA)
  const place = st.places[st.current]
  if (!place) return
  const file = await editorFile($, st, place)
  if (!file) {
    $.ui.toast(`No copy of ${place.path} to open.`)
    return
  }
  const line = Math.max(1, place.line)
  const tries = ideCommands(ideOf(term), file, line, { command: cfg.ideCommand, askpassNode, bundleId: term.bundleId, nvim: term.nvim })
  if (tries.length === 0) tries.push(['code', '-g', `${file}:${line}`], [isMac ? 'open' : 'xdg-open', file])
  const run = runner($)
  for (const argv of tries) if ((await run(argv, 15_000)).isOk) return
  $.ui.toast('No editor answered: set Editor command in /config (code-reference), e.g. code, cursor, zed or idea.', { timeoutMs: 10_000 })
}

/** A PR's page at the place: its Files tab when the diff shows those lines, else the file at the head. */
async function githubUrl($: EngineInterface, src: Source & { kind: 'pr' }, place: Place): Promise<string> {
  const files = await prDiff($, src.url)
  if (files && inDiff(files, place)) return prLineAnchor(src.url, place)
  const info = await prInfo($, { kind: 'url', url: src.url })
  return info ? blobUrl(src.url, src.repo, info.headSha, place) : prLineAnchor(src.url, place)
}

/** The PR's page at the place: in terminal-browser where it can draw, else the browser. The pane says so when terminal-browser fails. */
async function openGithub($: EngineInterface, surface: RenderSurface) {
  const st = await read($, refA)
  const place = st.places[st.current]
  const src = st.source
  if (!place || src?.kind !== 'pr') return
  await update($, refA, s => ({ ...s, browserNote: null }))
  const url = await githubUrl($, src, place)
  if (surface === 'terminal' && (await read($, browserA)) && canDrawImages(term)) {
    let note: string | null = null
    try {
      // @ts-ignore `browser` is the noun terminal-browser adds; absent when it is not installed.
      const opened = await $.browser.open({ url })
      if (opened && opened.ok === false) note = "The PR page didn't load in terminal-browser."
    } catch {
      note = "terminal-browser isn't answering."
    }
    if (note) await update($, refA, s => ({ ...s, browserNote: note }))
    return
  }
  await openUrl($, url, surface)
}

/**
 * `/code-reference` alone: the last reply's code. The last turn's latest block
 * of text that names files is drawn in place; a turn that names none is asked
 * for again, with links.
 */
async function codeForLastReply($: EngineInterface): Promise<string> {
  const messages = await $.session.messages().catch(() => [])
  const root = await sessionRoot($)
  let found: { text: string; doc: Doc } | null = null
  let hasReply = false
  for (const m of [...messages].reverse()) {
    if (m.role === 'user' && m.text.trim() !== '') {
      if (hasReply) break
      continue
    }
    if (m.role !== 'assistant' || m.text.trim() === '') continue
    hasReply = true
    const doc = parseDoc(m.text, root)
    if (doc && doc.places.length > 0) {
      found = { text: m.text, doc }
      break
    }
  }
  if (!hasReply) return 'No reply yet: ask with /code-reference <question>.'
  if (found) {
    const key = keyOf(found.text)
    await update($, refA, s => (s.adopted.includes(key) ? s : { ...s, adopted: [...s.adopted.slice(-49), key] }))
    shown.delete(key)
    await activate($, found.text, true)
    const n = found.doc.places.length
    return `The code for the last reply: ${n} ${n === 1 ? 'place' : 'places'}.`
  }
  // A command's hook holds the turn a prompt would wait on: send it once this one is done.
  const text = rewritePrompt(root)
  $.clock.after(0, () => void $.prompt.submit({ text }).catch(() => undefined))
  return 'The last reply names no files: asking Claude for it again, with links to the code.'
}

// ---------- prompts ----------

async function reviewPrompt($: EngineInterface, ask: ReviewAsk): Promise<string[]> {
  if (cfg.offerSetup) await runSetup($, 'review', true).catch(() => [])
  const info = await prInfo($, ask)
  if (!info) return ask.kind === 'url' ? [reviewContext(ask.url)] : []
  const dir = startWorktree($, info)
  const isWide = !isTerminal || viewport.isFullscreen !== false
  if (isWide) await $.ui.open({ id: PANE, title: PANE_TITLE }).catch(() => undefined)
  return [reviewContext(info.url, dir || undefined)]
}

export const register: Register = (on, options) => {
  cfg = readCfg((options ?? {}) as Record<string, unknown>)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const commands: Parameters<typeof $.command.register>[0][] = [
      {
        name: 'code-reference',
        description: 'Answer with links to the code, shown beside the reply. Alone: show the code of the last reply. A number: show that place',
        argumentHint: '[question | PR link | place number]',
      },
      { name: 'code-reference-setup', description: 'code-reference: offer to install what it can use and this machine lacks (GitHub CLI, Ghostty, terminal-browser)' },
    ]
    for (const c of commands) {
      // One refused (a name another command holds) leaves the rest of the setup standing.
      await $.command.register(c).catch(() => $.ui.log(`code-reference: /${c.name} is taken by another command`, { to: 'debug' }))
    }
    const listed = await $.command.list().catch(() => [])
    await update($, browserA, () => listed.some(c => c.name === 'browser'))
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
    if (cfg.offerSetup && e.isInteractive && !wasAsked(await $.store.get(SETUP_KEY).catch(() => undefined))) {
      $.clock.after(1500, () => void runSetup($, 'first-run').catch(() => undefined))
    }
    return started
  })

  on('session.end', async ($, e, next) => {
    const wt = await read($, worktreeA)
    if (wt.status === 'ready' && wt.repo && wt.path) await removeWorktree(runner($), wt.repo, wt.path).catch(() => false)
    return next(e)
  })

  // A prompt that asks for a code reference or a review: hand the model the format.
  on('prompt.submit', async ($, e, next) => {
    const context = e.context ?? []
    const cmd = parseCommand(e.text)
    if (cmd?.kind === 'ask') return next({ ...e, text: cmd.question, context: [...context, explainContext(await sessionRoot($))] })
    if (cmd?.kind === 'review') return next({ ...e, text: `Review ${cmd.url}`, context: [...context, ...(await reviewPrompt($, { kind: 'url', url: cmd.url }))] })
    if (cmd) return next(e)
    if (mentionsCommand(e.text)) return next({ ...e, context: [...context, explainContext(await sessionRoot($))] })
    const ask = cfg.autoReview ? reviewRequest(e.text) : null
    if (ask) return next({ ...e, context: [...context, ...(await reviewPrompt($, ask))] })
    return next(e)
  }).catch(($, e, next) => next(e))

  // The reply's code shows as soon as its text arrives, while the turn may still run.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (e.agentId === undefined && isCodeReference(result.answer)) void activate($, result.answer, true).catch(() => undefined)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && isCodeReference(e.answer)) void activate($, e.answer, true).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'code-reference' }, async ($, e) => {
    const cmd = parseCommand(`/code-reference ${e.args}`)
    if (!cmd || cmd.kind === 'last') return { text: await codeForLastReply($) }
    if (cmd.kind === 'pick') {
      const st = await read($, refA)
      const place = st.places.find(p => p.n === cmd.n)
      if (!st.key || !place) return { text: st.key ? `The reply names places 1 to ${st.places.length}.` : 'No code reference yet: ask with /code-reference <question>.' }
      await pick($, st.key, cmd.n)
      return { text: `${cmd.n}  ${refLabel(place)}` }
    }
    return { text: 'Type the question after /code-reference, as a prompt.' }
  })

  on('command.run', { command: 'code-reference-setup' }, async $ => {
    const lines = await runSetup($, 'command')
    return { text: lines.join('\n') || 'Nothing installed.' }
  })

  // A click or key in the reply or the pane.
  on('ui.message', async ($, e, next) => {
    const d = (e.data ?? {}) as { key?: unknown; act?: unknown }
    if (typeof d.act !== 'string') return next(e)
    const act = d.act
    const key = typeof d.key === 'string' ? d.key : (await read($, refA)).key
    if (act.startsWith('place:') && key) await pick($, key, Number(act.slice(6)))
    else if (act.startsWith('url:')) await openUrl($, act.slice(4), e.surface)
    else {
      if (key && key !== (await read($, refA)).key) await focus($, key)
      if (act === 'prev') await step($, -1)
      else if (act === 'next') await step($, 1)
      else if (act === 'pane') await show($, true)
      else if (act === 'editor') await openEditor($)
      else if (act === 'github' || act === 'retry') await openGithub($, e.surface)
      else if (act === 'more') await more($)
    }
    return next(e)
  })

  // The person closed the pane: the code goes under the section.
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === PANE && e.origin.kind !== 'unload') await update($, refA, s => ({ ...s, isPaneClosed: true, paneSeq: s.paneSeq + 1 }))
    return closed
  }).catch(($, e, next) => next(e))

  // ---------- drawing ----------

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    const text = e.props.text
    const key = keyOf(text)
    const st = await read($, refA)
    if (!isCodeReference(text) && !st.adopted.includes(key)) return next(e)
    const root = await sessionRoot($)
    const doc = parseDoc(text, root)
    const source = doc ? sourceOf(doc.target, root) : null
    if (!doc || !source) return next(e)
    noteViewport(e.viewport)
    docs.set(key, { doc, source })
    const place = st.key === key ? st.places[st.current] : undefined
    let inline: InlineCode | null = null
    if (place) {
      const pane = (await $.ui.panes().catch(() => [])).find(p => p.id === PANE)
      const isUp = !st.isPaneClosed && pane !== undefined && (e.surface !== 'terminal' || pane.isPlaced)
      const view = st.code[refKey(place)] ?? null
      if (!isUp) inline = { place, view, tag: view?.kind === 'rows' ? view.note : sourceTag(st.source) }
    }
    const props: ReplyProps = { key, doc, current: place?.n ?? null, inline, cols: Math.max(20, e.viewport?.columns ?? 100) }
    const els = $.ui.resolve(e)
    if (!('Client' in els)) return next(e)
    const { Client } = els
    return <Client key="reply" module="./reply.view.tsx" props={props} width="100%" />
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const st = await read($, refA)
    const wt = await read($, worktreeA)
    const place = st.places[st.current] ?? null
    const view = place ? (st.code[refKey(place)] ?? null) : null
    if (place && st.key && !view) void ensureCode($, st.key, place).catch(() => undefined)
    const rows = e.props.placement === 'inline' ? Math.min(18, e.props.scroll.bodyRows) : e.props.scroll.bodyRows
    const props: PaneProps = {
      place,
      view,
      tag: view?.kind === 'rows' ? view.note : sourceTag(st.source),
      note: st.browserNote,
      isPr: st.source?.kind === 'pr',
      empty: emptyText(st, wt),
      cols: e.props.bodyColumns,
      rows,
    }
    const els = $.ui.resolve(e)
    if (!('Client' in els)) return drawRows(els, paneRows(props, props.cols, rows, 0).rows)
    const { Client } = els
    return <Client key="pane" module="./pane.view.tsx" props={props} width="100%" height={rows} />
  })
}

const sourceTag = (src: Source | null) => (src?.kind === 'pr' ? `PR #${src.number}` : 'local')

function emptyText(st: RefState, wt: Worktree): string {
  if (wt.status === 'preparing') return wt.note
  if (st.key && st.places.length === 0) return 'The reply names no places in the code.'
  if (wt.status === 'ready' && !st.key) return `The PR is checked out in ${wt.path}. Its code shows here once the review arrives.`
  return 'Ask with /code-reference and the code each reply points at shows here.'
}

