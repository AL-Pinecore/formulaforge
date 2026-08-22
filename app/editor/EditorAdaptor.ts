// The editing backend interface. Editor features depend on this type only;
// no MathLive (or any concrete engine) type may leak past it. The exchange
// data at the boundary is public LaTeX plus caret offsets; the backend's
// private DOM (shadow root, `.ML__*` classes) is never exposed.

export type EditorMode = 'math' | 'text' | 'latex' | 'inline-math'

export interface EditorRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface EditorElementInfo {
  latex?: string
  bounds?: EditorRect
  depth?: number
  mode?: string
  style?: Record<string, string>
}

export type EditorRange = [start: number, end: number]

// FormulaForge's own caret position, expressed as an offset into the public
// (editor) LaTeX string — never a backend model offset.
export interface CaretBookmark {
  latexOffset: number
}

export interface EditorSelection {
  ranges: EditorRange[]
  direction?: 'forward' | 'backward' | 'none'
}

export interface EditorInsertOptions {
  mode?: 'math' | 'text' | 'latex' | 'inline-math' | 'auto'
  format?: 'latex' | 'auto'
  insertionMode?: 'replaceSelection' | 'replaceAll' | 'insertBefore' | 'insertAfter'
  selectionMode?: 'placeholder' | 'after' | 'before' | 'item'
  silenceNotifications?: boolean
  focus?: boolean
  scrollIntoView?: boolean
}

export interface EditorFontStyle {
  color?: string
  backgroundColor?: string
  fontFamily?: 'none' | 'roman' | 'monospace' | 'sans-serif'
  fontShape?: 'auto' | 'n' | 'it' | 'sl' | 'sc' | ''
  fontSeries?: 'auto' | 'm' | 'b' | 'l' | ''
}

export interface EditorApplyStyleOptions {
  range?: EditorRange
  operation?: 'set' | 'toggle'
  silenceNotifications?: boolean
}

// Loose structural view of a context-menu item. Only the fields the editor
// features touch are typed; unknown backend fields pass through untouched.
export type EditorMatrixCommand =
  | 'addColumnBefore'
  | 'addColumnAfter'
  | 'addRowBefore'
  | 'addRowAfter'
  | 'removeColumn'
  | 'removeRow'

export interface ContextMenuHandlers {
  matrixVisible: () => boolean
  matrixSelect: (command: EditorMatrixCommand) => void
  unwrapLabel: () => string
  unwrapVisible: () => boolean
  unwrapSelect: () => void
}

export interface EditorPreviewBox {
  left: number
  top: number
  width: number
  height: number
}

export interface EditorPreviewResult {
  html: string
  box: EditorPreviewBox
}

export interface EditorMirrorConfig {
  fontSize: number
  displayStyle: boolean
}

export interface EditorAdaptorConfig {
  placeholder: string
  maxMatrixCols: number
  fontSize: number
  displayStyle: boolean
  // Enable the fraction-rule rendering correction (defaults to true).
  fractionFix?: boolean
}

export interface EditorAdaptor {
  // The underlying host element, restricted to generic DOM APIs (classList,
  // style, getBoundingClientRect, event listeners). Backend-private DOM is not
  // reachable through the typed surface.
  readonly element: HTMLElement

  value: string
  position: number
  readonly lastOffset: number
  selection: EditorSelection | null
  readonly selectionIsCollapsed: boolean
  mode: EditorMode

  canUndo(): boolean
  resetUndo(): void
  focus(): void
  focusKeyboard(): void
  blur(): void
  hasFocus(): boolean

  getValue(start?: number, end?: number): string
  setValue(latex: string, options?: EditorInsertOptions): void
  insert(latex: string, options?: EditorInsertOptions): void
  applyStyle(style: EditorFontStyle, options?: EditorApplyStyleOptions): void
  moveToPlaceholder(index: number): void
  rejectCompletion(): void
  executeMatrixCommand(command: EditorMatrixCommand): void
  configureContextMenu(handlers: ContextMenuHandlers): void
  getElementInfo(offset: number): EditorElementInfo | undefined
  getOffsetFromPoint(x: number, y: number): number
  getCaret(): CaretBookmark
  setCaret(caret: CaretBookmark): void

  // Backend setup + editor-LaTeX exchange boundary.
  configure(config: EditorAdaptorConfig): void
  ensureMathMode(): void
  loadEditorLatex(latex: string): void
  readEditorLatex(): string
  readErrors(): string[]
  setFontSize(px: number): void
  setDisplayStyle(display: boolean): void

  // Semantic geometry (backend-internal placeholder/DOM handling).
  offsetFromPoint(x: number, y: number): number
  placeholderIndexAtPoint(x: number, y: number): number
  selectPlaceholderAtPoint(x: number, y: number): boolean
  enterPlaceholder(offset: number): void

  // Offscreen insertion preview (drag-and-drop).
  createMirror(config: EditorMirrorConfig): Promise<EditorAdaptor | null>
  readPreviewHtml(): EditorPreviewResult | null

  // Autocomplete popover interception (backend-specific DOM).
  suggestionCommandAt(target: EventTarget | null): string | null

  // Backend render workarounds.
  scheduleFractionRules(): void
  dispose(): void
}
