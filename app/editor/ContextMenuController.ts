import type { EditorAdaptor, EditorMatrixCommand } from './EditorAdaptor'
import { unwrapCommandLatex } from '~/utils/unwrap-element'
import {
  matrixContextAtCaret,
  matrixOffsetAtPoint,
  moveToMatrixCell,
} from './MatrixController'
import { normalizePublicLatex, publicStringOffsetToModel } from './EditorLatex'

type UnwrapTarget = {
  range: [number, number]
  latex: string
  caretOffset: number
}

type ContextMenuOptions = {
  restoreEmptyGroups: (mf: EditorAdaptor) => void
  publishState: (mf: EditorAdaptor) => void
  updateTextHints: () => void
  selectionChanged: () => void
}

export class ContextMenuController {
  private unwrapTarget: UnwrapTarget | null = null
  private matrixTarget: { offset: number; placeholder: boolean } | null = null

  constructor(private readonly options: ContextMenuOptions) {}

  hasUnwrapTarget(): boolean {
    return this.unwrapTarget !== null
  }

  handlePointerDown(mf: EditorAdaptor, event: PointerEvent): boolean {
    if (
      event.composedPath().some(
        (node) => node instanceof HTMLElement && node.getAttribute('role') === 'menuitem',
      )
    ) {
      event.stopPropagation()
      return true
    }
    this.unwrapTarget = null
    this.matrixTarget = null
    if (event.button !== 2) return false
    this.unwrapTarget = this.unwrapTargetAtPoint(mf, event.clientX, event.clientY)
    return true
  }

  onContextMenu(mf: EditorAdaptor, event: MouseEvent, matrixPadding: number): void {
    const unwrap = this.unwrapTarget ?? this.unwrapTargetAtPoint(mf, event.clientX, event.clientY)
    const offset = matrixOffsetAtPoint(mf, event.clientX, event.clientY, matrixPadding)
      ?? mf.getOffsetFromPoint(event.clientX, event.clientY)
    if (offset == null || offset < 0) return
    const placeholder = /^\\placeholder/.test(mf.getElementInfo(offset)?.latex ?? '')
    if (placeholder) mf.selection = { ranges: [[Math.max(0, offset - 1), offset]] }
    else mf.position = offset
    this.matrixTarget = matrixContextAtCaret(mf) ? { offset, placeholder } : null

    mf.focus()
    if (!unwrap) return
    this.unwrapTarget = unwrap
    mf.selection = { ranges: [unwrap.range] }
    this.options.selectionChanged()
    requestAnimationFrame(() => {
      if (this.unwrapTarget !== unwrap) return
      mf.selection = { ranges: [unwrap.range] }
      this.options.selectionChanged()
    })
  }

  executeMatrixCommands(
    mf: EditorAdaptor,
    commands: readonly EditorMatrixCommand[],
  ): void {
    mf.focus()
    for (const command of commands) {
      mf.executeMatrixCommand(command)
      if (command !== 'addRowBefore' && command !== 'addRowAfter') continue
      const context = matrixContextAtCaret(mf)
      if (context?.matrix.environmentName !== 'aligned') continue
      if (!moveToMatrixCell(mf, context.matrix.index, context.row, 1)) continue
      mf.insert('=\\placeholder{}', {
        mode: 'math',
        format: 'latex',
        selectionMode: 'after',
        silenceNotifications: true,
      })
      moveToMatrixCell(mf, context.matrix.index, context.row, 0)
    }
    this.options.restoreEmptyGroups(mf)
    this.options.publishState(mf)
    this.options.updateTextHints()
  }

  executeContextMatrixCommand(
    mf: EditorAdaptor,
    command: EditorMatrixCommand,
  ): void {
    const target = this.matrixTarget
    if (!target) return
    if (target.placeholder) mf.selection = { ranges: [[Math.max(0, target.offset - 1), target.offset]] }
    else mf.position = target.offset
    this.executeMatrixCommands(mf, [command])
  }

  unwrapContextTarget(mf: EditorAdaptor): void {
    const target = this.unwrapTarget
    if (!target) return
    const publicCaretOffset = normalizePublicLatex(target.latex.slice(0, target.caretOffset)).length
    mf.setValue(target.latex, { mode: 'math', silenceNotifications: true })
    this.options.restoreEmptyGroups(mf)
    mf.position = publicStringOffsetToModel(mf, publicCaretOffset)
    this.options.publishState(mf)
    this.options.updateTextHints()
  }

  private elementRange(
    mf: EditorAdaptor,
    end: number,
    latex: string,
  ): [number, number] | null {
    for (let start = end; start >= 0; start--) {
      if (mf.getValue(start, end) === latex) return [start, end]
    }
    return null
  }

  private unwrapTargetAtPoint(
    mf: EditorAdaptor,
    x: number,
    y: number,
  ): UnwrapTarget | null {
    let best: { area: number; target: UnwrapTarget } | null = null
    for (let end = 0; end <= mf.lastOffset; end++) {
      const info = mf.getElementInfo(end)
      const bounds = info?.bounds
      if (
        !bounds ||
        x < bounds.left ||
        x > bounds.left + bounds.width ||
        y < bounds.top ||
        y > bounds.top + bounds.height
      ) continue
      const target = this.unwrapTargetAtOffset(mf, end)
      const area = bounds.width * bounds.height
      if (target && (!best || area < best.area)) best = { area, target }
    }
    return best?.target ?? this.unwrapTargetAtOffset(mf, mf.getOffsetFromPoint(x, y))
  }

  private unwrapTargetAtOffset(mf: EditorAdaptor, end: number): UnwrapTarget | null {
    const latex = mf.getElementInfo(end)?.latex
    if (!latex) return null
    const replacement = unwrapCommandLatex(latex)
    const range = replacement != null && this.elementRange(mf, end, latex)
    if (!range) return null
    let occurrence = 0
    for (let candidate = 0; candidate < end; candidate++) {
      if (mf.getElementInfo(candidate)?.latex === latex) occurrence++
    }
    let index = -1
    for (let candidate = 0; candidate <= occurrence; candidate++) {
      index = mf.value.indexOf(latex, index + 1)
    }
    if (index < 0) return null
    return {
      range,
      latex: mf.value.slice(0, index) + replacement + mf.value.slice(index + latex.length),
      caretOffset: index + replacement.length,
    }
  }
}
