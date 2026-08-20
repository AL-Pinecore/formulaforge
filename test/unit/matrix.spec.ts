import { describe, expect, it } from 'vitest'
import { matrixContextFromLatex } from '~/editor/MatrixController'
import { matrixCommandsForKey, type MatrixCellState } from '~/utils/matrix'

const state = (overrides: Partial<MatrixCellState>): MatrixCellState => ({
  row: 0,
  column: 0,
  rows: 3,
  columns: 3,
  rowEmpty: false,
  columnEmpty: false,
  ...overrides,
})

describe('matrix keyboard resizing', () => {
  it('adds at the right and bottom edges', () => {
    expect(matrixCommandsForKey(state({ column: 2 }), 'Enter')).toEqual(['addColumnAfter'])
    expect(matrixCommandsForKey(state({ row: 2 }), 'Enter')).toEqual(['addRowAfter'])
    expect(matrixCommandsForKey(state({ row: 2, column: 2 }), 'Enter')).toEqual([
      'addColumnAfter',
      'addRowAfter',
    ])
  })

  it('removes only empty outer rows and columns', () => {
    expect(matrixCommandsForKey(state({ column: 2, columnEmpty: true }), 'Delete')).toEqual([
      'removeColumn',
    ])
    expect(matrixCommandsForKey(state({ row: 2, rowEmpty: true }), 'Delete')).toEqual([
      'removeRow',
    ])
    expect(
      matrixCommandsForKey(
        state({ row: 2, column: 2, rowEmpty: true, columnEmpty: true }),
        'Delete',
      ),
    ).toEqual(['removeColumn', 'removeRow'])
    expect(matrixCommandsForKey(state({ row: 2, column: 2 }), 'Delete')).toEqual([])
  })

  it('uses the only resizable dimension for one-dimensional matrices', () => {
    expect(matrixCommandsForKey(state({ rows: 1, column: 2 }), 'Enter')).toEqual([
      'addColumnAfter',
    ])
    expect(
      matrixCommandsForKey(state({ rows: 1, column: 2, columnEmpty: true }), 'Delete'),
    ).toEqual(['removeColumn'])
    expect(matrixCommandsForKey(state({ columns: 1, row: 2 }), 'Enter')).toEqual(['addRowAfter'])
    expect(
      matrixCommandsForKey(state({ columns: 1, row: 2, rowEmpty: true }), 'Delete'),
    ).toEqual(['removeRow'])
  })

  it('defaults a 1x1 matrix to adding a column and never removes its last cell', () => {
    const single = state({ rows: 1, columns: 1, rowEmpty: true, columnEmpty: true })
    expect(matrixCommandsForKey(single, 'Enter')).toEqual(['addColumnAfter'])
    expect(matrixCommandsForKey(single, 'Delete')).toEqual([])
  })
})

describe('public LaTeX matrix context', () => {
  it('finds cells without splitting nested matrices or braced ampersands', () => {
    const latex = String.raw`\begin{matrix}{a&b}&\placeholder{}\\c&\begin{matrix}1&2\\3&4\end{matrix}\end{matrix}`
    const empty = matrixContextFromLatex(latex, latex.indexOf('placeholder'))
    expect(empty && [empty.row, empty.column, empty.rowEmpty, empty.columnEmpty]).toEqual([
      0,
      1,
      false,
      false,
    ])

    const nested = matrixContextFromLatex(latex, latex.indexOf('3'))
    expect(nested && [nested.matrix.environmentName, nested.row, nested.column]).toEqual([
      'matrix',
      1,
      0,
    ])
    expect(nested?.matrix.rowCount).toBe(2)
    expect(nested?.matrix.colCount).toBe(2)
  })
})
