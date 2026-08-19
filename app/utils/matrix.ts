export type MatrixCommand =
  | 'addColumnAfter'
  | 'addRowAfter'
  | 'removeColumn'
  | 'removeRow'

export interface MatrixCellState {
  row: number
  column: number
  rows: number
  columns: number
  rowEmpty: boolean
  columnEmpty: boolean
}

export function matrixCommandsForKey(
  state: MatrixCellState,
  key: 'Enter' | 'Delete',
): MatrixCommand[] {
  const lastRow = state.row === state.rows - 1
  const lastColumn = state.column === state.columns - 1

  if (key === 'Enter') {
    if (state.rows === 1) return lastColumn ? ['addColumnAfter'] : []
    if (state.columns === 1) return lastRow ? ['addRowAfter'] : []
    return [
      ...(lastColumn ? ['addColumnAfter' as const] : []),
      ...(lastRow ? ['addRowAfter' as const] : []),
    ]
  }

  if (state.rows === 1) {
    return state.columns > 1 && lastColumn && state.columnEmpty ? ['removeColumn'] : []
  }
  if (state.columns === 1) {
    return state.rows > 1 && lastRow && state.rowEmpty ? ['removeRow'] : []
  }
  return [
    ...(lastColumn && state.columnEmpty ? ['removeColumn' as const] : []),
    ...(lastRow && state.rowEmpty ? ['removeRow' as const] : []),
  ]
}
