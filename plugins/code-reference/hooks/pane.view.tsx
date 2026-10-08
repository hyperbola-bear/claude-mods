// The pane, drawn by the surface itself: one header line and code in every
// other row. It scrolls on its own (↑ ↓, the arrow and page keys) and asks
// the hooks module for more of the file once it reaches the end of what it has.
import type { ClientModule } from 'claude-code'

import { drawRows } from './draw.tsx'
import { anchorOf, hitAt, paneRows } from './layout.ts'
import type { PaneProps } from './layout.ts'

/** How far the code is scrolled from where the place puts it, for which place. */
type Local = { scroll: number; at: string }

const Pane: ClientModule<PaneProps, Local> = (props, surface) => {
  const p = props.place
  const at = p ? `${p.n}:${p.path}:${p.line}` : ''
  const scroll = surface.state?.at === at ? surface.state.scroll : 0
  const w = surface.columns > 0 ? surface.columns : props.cols
  const h = surface.rows > 0 ? surface.rows : props.rows
  const { rows, start, room } = paneRows(props, w, h, scroll)
  const post = (act: string) => surface.post({ act })
  const move = (d: number) => {
    const view = props.view
    if (!p || !view || view.kind !== 'rows') return
    if ((d < 0 && start + d < 0 && view.above > 0) || (d > 0 && start + room + d > view.rows.length && view.below > 0)) post('more')
    const base = anchorOf(view, p, room)
    const next = Math.max(-base, Math.min(scroll + d, view.rows.length - room - base))
    if (next !== scroll) surface.setState({ scroll: next, at })
  }
  surface.onPointer(ev => {
    if (ev.type !== 'down' || ev.button !== 'left') return
    const hit = hitAt(rows, ev.x, ev.y)
    if (hit === 'up') move(-10)
    else if (hit === 'down') move(10)
    else if (hit) post(hit)
  })
  surface.onKey(k => {
    if (k.key === 'up') move(-1)
    else if (k.key === 'down') move(1)
    else if (k.key === 'pageup') move(-room)
    else if (k.key === 'pagedown' || k.key === ' ') move(room)
    else if (k.key === 'left' || k.key === 'a') post('prev')
    else if (k.key === 'right' || k.key === 'd') post('next')
    else if (k.key === 'e') post('editor')
    else if (k.key === 'o' && props.isPr) post('github')
  })
  return drawRows(surface.elements, rows)
}

export default Pane
