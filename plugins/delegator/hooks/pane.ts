// The pane and the band above the prompt as grids of cells: the gate and its queue, the agents running
// and done, and the flow an orchestrating session reports. Pure: no `$`, so tests call it directly.
import type { AgentRun, DelegatorState, Flow, Pending, Tracking } from '../types'
import { batteryRuns } from './battery.ts'
import { builder, cut, line, piece, put, runs, widthOf, wrap } from './cells.ts'
import type { Grid, Piece, Run } from './cells.ts'
import { launchTask, modelName } from './queue.ts'
import { elapsed, fmtCost, fmtTime, fmtTokens, plannedOf, runOfTask, totals } from './runs.ts'
import { SPRITE_WIDTH, spriteRows } from './sprites.ts'

/** Rows of a task the pane shows before it says how many more there are. */
export const TASK_ROWS = 40

/** Below this many columns the characters are left out and each agent's text starts at the left edge. */
export const CHARACTER_MIN_WIDTH = 44

/** What a drawing needs besides the state: the time now, the animation's frame, and whether agents are asked for steps. */
export type Moment = { at: number; frame: number; asksSteps: boolean }

const STILL: Moment = { at: 0, frame: 0, asksSteps: false }

export type CellsGrid = Grid & { keys: Record<string, string> }

/** Each model family's colour, as user-hud's picker draws it. */
const MODEL_COLORS: Record<string, string> = { haiku: '#358fe9', sonnet: '#8a8fd4', opus: '#d88a6a', fable: '#f97d14', mythos: '#f97d14' }

const modelColor = (model: string): string => MODEL_COLORS[/haiku|sonnet|opus|fable|mythos/i.exec(model)?.[0].toLowerCase() ?? ''] ?? ''

/** `── W A I T I N G  · 2 ────`, the label spaced out while it fits. */
function divider(label: string, width: number, count?: number): Run[] {
  const tail = count === undefined ? '' : `  · ${count}`
  const spaced = `── ${label.split('').join(' ')}${tail} `
  const head = spaced.length + 2 <= width ? spaced : `── ${label}${tail} `
  return runs(head + '─'.repeat(Math.max(2, width - head.length)), { isDim: true })
}

/** A hotkey and what it does: `o: Turn off`, pressed as one action. */
const keyed = (key: string, label: string, action: string): Piece => ({ runs: [...runs(key, { color: 'claude', isBold: true }), ...runs(`: ${label}`)], action })

/** The task as rows: its own line breaks kept, each line wrapped, capped at `max` rows. */
export function taskRows(task: string, width: number, max = TASK_ROWS): Run[][] {
  const rows: Run[][] = []
  for (const para of task.split('\n')) {
    if (para.trim() === '') rows.push([])
    else rows.push(...wrap(para, width))
  }
  if (rows.length <= max) return rows
  return [...rows.slice(0, max - 1), runs(`… ${rows.length - max + 1} more lines`, { isDim: true })]
}

const pendingLine = (p: Pending) =>
  `#${p.n} ${p.subagentType} · ${p.description} · ${p.kind === 'fork' ? 'parent model' : p.model === null ? 'agent default' : modelName(p.model)}`

const what = (n: number, type: string, description: string) => `#${n} ${type} · ${description}`

/** A running agent's three rows of text: what it is and its model; its context, tokens, cost and time; its steps. */
function runningText(r: AgentRun, width: number, at: number): Run[][] {
  const head = line(width, [piece(what(r.n, r.type, r.description))], [piece(modelName(r.model), { color: modelColor(r.model) })]).row
  const context = r.contextMax > 0 ? (r.contextTokens / r.contextMax) * 100 : 0
  const usage = [...batteryRuns(context), ...runs(`  ${fmtTokens(r.tokens)}  ≈${fmtCost(r.costUsd)}  ${fmtTime(elapsed(r, at))}`, { isDim: true })]
  const s = r.steps
  const steps = s
    ? [...runs(s.total > 0 ? `${s.done}/${s.total}` : `${s.done}`, { color: 'claude', isBold: true }), ...(s.note ? runs(` ${s.note}`, { isDim: true }) : [])]
    : runs('no steps reported', { isDim: true })
  return [head, usage, steps]
}

/**
 * The pane, top to bottom, each part only when it has something: the gate and the totals, the flow, the
 * agents waiting and the first one's task, the agents running as their characters, the agents done, and
 * the tasks the flow planned that no agent has taken. Every row is cut at `width`.
 */
export function paneGrid(s: DelegatorState, t: Tracking, width: number, isOn: boolean, m: Moment = STILL): CellsGrid {
  const b = builder()
  const running = t.runs.filter(r => r.status === 'running')
  const finished = t.runs.filter(r => r.status !== 'running')
  const refused = s.recent.filter(d => d.outcome === 'refused')
  const planned = plannedOf(t.flow, t.runs)

  const head = line(
    width,
    [piece('DELEGATOR', { isBold: true }), isOn ? piece('● gate on', { color: 'success' }) : piece('○ gate off', { isDim: true })],
    [keyed('o', isOn ? 'Turn off' : 'Turn on', 'toggle')],
  )
  b.add(head.row, head.spans)
  const all = totals(t.runs, m.at)
  const sum = line(
    width,
    [piece(`${running.length} running · ≈${fmtCost(all.cost)} · ${fmtTokens(all.tokens)} tokens · ${fmtTime(all.time)}`, { isDim: true })],
    [keyed('c', t.isDoneHidden ? 'show done' : 'hide done', 'done')],
  )
  b.add(sum.row, sum.spans)
  if (s.approveAllTurn) b.add(runs('Approve all is on until this turn ends.', { color: 'warning' }))

  const flow = t.flow
  if (flow) b.add(line(width, [piece(flow.title, { isBold: true }), piece(`· ${flow.isFinished ? 'finished' : flow.phase}`, { isDim: true })]).row)

  const first = s.pending[0]
  if (first) {
    b.add(divider('WAITING', width, s.pending.length))
    s.pending.forEach((p, i) => b.add(line(width, [piece(i === 0 ? '▸' : ' ', { color: 'warning' }), piece(pendingLine(p), { isBold: i === 0 })]).row))
    b.add(divider(`TASK #${first.n}`, width))
    for (const row of taskRows(launchTask(first, m.asksSteps), width)) b.add(row)
  }

  if (running.length > 0) {
    b.add(divider('RUNNING', width, running.length))
    const hasCharacter = width >= CHARACTER_MIN_WIDTH
    const textWidth = hasCharacter ? width - SPRITE_WIDTH - 1 : width
    running.forEach((r, i) => {
      if (i > 0) b.add([])
      const text = runningText(r, textWidth, m.at)
      const sprite = hasCharacter ? spriteRows(r.role, m.frame + i) : []
      text.forEach((row, y) => {
        const out: Run[] = []
        for (const cell of sprite[y] ?? []) put(out, cell.text, cell)
        if (hasCharacter) put(out, ' ')
        for (const run of cut(row, textWidth)) put(out, run.text, run)
        b.add(out)
      })
    })
  }

  const doneCount = finished.length + refused.length
  if (doneCount > 0 && !t.isDoneHidden) {
    b.add(divider('DONE', width, doneCount))
    const rows = [
      ...finished.map(r => ({
        at: r.endedAt ?? r.startedAt,
        row: line(
          width,
          [piece(r.status === 'done' ? '✓' : '✗', { color: r.status === 'done' ? 'success' : 'error' }), piece(what(r.n, r.type, r.description))],
          [piece(`${fmtTokens(r.tokens)} · ${fmtTime(elapsed(r, m.at))}`, { isDim: true })],
        ).row,
      })),
      ...refused.map(d => ({
        at: d.at,
        row: line(width, [piece('✗', { color: 'error' }), piece(what(d.n, d.subagentType, d.description))], [piece('refused', { color: 'error' })]).row,
      })),
    ]
    for (const r of rows.sort((a, z) => z.at - a.at)) b.add(r.row)
  }

  if (flow && planned.length > 0) {
    b.add(divider('PLANNED', width, planned.length))
    for (const task of planned) {
      // A task it waits on that an agent took is that agent's number; one still planned keeps its own.
      const after = task.after.map(k => {
        const r = runOfTask(flow, t.runs, k)
        return r ? `#${r.n}` : `${k}`
      })
      const right = after.length > 0 ? [piece(`after ${after.join(', ')}`, { isDim: true })] : []
      b.add(line(width, [piece('◷', { isDim: true }), piece(`${task.k}. ${task.title}`, { isDim: true })], right).row)
    }
  }

  if (!first && t.runs.length === 0 && refused.length === 0 && !flow) {
    const idle = isOn ? 'No agent waiting. Each agent Claude starts waits here for your approval.' : 'Off: agents launch without asking.'
    for (const row of wrap(idle, width, { isDim: true })) b.add(row)
  }

  return { rows: b.grid.rows.map(row => cut(row, width)), hits: b.grid.hits, keys: { o: 'toggle', c: 'done' } }
}

const BAR_CELLS = 10

const BAND_GAP = 2

/**
 * The row above the prompt while a flow runs, right-aligned: `<title> · <phase>  ▰▰▰▱▱ 3/5 accepted  ● 3 agents ▸`,
 * the last part a button to the pane. Where the row is narrow the title gives way first, then the count.
 */
export function bandGrid(flow: Flow, running: number, width: number): CellsGrid {
  const button: Piece = {
    runs: [...runs('●', running > 0 ? { color: 'success' } : { isDim: true }), ...runs(` ${running} ${running === 1 ? 'agent' : 'agents'} ▸`)],
    action: 'open',
  }
  const pieces: Piece[] = [button]
  const used = () => pieces.reduce((n, p) => n + widthOf(p.runs), 0) + BAND_GAP * pieces.length
  if (flow.total > 0) {
    const cells = Math.min(BAR_CELLS, flow.total)
    const filled = Math.round((flow.done / flow.total) * cells)
    const bar: Run[] = [...runs('▰'.repeat(filled), { color: 'claude' }), ...runs('▱'.repeat(cells - filled), { isDim: true })]
    put(bar, ` ${flow.done}/${flow.total} accepted`)
    if (used() + widthOf(bar) <= width) pieces.unshift({ runs: bar, action: null })
  }
  const phase = ` · ${flow.phase}`
  const room = width - used() - phase.length
  if (room >= 4) pieces.unshift({ runs: [...cut(runs(flow.title, { isBold: true }), room), ...runs(phase, { isDim: true })], action: null })
  const b = builder()
  const row = line(width, [], pieces, BAND_GAP)
  b.add(cut(row.row, width), row.spans.filter(h => h.x1 <= width))
  return { ...b.grid, keys: {} }
}
