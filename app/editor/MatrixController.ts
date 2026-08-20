import type { MathfieldElement } from 'mathlive'
import { normalizePublicLatex, publicStringOffsetToModel } from './EditorLatex'

export interface MatrixCell {
  start: number
  end: number
  latex: string
}

export interface MatrixStructure {
  index: number
  environmentName: string
  rowCount: number
  colCount: number
  cells: MatrixCell[][]
  start: number
  end: number
}

export interface MatrixContext {
  matrix: MatrixStructure
  row: number
  column: number
  rowEmpty: boolean
  columnEmpty: boolean
}

const MATRIX_ENVIRONMENT_RE = /^(?:[a-zA-Z]*matrix\*?|[dr]?cases|aligned)$/
const ENVIRONMENT_TOKEN_RE = /\\(begin|end)\{([^{}]+)\}/g
const CARET_MARKER = 'FormulaForgeMatrixCaret'

function splitCells(source: string, start: number, end: number): MatrixCell[][] {
  const rows: MatrixCell[][] = [[]]
  let cellStart = start
  let braceDepth = 0
  let environmentDepth = 0

  const pushCell = (cellEnd: number) => {
    rows.at(-1)!.push({ start: cellStart, end: cellEnd, latex: source.slice(cellStart, cellEnd) })
  }

  for (let index = start; index < end;) {
    if (source[index] === '\\') {
      const environment = /^\\(begin|end)\{([^{}]+)\}/.exec(source.slice(index))
      if (environment) {
        environmentDepth += environment[1] === 'begin' ? 1 : -1
        index += environment[0].length
        continue
      }
      if (source.startsWith('\\\\', index) && braceDepth === 0 && environmentDepth === 0) {
        pushCell(index)
        rows.push([])
        index += 2
        cellStart = index
        continue
      }
      const command = /^\\[a-zA-Z]+\*?/.exec(source.slice(index))
      index += command?.[0].length ?? 2
      continue
    }
    if (source[index] === '{') braceDepth++
    else if (source[index] === '}') braceDepth = Math.max(0, braceDepth - 1)
    else if (source[index] === '&' && braceDepth === 0 && environmentDepth === 0) {
      pushCell(index)
      cellStart = ++index
      continue
    }
    index++
  }
  pushCell(end)
  return rows
}

function matrixStructures(source: string): MatrixStructure[] {
  const stack: Array<{ environmentName: string; start: number; bodyStart: number }> = []
  const structures: MatrixStructure[] = []
  ENVIRONMENT_TOKEN_RE.lastIndex = 0
  for (let match = ENVIRONMENT_TOKEN_RE.exec(source); match; match = ENVIRONMENT_TOKEN_RE.exec(source)) {
    const token = match[1]!
    const environmentName = match[2]!
    if (token === 'begin') {
      stack.push({ environmentName, start: match.index, bodyStart: match.index + match[0].length })
      continue
    }
    const stackIndex = stack.findLastIndex((entry) => entry.environmentName === environmentName)
    if (stackIndex < 0) continue
    const begin = stack[stackIndex]!
    stack.length = stackIndex
    if (!MATRIX_ENVIRONMENT_RE.test(environmentName)) continue
    const cells = splitCells(source, begin.bodyStart, match.index)
    structures.push({
      index: 0,
      environmentName,
      rowCount: cells.length,
      colCount: Math.max(0, ...cells.map((row) => row.length)),
      cells,
      start: begin.start,
      end: match.index + match[0].length,
    })
  }
  return structures
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .map((matrix, index) => ({ ...matrix, index }))
}

function emptyCell(cell: MatrixCell | undefined): boolean {
  return !cell || cell.latex.replace(/\\placeholder(?:\[[^\]]*\])?\{[^{}]*\}/g, '').trim() === ''
}

export function matrixContextFromLatex(source: string, caretOffset: number): MatrixContext | null {
  const matrix = matrixStructures(source)
    .filter((candidate) => caretOffset >= candidate.start && caretOffset <= candidate.end)
    .sort((a, b) => a.end - a.start - (b.end - b.start))[0]
  if (!matrix) return null
  for (let row = 0; row < matrix.cells.length; row++) {
    const column = matrix.cells[row]!.findIndex(
      (cell) => caretOffset >= cell.start && caretOffset <= cell.end,
    )
    if (column < 0) continue
    return {
      matrix,
      row,
      column,
      rowEmpty: matrix.cells[row]!.every(emptyCell),
      columnEmpty: matrix.cells.every((cells) => emptyCell(cells[column])),
    }
  }
  return null
}

export function matrixContextAtCaret(mf: MathfieldElement): MatrixContext | null {
  const original = mf.value
  const position = mf.position
  const selection = mf.selection
  let marked = ''
  try {
    mf.position = position
    mf.insert(`\\text{${CARET_MARKER}}`, {
      mode: 'math',
      format: 'latex',
      insertionMode: 'insertBefore',
      selectionMode: 'after',
      silenceNotifications: true,
    })
    marked = mf.value
  } finally {
    mf.setValue(original, { mode: 'math', silenceNotifications: true })
    mf.selection = selection
    mf.resetUndo()
  }
  const markedOffset = marked.indexOf(CARET_MARKER)
  const markedContext = markedOffset >= 0 ? matrixContextFromLatex(marked, markedOffset) : null
  const matrix = markedContext && matrixStructures(original)[markedContext.matrix.index]
  if (!markedContext || !matrix) return null
  const { row, column } = markedContext
  return {
    matrix,
    row,
    column,
    rowEmpty: matrix.cells[row]?.every(emptyCell) ?? true,
    columnEmpty: matrix.cells.every((cells) => emptyCell(cells[column])),
  }
}

export function matrixOffsetAtPoint(
  mf: MathfieldElement,
  x: number,
  y: number,
  padding: number,
): number | null {
  let nearest: { distance: number; area: number; offset: number } | null = null
  for (let offset = 0; offset <= mf.lastOffset; offset++) {
    const bounds = mf.getElementInfo(offset)?.bounds
    if (!bounds) continue
    const distance = Math.hypot(
      Math.max(bounds.left - x, 0, x - bounds.right),
      Math.max(bounds.top - y, 0, y - bounds.bottom),
    )
    if (distance > padding) continue
    const area = bounds.width * bounds.height
    if (!nearest || distance < nearest.distance || (distance === nearest.distance && area < nearest.area)) {
      nearest = { distance, area, offset }
    }
  }
  return nearest?.offset ?? null
}

function matrixCell(mf: MathfieldElement, matrixIndex: number, row: number, column: number): MatrixCell | null {
  return matrixStructures(mf.value)[matrixIndex]?.cells[row]?.[column] ?? null
}

export function moveToMatrixCell(
  mf: MathfieldElement,
  matrixIndex: number,
  row: number,
  column: number,
): boolean {
  const cell = matrixCell(mf, matrixIndex, row, column)
  if (!cell) return false
  mf.position = publicStringOffsetToModel(mf, normalizePublicLatex(mf.value.slice(0, cell.start)).length)
  return true
}

export function selectMatrixCellPlaceholder(
  mf: MathfieldElement,
  matrixIndex: number,
  row: number,
  column: number,
): boolean {
  const cell = matrixCell(mf, matrixIndex, row, column)
  if (!cell) return false
  const placeholder = /\\placeholder(?:\[[^\]]*\])?\{[^{}]*\}/.exec(cell.latex)
  if (!placeholder) return false
  const stringOffset = normalizePublicLatex(
    mf.value.slice(0, cell.start + placeholder.index + placeholder[0].length),
  ).length
  const offset = publicStringOffsetToModel(mf, stringOffset)
  mf.selection = { ranges: [[Math.max(0, offset - 1), offset]] }
  return true
}
