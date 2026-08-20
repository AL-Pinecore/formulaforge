import type { MathfieldElement } from 'mathlive'

// MathLive centers fixed-width accents (`\hat`, `\bar`, `\vec`, `\tilde`,
// `\dot`, `\ddot`, ...) over a single character using a fixed horizontal
// offset, so over multi-character content the accent drifts to the right of the
// content's center (the accent glyph is anchored at the content's center rather
// than centered over it). The preview/export (MathJax) renders these correctly,
// so we correct the editor's `ML__accent-body` horizontally after each render.
//
// `\vec` renders as a zero-width combining character. Chromium paints its
// glyph to the left of the anchor while WebKit paints it to the right, so its
// visual bounds must come from canvas text metrics rather than the zero-width
// DOM box.
//
// `\widehat`/`\widetilde` render as a stretchy glyph. MathLive natively sizes
// the container to only half the content width, which makes it select the
// narrow single-character glyph variant and anchor it at the middle. We fix the
// width/centering, upgrade the glyph to the wide variant so the accent spans its
// content, and cap it at the font's largest size — matching how MathJax sizes
// the S7 wide-accent glyph (about 1.9em) and centers it over the content.

const fixed = new WeakMap<ShadowRoot, MutationObserver>()

// Fallback for browsers without painted text bounds in TextMetrics.
const COMBINING_ARROW_HALF_EM = 0.26

// WebKit keeps TeX's italic skew after the arrow glyph itself is centered.
// Calibrated in Safari; macOS Tauri uses the same WebKit renderer.
const WEBKIT_VEC_SKEW_EM = 0.21

// The narrow wide-accent glyph is ~1.06em wide; beyond that, the wide variant
// (with a flatter shape) must be used instead of stretching the narrow glyph.
const NARROW_MAX_EM = 1.06

// `\widehat`/`\widetilde` cap at the font's largest size variant (MathJax's S7,
// ~1.9em) and are centered over the content.
const WIDE_ACCENT_CAP_EM = 1.9

interface WideGlyph {
  viewBox: string
  height: string
  path: string
}

// KaTeX font glyphs used by MathLive (from mathlive/fonts). The wide variants
// have a flatter slope so they look correct when spanning multiple characters.
const WIDE_HAT: WideGlyph = {
  viewBox: '0 0 2364 300',
  height: '0.3em',
  path:
    'M1181 0h2l1171 176c6 0 10 5 10 11l-2 23c-1 6-5 10-11 10h-1L1182 67 15 220h-1c-6 0-10-4-11-10l-2-23c-1-6 4-11 10-11z',
}

const WIDE_TILDE: WideGlyph = {
  viewBox: '0 0 2339 306',
  height: '0.306em',
  path:
    'M786 59C457 59 32 175.242 13 175.242c-6 0-10-3.457-11-10.37L.15 138c-1-7 3-12 10-13l19.2-6.4C378.4 40.7 634.3 0 804.3 0c337 0 411.8 157 746.8 157 328 0 754-112 773-112 5 0 10 3 11 9l1 14.075c1 8.066-.697 16.595-6.697 17.492l-21.052 7.31c-367.9 98.146-609.15 122.696-778.15 122.696 -338 0-409-156.573-744-156.573z',
}

function paintedTextCenter(element: HTMLElement): number | null {
  if (!element.textContent) return null
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return null
  context.font = getComputedStyle(element).font
  const metrics = context.measureText(element.textContent)
  if (!metrics.actualBoundingBoxLeft && !metrics.actualBoundingBoxRight) return null
  return element.getBoundingClientRect().left
    + (metrics.actualBoundingBoxRight - metrics.actualBoundingBoxLeft) / 2
}

function centerAccentBodies(root: ParentNode): void {
  if (typeof (root as unknown as { querySelectorAll?: unknown }).querySelectorAll !== 'function') {
    return
  }
  const bodies = root.querySelectorAll('.ML__accent-body')
  // Measure from the untransformed layout, then re-center each glyph.
  for (const node of bodies) {
    ;(node as HTMLElement).style.transform = ''
  }
  for (const node of bodies) {
    const body = node as HTMLElement
    const vlist = body.closest('.ML__vlist') as HTMLElement | null
    if (!vlist) {
      continue
    }
    const bodyRect = body.getBoundingClientRect()
    const vlistRect = vlist.getBoundingClientRect()
    if (vlistRect.width < 1) {
      continue
    }
    let targetCenter = (vlistRect.left + vlistRect.right) / 2
    let visualCenter: number
    if (body.classList.contains('ML__accent-combining-char')) {
      const style = getComputedStyle(body)
      const fontSize = parseFloat(style.fontSize) || 0
      visualCenter = paintedTextCenter(body) ?? bodyRect.left - COMBINING_ARROW_HALF_EM * fontSize
      if (navigator.userAgent.includes('AppleWebKit') && !navigator.userAgent.includes('Chrome')) {
        targetCenter -= WEBKIT_VEC_SKEW_EM * fontSize
      }
    } else {
      if (bodyRect.width < 1) {
        continue
      }
      visualCenter = (bodyRect.left + bodyRect.right) / 2
    }
    const correction = targetCenter - visualCenter
    if (Math.abs(correction) < 0.5) {
      continue
    }
    body.style.transform = `translateX(${correction.toFixed(2)}px)`
  }
}

function stretchWideAccents(root: ParentNode): void {
  if (typeof (root as unknown as { querySelectorAll?: unknown }).querySelectorAll !== 'function') {
    return
  }
  for (const node of root.querySelectorAll('.ML__stretchy')) {
    const stretchy = node as HTMLElement
    const vlist = stretchy.closest('.ML__vlist') as HTMLElement | null
    const center = stretchy.closest('.ML__center') as HTMLElement | null
    if (!vlist || !center) {
      continue
    }
    const contentWidth = vlist.getBoundingClientRect().width
    if (contentWidth < 1) {
      continue
    }
    const fontSize = parseFloat(getComputedStyle(stretchy).fontSize) || 16
    const contentEm = contentWidth / fontSize

    // Upgrade the narrow single-character glyph to the wide variant once the
    // content is wider than one character, so the accent keeps its shape instead
    // of flattening the narrow glyph's slopes.
    const svg = stretchy.querySelector('svg')
    const path = svg?.querySelector('path')
    if (svg && path) {
      const viewBox = svg.getAttribute('viewBox') ?? ''
      const isHatNarrow = viewBox === '0 0 1062 239'
      const isTildeNarrow = viewBox === '0 0 600 260' || viewBox === '0 0 1033 286'
      if (contentEm > NARROW_MAX_EM && (isHatNarrow || isTildeNarrow)) {
        const wide = isHatNarrow ? WIDE_HAT : WIDE_TILDE
        svg.setAttribute('viewBox', wide.viewBox)
        svg.setAttribute('height', wide.height)
        path.setAttribute('d', wide.path)
        stretchy.style.height = wide.height
      }
    }

    // Span the content, capped at the font's largest size and centered.
    const width = Math.min(contentWidth, WIDE_ACCENT_CAP_EM * fontSize)
    stretchy.style.width = `${width}px`
    center.style.marginLeft = `${(contentWidth - width) / 2}px`
  }
}

export function correctAccentPositioning(root: ParentNode): void {
  centerAccentBodies(root)
  stretchWideAccents(root)
}

function schedule(shadow: ShadowRoot): void {
  // Correct synchronously (as a microtask after MathLive's DOM mutation, before
  // the next paint) so the accent never appears at its un-centered position.
  correctAccentPositioning(shadow)
}

/**
 * Correct the horizontal position and extent of accent glyphs in a MathLive
 * field so they stay centered over (and, for wide accents, spanning) their
 * content. Idempotent: one observer per shadow root re-corrects after render.
 */
export function ensureAccentPositioning(mf: MathfieldElement, attempts = 20): void {
  const shadow = mf.shadowRoot
  if (!shadow) {
    if (attempts > 0) {
      requestAnimationFrame(() => ensureAccentPositioning(mf, attempts - 1))
    }
    return
  }
  if (typeof shadow.appendChild !== 'function' || typeof shadow.querySelectorAll !== 'function') {
    return
  }
  schedule(shadow)
  if (fixed.has(shadow)) {
    return
  }
  const observer = new MutationObserver(() => schedule(shadow))
  observer.observe(shadow, { childList: true, subtree: true })
  fixed.set(shadow, observer)
}
