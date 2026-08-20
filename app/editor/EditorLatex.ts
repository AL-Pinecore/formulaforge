import type { MathfieldElement } from 'mathlive'
import {
  mergeAdjacentTextCommands,
  removeOrphanedTextBoundaries,
  stripTextBoundaries,
} from '~/utils/text-boundary'

export function normalizePublicLatex(latex: string): string {
  return mergeAdjacentTextCommands(stripTextBoundaries(removeOrphanedTextBoundaries(latex)))
}

export function publicStringOffsetToModel(mf: MathfieldElement, stringOffset: number): number {
  let bestOffset = 0
  let bestDistance = Infinity
  for (let offset = 0; offset <= mf.lastOffset; offset++) {
    const length = normalizePublicLatex(mf.getValue(0, offset)).length
    if (length > stringOffset) continue
    const distance = stringOffset - length
    if (distance < bestDistance) {
      bestDistance = distance
      bestOffset = offset
    }
  }
  return bestOffset
}
