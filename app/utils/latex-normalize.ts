// Normalizations applied to the LaTeX before it leaves the editor (source
// panel, clipboard, .tex export, preview and image/PDF export), so the output
// is portable to external LaTeX tooling and renderers.

// MathLive serializes its ISO upright differential as `\differentialD`, a
// MathLive-only command that neither MathJax nor standard LaTeX understands.
// Rewrite it to the standard `\mathrm{d}` before publishing.
export function normalizeDifferential(latex: string): string {
  return latex.replace(/\\differentialD/g, '\\mathrm{d}')
}
