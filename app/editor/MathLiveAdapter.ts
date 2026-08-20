import type { LatexSyntaxError, MathfieldElement } from 'mathlive'

export interface InternalAtom {
  type: string
  parent?: InternalAtom
  parentBranch?: unknown
  body?: InternalAtom[]
  value?: string
  firstChild?: InternalAtom
}

export interface InternalModel {
  at: (position: number) => InternalAtom
  offsetOf: (atom: InternalAtom) => number
  atoms?: InternalAtom[]
  mode: 'math' | 'text' | 'latex'
}

export function internalModel(mf: MathfieldElement): InternalModel | null {
  return (mf as unknown as { _mathfield?: { model?: InternalModel } })._mathfield?.model ?? null
}

export function disableNativeHistory(mf: MathfieldElement): void {
  const controls = mf as unknown as {
    stopRecording?: () => void
    resetUndo?: () => void
  }
  controls.stopRecording?.()
  controls.resetUndo?.()
}

export function ensureMathMode(mf: MathfieldElement): void {
  const model = internalModel(mf)
  if (model && mf.value === '' && model.mode === 'text') model.mode = 'math'
}

export function firstElementRangeAfter(mf: MathfieldElement): [number, number] | null {
  const model = internalModel(mf)
  if (!model?.atoms) return null
  const position = mf.position
  const startIndex = position === 0 ? 0 : position + 1
  for (let i = startIndex; i < model.atoms.length; i++) {
    const atom = model.atoms[i]!
    if (atom.type === 'first' || atom.type === 'placeholder') continue
    const end = model.offsetOf(atom)
    const start = atom.firstChild ? model.offsetOf(atom.firstChild) - 1 : end - 1
    if (start >= position) return [start, end]
  }
  return null
}

export function typedCommandName(mf: MathfieldElement): string | null {
  const group = internalModel(mf)?.atoms?.find((atom) => atom.type === 'latexgroup')
  if (!group?.body) return null
  const command = group.body
    .filter((atom) => atom.type === 'latex')
    .map((atom) => atom.value ?? '')
    .join('')
  return command.match(/^\\([a-zA-Z]+)/)?.[1] ?? null
}

export function formatLatexErrors(errors: readonly LatexSyntaxError[]): string[] {
  return errors.map((error) => {
    const code = error.code.replace(/-/g, ' ')
    const near = error.latex ? ` near '${error.latex}'` : ''
    return `LaTeX ${code}${near}`
  })
}
