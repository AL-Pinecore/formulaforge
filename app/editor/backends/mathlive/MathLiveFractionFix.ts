import type { MathfieldElement } from 'mathlive'

// MathLive's public bounds include invisible font struts. Measure the actual
// painted glyph boxes, then place each fraction rule midway between them.
export class MathLiveFractionFix {
  private raf = 0
  private observer: MutationObserver | null = null

  constructor(
    private readonly mf: MathfieldElement,
    private readonly fontSize: () => number,
  ) {}

  schedule(): void {
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(() => this.position())
  }

  observe(): void {
    const shadow = this.mf.shadowRoot
    if (
      !shadow ||
      this.observer ||
      typeof ShadowRoot === 'undefined' ||
      !(shadow instanceof ShadowRoot)
    ) {
      return
    }
    this.observer = new MutationObserver(() => {
      // Mutation observers run before the browser's next paint. Correct newly
      // rendered fraction rows here so their unpositioned state is never shown.
      this.position()
    })
    this.observer.observe(shadow, { childList: true, subtree: true })
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    this.observer?.disconnect()
    this.observer = null
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

  private position(): void {
    const root = this.mf.shadowRoot
    if (!root || typeof root.querySelectorAll !== 'function') return
    const lines = Array.from(root.querySelectorAll<HTMLElement>('.ML__frac-line'))
    // Process inner rules first so their painted position is included when an
    // enclosing fraction measures a nested numerator or denominator.
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
      const limit = (parseFloat(getComputedStyle(lineRow).fontSize) || this.fontSize()) * 0.25
      const nextShift = Math.max(-limit, Math.min(limit, shift))
      if (Math.abs(nextShift - currentShift) > 0.01) {
        lineRow.style.transform = `translateY(${nextShift}px)`
      }
    }
  }
}
