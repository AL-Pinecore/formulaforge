// Normalizations applied to the LaTeX before it leaves the editor (source
// panel, clipboard, .tex export, preview and image/PDF export), so the output
// is portable to external LaTeX tooling and renderers.

const PORTABLE_COMMANDS: Record<string, string> = {
  '\\exponentialE': '\\mathrm{e}',
  '\\imaginaryI': '\\mathrm{i}',
  '\\imaginaryJ': '\\mathrm{j}',
  '\\differentialD': '\\mathrm{d}',
  '\\capitalDifferentialD': '\\mathrm{D}',
  '\\degree': '{}^{\\circ}',
}

export function normalizePortableLatex(latex: string): string {
  return latex
    .replace(
      /\\(?:exponentialE|imaginaryI|imaginaryJ|differentialD|capitalDifferentialD|degree)\b/g,
      (command) => PORTABLE_COMMANDS[command] ?? command,
    )
    .replace(/\\long(left|right)arrow(?=\s*(?:\[|\{))/g, '\\x$1arrow')
}
