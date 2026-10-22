import { expect, test } from 'claude-code/testing'

import type { AgentRun, Tracking } from '../types'
import { plain, widthOf } from '../hooks/cells.ts'
import { CHARACTER_MIN_WIDTH, bandGrid, paneGrid } from '../hooks/pane.ts'
import { EMPTY, decided, makePending } from '../hooks/queue.ts'
import { startRun } from '../hooks/runs.ts'
import { PAL } from '../hooks/sprites.ts'

const run = (over: Partial<AgentRun> & Pick<AgentRun, 'n' | 'type' | 'description' | 'model'>): AgentRun => ({
  ...startRun({ n: over.n, agentId: `agent-${over.n}`, type: over.type, description: over.description, model: over.model, at: 0 }),
  ...over,
})

const MIN = 60_000

const plan = makePending({ description: 'lay out the verify skill', subagentType: 'Plan', prompt: 'Lay out the verify skill for polar-mods.', parentModel: 'claude-opus-5-5', fork: false }, 7, true)
const rewrite = makePending({ description: 'rewrite the tests', subagentType: 'general-purpose', prompt: 'Rewrite them.', parentModel: 'claude-opus-5-5', fork: false }, 2, true)
const QUEUE = { ...EMPTY, pending: [plan], recent: [decided(rewrite, 'refused', null, 10_000, 'refused')] }
const AT = 6 * MIN + 12_000
const TRACKED: Tracking = {
  issued: 7,
  isDoneHidden: false,
  runs: [
    run({ n: 1, type: 'Explore', description: 'read savvy-progress', model: 'claude-haiku-4-5', status: 'done', endedAt: 38_000, tokens: 31_000 }),
    run({ n: 3, type: 'Explore', description: 'find session status files', model: 'claude-haiku-4-5', startedAt: AT - 41_000, contextTokens: 44_000, tokens: 48_000, costUsd: 0.02, steps: { done: 2, total: 4, note: 'reading sessions/*.json' } }),
    run({ n: 5, type: 'general-purpose', description: 'port the agent panel into delegator', model: 'claude-opus-5-5', contextTokens: 630_000, tokens: 412_000, costUsd: 1.84, steps: { done: 3, total: 6, note: 'cells for the running list' } }),
    run({ n: 6, type: 'claude-code-guide', description: 'how Client cells paint on desktop', model: 'claude-sonnet-5-5', startedAt: AT - 4 * MIN - 3_000, contextTokens: 810_000, tokens: 650_000, costUsd: 0.45 }),
  ],
  flow: {
    title: 'verify skill',
    phase: 'delegate',
    done: 1,
    total: 3,
    isFinished: false,
    tasks: [
      { title: 'find session status files', tier: 'light', after: [] },
      { title: 'port the agent panel into delegator', tier: 'careful', after: [] },
      { title: 'write the polar-mods verify skill', tier: 'medium', after: [2] },
    ],
  },
}

const MOMENT = { at: AT, frame: 0, asksSteps: false }

const PALETTE = new Set(Object.values(PAL))

const hasCharacter = (row: ReturnType<typeof paneGrid>['rows'][number]) =>
  row.some(r => /[▀▄█]/.test(r.text) && (PALETTE.has(r.color) || PALETTE.has(r.bg)))

test('the approved drawing: the gate, the totals, the flow, waiting, running with characters, done and planned', () => {
  const grid = paneGrid(QUEUE, TRACKED, 70, true, MOMENT)
  const lines = plain(grid).map(l => l.trimEnd())
  expect(lines[0]).toMatch(/^DELEGATOR ● gate on +o: Turn off$/)
  expect(lines[1]).toMatch(/^3 running · ≈\$2\.31 · 1\.1M tokens · 6m 12s +c: hide done$/)
  expect(lines[2]).toBe('verify skill · delegate')
  expect(lines[3]).toMatch(/^── W A I T I N G {2}· 1 ─+$/)
  expect(lines[4]).toBe('▸ #7 Plan · lay out the verify skill · Opus')
  expect(lines[5]).toMatch(/^── T A S K +# 7 ─+$/)
  expect(lines[6]).toBe('Lay out the verify skill for polar-mods.')
  expect(lines[7]).toMatch(/^── R U N N I N G {2}· 3 ─+$/)
  // Each running agent: its character in the first 8 cells, a blank cell, then three rows of text.
  expect(lines.slice(8, 19).map(l => l.slice(9))).toEqual([
    '#3 Explore · find session status files              Haiku 4.5',
    '▕██▏       ▏ 22%  48k  ≈$0.02  41s',
    '2/4 reading sessions/*.json',
    '',
    // The task's words give way so the model fits on the right.
    '#5 general-purpose · port the agent panel into dele… Opus 5.5',
    '▕██████▎   ▏ 63%  412k  ≈$1.84  6m 12s',
    '3/6 cells for the running list',
    '',
    '#6 claude-code-guide · how Client cells paint on … Sonnet 5.5',
    '▕████████  ▏ 81%  650k  ≈$0.45  4m 03s',
    'no steps reported',
  ])
  expect(grid.rows.slice(8, 11).every(hasCharacter)).toBe(true)
  expect(lines[19]).toMatch(/^── D O N E {2}· 2 ─+$/)
  expect(lines[20]).toMatch(/^✓ #1 Explore · read savvy-progress +31k · 38s$/)
  expect(lines[21]).toMatch(/^✗ #2 general-purpose · rewrite the tests +refused$/)
  expect(lines[22]).toMatch(/^── P L A N N E D {2}· 1 ─+$/)
  expect(lines[23]).toMatch(/^◷ 3\. write the polar-mods verify skill +after #5$/)
  expect(lines).toHaveLength(24)
  expect(grid.hits.map(h => h.id)).toEqual(['toggle', 'done'])
})

test('at every width from 40 to 110 no row is wider than the pane; below 44 the characters are left out', () => {
  // A word no wrap can break, such as a long link in a task, is cut too.
  const queue = { ...QUEUE, pending: [{ ...plan, prompt: `Read https://example.com/${'x'.repeat(150)} first.` }] }
  for (let width = 40; width <= 110; width++) {
    const grid = paneGrid(queue, TRACKED, width, true, MOMENT)
    for (const row of grid.rows) expect({ width, cells: widthOf(row) <= width }).toEqual({ width, cells: true })
    for (const h of grid.hits) expect({ width, inside: h.x0 >= 0 && h.x1 <= width }).toEqual({ width, inside: true })
    const lines = plain(grid)
    const first = lines.findIndex(l => l.includes('R U N N I N G'))
    if (width < CHARACTER_MIN_WIDTH) {
      expect({ width, characters: grid.rows.some(hasCharacter) }).toEqual({ width, characters: false })
      expect(lines[first + 1]?.startsWith('#3 Explore')).toBe(true)
    } else {
      expect({ width, characters: grid.rows.slice(first + 1, first + 4).every(hasCharacter) }).toEqual({ width, characters: true })
    }
  }
})

test('a planned task waits on the newest agent that took the task it names', () => {
  const again = run({ n: 9, type: 'general-purpose', description: 'port the agent panel into delegator', model: 'claude-opus-5-5' })
  const lines = plain(paneGrid(QUEUE, { ...TRACKED, runs: [...TRACKED.runs, again] }, 70, true, MOMENT)).map(l => l.trimEnd())
  expect(lines.some(l => /^◷ 3\. write the polar-mods verify skill +after #9$/.test(l))).toBe(true)
})

test('c hides the agents done, and the row says how to show them', () => {
  const lines = plain(paneGrid(QUEUE, { ...TRACKED, isDoneHidden: true }, 70, true, MOMENT)).map(l => l.trimEnd())
  expect(lines[1]).toMatch(/c: show done$/)
  expect(lines.some(l => l.includes('D O N E') || l.includes('read savvy-progress') || l.includes('rewrite the tests'))).toBe(false)
  expect(lines.some(l => l.includes('R U N N I N G'))).toBe(true)
})

test('the band fits its row, the title giving way first', () => {
  const flow = TRACKED.flow!
  for (let width = 20; width <= 120; width++) {
    const band = bandGrid(flow, 3, width)
    expect({ width, cells: widthOf(band.rows[0] ?? []) }).toEqual({ width, cells: width })
    // The button to the pane is the last part to go.
    expect({ width, button: band.hits }).toEqual({ width, button: [{ id: 'open', y: 0, x0: width - 12, x1: width }] })
  }
  expect(plain(bandGrid(flow, 3, 80))[0]).toBe(`${' '.repeat(25)}verify skill · delegate  ▰▱▱ 1/3 accepted  ● 3 agents ▸`)
  expect(plain(bandGrid(flow, 3, 40))[0]).toBe('▰▱▱ 1/3 accepted  ● 3 agents ▸'.padStart(40))
  expect(plain(bandGrid(flow, 3, 20))[0]).toBe('● 3 agents ▸'.padStart(20))
  expect(bandGrid(flow, 3, 80).hits).toEqual([{ id: 'open', y: 0, x0: 68, x1: 80 }])
})
