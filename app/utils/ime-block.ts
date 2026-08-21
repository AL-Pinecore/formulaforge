// FormulaForge's English-only math input policy: composition (IME) text is
// blocked at the host element and, for the backend, at its shadow root. This
// logic is backend-agnostic; the MathLive adaptor reuses it for the shadow
// root, which WKWebView composes across.

const NON_ASCII_RE = /[^\x00-\x7F]/

export function hasNonAsciiText(data: string | null | undefined): boolean {
  return typeof data === 'string' && data.length > 0 && NON_ASCII_RE.test(data)
}

export function blockImeEvent(event: Event): void {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}

export function blockImeBeforeInput(event: Event): void {
  const inputEvent = event as InputEvent
  if (inputEvent.inputType === 'insertCompositionText' || hasNonAsciiText(inputEvent.data)) {
    blockImeEvent(event)
  }
}
