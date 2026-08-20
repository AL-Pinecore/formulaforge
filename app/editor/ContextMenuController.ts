import type { MathfieldElement } from 'mathlive'
import type { MatrixCommand } from '~/utils/matrix'
import { unwrapCommandLatex } from '~/utils/unwrap-element'
import {
  matrixAtPoint,
  matrixContextAtCaret,
  matrixOffsetAtPoint,
} from './MatrixController'
import { internalModel, type InternalAtom } from './MathLiveAdapter'
import { normalizePublicLatex, publicStringOffsetToModel } from './TextController'

type ContextMatrixCommand = MatrixCommand | 'addColumnBefore' | 'addRowBefore'

const MATRIX_MENU_COMMANDS: Record<string, ContextMatrixCommand> = {
  'add-row-above': 'addRowBefore',
  'add-row-below': 'addRowAfter',
  'add-column-before': 'addColumnBefore',
  'add-column-after': 'addColumnAfter',
  'delete-row': 'removeRow',
  'delete-column': 'removeColumn',
}

type UnwrapTarget = {
  range: [number, number]
  latex: string
  caretOffset: number
}

type ContextMenuOptions = {
  unwrapLabel: () => string
  restoreEmptyGroups: (mf: MathfieldElement) => void
  publishState: (mf: MathfieldElement) => void
  updateTextHints: () => void
  selectionChanged: () => void
}

export class ContextMenuController {
  private unwrapTarget: UnwrapTarget | null = null
  private matrixTarget: InternalAtom | null = null

  constructor(private readonly options: ContextMenuOptions) {}

  configure(mf: MathfieldElement): void {
    mf.menuItems = [
      ...(mf.menuItems ?? []).map((item) => {
        const command = 'id' in item && item.id ? MATRIX_MENU_COMMANDS[item.id] : undefined
        if (!command) return item
        const rowCommand =
          command === 'addRowBefore' || command === 'addRowAfter' || command === 'removeRow'
        return {
          ...item,
          ...(rowCommand ? { visible: () => matrixContextAtCaret(mf) !== null } : {}),
          onMenuSelect: () => this.executeContextMatrixCommand(mf, command),
        }
      }),
      { type: 'divider' },
      {
        id: 'unwrap-element',
        label: this.options.unwrapLabel,
        visible: () => this.unwrapTarget !== null,
        onMenuSelect: () => this.unwrapContextTarget(mf),
      },
    ]
  }

  handlePointerDown(mf: MathfieldElement, event: PointerEvent): boolean {
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

  onContextMenu(mf: MathfieldElement, event: MouseEvent, matrixPadding: number): void {
    const model = internalModel(mf)
    if (!model) return

    const unwrap = this.unwrapTarget ?? this.unwrapTargetAtPoint(mf, event.clientX, event.clientY)
    const matrix = matrixAtPoint(mf, event.clientX, event.clientY, matrixPadding)
    const offset = matrix
      ? matrixOffsetAtPoint(mf, matrix, event.clientX, event.clientY)
      : mf.getOffsetFromPoint(event.clientX, event.clientY)
    if (offset == null || offset < 0) return
    const atom = model.at(offset)
    if (atom?.type === 'placeholder') mf.selection = { ranges: [[offset - 1, offset]] }
    else mf.position = offset
    this.matrixTarget = matrixContextAtCaret(mf) ? atom : null

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
    mf: MathfieldElement,
    commands: readonly ContextMatrixCommand[],
  ): void {
    mf.focus()
    for (const command of commands) {
      mf.executeCommand(command)
      if (command !== 'addRowBefore' && command !== 'addRowAfter') continue
      const context = matrixContextAtCaret(mf)
      const model = internalModel(mf)
      const right = context?.matrix.getCell(context.row, 1)?.[0]
      if (context?.matrix.environmentName !== 'aligned' || !model || !right) continue
      mf.position = model.offsetOf(right)
      mf.insert('=\\placeholder{}', {
        mode: 'math',
        format: 'latex',
        selectionMode: 'after',
        silenceNotifications: true,
      })
      const left = context.matrix.getCell(context.row, 0)?.[0]
      if (left) mf.position = model.offsetOf(left)
    }
    this.options.restoreEmptyGroups(mf)
    this.options.publishState(mf)
    this.options.updateTextHints()
  }

  private executeContextMatrixCommand(
    mf: MathfieldElement,
    command: ContextMatrixCommand,
  ): void {
    const model = internalModel(mf)
    const target = this.matrixTarget
    if (!model || !target) return
    const offset = model.offsetOf(target)
    if (offset < 0) return
    if (target.type === 'placeholder') mf.selection = { ranges: [[offset - 1, offset]] }
    else mf.position = offset
    this.executeMatrixCommands(mf, [command])
  }

  private unwrapContextTarget(mf: MathfieldElement): void {
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
    mf: MathfieldElement,
    end: number,
    latex: string,
  ): [number, number] | null {
    for (let start = end; start >= 0; start--) {
      if (mf.getValue(start, end) === latex) return [start, end]
    }
    return null
  }

  private unwrapTargetAtPoint(
    mf: MathfieldElement,
    x: number,
    y: number,
  ): UnwrapTarget | null {
    const model = internalModel(mf)
    let offset = mf.getOffsetFromPoint(x, y)
    let area = Infinity
    for (let candidate = 0; candidate <= mf.lastOffset; candidate++) {
      const bounds = mf.getElementInfo(candidate)?.bounds
      if (
        bounds &&
        x >= bounds.left &&
        x <= bounds.left + bounds.width &&
        y >= bounds.top &&
        y <= bounds.top + bounds.height &&
        bounds.width * bounds.height < area
      ) {
        offset = candidate
        area = bounds.width * bounds.height
      }
    }
    let atom = model?.at(offset)
    const seen = new Set<number>()
    while (model && atom) {
      const end = model.offsetOf(atom)
      if (seen.has(end)) {
        atom = atom.parent
        continue
      }
      seen.add(end)
      const latex = mf.getElementInfo(end)?.latex
      if (!latex) {
        atom = atom.parent
        continue
      }
      const replacement = unwrapCommandLatex(latex)
      const range = replacement != null && this.elementRange(mf, end, latex)
      if (range) {
        let occurrence = 0
        for (let candidate = 0; candidate < end; candidate++) {
          if (mf.getElementInfo(candidate)?.latex === latex) occurrence++
        }
        let index = -1
        for (let candidate = 0; candidate <= occurrence; candidate++) {
          index = mf.value.indexOf(latex, index + 1)
        }
        if (index >= 0) {
          return {
            range,
            latex: mf.value.slice(0, index) + replacement + mf.value.slice(index + latex.length),
            caretOffset: index + replacement.length,
          }
        }
      }
      atom = atom.parent
    }
    return null
  }
}
