/**
 * Mermaid drawn where the pane is, by beautiful-mermaid (no DOM needed):
 *
 *   - terminal: box-drawing lines that fit the pane's columns;
 *   - desktop: an SVG that follows the app's light or dark theme. Sequence
 *     diagrams and charts are beautiful-mermaid's own drawings; flowcharts and
 *     state, class and ER diagrams need its ELK layout engine, too big to
 *     bundle (see scripts/vendor.sh), so their box drawing's layout is
 *     redrawn as vector strokes instead (boxart.ts).
 *
 * `diagramPage` is the full-size view: a page that draws every diagram of an
 * answer with Mermaid itself, all diagram types, in the browser.
 */
import { boxArtSvg } from './boxart.ts'
import { renderMermaidASCII, renderMermaidSVG } from './vendor/beautiful-mermaid.js'

export type AsciiDrawing =
  | { kind: 'lines'; lines: string[]; width: number; isClipped: boolean }
  | { kind: 'error'; reason: string }

/** `layout`: beautiful-mermaid's own SVG; `grid`: the box drawing's layout redrawn as vector strokes (boxart.ts). */
export type SvgDrawing = { kind: 'svg'; svg: string; from: 'layout' | 'grid' } | { kind: 'error'; reason: string }

/** Roomy first, then tighter, until the drawing fits. */
const LADDER = [
  { paddingX: 4, paddingY: 2, boxBorderPadding: 0 },
  { paddingX: 2, paddingY: 1, boxBorderPadding: 0 },
] as const

const SIDEWAYS = /^(\s*(?:flowchart|graph))\s+(LR|RL)\b/

const widthOf = (lines: readonly string[]): number => Math.max(0, ...lines.map(l => [...l].length))

function ascii(source: string, options: (typeof LADDER)[number]): string[] {
  const lines = renderMermaidASCII(source, { colorMode: 'none', ...options })
    .split('\n')
    .map(l => l.replace(/\s+$/, ''))
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

const reasonOf = (err: unknown): string => (err instanceof Error ? err.message : String(err)).split('\n')[0] ?? ''

const cache = new Map<string, AsciiDrawing | SvgDrawing>()

function remember<T extends AsciiDrawing | SvgDrawing>(key: string, make: () => T): T {
  const hit = cache.get(key)
  if (hit) return hit as T
  const made = make()
  const oldest = cache.keys().next().value
  if (cache.size > 200 && oldest !== undefined) cache.delete(oldest)
  cache.set(key, made)
  return made
}

/**
 * The diagram as lines no wider than `columns` where it can be: a sideways
 * flowchart is turned top-down, then the spacing tightened. One that still
 * does not fit comes back whole with `isClipped`, for the pane to cut.
 */
export function drawAscii(source: string, columns: number): AsciiDrawing {
  return remember(`a${columns}\n${source}`, () => {
    const sources = SIDEWAYS.test(source) ? [source, source.replace(SIDEWAYS, '$1 TD')] : [source]
    let narrowest: string[] | null = null
    try {
      for (const src of sources) {
        for (const options of LADDER) {
          const lines = ascii(src, options)
          if (widthOf(lines) <= columns) return { kind: 'lines', lines, width: widthOf(lines), isClipped: false }
          if (narrowest === null || widthOf(lines) < widthOf(narrowest)) narrowest = lines
        }
      }
    } catch (err) {
      return { kind: 'error', reason: reasonOf(err) }
    }
    const lines = narrowest ?? []
    return { kind: 'lines', lines, width: widthOf(lines), isClipped: true }
  })
}

/** Light colors are the markup's own; these take over where the system is dark. */
const DARK = '@media (prefers-color-scheme: dark) { svg { --bg: #262624 !important; --fg: #ECEAE4 !important; } }'

const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * The diagram as an SVG for a pane `columns` cells wide. A grid drawing is
 * laid out to fit a little more than that (a sideways flowchart turned
 * top-down), since the picture is scaled to the pane and a wide one would
 * shrink its words.
 */
export function drawSvg(source: string, columns = 100): SvgDrawing {
  return remember(`s${columns}\n${source}`, () => {
    try {
      // Drawn on its own background, so it reads the same whatever is behind it.
      const svg = renderMermaidSVG(source, { transparent: false })
        // A web font is fetched from the network; the system font draws the same words.
        .replace(/@import url\([^)]*\);?/g, '')
        .replace('<style>', `<style>${DARK} text { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }`)
      return { kind: 'svg', svg, from: 'layout' }
    } catch (err) {
      const drawn = drawAscii(source, Math.max(72, Math.round(columns * 1.25)))
      if (drawn.kind === 'lines') return { kind: 'svg', svg: boxArtSvg(drawn.lines, DARK), from: 'grid' }
      return { kind: 'error', reason: drawn.kind === 'error' ? drawn.reason : reasonOf(err) }
    }
  })
}

/** Mermaid itself, pinned, drawing in the person's browser. */
export const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs'

/** A page with every diagram of an answer full size, drawn by Mermaid itself (every diagram type). */
export function diagramPage(question: string, sources: readonly string[]): string {
  const figures = sources
    .map(src => `<figure><pre class="mermaid">${escape(src)}</pre><details><summary>Mermaid source</summary><pre>${escape(src)}</pre></details></figure>`)
    .join('\n')
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ask: ${escape(question.slice(0, 60))}</title>
<style>
  :root { color-scheme: light dark; --bg: #faf9f5; --fg: #262624; --muted: #6b6a66; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1f1e1d; --fg: #ECEAE4; --muted: #a3a19b; } }
  body { margin: 0; padding: 32px 16px; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 17px; font-weight: 600; margin: 0 0 24px; }
  figure { margin: 0 0 40px; overflow-x: auto; }
  pre.mermaid { background: none; text-align: center; }
  summary { color: var(--muted); cursor: pointer; margin-top: 8px; }
  details pre { font-size: 13px; overflow-x: auto; }
</style></head>
<body><main><h1>${escape(question)}</h1>
${figures}
</main>
<script type="module">
  import mermaid from '${MERMAID_URL}'
  const dark = matchMedia('(prefers-color-scheme: dark)').matches
  mermaid.initialize({ startOnLoad: true, theme: dark ? 'dark' : 'default', securityLevel: 'strict' })
</script>
</body></html>
`
}
