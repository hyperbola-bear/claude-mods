import { expect, test } from 'claude-code/testing'

import { parseApiPr, readGithubFile, readPr, repoOfRemote } from '../hooks/source.ts'
import type { GithubIo } from '../hooks/source.ts'

const URL = 'https://github.com/acme/billing/pull/12'
const SHA = 'abc1234def5678'

const GH_JSON = { url: URL, number: 12, title: 'Firehose', headRefOid: SHA, headRefName: 'feat/x', baseRefName: 'main', author: { login: 'mlee' }, additions: 3, deletions: 1, changedFiles: 2 }
const API_JSON = { html_url: URL, number: 12, title: 'Firehose', head: { sha: SHA, ref: 'feat/x' }, base: { ref: 'main' }, user: { login: 'mlee' }, additions: 3, deletions: 1, changed_files: 2 }

/** A world where each source answers or not; it records who was asked. */
function io(o: { gh?: boolean; mcp?: boolean; git?: boolean; file?: string | null }) {
  const asked: string[] = []
  const world: GithubIo = {
    gh: async args => {
      asked.push(`gh ${args.join(' ')}`)
      if (!o.gh) return { isOk: false, err: 'gh is not installed' }
      return { isOk: true, out: args[0] === 'api' ? 'raw file' : JSON.stringify(GH_JSON) }
    },
    mcp: async (name, args) => {
      asked.push(`mcp ${name} ${JSON.stringify(args)}`)
      if (!o.mcp) return null
      return name === 'get_pull_request' ? JSON.stringify(API_JSON) : (o.file ?? null)
    },
    git: async argv => {
      asked.push(argv.join(' '))
      if (argv.includes('remote')) return { isOk: true, out: 'origin\tgit@github.com:acme/billing.git (fetch)\norigin\tgit@github.com:acme/billing.git (push)\n' }
      if (!o.git) return { isOk: false, err: 'could not read from remote' }
      if (argv.includes('--symref')) return { isOk: true, out: 'ref: refs/heads/trunk\tHEAD\nfff\tHEAD\n' }
      return { isOk: true, out: `${SHA}\trefs/pull/12/head\n` }
    },
  }
  return { world, asked }
}

test('a PR is read with gh first', async () => {
  const { world, asked } = io({ gh: true, mcp: true, git: true })
  const read = await readPr(world, { kind: 'url', url: URL }, '/work')
  expect(read).toMatchObject({ isOk: true, via: 'gh', info: { headSha: SHA, base: 'main', meta: { title: 'Firehose' } } })
  expect(asked).toHaveLength(1)
})

test('without gh, a GitHub MCP server; without either, git reads refs/pull/<n>/head', async () => {
  const viaMcp = io({ gh: false, mcp: true, git: true })
  expect(await readPr(viaMcp.world, { kind: 'url', url: URL }, '/work')).toMatchObject({ isOk: true, via: 'mcp', info: { headSha: SHA, meta: { author: 'mlee' } } })
  expect(viaMcp.asked[1]).toBe('mcp get_pull_request {"owner":"acme","repo":"billing","pullNumber":12}')
  const viaGit = io({ gh: false, mcp: false, git: true })
  expect(await readPr(viaGit.world, { kind: 'number', number: 12 }, '/work')).toMatchObject({ isOk: true, via: 'git', info: { url: URL, headSha: SHA, base: 'trunk' } })
  expect(viaGit.asked).toContain('git -C /work ls-remote origin refs/pull/12/head')
  const none = io({ gh: false, mcp: false, git: false })
  const failed = await readPr(none.world, { kind: 'url', url: URL }, '/work')
  expect(failed.isOk).toBe(false)
  expect(failed.isOk ? '' : failed.note).toContain('gh: gh is not installed')
  expect(await readPr(none.world, { kind: 'branch' }, '/work')).toEqual({ isOk: false, note: 'finding the PR of this branch needs gh' })
})

test('a file at the PR head: gh, else the MCP server, base64 or raw', async () => {
  expect(await readGithubFile(io({ gh: true }).world, 'github.com', 'acme/billing', SHA, 'a.ts')).toBe('raw file')
  const utf8 = String.fromCharCode(...new TextEncoder().encode('héllo\n'))
  const b64 = io({ gh: false, mcp: true, file: JSON.stringify({ content: btoa(utf8), encoding: 'base64' }) })
  expect(await readGithubFile(b64.world, 'github.com', 'acme/billing', SHA, 'a.ts')).toBe('héllo\n')
  expect(await readGithubFile(io({ gh: false, mcp: true, file: 'plain text' }).world, 'github.com', 'acme/billing', SHA, 'a.ts')).toBe('plain text')
  expect(await readGithubFile(io({ gh: false, mcp: false }).world, 'github.com', 'acme/billing', SHA, 'a.ts')).toBe(null)
})

test('remotes and the API shape', () => {
  expect(repoOfRemote('git@github.com:acme/billing.git')).toEqual({ host: 'github.com', repo: 'acme/billing' })
  expect(repoOfRemote('https://ghe.acme.io/pay/api')).toEqual({ host: 'ghe.acme.io', repo: 'pay/api' })
  expect(parseApiPr('not json')).toBe(null)
  expect(parseApiPr(JSON.stringify({ ...API_JSON, head: { sha: 'zz' } }))).toBe(null)
})
