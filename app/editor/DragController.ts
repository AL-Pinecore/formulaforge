import type { MathfieldElement } from 'mathlive'
import type { EquationElement } from '~/types/equation'
import { getElementById } from '~/data/equation-elements'
import { DRAG_ELEMENT_MIME, draggedElementId } from '~/utils/drag-payload'
import { FONT_STYLES, isFontStyleElement } from '~/utils/font-styles'
import { ensureAccentPositioning } from '~/utils/mathfield-accent'
import { ensurePlaceholderSupport } from '~/utils/mathfield-placeholder'
import { addTextBoundaries, withEmptyTextSentinel } from '~/utils/text-boundary'
import {
  offsetFromPoint,
  placeholderIndexAtPoint,
  selectPlaceholderAtPoint,
} from './SelectionController'
import { collectTextHints, textGroupRangeAtPoint, type TextHint } from './TextController'

const PREVIEW_GREY = '#9ca3af'

export interface DragPreviewBox {
  left: number
  top: number
  width: number
  height: number
}

interface DragControllerOptions {
  getMathfield: () => MathfieldElement | null
  getContainer: () => HTMLElement | null
  setDragging: (value: boolean) => void
  setPreview: (
    html: string | null,
    box: DragPreviewBox | null,
    hints: TextHint[],
  ) => void
  insertElement: (
    element: EquationElement,
    offset?: number,
    placeholderIndex?: number,
    x?: number,
    y?: number,
  ) => void
  insertLatex: (latex: string, offset?: number) => void
  loadFile: (file: File) => void
}

export class DragController {
  private mirror: MathfieldElement | null = null
  private disposed = false
  private dragging = false
  private previewRaf = 0
  private snapshotRaf = 0
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null
  private lastPreviewKey = ''
  private offset = -1
  private placeholderIndex = -1
  private applyFont = false
  private x = -1
  private y = -1
  private fontSize: number
  private displayStyle: boolean

  constructor(
    private readonly options: DragControllerOptions,
    initial: { fontSize: number; displayStyle: boolean },
  ) {
    this.fontSize = initial.fontSize
    this.displayStyle = initial.displayStyle
  }

  onDragOver(event: DragEvent): void {
    if (!this.hasPayload(event)) return
    event.preventDefault()
    this.setDragging(true)
    this.updatePreview(event)
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  onDragLeave(event: DragEvent): void {
    const related = event.relatedTarget
    if (!related || !this.options.getContainer()?.contains(related as Node)) {
      this.setDragging(false)
      this.hidePreview()
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault()
    const offset = this.offset
    const placeholderIndex = this.placeholderIndex
    const x = this.x
    const y = this.y
    this.setDragging(false)
    this.hidePreview()
    const dataTransfer = event.dataTransfer
    const types = dataTransfer?.types ? Array.from(dataTransfer.types) : []

    const file = dataTransfer?.files?.[0]
    if (file) {
      this.options.loadFile(file)
      return
    }

    const id =
      dataTransfer?.getData(DRAG_ELEMENT_MIME) ||
      (types.includes(DRAG_ELEMENT_MIME) ? draggedElementId.value : null)
    draggedElementId.value = null
    if (id) {
      const element = getElementById(id)
      if (element) {
        this.options.insertElement(element, offset, placeholderIndex, x, y)
        return
      }
    }
    const text = dataTransfer?.getData('text/plain')?.trim()
    if (text) this.options.insertLatex(text, offset)
  }

  setFontSize(px: number): void {
    this.fontSize = px
    if (this.mirror) this.mirror.style.fontSize = `${px}px`
  }

  setDisplayStyle(value: boolean): void {
    this.displayStyle = value
    if (this.mirror) this.mirror.defaultMode = value ? 'math' : 'inline-math'
  }

  dispose(): void {
    this.disposed = true
    this.setDragging(false)
    this.hidePreview()
    this.mirror?.remove()
    this.mirror = null
  }

  private hasPayload(event: DragEvent): boolean {
    const types = event.dataTransfer?.types
    const list = types ? Array.from(types) : []
    return Boolean(
      draggedElementId.value ||
        list.includes(DRAG_ELEMENT_MIME) ||
        list.includes('text/plain') ||
        list.includes('Files') ||
        (event.dataTransfer && event.dataTransfer.files.length > 0),
    )
  }

  private setDragging(value: boolean): void {
    this.dragging = value
    this.options.setDragging(value)
  }

  private async ensureMirror(): Promise<MathfieldElement | null> {
    if (this.mirror) return this.mirror
    try {
      await customElements.whenDefined('math-field')
    } catch {
      return null
    }
    if (this.disposed) return null
    const mirror = document.createElement('math-field') as MathfieldElement
    mirror.setAttribute('tabindex', '-1')
    mirror.setAttribute('aria-hidden', 'true')
    mirror.classList.add('workspace-mirror')
    mirror.readOnly = true
    mirror.mathVirtualKeyboardPolicy = 'manual'
    mirror.defaultMode = this.displayStyle ? 'math' : 'inline-math'
    Object.assign(mirror.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      visibility: 'hidden',
      pointerEvents: 'none',
      background: 'transparent',
      color: 'var(--text)',
      zIndex: '50',
      fontSize: `${this.fontSize}px`,
    })
    mirror.style.setProperty('--selection-background-color', 'transparent')
    mirror.style.setProperty('--contains-highlight-background-color', 'transparent')
    document.body.appendChild(mirror)
    ensureAccentPositioning(mirror)
    this.mirror = mirror
    return mirror
  }

  private updatePreview(event: DragEvent): void {
    const element = draggedElementId.value ? getElementById(draggedElementId.value) : undefined
    const mf = this.options.getMathfield()
    if (!element || !mf) {
      this.hidePreview()
      return
    }
    let offset = offsetFromPoint(mf, event.clientX, event.clientY)
    if (!Number.isInteger(offset) || offset < 0) {
      const rect = mf.getBoundingClientRect()
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      offset = inside ? mf.lastOffset : -1
    }
    this.offset = offset
    this.placeholderIndex = placeholderIndexAtPoint(mf, event.clientX, event.clientY)
    this.applyFont =
      isFontStyleElement(element.id) &&
      textGroupRangeAtPoint(mf, event.clientX, event.clientY) !== null
    this.x = event.clientX
    this.y = event.clientY
    const key = this.applyFont
      ? `${element.id}|${mf.value}|font:${this.offset}`
      : this.placeholderIndex >= 0
        ? `${element.id}|${mf.value}|placeholder:${this.placeholderIndex}`
        : `${element.id}|${mf.value}|${this.offset}`
    if (key === this.lastPreviewKey) return
    this.lastPreviewKey = key
    cancelAnimationFrame(this.previewRaf)
    this.previewRaf = requestAnimationFrame(async () => {
      await this.ensureMirror()
      if (this.dragging) this.renderPreview(element)
    })
  }

  private renderPreview(element: EquationElement): void {
    const mf = this.options.getMathfield()
    const mirror = this.mirror
    if (!mf || !mirror) return
    ensurePlaceholderSupport(mirror)
    const rect = mf.getBoundingClientRect()
    Object.assign(mirror.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })
    mirror.value = mf.value
    if (this.applyFont) {
      const style = FONT_STYLES[element.id]
      const range = textGroupRangeAtPoint(mf, this.x, this.y)
      if (style && range) mirror.applyStyle(style, { range })
      this.scheduleSnapshot(mirror)
      return
    }
    let positioned = false
    if (this.placeholderIndex >= 0) {
      positioned = selectPlaceholderAtPoint(mirror, this.x, this.y)
    }
    if (!positioned) mirror.position = this.offset >= 0 ? this.offset : mf.position
    const latex = withEmptyTextSentinel(element.latex)
    mirror.insert(addTextBoundaries(latex), {
      insertionMode: 'replaceSelection',
      selectionMode: 'item',
      format: 'latex',
      silenceNotifications: true,
    })
    const range = mirror.selection?.ranges?.[0]
    if (latex === element.latex && range && range[0] !== range[1]) {
      mirror.applyStyle({ color: PREVIEW_GREY }, { range })
    }
    this.scheduleSnapshot(mirror)
  }

  private scheduleSnapshot(mirror: MathfieldElement): void {
    const run = () => {
      if (this.dragging && !this.disposed) this.snapshot(mirror)
    }
    cancelAnimationFrame(this.snapshotRaf)
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer)
    this.snapshotRaf = requestAnimationFrame(run)
    this.snapshotTimer = setTimeout(run, 32)
  }

  private snapshot(mirror: MathfieldElement): void {
    const latex = mirror.shadowRoot?.querySelector('.ML__latex') as HTMLElement | null
    if (!latex) {
      this.options.setPreview(null, null, [])
      return
    }
    const mf = this.options.getMathfield()
    if (mf) mf.style.visibility = 'hidden'
    const box = latex.getBoundingClientRect()
    this.options.setPreview(
      `<span class="ML__container">${latex.outerHTML}</span>`,
      { left: box.left, top: box.top, width: box.width, height: box.height },
      collectTextHints(mirror),
    )
  }

  private hidePreview(): void {
    cancelAnimationFrame(this.previewRaf)
    cancelAnimationFrame(this.snapshotRaf)
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer)
      this.snapshotTimer = null
    }
    const mf = this.options.getMathfield()
    if (mf) mf.style.visibility = ''
    this.lastPreviewKey = ''
    this.offset = -1
    this.placeholderIndex = -1
    this.applyFont = false
    this.x = -1
    this.y = -1
    this.options.setPreview(null, null, [])
  }
}
