// Pure logic of the jump to a terminal session: where it runs, read from its process's environment, and the
// commands that bring it forward. Orca, Ghostty, Terminal, iTerm2 and tmux come forward on the session's own tab;
// VS Code, Cursor and the JetBrains IDEs on the window of its project; any other app as a whole.

/**
 * The environment variables that say where a process runs, each with the shape it may have. Their values go on
 * command lines, so nothing else is let through, and nothing else of the environment is kept.
 */
const HOST_VARS = {
  TERM_PROGRAM: /^[\w.-]{1,40}$/,
  __CFBundleIdentifier: /^[A-Za-z0-9.-]{1,100}$/,
  ORCA_TERMINAL_HANDLE: /^term_[A-Za-z0-9-]{1,64}$/,
  ORCA_CLI_BIN_DIR: /^\/[\w/.-]{1,200}$/,
  ITERM_SESSION_ID: /^w\d+t\d+p\d+:[A-Za-z0-9-]{1,64}$/,
  TMUX: /^\/[\w/.-]{1,200},\d+,\d+$/,
  TMUX_PANE: /^%\d{1,6}$/,
  TERMINAL_EMULATOR: /^[\w.-]{1,40}$/,
  CLAUDE_CODE_SSE_PORT: /^\d{1,5}$/,
} as const

export type HostVar = keyof typeof HOST_VARS

/** A process as `PROC_ARGV` prints it: its terminal and the variables of `HOST_VARS` it has. */
export type Proc = { tty: string | null; env: Partial<Record<HostVar, string>> }

/** Prints a process's terminal, then its command and environment on the same line. */
export const procArgv = (pid: number) => ['ps', '-Eww', '-o', 'tty=,command=', '-p', String(pid)]

/** What `procArgv` printed, or null when the process is gone. */
export function parseProc(stdout: string): Proc | null {
  const line = stdout.split('\n').find(l => l.trim())
  if (!line) return null
  const [tty = '', ...words] = line.trim().split(/\s+/)
  const env: Proc['env'] = {}
  for (const name of Object.keys(HOST_VARS) as HostVar[]) {
    // The environment follows the command's own words, so a name's last word is the environment's.
    const value = words.findLast(w => w.startsWith(`${name}=`))?.slice(name.length + 1)
    if (value !== undefined && HOST_VARS[name].test(value)) env[name] = value
  }
  return { tty: /^ttys?\d{1,4}$/.test(tty) ? tty : null, env }
}

const ORCA_APP = 'com.stablyai.orca'
const ITERM_APP = 'com.googlecode.iterm2'
const TERMINAL_APP = 'com.apple.Terminal'
const GHOSTTY_APP = 'com.mitchellh.ghostty'

/** Where a session runs, as far as its environment says; `app` is the bundle id brought forward when nothing finer works. */
export type Host =
  | { kind: 'tmux'; socket: string; serverPid: number; pane: string }
  | { kind: 'orca'; app: string; handle: string; cli: string }
  | { kind: 'iterm'; app: string; id: string }
  | { kind: 'terminal'; app: string; tty: string }
  | { kind: 'ghostty'; app: string }
  | { kind: 'vscode'; app: string; idePort: string | null }
  | { kind: 'jetbrains'; app: string; idePort: string | null }
  | { kind: 'app'; app: string }

export function hostOf({ tty, env }: Proc): Host | null {
  const app = env.__CFBundleIdentifier ?? null
  const idePort = env.CLAUDE_CODE_SSE_PORT ?? null
  if (env.TMUX && env.TMUX_PANE) {
    const [socket = '', pid = ''] = env.TMUX.split(',')
    return { kind: 'tmux', socket, serverPid: Number(pid), pane: env.TMUX_PANE }
  }
  if (env.ORCA_TERMINAL_HANDLE) {
    const cli = env.ORCA_CLI_BIN_DIR ? `${env.ORCA_CLI_BIN_DIR}/orca` : 'orca'
    return { kind: 'orca', app: app ?? ORCA_APP, handle: env.ORCA_TERMINAL_HANDLE, cli }
  }
  if (env.TERM_PROGRAM === 'iTerm.app' && env.ITERM_SESSION_ID) return { kind: 'iterm', app: app ?? ITERM_APP, id: env.ITERM_SESSION_ID.split(':')[1]! }
  if (env.TERM_PROGRAM === 'Apple_Terminal' && tty) return { kind: 'terminal', app: app ?? TERMINAL_APP, tty: `/dev/${tty}` }
  if (env.TERM_PROGRAM === 'ghostty') return { kind: 'ghostty', app: app ?? GHOSTTY_APP }
  if (!app) return null
  if (env.TERM_PROGRAM === 'vscode') return { kind: 'vscode', app, idePort }
  if (env.TERMINAL_EMULATOR?.startsWith('JetBrains')) return { kind: 'jetbrains', app, idePort }
  return { kind: 'app', app }
}

/** A path as it may go on a command line: absolute, without control characters. */
export const isPath = (v: unknown): v is string => typeof v === 'string' && v.startsWith('/') && v.length <= 4096 && !/[\u0000-\u001f]/.test(v)

/** The open workspace folder of an IDE lock file (`~/.claude/ide/<port>.lock`) that holds `cwd`: the deepest one. */
export function workspaceOf(lockText: string, cwd: string | null): string | null {
  let folders: unknown
  try {
    folders = (JSON.parse(lockText) as { workspaceFolders?: unknown }).workspaceFolders
  } catch {
    return null
  }
  if (!Array.isArray(folders)) return null
  const paths = folders.filter(isPath).map(p => p.replace(/(.)\/$/, '$1'))
  const holding = cwd ? paths.filter(p => cwd === p || cwd.startsWith(p === '/' ? p : `${p}/`)) : []
  return holding.sort((a, b) => b.length - a.length)[0] ?? (paths.length === 1 ? paths[0]! : null)
}

/** Prints every process with its parent and its executable, which for an app is the path inside its bundle. */
export const TREE_ARGV = ['ps', '-A', '-o', 'pid=,ppid=,comm=']

/** The executable of the app `pid` runs under, of those `TREE_ARGV` printed: the first one up its parents that is an app's. */
export function appExecutableOf(stdout: string, pid: number): string | null {
  const procs = new Map<number, { ppid: number; comm: string }>()
  for (const l of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(l)
    if (m) procs.set(Number(m[1]), { ppid: Number(m[2]), comm: m[3]!.trim() })
  }
  for (let p = procs.get(pid), n = 0; p && n < 32; p = procs.get(p.ppid), n++) {
    if (/^\/.+\.app\/Contents\/MacOS\/[^/]+$/.test(p.comm) && isPath(p.comm)) return p.comm
  }
  return null
}

/** `cwd` and the folders above it, the deepest first: where a JetBrains project's `.idea` is looked for. */
export function upFrom(cwd: string): string[] {
  const out: string[] = []
  for (let p = cwd.replace(/(.)\/$/, '$1'); out.length < 32; p = p.slice(0, p.lastIndexOf('/')) || '/') {
    out.push(p)
    if (p === '/') break
  }
  return out
}

/** Selects the Terminal tab on the tty given, brings its window to the front and Terminal with it. */
export const TERMINAL_SCRIPT = `on run argv
  set want to item 1 of argv
  tell application id "${TERMINAL_APP}"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is want then
          set selected tab of w to t
          set index of w to 1
          activate
          return
        end if
      end repeat
    end repeat
  end tell
  error "no tab on " & want
end run`

/** Selects the iTerm2 session with the unique id given, its tab and its window, and brings iTerm2 forward. */
export const ITERM_SCRIPT = `on run argv
  set want to item 1 of argv
  tell application id "${ITERM_APP}"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if unique id of s is want then
            select w
            tell t to select
            tell s to select
            activate
            return
          end if
        end repeat
      end repeat
    end repeat
  end tell
  error "no session " & want
end run`

/**
 * Focuses the Ghostty terminal in the folder given, the one whose title holds the title given when several are;
 * Ghostty names no tty or id a process could carry, so the folder and the title are what there is.
 */
export const GHOSTTY_SCRIPT = `on run argv
  set wd to item 1 of argv
  set ttl to item 2 of argv
  tell application id "${GHOSTTY_APP}"
    set found to missing value
    repeat with t in terminals
      if working directory of t is wd then
        if found is missing value then set found to contents of t
        if ttl is not "" and name of t contains ttl then
          set found to contents of t
          exit repeat
        end if
      end if
    end repeat
    if found is missing value then error "no terminal in " & wd
    focus found
    activate
  end tell
end run`

/**
 * What the jump needs beside the host: the session's folder and title, its IDE window's project folder, and the
 * executable of the IDE it runs under.
 */
export type JumpAt = { cwd: string | null; title: string; root: string | null; launcher: string | null }

/** The commands that bring the session forward, in order; null-free argv lists for `$.process.run`. */
export function jumpSteps(host: Host, at: JumpAt): string[][] {
  switch (host.kind) {
    case 'orca':
      // The switch picks the tab inside Orca without bringing Orca to the front.
      return [
        [host.cli, 'terminal', 'switch', '--terminal', host.handle],
        ['open', '-b', host.app],
      ]
    case 'iterm':
      return [['osascript', '-e', ITERM_SCRIPT, host.id]]
    case 'terminal':
      return [['osascript', '-e', TERMINAL_SCRIPT, host.tty]]
    case 'ghostty':
      return at.cwd ? [['osascript', '-e', GHOSTTY_SCRIPT, at.cwd, at.title.replace(/…$/, '')]] : [['open', '-b', host.app]]
    case 'vscode':
      // Given an open workspace's folder, VS Code and Cursor raise its window; given any other folder they open a new one.
      return [at.root ? ['open', '-b', host.app, at.root] : ['open', '-b', host.app]]
    case 'jetbrains':
      // The IDE's own executable hands the folder to the running IDE, which brings that project's window forward. `open`
      // makes it load the project a second time and leave an empty window; its URL reuses the project but raises nothing.
      return [at.root && at.launcher ? [at.launcher, at.root] : ['open', '-b', host.app]]
    case 'app':
      return [['open', '-b', host.app]]
    case 'tmux':
      return []
  }
}

/** Lists a tmux server's clients: when each was last used, its pid and its tty. */
export const tmuxClientsArgv = (tmux: string, socket: string) => [tmux, '-S', socket, 'list-clients', '-F', '#{client_activity} #{client_pid} #{client_tty}']

/** The client last used, of those `tmuxClientsArgv` printed: the one whose terminal shows the server. */
export function latestClient(stdout: string): { pid: number; tty: string } | null {
  let best: { at: number; pid: number; tty: string } | null = null
  for (const l of stdout.split('\n')) {
    const m = /^(\d+) (\d+) (\/dev\/ttys?\d{1,4})$/.exec(l.trim())
    if (m && (!best || Number(m[1]) > best.at)) best = { at: Number(m[1]), pid: Number(m[2]), tty: m[3]! }
  }
  return best && { pid: best.pid, tty: best.tty }
}

/** Shows the pane on that client: its session, its window, then the pane itself. */
export const tmuxSteps = (tmux: string, socket: string, pane: string, clientTty: string) => [
  [tmux, '-S', socket, 'switch-client', '-c', clientTty, '-t', pane],
  [tmux, '-S', socket, 'select-window', '-t', pane],
  [tmux, '-S', socket, 'select-pane', '-t', pane],
]
