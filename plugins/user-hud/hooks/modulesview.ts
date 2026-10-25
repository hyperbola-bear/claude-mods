// Pure layout of the Modules pane: each module on or off, and the cards' order, moved a place at a time.
import { builder, keyed, line, piece } from './cells.ts'
import type { Piece } from './cells.ts'
import { DEFAULT_ORDER, MODULES, cardOrder, hintedRule } from './hud.ts'
import type { ModuleId, Modules } from './hud.ts'
import type { Band } from './panelgrid.ts'

/** What each module is called on its card. */
const TITLES: Record<ModuleId, string> = {
  pickers: 'Model & effort',
  cache: 'Cache',
  tokens: 'Context',
  sessions: 'Sessions',
  assume: 'Guesses',
  next: 'Next steps',
  handoff: 'Handoff',
}

/** Wide enough to say what each module does after its name. */
export const DESC_MIN_WIDTH = 56

/** `● on` or `○ off`, pressed to switch the module. */
const toggle = (id: ModuleId, isOn: boolean): Piece => piece(isOn ? '● on ' : '○ off', isOn ? { color: 'success' } : { isDim: true }, `module:toggle:${id}`)

function moduleRow(id: ModuleId, place: string, isOn: boolean, right: readonly Piece[], width: number) {
  const m = MODULES.find(x => x.id === id)!
  const left = [piece(place.padStart(2), { isDim: true }), toggle(id, isOn), piece(TITLES[id].padEnd(14), isOn ? { isBold: true } : { isDim: true })]
  if (width >= DESC_MIN_WIDTH) left.push(piece(m.desc, { isDim: true }))
  return line(width, left, right)
}

/**
 * The Modules pane: the cards top to bottom, each with its switch and `▲ ▼` to move it a place, then
 * handoff, which draws no card. The focus stays on a module's arrow as it moves.
 */
export function modulesPaneGrid(modules: Modules, order: readonly ModuleId[], width: number): Band {
  const b = builder()
  const add = (l: ReturnType<typeof line>) => b.add(l.row, l.spans)
  const cards = cardOrder(order)
  const isUsual = cards.join() === cardOrder(DEFAULT_ORDER).join()
  add(hintedRule('MODULES', width, isUsual ? [] : [keyed('d', 'usual order', 'modules:default')]))
  cards.forEach((id, i) => {
    const up = i > 0 ? piece(' ▲ ', {}, `module:up:${id}`) : piece(' ▲ ', { isDim: true })
    const down = i < cards.length - 1 ? piece(' ▼ ', {}, `module:down:${id}`) : piece(' ▼ ', { isDim: true })
    add(moduleRow(id, `${i + 1}`, modules[id], [up, down], width))
  })
  for (const id of order.filter(x => !cards.includes(x))) add(moduleRow(id, '', modules[id], [piece('bottom bar', { isDim: true })], width))
  add(line(width, [piece('Click ▲ ▼ or a switch, or arrow to one and press Return.', { isDim: true })]))
  return { ...b.grid, keys: isUsual ? {} : { d: 'modules:default' }, width }
}
