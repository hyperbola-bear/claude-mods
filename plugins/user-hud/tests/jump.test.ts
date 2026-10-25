import { expect, test } from 'claude-code/testing'

import { GHOSTTY_SCRIPT, ITERM_SCRIPT, TERMINAL_SCRIPT, TREE_ARGV, appExecutableOf, hostOf, jumpSteps, latestClient, parseProc, procArgv, tmuxSteps, upFrom, workspaceOf } from '../hooks/jump.ts'
import type { Proc } from '../hooks/jump.ts'

/** One line of `ps -Eww -o tty=,command=`: the tty, the command, then the environment, as macOS prints it. */
const psLine = (tty: string, env: string) => `ttys${tty}  claude --model claude-sonnet-5-5 HOME=/Users/me PATH=/usr/bin ${env}\n`

// The environments below are what each terminal set for a real Claude Code session, cut to the words that matter.
const ORCA = psLine(
  '004',
  'TERM_PROGRAM=Orca ORCA_USER_DATA_PATH=/Users/me/Library/Application Support/orca __CFBundleIdentifier=com.stablyai.orca ORCA_TERMINAL_HANDLE=term_7b2400ab-c29b-4399-b13c-7a84a334f473 ORCA_CLI_BIN_DIR=/Applications/Orca.app/Contents/Resources/bin ORCA_AGENT_HOOK_TOKEN=secret',
)
const TERMINAL = psLine('010', '__CFBundleIdentifier=com.apple.Terminal TERM_PROGRAM=Apple_Terminal TERM_SESSION_ID=B726E0F2-98BD-442D-80D0-8AB7BB72AC01')
const GHOSTTY = psLine('011', 'GHOSTTY_RESOURCES_DIR=/Applications/Ghostty.app/Contents/Resources/ghostty TERM_PROGRAM=ghostty __CFBundleIdentifier=com.mitchellh.ghostty')
const VSCODE = psLine('017', '__CFBundleIdentifier=com.microsoft.VSCode TERM_PROGRAM=vscode VSCODE_GIT_ASKPASS_NODE=/Applications/Visual Studio Code.app CLAUDE_CODE_SSE_PORT=47628')
const CURSOR = psLine('018', '__CFBundleIdentifier=com.todesktop.230313mzl4w4u92 TERM_PROGRAM=vscode')
const GOLAND = psLine('013', '__CFBundleIdentifier=com.jetbrains.goland TERMINAL_EMULATOR=JetBrains-JediTerm TERM_SESSION_ID=dad45477-ad59-4eef-bc84-b25006196471')
const ITERM = psLine('020', '__CFBundleIdentifier=com.googlecode.iterm2 TERM_PROGRAM=iTerm.app ITERM_SESSION_ID=w0t1p0:8E2A1F0C-3B4D-4C5E-9F60-718293A4B5C6')
const TMUX = psLine('021', 'TERM_PROGRAM=tmux __CFBundleIdentifier=com.apple.Terminal TMUX=/private/tmp/tmux-501/default,51234,0 TMUX_PANE=%3')
const DESKTOP = '??       /Users/me/.local/share/claude/versions/2.1.308 __CFBundleIdentifier=com.anthropic.claudefordesktop\n'

const host = (line: string) => hostOf(parseProc(line)!)

test('a process is read for where it runs: its tty and the few variables that say so, nothing else', () => {
  expect(procArgv(88235)).toEqual(['ps', '-Eww', '-o', 'tty=,command=', '-p', '88235'])
  const p = parseProc(ORCA)!
  expect(p.tty).toBe('ttys004')
  expect(p.env).toEqual({
    TERM_PROGRAM: 'Orca',
    __CFBundleIdentifier: 'com.stablyai.orca',
    ORCA_TERMINAL_HANDLE: 'term_7b2400ab-c29b-4399-b13c-7a84a334f473',
    ORCA_CLI_BIN_DIR: '/Applications/Orca.app/Contents/Resources/bin',
  })
  expect(JSON.stringify(p)).not.toContain('secret')
  expect(parseProc(DESKTOP)).toEqual({ tty: null, env: { __CFBundleIdentifier: 'com.anthropic.claudefordesktop' } })
  expect(parseProc('')).toBe(null)
})

test('a value not shaped like its variable is dropped, and the environment wins over the command’s own words', () => {
  const p = parseProc(psLine('001', 'TERM_PROGRAM=Apple_Terminal;rm __CFBundleIdentifier=a/b ORCA_TERMINAL_HANDLE=term_x$y TMUX_PANE=%1'))!
  expect(p.env).toEqual({ TMUX_PANE: '%1' })
  // A prompt passed on the command line comes before the environment, so the environment's value is the one kept.
  const q = parseProc('ttys001  claude TERM_PROGRAM=ghostty TERM_PROGRAM=Apple_Terminal\n')!
  expect(q.env.TERM_PROGRAM).toBe('Apple_Terminal')
})

test('each terminal and IDE is told apart by what it sets', () => {
  expect(host(ORCA)).toEqual({ kind: 'orca', app: 'com.stablyai.orca', handle: 'term_7b2400ab-c29b-4399-b13c-7a84a334f473', cli: '/Applications/Orca.app/Contents/Resources/bin/orca' })
  expect(host(TERMINAL)).toEqual({ kind: 'terminal', app: 'com.apple.Terminal', tty: '/dev/ttys010' })
  expect(host(GHOSTTY)).toEqual({ kind: 'ghostty', app: 'com.mitchellh.ghostty' })
  expect(host(VSCODE)).toEqual({ kind: 'vscode', app: 'com.microsoft.VSCode', idePort: '47628' })
  expect(host(CURSOR)).toEqual({ kind: 'vscode', app: 'com.todesktop.230313mzl4w4u92', idePort: null })
  expect(host(GOLAND)).toEqual({ kind: 'jetbrains', app: 'com.jetbrains.goland', idePort: null })
  expect(host(ITERM)).toEqual({ kind: 'iterm', app: 'com.googlecode.iterm2', id: '8E2A1F0C-3B4D-4C5E-9F60-718293A4B5C6' })
  // Inside tmux the pane comes first, whatever terminal the server was started from.
  expect(host(TMUX)).toEqual({ kind: 'tmux', socket: '/private/tmp/tmux-501/default', serverPid: 51234, pane: '%3' })
  expect(host(psLine('030', '__CFBundleIdentifier=dev.warp.Warp-Stable TERM_PROGRAM=WarpTerminal'))).toEqual({ kind: 'app', app: 'dev.warp.Warp-Stable' })
  expect(host(psLine('031', 'TERM=xterm-256color'))).toBe(null)
})

test('the steps: the exact tab where the terminal can pick one, the project’s window in an IDE, else the app', () => {
  const at = { cwd: '/work/ghostty-a', title: 'Payload mapper fix…', root: null, launcher: null }
  expect(jumpSteps(host(ORCA)!, at)).toEqual([
    ['/Applications/Orca.app/Contents/Resources/bin/orca', 'terminal', 'switch', '--terminal', 'term_7b2400ab-c29b-4399-b13c-7a84a334f473'],
    ['open', '-b', 'com.stablyai.orca'],
  ])
  expect(jumpSteps(host(TERMINAL)!, at)).toEqual([['osascript', '-e', TERMINAL_SCRIPT, '/dev/ttys010']])
  expect(jumpSteps(host(ITERM)!, at)).toEqual([['osascript', '-e', ITERM_SCRIPT, '8E2A1F0C-3B4D-4C5E-9F60-718293A4B5C6']])
  // Ghostty is matched by folder, and by title among several in one folder; a cut title is matched by what is left.
  expect(jumpSteps(host(GHOSTTY)!, at)).toEqual([['osascript', '-e', GHOSTTY_SCRIPT, '/work/ghostty-a', 'Payload mapper fix']])
  expect(jumpSteps(host(GHOSTTY)!, { ...at, cwd: null })).toEqual([['open', '-b', 'com.mitchellh.ghostty']])
  expect(jumpSteps(host(VSCODE)!, { ...at, root: '/work/vscode-a' })).toEqual([['open', '-b', 'com.microsoft.VSCode', '/work/vscode-a']])
  expect(jumpSteps(host(CURSOR)!, at)).toEqual([['open', '-b', 'com.todesktop.230313mzl4w4u92']])
  // A JetBrains IDE gets the project from its own executable; without the project or the executable, only the app comes forward.
  const goland = '/Applications/GoLand.app/Contents/MacOS/goland'
  expect(jumpSteps(host(GOLAND)!, { ...at, root: '/work/my app', launcher: goland })).toEqual([[goland, '/work/my app']])
  expect(jumpSteps(host(GOLAND)!, { ...at, launcher: goland })).toEqual([['open', '-b', 'com.jetbrains.goland']])
  expect(jumpSteps(host(GOLAND)!, { ...at, root: '/work/my app' })).toEqual([['open', '-b', 'com.jetbrains.goland']])
  expect(jumpSteps({ kind: 'app', app: 'dev.warp.Warp-Stable' }, at)).toEqual([['open', '-b', 'dev.warp.Warp-Stable']])
})

test('the scripts take what they match as arguments, never as text of the script', () => {
  for (const script of [TERMINAL_SCRIPT, ITERM_SCRIPT, GHOSTTY_SCRIPT]) {
    expect(script).toMatch(/^on run argv\n/)
    expect(script).toContain('activate')
  }
  expect(TERMINAL_SCRIPT).toContain('tty of t is want')
  expect(ITERM_SCRIPT).toContain('unique id of s is want')
  expect(GHOSTTY_SCRIPT).toContain('working directory of t is wd')
})

test('an IDE lock file gives the open workspace that holds the session’s folder, the deepest one', () => {
  const lock = (workspaceFolders: unknown) => JSON.stringify({ pid: 74322, workspaceFolders, ideName: 'Visual Studio Code', authToken: 'secret' })
  expect(workspaceOf(lock(['/work/vscode-a']), '/work/vscode-a')).toBe('/work/vscode-a')
  expect(workspaceOf(lock(['/work', '/work/api/']), '/work/api/src')).toBe('/work/api')
  expect(workspaceOf(lock(['/work/api']), '/work/apiary')).toBe('/work/api')
  expect(workspaceOf(lock(['/work/a', '/work/b']), '/elsewhere')).toBe(null)
  expect(workspaceOf(lock(['/work/a']), null)).toBe('/work/a')
  for (const bad of ['{', lock('nope'), lock([7, 'relative', '/a\nb'])]) expect(workspaceOf(bad, '/work'), bad).toBe(null)
})

test('a JetBrains project is looked for from the session’s folder up to the root', () => {
  expect(upFrom('/work/api/src/')).toEqual(['/work/api/src', '/work/api', '/work', '/'])
  expect(upFrom('/')).toEqual(['/'])
})

test('tmux: the client last used shows the pane, then the terminal that client runs in comes forward', () => {
  const clients = ['1792900000 51300 /dev/ttys021', '1792905000 51400 /dev/ttys022', 'garbage', '17 x /dev/ttys1'].join('\n')
  expect(latestClient(clients)).toEqual({ pid: 51400, tty: '/dev/ttys022' })
  expect(latestClient('')).toBe(null)
  expect(tmuxSteps('/opt/homebrew/bin/tmux', '/tmp/s', '%3', '/dev/ttys022')).toEqual([
    ['/opt/homebrew/bin/tmux', '-S', '/tmp/s', 'switch-client', '-c', '/dev/ttys022', '-t', '%3'],
    ['/opt/homebrew/bin/tmux', '-S', '/tmp/s', 'select-window', '-t', '%3'],
    ['/opt/homebrew/bin/tmux', '-S', '/tmp/s', 'select-pane', '-t', '%3'],
  ])
  expect(jumpSteps(host(TMUX)!, { cwd: null, title: '', root: null, launcher: null })).toEqual([])
})

test('a process gone, or one no terminal claims, has no host', () => {
  const none: Proc = { tty: null, env: {} }
  expect(hostOf(none)).toBe(null)
  // Terminal's recipe needs the tty; without one only the app is known.
  expect(hostOf({ tty: null, env: { TERM_PROGRAM: 'Apple_Terminal', __CFBundleIdentifier: 'com.apple.Terminal' } })).toEqual({ kind: 'app', app: 'com.apple.Terminal' })
})

test('the IDE a session runs under is the first app executable up its parents', () => {
  expect(TREE_ARGV).toEqual(['ps', '-A', '-o', 'pid=,ppid=,comm='])
  // What ps printed for a session in GoLand's terminal: claude, its shell, then GoLand itself.
  const tree = ['    1     0 /sbin/launchd', '25562     1 /Applications/GoLand.app/Contents/MacOS/goland', '26660 25562 /bin/zsh', '26671 26660 claude', '30000     1 /Applications/IntelliJ IDEA.app/Contents/MacOS/idea', '30001 30000 /bin/zsh', '30002 30001 claude'].join('\n')
  expect(appExecutableOf(tree, 26671)).toBe('/Applications/GoLand.app/Contents/MacOS/goland')
  expect(appExecutableOf(tree, 30002)).toBe('/Applications/IntelliJ IDEA.app/Contents/MacOS/idea')
  expect(appExecutableOf(tree, 26660)).toBe('/Applications/GoLand.app/Contents/MacOS/goland')
  expect(appExecutableOf(tree, 1)).toBe(null)
  expect(appExecutableOf(tree, 999)).toBe(null)
  // A loop in the parents ends.
  expect(appExecutableOf('5 6 a\n6 5 b', 5)).toBe(null)
})
