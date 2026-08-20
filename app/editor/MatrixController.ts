import type { MathfieldElement } from 'mathlive'
import { internalModel, type InternalAtom } from './MathLiveAdapter'

export interface InternalMatrix extends InternalAtom {
  environmentName: string
  rowCount: number
  colCount: number
  minColumns: number
  getCell: (row: number, column: number) => InternalAtom[] | undefined
}

export interface MatrixContext {
  matrix: InternalMatrix
  row: number
  column: number
  rowEmpty: boolean
  columnEmpty: boolean
}

interface VisualBox {
  left: number
  top: number
  width: number
  height: number
}

export function isMatrix(atom: InternalAtom | undefined): atom is InternalMatrix {
  if (atom?.type !== 'array') return false
  const name = (atom as InternalMatrix).environmentName
  return typeof name === 'string' && (
    /matrix\*?$/.test(name) ||
    /^[dr]?cases$/.test(name) ||
    name === 'aligned'
  )
}

function isEmptyMatrixCell(matrix: InternalMatrix, row: number, column: number): boolean {
  return Boolean(
    matrix.getCell(row, column)?.every((atom) =>
      atom.type === 'first' || atom.type === 'placeholder',
    ),
  )
}

export function matrixContextAtCaret(mf: MathfieldElement): MatrixContext | null {
  const model = internalModel(mf)
  let atom: InternalAtom | undefined = model?.at(mf.position)
  while (atom) {
    const branch = atom.parentBranch
    if (
      Array.isArray(branch) &&
      branch.length === 2 &&
      typeof branch[0] === 'number' &&
      typeof branch[1] === 'number' &&
      isMatrix(atom.parent)
    ) {
      const matrix = atom.parent
      const row = branch[0]
      const column = branch[1]
      return {
        matrix,
        row,
        column,
        rowEmpty: Array.from({ length: matrix.colCount }, (_, col) => col).every((col) =>
          isEmptyMatrixCell(matrix, row, col),
        ),
        columnEmpty: Array.from({ length: matrix.rowCount }, (_, line) => line).every((line) =>
          isEmptyMatrixCell(matrix, line, column),
        ),
      }
    }
    atom = atom.parent
  }
  return null
}

export function matrixAtPoint(
  mf: MathfieldElement,
  x: number,
  y: number,
  padding: number,
): InternalMatrix | null {
  const model = internalModel(mf)
  if (!model) return null
  const boxes = new Map<InternalMatrix, VisualBox>()
  for (let offset = 0; offset <= mf.lastOffset; offset++) {
    const bounds = mf.getElementInfo(offset)?.bounds
    if (!bounds) continue
    let atom: InternalAtom | undefined = model.at(offset)
    while (atom) {
      if (isMatrix(atom)) {
        const box = boxes.get(atom)
        boxes.set(
          atom,
          box
            ? {
                left: Math.min(box.left, bounds.left),
                top: Math.min(box.top, bounds.top),
                width:
                  Math.max(box.left + box.width, bounds.left + bounds.width) -
                  Math.min(box.left, bounds.left),
                height:
                  Math.max(box.top + box.height, bounds.top + bounds.height) -
                  Math.min(box.top, bounds.top),
              }
            : { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
        )
      }
      atom = atom.parent
    }
  }
  return [...boxes]
    .map(([matrix, box]) => ({
      matrix,
      distance: Math.hypot(
        Math.max(box.left - x, 0, x - box.left - box.width),
        Math.max(box.top - y, 0, y - box.top - box.height),
      ),
    }))
    .filter(({ distance }) => distance <= padding)
    .sort((a, b) => a.distance - b.distance)[0]?.matrix ?? null
}

export function matrixOffsetAtPoint(
  mf: MathfieldElement,
  matrix: InternalMatrix,
  x: number,
  y: number,
): number | null {
  const model = internalModel(mf)
  if (!model) return null
  let nearest: { distance: number; offset: number } | null = null
  let hit: { area: number; offset: number } | null = null
  for (let row = 0; row < matrix.rowCount; row++) {
    for (let column = 0; column < matrix.colCount; column++) {
      const cell = matrix.getCell(row, column)
      if (!cell) continue
      let box: VisualBox | null = null
      for (const atom of cell) {
        const offset = model.offsetOf(atom)
        const bounds = mf.getElementInfo(offset)?.bounds
        if (!bounds) continue
        const area = bounds.width * bounds.height
        if (
          x >= bounds.left &&
          x <= bounds.left + bounds.width &&
          y >= bounds.top &&
          y <= bounds.top + bounds.height &&
          (!hit || area < hit.area)
        ) {
          hit = { area, offset }
        }
        box = box
          ? {
              left: Math.min(box.left, bounds.left),
              top: Math.min(box.top, bounds.top),
              width:
                Math.max(box.left + box.width, bounds.left + bounds.width) -
                Math.min(box.left, bounds.left),
              height:
                Math.max(box.top + box.height, bounds.top + bounds.height) -
                Math.min(box.top, bounds.top),
            }
          : { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }
      }
      const target = cell.at(-1)
      if (!box || !target) continue
      const distance = Math.hypot(
        Math.max(box.left - x, 0, x - box.left - box.width),
        Math.max(box.top - y, 0, y - box.top - box.height),
      )
      if (!nearest || distance < nearest.distance) {
        nearest = { distance, offset: model.offsetOf(target) }
      }
    }
  }
  return hit?.offset ?? nearest?.offset ?? null
}
