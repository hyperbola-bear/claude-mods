/** The part of beautiful-mermaid's API the ask mod calls. */

export type AsciiRenderOptions = {
  /** true: + - | > characters; false (the default): Unicode box drawing. */
  useAscii?: boolean
  paddingX?: number
  paddingY?: number
  boxBorderPadding?: number
  colorMode?: 'none' | 'auto' | 'ansi16' | 'ansi256' | 'truecolor' | 'html'
}

export type SvgRenderOptions = {
  bg?: string
  fg?: string
  font?: string
  padding?: number
  nodeSpacing?: number
  layerSpacing?: number
  transparent?: boolean
}

/** Synchronous; throws on a header it does not know (pie, gantt, mindmap, ...). */
export function renderMermaidASCII(text: string, options?: AsciiRenderOptions): string

/** Synchronous (ELK laid out in-thread); throws as the ASCII renderer does. */
export function renderMermaidSVG(text: string, options?: SvgRenderOptions): string
