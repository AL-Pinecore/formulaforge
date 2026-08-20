import type { LatexSyntaxError, MathfieldElement } from 'mathlive'

export function disableNativeHistory(mf: MathfieldElement): void {
  mf.resetUndo()
}

export function ensureMathMode(mf: MathfieldElement): void {
  if (mf.value === '' && mf.mode === 'text') mf.mode = 'math'
}

export function formatLatexErrors(errors: readonly LatexSyntaxError[]): string[] {
  return errors.map((error) => {
    const code = error.code.replace(/-/g, ' ')
    const near = error.latex ? ` near '${error.latex}'` : ''
    return `LaTeX ${code}${near}`
  })
}
