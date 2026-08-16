import type { Style } from 'mathlive'

// Maps the font-style palette elements to a MathLive `Style` object so that
// dragging one of them onto an existing `\text{...}` box restyles its content
// instead of inserting a new placeholder. Only the styles with a text-mode
// equivalent are included; calligraphic/blackboard/fraktur are math-only.
export const FONT_STYLES: Record<string, Style> = {
  mathrm: { fontFamily: 'roman' },
  mathbf: { fontSeries: 'b' },
  mathit: { fontShape: 'it' },
  mathsf: { fontFamily: 'sans-serif' },
  mathtt: { fontFamily: 'monospace' },
}

// The text-mode command a style produces when applied to a `\text{...}` box
// (e.g. Bold turns `\text{x}` into `\textbf{x}`). Dragging the same style
// again while the box already uses that command toggles it back off.
export const FONT_STYLE_TEXT_COMMANDS: Record<string, string> = {
  mathrm: 'textrm',
  mathbf: 'textbf',
  mathit: 'textit',
  mathsf: 'textsf',
  mathtt: 'texttt',
}

export function isFontStyleElement(id: string): boolean {
  return id in FONT_STYLES
}
