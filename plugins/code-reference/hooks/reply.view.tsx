// The reply, drawn by the surface itself: the mod's rows at the region's
// width, a hovered link or box lit, a click on one posted to the hooks module.
import type { ClientModule } from 'claude-code'

import { drawRows } from './draw.tsx'
import { hitAt, replyRows } from './layout.ts'
import type { ReplyProps } from './layout.ts'

type Local = { hover: string | null }

const Reply: ClientModule<ReplyProps, Local> = (props, surface) => {
  const hover = surface.state?.hover ?? null
  const w = surface.columns > 0 ? surface.columns : props.cols
  const rows = replyRows(props, w, hover)
  const post = (act: string) => surface.post({ key: props.key, act })
  surface.onPointer(ev => {
    const hit = ev.type === 'leave' ? null : hitAt(rows, ev.x, ev.y)
    if (ev.type === 'down') {
      if (ev.button === 'left' && hit) post(hit)
      return
    }
    if (ev.type !== 'up' && hit !== hover) surface.setState({ hover: hit })
  })
  surface.onKey(k => {
    if (k.key === 'left' || k.key === 'a') post('prev')
    else if (k.key === 'right' || k.key === 'd') post('next')
    else if (k.key === 'return') post('pane')
  })
  return drawRows(surface.elements, rows)
}

export default Reply
