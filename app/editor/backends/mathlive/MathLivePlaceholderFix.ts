import type { MathfieldElement } from 'mathlive'

// MathLive renders \placeholder{} (and empty groups) as a plain "▢" glyph with
// no stable, unique class, so it cannot be styled from the outside. To make the
// placeholder look like an editable rectangular input, we inject a style into
// each field's shadow root and re-annotate the placeholder glyphs with a class
// whenever MathLive re-renders its DOM.
const PLACEHOLDER_GLYPH = '▢'
const PLACEHOLDER_CLASS = 'ml-placeholder'

const STYLE_TEXT = `
@keyframes ml-placeholder-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
.${PLACEHOLDER_CLASS} {
  color: transparent !important;
  background-image: linear-gradient(var(--placeholder-bg, #e5e5e5), var(--placeholder-bg, #e5e5e5));
  background-repeat: no-repeat;
  background-position: center;
  background-size: calc(100% - 2px) 0.76em;
}
:host(.placeholder-selected) .${PLACEHOLDER_CLASS}.ML__selected {
  background-image: linear-gradient(var(--caret-color, #2563eb), var(--caret-color, #2563eb));
  background-repeat: no-repeat;
  background-position: center;
  background-size: 2px 0.76em;
  animation: ml-placeholder-blink 1.05s step-end infinite;
}
:host(.placeholder-selected) .ML__content .ML__selection {
  background: transparent !important;
}
:host(.empty-text-caret) .ML__caret::after,
:host(.empty-text-caret) .ML__text-caret::after,
:host(.empty-text-caret) .ML__latex-caret::after {
  visibility: hidden !important;
}
:host(.caret-in-text) .ML__contains-highlight {
  background: transparent !important;
}
`

const injected = new WeakSet<ShadowRoot>()
const observers = new WeakMap<ShadowRoot, MutationObserver>()

function annotate(shadow: ShadowRoot): void {
  for (const node of shadow.querySelectorAll('*')) {
    const element = node as HTMLElement
    if (element.textContent?.trim() !== PLACEHOLDER_GLYPH) {
      continue
    }
    // Only the innermost glyph span (no element children) is the placeholder
    // itself; ancestors also match the text so they must be skipped.
    if (element.querySelector('*')) {
      continue
    }
    element.classList.add(PLACEHOLDER_CLASS)
  }
}

function ensureObserver(shadow: ShadowRoot): void {
  if (observers.has(shadow)) {
    return
  }
  const observer = new MutationObserver(() => annotate(shadow))
  observer.observe(shadow, { childList: true, subtree: true })
  observers.set(shadow, observer)
}

/**
 * Make placeholders in a MathLive field render as a styled box. Idempotent: the
 * stylesheet is injected once per shadow root and the placeholder glyphs are
 * re-annotated after each render via a MutationObserver.
 */
export function ensurePlaceholderSupport(mf: MathfieldElement, attempts = 20): void {
  const shadow = mf.shadowRoot
  if (!shadow) {
    if (attempts > 0) {
      requestAnimationFrame(() => ensurePlaceholderSupport(mf, attempts - 1))
    }
    return
  }
  // Skip non-DOM shadow roots (e.g. test fakes) that lack DOM APIs.
  if (typeof shadow.appendChild !== 'function' || typeof shadow.querySelectorAll !== 'function') {
    return
  }
  if (!injected.has(shadow)) {
    const style = document.createElement('style')
    style.setAttribute('data-ml-placeholder', '')
    style.textContent = STYLE_TEXT
    shadow.appendChild(style)
    injected.add(shadow)
  }
  annotate(shadow)
  ensureObserver(shadow)
}
