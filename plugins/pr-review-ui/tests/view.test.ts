import { expect, test } from 'claude-code/testing'

import { parseDiff } from '../hooks/review.ts'
import { cacheDirs, canDrawImages, headCopyPath, ideCommands, ideOf, nvimOpenExpr, pickView, prFiles, remoteFor, sameRepo, shortRef, vscodeCliFrom } from '../hooks/view.ts'

const PR = { isTerminal: true, hasBrowser: true, isPr: true, hasIdeCommand: false }

test('auto follows the terminal: the editor in an IDE terminal, terminal-browser in Ghostty or kitty, else the pane', () => {
  expect(pickView('auto', { termProgram: 'vscode' }, PR)).toBe('ide')
  expect(pickView('auto', { terminalEmulator: 'JetBrains-JediTerm' }, PR)).toBe('ide')
  expect(pickView('auto', { termProgram: 'ghostty' }, PR)).toBe('browser')
  expect(pickView('auto', { term: 'xterm-kitty' }, PR)).toBe('browser')
  expect(pickView('auto', { termProgram: 'ghostty', tmux: '/tmp/tmux-1/default,1,0' }, PR)).toBe('pane')
  expect(pickView('auto', { termProgram: 'ghostty' }, { ...PR, hasBrowser: false })).toBe('pane')
  expect(pickView('auto', { termProgram: 'ghostty' }, { ...PR, isPr: false })).toBe('pane')
  expect(pickView('auto', { termProgram: 'Apple_Terminal' }, PR)).toBe('pane')
  expect(pickView('auto', { termProgram: 'Apple_Terminal' }, { ...PR, hasIdeCommand: true })).toBe('ide')
  expect(pickView('auto', { termProgram: 'vscode' }, { ...PR, isTerminal: false })).toBe('pane')
  expect(pickView('auto', { termProgram: 'zed' }, PR)).toBe('ide')
  expect(pickView('auto', { termProgram: 'ghostty', nvim: '/tmp/nvim.1/0' }, PR)).toBe('ide')
  expect(pickView('auto', { termProgram: 'iTerm.app' }, PR)).toBe('pane')
  expect(pickView('auto', { termProgram: 'WarpTerminal' }, PR)).toBe('pane')
})

test('a fixed setting wins, browser only for PRs', () => {
  expect(pickView('pane', { termProgram: 'vscode' }, PR)).toBe('pane')
  expect(pickView('ide', { termProgram: 'ghostty' }, PR)).toBe('ide')
  expect(pickView('browser', {}, PR)).toBe('browser')
  expect(pickView('browser', {}, { ...PR, isPr: false })).toBe('pane')
})

test('IDE and image support detection', () => {
  expect(ideOf({ termProgram: 'vscode' })).toBe('vscode')
  expect(ideOf({ bundleId: 'com.jetbrains.goland' })).toBe('jetbrains')
  expect(ideOf({ termProgram: 'iTerm.app' })).toBe(null)
  expect(ideOf({ termProgram: 'zed' })).toBe('zed')
  expect(ideOf({ termProgram: 'vscode', nvim: '/tmp/nvim.1/0' })).toBe('nvim') // Neovim's terminal inside VS Code's
  expect(canDrawImages({ term: 'xterm-ghostty' })).toBe(true)
  expect(canDrawImages({ kittyWindow: '1' })).toBe(true)
  expect(canDrawImages({ termProgram: 'vscode', term: 'xterm-256color' })).toBe(false)
})

test('the commands that open a file at a line, in order', () => {
  const node = '/Applications/Cursor.app/Contents/Frameworks/Cursor Helper (Plugin).app/Contents/MacOS/Cursor Helper (Plugin)'
  expect(vscodeCliFrom(node)).toBe('/Applications/Cursor.app/Contents/Resources/app/bin/code')
  expect(vscodeCliFrom(undefined)).toBe(null)
  expect(ideCommands('vscode', '/w/a.ts', 9, { askpassNode: node })).toEqual([
    ['/Applications/Cursor.app/Contents/Resources/app/bin/code', '-r', '-g', '/w/a.ts:9'],
    ['code', '-r', '-g', '/w/a.ts:9'],
  ])
  expect(ideCommands('jetbrains', '/w/a.go', 3, { bundleId: 'com.jetbrains.goland' })).toEqual([
    ['open', '-nb', 'com.jetbrains.goland', '--args', '--line', '3', '/w/a.go'],
    ['idea', '--line', '3', '/w/a.go'],
  ])
  expect(ideCommands(null, '/w/a.go', 3, { command: 'cursor' })).toEqual([['cursor', '-r', '-g', '/w/a.go:3']])
  expect(ideCommands(null, '/w/a.go', 3, { command: '/usr/local/bin/goland' })).toEqual([['/usr/local/bin/goland', '--line', '3', '/w/a.go']])
  expect(ideCommands(null, '/w/a.go', 3, {})).toEqual([])
  expect(ideCommands('zed', '/w/a.go', 3, {})).toEqual([['zed', '/w/a.go:3']])
  expect(ideCommands(null, '/w/a.go', 3, { command: '/usr/local/bin/zed' })).toEqual([['/usr/local/bin/zed', '/w/a.go:3']])
  expect(ideCommands('nvim', "/w/it's.go", 3, { nvim: '/tmp/nvim.1/0' })).toEqual([
    ['nvim', '--server', '/tmp/nvim.1/0', '--remote-expr', nvimOpenExpr("/w/it's.go", 3)],
  ])
  expect(nvimOpenExpr("/w/it's.go", 3)).toBe("execute('if winnr(''$'') == 1 | vsplit | else | wincmd p | endif | edit +3 ' . fnameescape('/w/it''s.go'))")
  expect(ideCommands('nvim', '/w/a.go', 3, {})).toEqual([]) // no socket, no Neovim
})

test('the PR repository among the remotes, and the cache folders', () => {
  const remotes = ['origin\tgit@github.com:polar/billing.git (fetch)', 'origin\tgit@github.com:polar/billing.git (push)', 'upstream\thttps://github.com/acme/billing.git (fetch)'].join('\n')
  expect(remoteFor(remotes, 'acme/billing')).toBe('upstream')
  expect(remoteFor(remotes, 'polar/billing')).toBe('origin')
  expect(remoteFor(remotes, 'acme/other')).toBe(null)
  expect(cacheDirs('/Users/p/', 'github.com', 'acme/billing', 12, 'abcdef1234')).toEqual({
    clone: '/Users/p/.cache/pr-review-ui/repos/github.com/acme/billing',
    worktree: '/Users/p/.cache/pr-review-ui/review/acme-billing-12-abcdef1',
    prefix: '/Users/p/.cache/pr-review-ui/review/acme-billing-12-',
  })
})

test('the PR checkout check and the PR-head copy path', () => {
  expect(sameRepo('git@github.com:Acme/Billing.git', 'acme/billing')).toBe(true)
  expect(sameRepo('https://github.com/acme/billing', 'acme/billing')).toBe(true)
  expect(sameRepo('https://github.com/acme/billing-ui.git', 'acme/billing')).toBe(false)
  expect(headCopyPath('/var/folders/x/T/', 'acme/billing', 12, 'abcdef1234', 'src/a.ts')).toBe('/var/folders/x/T/pr-review-ui/acme-billing-12-abcdef1/src/a.ts')
})

test('the PR files and short refs', () => {
  const files = parseDiff(['diff --git a/f.ts b/f.ts', '--- a/f.ts', '+++ b/f.ts', '@@ -10,3 +10,4 @@', ' a', '-b', '+B', '+C', ' d'].join('\n'))
  expect(prFiles(files)).toEqual([{ path: 'f.ts', adds: 2, dels: 1 }])
  expect(shortRef({ path: 'a/b/c/d.go', line: 3, endLine: 9 })).toBe('c/d.go:3-9')
})
