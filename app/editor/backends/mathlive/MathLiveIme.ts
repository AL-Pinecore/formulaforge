import type { MathfieldElement } from 'mathlive'
import { blockImeBeforeInput, blockImeEvent, hasNonAsciiText } from '~/utils/ime-block'

// Chromium composes the composition events across the shadow-DOM boundary, so
// the host-level capture handlers catch them and stop MathLive's internal
// keyboard-sink handler. WKWebView composes them too, but its IME commits the
// final text through a plain `insertText` `input` event that MathLive does not
// discard. Attach capture-phase listeners directly to MathLive's shadow root
// (an ancestor of the keyboard sink) so both the composition events and the
// committed IME text are blocked before they reach MathLive in every engine.
export function attachImeBlocker(mf: MathfieldElement): void {
  const root = mf.shadowRoot
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
