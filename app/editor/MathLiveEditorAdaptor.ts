import type { LatexSyntaxError, MathfieldElement } from 'mathlive'
import { restoreEmptyGroupLatex } from '~/utils/empty-group'
import { blockImeBeforeInput, blockImeEvent, hasNonAsciiText } from '~/utils/ime-block'
import { normalizePortableLatex } from '~/utils/latex-normalize'
import { ensureAccentPositioning } from '~/utils/mathfield-accent'
import { ensurePlaceholderSupport } from '~/utils/mathfield-placeholder'
import {
  addTextBoundaries,
  stripEmptyTextSentinel,
  stripTextBoundaries,
} from '~/utils/text-boundary'
import type {
  EditorAdaptor,
  EditorAdaptorConfig,
  EditorApplyStyleOptions,
  EditorElementInfo,
  EditorFontStyle,
  EditorInsertOptions,
  EditorMenuItem,
  EditorMirrorConfig,
  EditorPreviewResult,
  EditorSelection,
} from './EditorAdaptor'

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
  private fractionRaf = 0
  private fractionObserver: MutationObserver | null = null

  private readonly offsetCache = new WeakMap<
    MathfieldElement,
    { key: string; edges: OffsetEdge[] }
  >()

  constructor(element: HTMLElement) {
    this.mf = element as unknown as MathfieldElement
  }

  private readonly mf: MathfieldElement

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

  get menuItems(): readonly EditorMenuItem[] {
    return (this.mf.menuItems ?? []) as unknown as EditorMenuItem[]
  }

  set menuItems(items: readonly EditorMenuItem[]) {
    this.mf.menuItems = items as never
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

  executeCommand(command: string | string[]): boolean {
    return this.mf.executeCommand(command as Parameters<MathfieldElement['executeCommand']>[0])
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

  configure(config: EditorAdaptorConfig): void {
    this.fontSize = config.fontSize
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
    this.observeFractionRendering()
    this.attachImeBlocker()
  }

  ensureMathMode(): void {
    if (this.mf.value === '' && this.mf.mode === 'text') this.mf.mode = 'math'
  }

  loadPublicLatex(latex: string): void {
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

  readPublicLatex(): string {
    return normalizePortableLatex(
      stripEmptyTextSentinel(
        stripTextBoundaries(this.mf.getValue('latex-without-placeholders')).replace(
          /\\placeholder(?:\[[^\]]*\])?\{\}/g,
          '',
        ),
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
    cancelAnimationFrame(this.fractionRaf)
    this.fractionRaf = requestAnimationFrame(() => this.positionFractionRules())
  }

  private includePaintedRect(
    bounds: { top: number; bottom: number },
    rect: { top: number; bottom: number },
  ): void {
    bounds.top = Math.min(bounds.top, rect.top)
    bounds.bottom = Math.max(bounds.bottom, rect.bottom)
  }

  private paintedBounds(root: HTMLElement): { top: number; bottom: number } | null {
    const context = document.createElement('canvas').getContext('2d')
    if (!context) return null

    const bounds = { top: Infinity, bottom: -Infinity }
    for (const leaf of Array.from(root.querySelectorAll<HTMLElement>('span'))) {
      const text = leaf.children.length === 0 ? leaf.textContent : null
      if (!text || !text.trim() || leaf.classList.contains('ML__pstrut')) continue
      const style = getComputedStyle(leaf)
      const transparent = style.color.startsWith('rgba') && style.color.endsWith(', 0)')
      if (style.visibility === 'hidden' || Number(style.opacity) === 0 || transparent) continue
      const rect = leaf.getBoundingClientRect()
      context.font = style.font
      const metrics = context.measureText(text)
      const fontAscent = metrics.fontBoundingBoxAscent
      if (!Number.isFinite(fontAscent)) {
        this.includePaintedRect(bounds, rect)
        continue
      }
      const baseline = rect.top + fontAscent
      this.includePaintedRect(bounds, {
        top: baseline - metrics.actualBoundingBoxAscent,
        bottom: baseline + metrics.actualBoundingBoxDescent,
      })
    }

    for (const element of Array.from(
      root.querySelectorAll<HTMLElement>('.ML__frac-line, .ML__sqrt-line, .ML__rule, .ml-placeholder, svg'),
    )) {
      const rect = element.getBoundingClientRect()
      if (element.classList.contains('ML__frac-line')) {
        const after = getComputedStyle(element, '::after')
        const top = rect.top + (parseFloat(after.marginTop) || 0)
        this.includePaintedRect(bounds, { top, bottom: top + (parseFloat(after.minHeight) || rect.height) })
      } else {
        this.includePaintedRect(bounds, rect)
      }
    }

    return Number.isFinite(bounds.top) && Number.isFinite(bounds.bottom) ? bounds : null
  }

  private positionFractionRules(): void {
    const root = this.mf.shadowRoot
    if (!root || typeof root.querySelectorAll !== 'function') return
    const lines = Array.from(root.querySelectorAll<HTMLElement>('.ML__frac-line'))
    lines.sort((a, b) => {
      const depth = (element: Element) => {
        let result = 0
        for (let parent = element.parentElement; parent; parent = parent.parentElement) result++
        return result
      }
      return depth(b) - depth(a)
    })
    for (const lineEl of lines) {
      const lineRow = lineEl.parentElement
      const denominatorRow = lineRow?.previousElementSibling as HTMLElement | null
      const numeratorRow = lineRow?.nextElementSibling as HTMLElement | null
      if (!lineRow || !numeratorRow || !denominatorRow) continue
      const numerator = this.paintedBounds(numeratorRow)
      const denominator = this.paintedBounds(denominatorRow)
      if (!numerator || !denominator) continue
      const currentShift =
        parseFloat(lineRow.style.transform.match(/translateY\(([-\d.eE+]+)px\)/)?.[1] ?? '0') || 0
      const lineRect = lineEl.getBoundingClientRect()
      const after = getComputedStyle(lineEl, '::after')
      const lineTop = lineRect.top - currentShift + (parseFloat(after.marginTop) || 0)
      const lineBottom = lineTop + (parseFloat(after.minHeight) || lineRect.height)
      const shift = ((denominator.top - lineBottom) - (lineTop - numerator.bottom)) / 2
      const limit = (parseFloat(getComputedStyle(lineRow).fontSize) || this.fontSize) * 0.25
      const nextShift = Math.max(-limit, Math.min(limit, shift))
      if (Math.abs(nextShift - currentShift) > 0.01) {
        lineRow.style.transform = `translateY(${nextShift}px)`
      }
    }
  }

  private observeFractionRendering(): void {
    const shadow = this.mf.shadowRoot
    if (!shadow || this.fractionObserver || typeof ShadowRoot === 'undefined' || !(shadow instanceof ShadowRoot)) {
      return
    }
    this.fractionObserver = new MutationObserver(() => {
      this.positionFractionRules()
    })
    this.fractionObserver.observe(shadow, { childList: true, subtree: true })
  }

  // -- IME blocking workaround ---------------------------------------------

  private attachImeBlocker(): void {
    const root = this.mf.shadowRoot
    if (!root || typeof root.addEventListener !== 'function') return
    root.addEventListener('compositionstart', blockImeEvent, true)
    root.addEventListener('compositionupdate', blockImeEvent, true)
    root.addEventListener('compositionend', blockImeEvent, true)
    root.addEventListener('beforeinput', blockImeBeforeInput, true)
    root.addEventListener(
      'input',
      (event) => {
        if (hasNonAsciiText((event as InputEvent).data)) {
          blockImeEvent(event)
        }
      },
      true,
    )
  }

  dispose(): void {
    cancelAnimationFrame(this.fractionRaf)
    this.fractionObserver?.disconnect()
    this.fractionObserver = null
  }
}
