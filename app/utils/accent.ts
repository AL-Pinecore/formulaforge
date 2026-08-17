// Accent and decoration commands whose argument MathLive renders as an opaque
// construct: the accent glyph overlays the argument, so clicks inside it map to
// no model offset and the caret cannot be re-placed into the argument by the
// native click handling. This mirrors the Text box machinery: the argument is
// located by geometry and the caret is snapped back into it.

export const ACCENT_COMMANDS = new Set([
  'hat',
  'bar',
  'vec',
  'dot',
  'ddot',
  'tilde',
  'widehat',
  'widetilde',
  'overline',
  'underline',
  'overrightarrow',
  'overleftarrow',
  'overbrace',
  'underbrace',
])

// Whether a serialized atom (e.g. `\hat{x}`, `\overbrace{x}^{2}`) is an accent
// construct. MathLive serializes the whole command as a single atom at the
// construct offset.
export function isAccentConstructLatex(latex: string | undefined): boolean {
  if (!latex) {
    return false
  }
  const match = latex.match(/^\\([a-zA-Z]+)\{/)
  return match != null && ACCENT_COMMANDS.has(match[1]!)
}
