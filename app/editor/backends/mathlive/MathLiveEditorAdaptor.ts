import type { LatexSyntaxError, MathfieldElement } from 'mathlive'
import { restoreEmptyGroupLatex } from '~/utils/empty-group'
import {
  addTextBoundaries,
  stripEmptyTextSentinel,
  stripTextBoundaries,
} from '~/utils/text-boundary'
import type {
  CaretBookmark,
  ContextMenuHandlers,
  EditorAdaptor,
  EditorAdaptorConfig,
  EditorApplyStyleOptions,
  EditorElementInfo,
  EditorFontStyle,
  EditorInsertOptions,
  EditorMatrixCommand,
  EditorMirrorConfig,
  EditorPreviewResult,
  EditorSelection,
} from '../../EditorAdaptor'
import { modelOffsetToPublicOffset, publicStringOffsetToModel } from '../../EditorLatex'
import { ensureAccentPositioning } from './MathLiveAccentFix'
import { MathLiveFractionFix } from './MathLiveFractionFix'
import { attachImeBlocker } from './MathLiveIme'
import { ensurePlaceholderSupport } from './MathLivePlaceholderFix'

const PLACEHOLDER_GLYPH = '▢'
const PLACEHOLDER_CLICK_PAD = 10

interface OffsetEdge {
  x: number
  offset: number
  depth: number
}

function formatLatexErrors(errors: readonly LatexSyntaxError[]): string[] {
  return errors.map((error) => {
    const code = error.code.replace(/-/g, ' ')
    const near = error.latex ? ` near '${error.latex}'` : ''
    return `LaTeX ${code}${near}`
  })
}

// The single backend implementation today: a MathLive `<math-field>`. Every
// MathLive-specific behavior — the DOM rendering corrections and input
// workarounds — lives here, so no other editor code needs to know MathLive.
export class MathLiveEditorAdaptor implements EditorAdaptor {
  private fontSize = 24

  private readonly offsetCache = new WeakMap<
    MathfieldElement,
    { key: string; edges: OffsetEdge[] }
  >()

  constructor(element: HTMLElement) {
    this.mf = element as unknown as MathfieldElement
    this.fraction = new MathLiveFractionFix(this.mf, () => this.fontSize)
  }

  private readonly mf: MathfieldElement
  private readonly fraction: MathLiveFractionFix
  private fractionFix = true

  get element(): HTMLElement {
    return this.mf
  }

  get value(): string {
    return this.mf.value
  }

  set value(value: string) {
    this.mf.value = value
  }

  get position(): number {
    return this.mf.position
  }

  set position(offset: number) {
    this.mf.position = offset
  }

  get lastOffset(): number {
    return this.mf.lastOffset
  }

  get selection(): EditorSelection | null {
    return this.mf.selection as EditorSelection | null
  }

  set selection(sel: EditorSelection | null) {
    if (sel) this.mf.selection = sel as never
  }

  get selectionIsCollapsed(): boolean {
    return this.mf.selectionIsCollapsed
  }

  get mode(): 'math' | 'text' | 'latex' | 'inline-math' {
    return this.mf.mode
  }

  set mode(value: 'math' | 'text' | 'latex' | 'inline-math') {
    this.mf.mode = value as 'math' | 'text' | 'latex'
  }

  canUndo(): boolean {
    return this.mf.canUndo()
  }

  resetUndo(): void {
    this.mf.resetUndo()
  }

  focus(): void {
    this.mf.focus()
  }

  focusKeyboard(): void {
    if (document.activeElement === this.mf) return
    this.mf.focus()
    if (document.activeElement !== this.mf) {
      this.mf.shadowRoot?.querySelector<HTMLElement>('.ML__keyboard-sink')?.focus()
    }
  }

  blur(): void {
    this.mf.blur()
  }

  hasFocus(): boolean {
    return this.mf.hasFocus()
  }

  getValue(start?: number, end?: number): string {
    return start != null && end != null ? this.mf.getValue(start, end) : this.mf.getValue()
  }

  setValue(latex: string, options?: EditorInsertOptions): void {
    this.mf.setValue(latex, options as Parameters<MathfieldElement['setValue']>[1])
  }

  insert(latex: string, options?: EditorInsertOptions): void {
    this.mf.insert(latex, options as Parameters<MathfieldElement['insert']>[1])
  }

  applyStyle(style: EditorFontStyle, options?: EditorApplyStyleOptions): void {
    this.mf.applyStyle(style, options as Parameters<MathfieldElement['applyStyle']>[1])
  }

  moveToPlaceholder(index: number): void {
    this.mf.position = 0
    for (let i = 0; i <= index && i < 64; i++) {
      this.mf.executeCommand('moveToNextPlaceholder')
    }
  }

  rejectCompletion(): void {
    this.mf.executeCommand(['complete', 'reject'])
  }

  executeMatrixCommand(command: EditorMatrixCommand): void {
    this.mf.executeCommand(command)
  }

  configureContextMenu(handlers: ContextMenuHandlers): void {
    const MATRIX_MENU_COMMANDS: Record<string, EditorMatrixCommand> = {
      'add-row-above': 'addRowBefore',
      'add-row-below': 'addRowAfter',
      'add-column-before': 'addColumnBefore',
      'add-column-after': 'addColumnAfter',
      'delete-row': 'removeRow',
      'delete-column': 'removeColumn',
    }
    this.mf.menuItems = [
      ...(this.mf.menuItems ?? []).map((item) => {
        const id = 'id' in item && item.id ? item.id : undefined
        const command = id ? MATRIX_MENU_COMMANDS[id] : undefined
        if (!command) return item
        const rowCommand =
          command === 'addRowBefore' || command === 'addRowAfter' || command === 'removeRow'
        return {
          ...item,
          ...(rowCommand ? { visible: () => handlers.matrixVisible() } : {}),
          onMenuSelect: () => handlers.matrixSelect(command),
        }
      }),
      { type: 'divider' },
      {
        id: 'unwrap-element',
        label: handlers.unwrapLabel(),
        visible: () => handlers.unwrapVisible(),
        onMenuSelect: () => handlers.unwrapSelect(),
      },
    ] as never
  }

  getElementInfo(offset: number): EditorElementInfo | undefined {
    const info = this.mf.getElementInfo(offset)
    if (!info) return undefined
    const bounds = info.bounds
      ? {
          left: info.bounds.left,
          top: info.bounds.top,
          right: info.bounds.right,
          bottom: info.bounds.bottom,
          width: info.bounds.width,
          height: info.bounds.height,
        }
      : undefined
    return {
      latex: info.latex,
      bounds,
      depth: info.depth,
      mode: info.mode,
      style: info.style as Record<string, string> | undefined,
    }
  }

  getOffsetFromPoint(x: number, y: number): number {
    return this.mf.getOffsetFromPoint(x, y)
  }

  getCaret(): CaretBookmark {
    return { latexOffset: modelOffsetToPublicOffset(this, this.mf.position) }
  }

  setCaret(caret: CaretBookmark): void {
    this.mf.position = publicStringOffsetToModel(this, caret.latexOffset)
  }

  configure(config: EditorAdaptorConfig): void {
    this.fontSize = config.fontSize
    this.fractionFix = config.fractionFix ?? true
    this.mf.placeholder = config.placeholder
    this.mf.mathVirtualKeyboardPolicy = 'manual'
    this.mf.maxMatrixCols = config.maxMatrixCols
    this.mf.defaultMode = config.displayStyle ? 'math' : 'inline-math'
    this.mf.style.fontSize = `${config.fontSize}px`
    const normalized = addTextBoundaries(this.mf.value)
    if (normalized !== this.mf.value) {
      this.mf.setValue(normalized, { mode: 'math', silenceNotifications: true })
    }
    ensurePlaceholderSupport(this.mf)
    ensureAccentPositioning(this.mf)
    if (this.fractionFix) this.fraction.observe()
    attachImeBlocker(this.mf)
  }

  ensureMathMode(): void {
    if (this.mf.value === '' && this.mf.mode === 'text') this.mf.mode = 'math'
  }

  loadEditorLatex(latex: string): void {
    const internalValue = addTextBoundaries(latex)
    if (this.mf.value !== internalValue) {
      this.mf.setValue(internalValue, { mode: 'math', silenceNotifications: true })
    }
    const restored = restoreEmptyGroupLatex(this.mf.value)
    if (restored !== null && restored !== this.mf.value) {
      this.mf.setValue(addTextBoundaries(restored), { mode: 'math', silenceNotifications: true })
    }
    this.ensureMathMode()
  }

  // The canonical editor LaTeX: backend-specific command names (`\exponentialE`,
  // `\longleftarrow`, …) are preserved so FormulaForge keeps its own formula.
  // Portable normalization is a separate concern applied at the export boundary.
  readEditorLatex(): string {
    return stripEmptyTextSentinel(
      stripTextBoundaries(this.mf.getValue('latex-without-placeholders')).replace(
        /\\placeholder(?:\[[^\]]*\])?\{\}/g,
        '',
      ),
    )
  }

  readErrors(): string[] {
    return formatLatexErrors(this.mf.errors ?? [])
  }

  setFontSize(px: number): void {
    this.fontSize = px
    this.mf.style.fontSize = `${px}px`
  }

  setDisplayStyle(display: boolean): void {
    this.mf.defaultMode = display ? 'math' : 'inline-math'
    // The option setter alone does not re-render existing content; re-parse to
    // apply the new mathstyle while preserving the caret position.
    const position = this.mf.position
    this.mf.setValue(this.mf.value, { mode: 'math', silenceNotifications: true })
    this.mf.position = Math.min(position, this.mf.lastOffset)
  }

  // -- Semantic geometry ----------------------------------------------------

  offsetFromPoint(x: number, y: number): number {
    const root = this.mf.shadowRoot
    const latex = root?.querySelector('.ML__latex') as HTMLElement | null
    if (!root || !latex) return -1
    const rect = latex.getBoundingClientRect()
    if (x < rect.left - 4 || x > rect.right + 4 || y < rect.top - 8 || y > rect.bottom + 8) {
      return -1
    }
    if (this.mf.lastOffset <= 0) return 0
    const edges = this.buildOffsetEdges(rect.left, rect.right)
    let best = edges[0]!
    let bestDistance = Infinity
    for (const edge of edges) {
      const distance = Math.abs(edge.x - x)
      if (distance < bestDistance || (distance === bestDistance && edge.depth > best.depth)) {
        bestDistance = distance
        best = edge
      }
    }
    return Math.max(0, Math.min(this.mf.lastOffset, best.offset))
  }

  placeholderIndexAtPoint(x: number, y: number): number {
    const root = this.mf.shadowRoot
    if (!root) return -1
    let index = 0
    for (const node of root.querySelectorAll('*')) {
      if (node.textContent?.trim() !== PLACEHOLDER_GLYPH) continue
      const rect = node.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        if (
          x >= rect.left - PLACEHOLDER_CLICK_PAD &&
          x <= rect.right + PLACEHOLDER_CLICK_PAD &&
          y >= rect.top - PLACEHOLDER_CLICK_PAD &&
          y <= rect.bottom + PLACEHOLDER_CLICK_PAD
        ) return index
        index++
      }
    }
    return -1
  }

  selectPlaceholderAtPoint(x: number, y: number): boolean {
    this.mf.position = 0
    let previousStart = -1
    for (let i = 0; i < 64; i++) {
      this.mf.executeCommand('moveToNextPlaceholder')
      const start = this.mf.selection?.ranges?.[0]?.[0]
      if (typeof start !== 'number' || start === previousStart) return false
      previousStart = start
      if (this.selectedPlaceholderAtPoint(x, y)) return true
    }
    return false
  }

  enterPlaceholder(offset: number): void {
    if (!this.mf.selectionIsCollapsed) return
    this.mf.position = offset
    this.mf.executeCommand(
      offset >= this.mf.lastOffset ? 'moveToPreviousPlaceholder' : 'moveToNextPlaceholder',
    )
  }

  private buildOffsetEdges(left: number, right: number): OffsetEdge[] {
    const key = `${this.mf.value}|${Math.round(right - left)}`
    const cached = this.offsetCache.get(this.mf)
    if (cached?.key === key) return cached.edges
    const edges: OffsetEdge[] = [
      { x: left, offset: 0, depth: 0 },
      { x: right, offset: this.mf.lastOffset, depth: 0 },
    ]
    for (let offset = 1; offset < this.mf.lastOffset; offset++) {
      const info = this.mf.getElementInfo(offset)
      const bounds = info?.bounds
      if (!bounds || bounds.width < 0.5) continue
      const depth = info?.depth ?? 0
      edges.push({ x: bounds.left, offset: offset - 1, depth })
      edges.push({ x: bounds.right, offset, depth })
    }
    edges.sort((a, b) => a.x - b.x)
    this.offsetCache.set(this.mf, { key, edges })
    return edges
  }

  private selectedPlaceholderAtPoint(x: number, y: number): boolean {
    const root = this.mf.shadowRoot
    if (!root) return false
    for (const node of root.querySelectorAll('.ML__selected')) {
      if (node.textContent?.trim() !== PLACEHOLDER_GLYPH) continue
      const rect = node.getBoundingClientRect()
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        x >= rect.left - PLACEHOLDER_CLICK_PAD &&
        x <= rect.right + PLACEHOLDER_CLICK_PAD &&
        y >= rect.top - PLACEHOLDER_CLICK_PAD &&
        y <= rect.bottom + PLACEHOLDER_CLICK_PAD
      ) return true
    }
    return false
  }

  // -- Offscreen insertion preview -----------------------------------------

  async createMirror(config: EditorMirrorConfig): Promise<EditorAdaptor | null> {
    try {
      await customElements.whenDefined('math-field')
    } catch {
      return null
    }
    const mirror = document.createElement('math-field') as MathfieldElement
    mirror.setAttribute('tabindex', '-1')
    mirror.setAttribute('aria-hidden', 'true')
    mirror.classList.add('workspace-mirror')
    mirror.readOnly = true
    mirror.mathVirtualKeyboardPolicy = 'manual'
    mirror.defaultMode = config.displayStyle ? 'math' : 'inline-math'
    Object.assign(mirror.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      visibility: 'hidden',
      pointerEvents: 'none',
      background: 'transparent',
      color: 'var(--text)',
      zIndex: '50',
      fontSize: `${config.fontSize}px`,
    })
    mirror.style.setProperty('--selection-background-color', 'transparent')
    mirror.style.setProperty('--contains-highlight-background-color', 'transparent')
    document.body.appendChild(mirror)
    ensureAccentPositioning(mirror)
    ensurePlaceholderSupport(mirror)
    return new MathLiveEditorAdaptor(mirror)
  }

  readPreviewHtml(): EditorPreviewResult | null {
    const latex = this.mf.shadowRoot?.querySelector('.ML__latex') as HTMLElement | null
    if (!latex) return null
    const box = latex.getBoundingClientRect()
    return {
      html: `<span class="ML__container">${latex.outerHTML}</span>`,
      box: { left: box.left, top: box.top, width: box.width, height: box.height },
    }
  }

  suggestionCommandAt(target: EventTarget | null): string | null {
    const item = (target as Element | null)?.closest<HTMLElement>(
      '#mathlive-suggestion-popover [data-command]',
    )
    return item?.dataset.command?.match(/^\\([a-zA-Z]+)/)?.[1] ?? null
  }

  // -- Fraction rule rendering workaround ----------------------------------

  scheduleFractionRules(): void {
    if (this.fractionFix) this.fraction.schedule()
  }

  dispose(): void {
    this.fraction.dispose()
  }
}
