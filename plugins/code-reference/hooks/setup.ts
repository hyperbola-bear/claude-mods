// What code-reference can use on this machine: the GitHub CLI for pull
// requests, and for a PR's GitHub page, Ghostty and terminal-browser. None is
// required (reviews fall back to a GitHub MCP server or plain git), and
// nothing is installed without asking: each missing one gets its own question.
import { clean } from './gh.ts'

export type DepId = 'gh' | 'ghostty' | 'terminal-browser'

type Dep = {
  name: string
  /** Asked about before every review while missing, not just once. */
  isRequired: boolean
  question: string
  steps: string[][]
  done: string
  manual: string
}

export const DEPS: Record<DepId, Dep> = {
  gh: {
    name: 'the GitHub CLI',
    isRequired: false,
    question: 'code-reference reads pull requests fastest with the GitHub CLI (gh), which is not installed; without it, reviews go through a GitHub MCP server or plain git. Install it with Homebrew (brew install gh)?',
    steps: [['brew', 'install', 'gh']],
    done: 'The GitHub CLI is installed. Sign in once with gh auth login in a terminal.',
    manual: 'brew install gh, then gh auth login',
  },
  ghostty: {
    name: 'Ghostty',
    isRequired: false,
    question: 'Ghostty is a terminal where code-reference can show a PR\'s GitHub page when you ask for it (with terminal-browser). Install it with Homebrew (brew install --cask ghostty)?',
    steps: [['brew', 'install', '--cask', 'ghostty']],
    done: 'Ghostty is installed: open it from Applications and run claude there.',
    manual: 'brew install --cask ghostty',
  },
  'terminal-browser': {
    name: 'terminal-browser',
    isRequired: false,
    question: 'terminal-browser draws a PR\'s GitHub page inside Ghostty or kitty, the lines you are looking at highlighted, when you press github in the code pane. Install it (brew install terminal-browser, then its Claude Code plugin)?',
    steps: [
      ['brew', 'install', 'terminal-browser'],
      ['claude', 'plugin', 'marketplace', 'add', 'zenbu-labs/terminal-browser'],
      ['claude', 'plugin', 'install', 'terminal-browser@terminal-browser'],
    ],
    done: 'terminal-browser is installed: restart Claude Code to load it.',
    manual: 'brew install terminal-browser, then claude plugin marketplace add zenbu-labs/terminal-browser and claude plugin install terminal-browser@terminal-browser',
  },
}

export const ANSWER = { yes: 'Install', no: 'Not now', never: "Don't ask again" } as const

/** When setup runs: once after the plugin is installed, before a review, or because the person asked. */
export type SetupMode = 'first-run' | 'review' | 'command'

/** What the store keeps: whether the questions were asked, and which ones not to ask again. */
export type Stored = { isAsked?: boolean; never?: DepId[] }

export type SetupFacts = { ghPath: string; hasBrowser: boolean; isMac: boolean; home: string }

/** What setup reaches outside itself; the hooks module builds it. */
export type SetupIo = {
  /** Runs a command: its exit code and standard error; exit code 127 when it cannot start. */
  run: (argv: string[], timeoutMs: number) => Promise<{ exitCode: number; stderr: string }>
  exists: (path: string) => Promise<boolean>
  /** The option picked; rejects when dismissed or no one can be asked. */
  ask: (question: string, options: string[]) => Promise<string>
  toast: (text: string, timeoutMs: number) => void
  status: (text: string | undefined) => void
  load: () => Promise<unknown>
  save: (value: Stored) => Promise<void>
}

const runs = async (io: SetupIo, argv: string[]) => (await io.run(argv, 10_000)).exitCode === 0

async function hasGhostty(io: SetupIo, home: string): Promise<boolean> {
  if ((await io.exists('/Applications/Ghostty.app')) || (await io.exists(`${home}/Applications/Ghostty.app`))) return true
  return runs(io, ['ghostty', '--version'])
}

/** The ones this machine lacks, required first. */
export async function missingDeps(io: SetupIo, facts: SetupFacts): Promise<DepId[]> {
  const out: DepId[] = []
  if (!(await runs(io, [facts.ghPath, '--version']))) out.push('gh')
  if (facts.isMac && !(await hasGhostty(io, facts.home))) out.push('ghostty')
  if (!facts.hasBrowser) out.push('terminal-browser')
  return out
}

/** Which missing ones to ask about: all when asked for, the required ones before a review, the rest once. */
export function toOffer(missing: readonly DepId[], mode: SetupMode, stored: Stored): DepId[] {
  const never = new Set(stored.never ?? [])
  return missing.filter(id => {
    if (mode === 'command') return true
    if (never.has(id)) return false
    if (mode === 'first-run') return true
    return DEPS[id].isRequired || !stored.isAsked
  })
}

async function install(io: SetupIo, id: DepId): Promise<boolean> {
  const dep = DEPS[id]
  io.status(`code-reference: installing ${dep.name}…`)
  try {
    for (const argv of dep.steps) {
      const r = await io.run(argv, 600_000)
      if (r.exitCode !== 0) {
        const why = clean(r.stderr.split('\n').find(l => l.trim()) ?? '', 160) || `${argv.join(' ')} exited with ${r.exitCode}`
        io.toast(`Could not install ${dep.name} (${why}). To do it yourself: ${dep.manual}.`, 15_000)
        return false
      }
    }
    io.toast(dep.done, 10_000)
    return true
  } finally {
    io.status(undefined)
  }
}

/**
 * Asks about each missing dependency in turn and installs the ones the person
 * says yes to. The required ones install before this resolves; with
 * `isBackground`, the optional ones install after it, so a review is not held up.
 */
export async function offerSetup(io: SetupIo, facts: SetupFacts, mode: SetupMode, isBackground = false): Promise<string[]> {
  const stored = ((await io.load().catch(() => undefined)) ?? {}) as Stored
  const missing = await missingDeps(io, facts)
  const offer = toOffer(missing, mode, stored)
  const lines: string[] = []
  if (offer.length === 0) {
    if (mode === 'command') lines.push(missing.length === 0 ? 'Everything code-reference uses is installed.' : 'Nothing to install.')
    return lines
  }
  if (!(await runs(io, ['brew', '--version']))) {
    const names = offer.map(id => DEPS[id].name).join(', ')
    const text = `code-reference would install ${names} with Homebrew, which is not installed: see https://brew.sh, or install them yourself.`
    io.toast(text, 15_000)
    await io.save({ ...stored, isAsked: true }).catch(() => undefined)
    return [text]
  }
  const never = new Set(stored.never ?? [])
  const later: DepId[] = []
  for (const id of offer) {
    const dep = DEPS[id]
    let answer: string
    try {
      answer = await io.ask(dep.question, [ANSWER.yes, ANSWER.no, ANSWER.never])
    } catch {
      break // dismissed, or no one to ask
    }
    if (answer === ANSWER.never) {
      never.add(id)
      lines.push(`${dep.name}: will not ask again (run /code-reference-setup to install it later).`)
      continue
    }
    if (answer !== ANSWER.yes) {
      lines.push(`${dep.name}: not installed.`)
      continue
    }
    if (isBackground && !dep.isRequired) later.push(id)
    else lines.push(`${dep.name}: ${(await install(io, id)) ? 'installed' : 'install failed'}.`)
  }
  await io.save({ isAsked: true, never: [...never] }).catch(() => undefined)
  if (later.length > 0) {
    void (async () => {
      for (const id of later) await install(io, id)
    })()
    lines.push(`${later.map(id => DEPS[id].name).join(' and ')}: installing in the background.`)
  }
  return lines
}

/** Whether setup has asked its questions on this machine before. */
export const wasAsked = (stored: unknown) => (stored as Stored | undefined)?.isAsked === true
