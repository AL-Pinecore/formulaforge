<script setup lang="ts">
import type { MathfieldElement } from 'mathlive'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getElementByCommand } from '~/data/equation-elements'
import { restoreEmptyGroupLatex } from '~/utils/empty-group'
import { isAccentConstructLatex } from '~/utils/accent'
import { isFontStyleElement } from '~/utils/font-styles'
import { ensurePlaceholderSupport } from '~/utils/mathfield-placeholder'
import { ensureAccentPositioning } from '~/utils/mathfield-accent'
import { removeElementAtPlaceholder } from '~/utils/remove-empty-element'
import { normalizePortableLatex } from '~/utils/latex-normalize'
import { DISABLED_LATEX_AUTOCOMPLETE_COMMANDS } from '~/utils/latex-autocomplete'
import { matrixCommandsForKey, type MatrixCommand } from '~/utils/matrix'
import { unwrapCommandLatex } from '~/utils/unwrap-element'
import {
  addTextBoundaries,
  isEmptyTextLatex,
  stripEmptyTextSentinel,
  stripTextBoundaries,
  withEmptyTextSentinel,
} from '~/utils/text-boundary'
import type { EquationElement } from '~/types/equation'
import { useI18n } from '~/composables/useI18n'
import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from '~/composables/useEquationExport'
import { EditorHistory } from '~/editor/EditorHistory'
import { DragController, type DragPreviewBox } from '~/editor/DragController'
import {
  disableNativeHistory,
  ensureMathMode,
  firstElementRangeAfter,
  formatLatexErrors,
  internalModel,
  typedCommandName,
  type InternalAtom,
} from '~/editor/MathLiveAdapter'
import {
  enterPlaceholder,
  isSinglePlaceholderSelection,
  placeholderIndexAtPoint,
  selectPlaceholderAtPoint,
} from '~/editor/SelectionController'
import {
  matrixAtPoint,
  matrixContextAtCaret,
  matrixOffsetAtPoint,
} from '~/editor/MatrixController'
import {
  applyFontStyle,
  clampOffsetOutsideText,
  collectTextHints,
  emptyTextGroupAtPoint,
  emptyTextHintBox,
  handleEmptyTextNavigation,
  handleTextDeletion,
  handleTextInput,
  normalizePublicLatex,
  publicStringOffsetToModel,
  relocateCaretAcrossBoundaries,
  snapCaretIntoEmptyText,
  textGroupAtCaret,
  textGroupNearPosition,
  type TextHint,
} from '~/editor/TextController'

const props = withDefaults(defineProps<{ fontSize: number; displayStyle?: boolean }>(), {
  displayStyle: true,
})

const emit = defineEmits<{
  'latex-change': [value: string, errors: string[]]
  'undo-state': [canUndo: boolean, canRedo: boolean]
  toast: [message: string, kind: 'success' | 'error']
}>()

const { t } = useI18n()

const PLACEHOLDER_CLICK_PAD = 10
const TEXT_FILE_EXTENSIONS = ['tex', 'latex', 'txt', 'md', 'markdown']
const MAX_FILE_SIZE = 1_000_000
// ponytail: practical ceiling; raise this if formulas genuinely need 100+ columns.
const MAX_MATRIX_COLUMNS = 100

type MatrixMenuCommand =
  | MatrixCommand
  | 'addColumnBefore'
  | 'addRowBefore'

const MATRIX_MENU_COMMANDS: Record<string, MatrixMenuCommand> = {
  'add-row-above': 'addRowBefore',
  'add-row-below': 'addRowAfter',
  'add-column-before': 'addColumnBefore',
  'add-column-after': 'addColumnAfter',
  'delete-row': 'removeRow',
  'delete-column': 'removeColumn',
}

interface UnwrapTarget {
  range: [number, number]
  latex: string
  caretOffset: number
}

const containerEl = ref<HTMLDivElement | null>(null)
const dragging = ref(false)
let contextUnwrapTarget: UnwrapTarget | null = null
let contextMatrixTarget: InternalAtom | null = null
const insertionPreview = ref<string | null>(null)
const previewBox = ref<DragPreviewBox | null>(null)
const textHints = ref<TextHint[]>([])
const previewTextHints = ref<TextHint[]>([])
const visibleTextHints = computed(() => insertionPreview.value ? previewTextHints.value : textHints.value)
const caretTextBox = ref<{ left: number; top: number; width: number; height: number } | null>(null)
const emptyTextCaretBox = ref<{ left: number; top: number; width: number; height: number } | null>(null)
let mathfield: MathfieldElement | null = null
let disposed = false
let textHintRaf = 0
let fractionRaf = 0
let fractionObserver: MutationObserver | null = null

const history = new EditorHistory()

function getMf(): MathfieldElement | null {
  return mathfield
}

const dragController = new DragController(
  {
    getMathfield: getMf,
    getContainer: () => containerEl.value,
    setDragging: (value) => { dragging.value = value },
    setPreview: (html, box, hints) => {
      insertionPreview.value = html
      previewBox.value = box
      previewTextHints.value = hints
    },
    insertElement: (...args) => { void insertElement(...args) },
    insertLatex: (...args) => { void insertLatex(...args) },
    loadFile: loadDroppedFile,
  },
  { fontSize: props.fontSize, displayStyle: props.displayStyle },
)

function emitUndoState() {
  emit('undo-state', history.canUndo, history.canRedo)
}

function recordHistory(mf: MathfieldElement): void {
  history.record({ latex: publicLatex(mf), position: mf.position })
}

function publishState(mf: MathfieldElement, record = true) {
  disableNativeHistory(mf)
  if (record) recordHistory(mf)
  emit(
    'latex-change',
    publicLatex(mf),
    formatLatexErrors(mf.errors ?? []),
  )
  emitUndoState()
}

function publicLatex(mf: MathfieldElement): string {
  return normalizePortableLatex(
    stripEmptyTextSentinel(
      stripTextBoundaries(mf.getValue('latex-without-placeholders')).replace(
        /\\placeholder(?:\[[^\]]*\])?\{\}/g,
        '',
      ),
    ),
  )
}

function updateTextHints() {
  const mf = getMf()
  textHints.value = mf ? collectTextHints(mf) : []
}

let inkCanvasContext: CanvasRenderingContext2D | null = null

function includePaintedRect(
  bounds: { top: number; bottom: number },
  rect: { top: number; bottom: number },
): void {
  bounds.top = Math.min(bounds.top, rect.top)
  bounds.bottom = Math.max(bounds.bottom, rect.bottom)
}

function paintedBounds(root: HTMLElement): { top: number; bottom: number } | null {
  inkCanvasContext ??= document.createElement('canvas').getContext('2d')
  const context = inkCanvasContext
  if (!context) {
    return null
  }

  const bounds = { top: Infinity, bottom: -Infinity }
  for (const leaf of Array.from(root.querySelectorAll<HTMLElement>('span'))) {
    const text = leaf.children.length === 0 ? leaf.textContent : null
    if (!text || !text.trim() || leaf.classList.contains('ML__pstrut')) {
      continue
    }
    const style = getComputedStyle(leaf)
    const transparent = style.color.startsWith('rgba') && style.color.endsWith(', 0)')
    if (style.visibility === 'hidden' || Number(style.opacity) === 0 || transparent) {
      continue
    }
    const rect = leaf.getBoundingClientRect()
    context.font = style.font
    const metrics = context.measureText(text)
    const fontAscent = metrics.fontBoundingBoxAscent
    if (!Number.isFinite(fontAscent)) {
      includePaintedRect(bounds, rect)
      continue
    }
    const baseline = rect.top + fontAscent
    includePaintedRect(bounds, {
      top: baseline - metrics.actualBoundingBoxAscent,
      bottom: baseline + metrics.actualBoundingBoxDescent,
    })
  }

  // Structural ink is not represented by text metrics. This also lets an
  // outer fraction account for corrected rules inside a nested fraction.
  for (const element of Array.from(
    root.querySelectorAll<HTMLElement>('.ML__frac-line, .ML__sqrt-line, .ML__rule, .ml-placeholder, svg'),
  )) {
    const rect = element.getBoundingClientRect()
    if (element.classList.contains('ML__frac-line')) {
      const after = getComputedStyle(element, '::after')
      const top = rect.top + (parseFloat(after.marginTop) || 0)
      includePaintedRect(bounds, { top, bottom: top + (parseFloat(after.minHeight) || rect.height) })
    } else {
      includePaintedRect(bounds, rect)
    }
  }

  return Number.isFinite(bounds.top) && Number.isFinite(bounds.bottom) ? bounds : null
}

// MathLive's public bounds include invisible font struts. Measure the actual
// painted glyph boxes instead, then place the rule midway between them.
function positionFractionRules(mf: MathfieldElement): void {
  const root = mf.shadowRoot
  if (!root) {
    return
  }
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
    if (!lineRow || !numeratorRow || !denominatorRow) {
      continue
    }
    const numerator = paintedBounds(numeratorRow)
    const denominator = paintedBounds(denominatorRow)
    if (!numerator || !denominator) {
      continue
    }
    const currentShift =
      parseFloat(lineRow.style.transform.match(/translateY\(([-\d.eE+]+)px\)/)?.[1] ?? '0') || 0
    const lineRect = lineEl.getBoundingClientRect()
    const after = getComputedStyle(lineEl, '::after')
    const lineTop = lineRect.top - currentShift + (parseFloat(after.marginTop) || 0)
    const lineBottom = lineTop + (parseFloat(after.minHeight) || lineRect.height)
    const shift = ((denominator.top - lineBottom) - (lineTop - numerator.bottom)) / 2
    const limit = (parseFloat(getComputedStyle(lineRow).fontSize) || props.fontSize) * 0.25
    const nextShift = Math.max(-limit, Math.min(limit, shift))
    if (Math.abs(nextShift - currentShift) > 0.01) {
      lineRow.style.transform = `translateY(${nextShift}px)`
    }
  }
}

function scheduleFractionRules(mf: MathfieldElement): void {
  cancelAnimationFrame(fractionRaf)
  fractionRaf = requestAnimationFrame(() => positionFractionRules(mf))
}

function observeFractionRendering(mf: MathfieldElement): void {
  const shadow = mf.shadowRoot
  if (!shadow || fractionObserver || typeof ShadowRoot === 'undefined' || !(shadow instanceof ShadowRoot)) {
    return
  }
  fractionObserver = new MutationObserver(() => {
    // Mutation observers run before the browser's next paint. Correct newly
    // rendered fraction rows here so their unpositioned state is never shown.
    positionFractionRules(mf)
  })
  fractionObserver.observe(shadow, { childList: true, subtree: true })
}

function scheduleUpdateTextHints() {
  cancelAnimationFrame(textHintRaf)
  textHintRaf = requestAnimationFrame(() => {
    updateTextHints()
    // MathLive also renders on requestAnimationFrame. Measuring here, after
    // its queued render, keeps the highlight in sync with inserted/deleted
    // characters instead of using the previous frame's bounds.
    syncCaretInText()
    const mf = getMf()
    if (mf) {
      scheduleFractionRules(mf)
    }
  })
}

const PLACEHOLDER_LATEX_RE = /^\\placeholder(?:\[[^\]]*\])?\{\}$/

function syncPlaceholderSelected() {
  const mf = getMf()
  if (!mf) {
    return
  }
  mf.classList.toggle(
    'placeholder-selected',
    mf.hasFocus() && isSinglePlaceholderSelection(mf),
  )
}

// The Text branch start is the inside position before the first character; the
// right boundary is outside. While the caret is inside a non-empty box, only
// that box gets a highlight based on its rendered character bounds. A global
// CSS rule would light up every Text box at once.
function syncCaretInText() {
  const mf = getMf()
  if (!mf) {
    caretTextBox.value = null
    emptyTextCaretBox.value = null
    return
  }
  const position = mf.position
  const group = textGroupAtCaret(mf)
  const accent = accentGroupAtCaret(mf)
  // MathLive's `hasFocus()` (an internal `blurred` flag) can go stale when
  // focus is moved programmatically around its keyboard sink, so use the real
  // DOM focus instead.
  const focused = document.activeElement === mf
  const inText = Boolean(
    focused &&
      mf.selectionIsCollapsed &&
      group &&
      position >= group.start &&
      position <= group.end,
  )
  mf.classList.toggle('caret-in-text', inText)
  const empty = Boolean(group && isEmptyTextLatex(group.latex))
  // Empty Text shows its gray hint only; Non-empty Text uses the actual
  // character bounds, not marker positions, as its highlight.
  const textBox = inText && group && !empty ? group.bounds : null
  // A filled accent highlights its argument the same way a Text box does.
  const inAccent = Boolean(focused && mf.selectionIsCollapsed && accent)
  const accentBounds = accent && inAccent ? accentBoundsAt(mf, accent) : null
  const accentBox = accentBounds
    ? {
        left: accentBounds.left,
        top: accentBounds.top,
        width: accentBounds.right - accentBounds.left,
        height: accentBounds.bottom - accentBounds.top,
      }
    : null
  caretTextBox.value = textBox ?? accentBox

  // The empty box's native caret sits on a zero-width branch atom and is not
  // visible, so a MathLive-style caret is overlaid in front of the gray "Text"
  // word instead.
  let simulated = false
  if (inText && group && empty) {
    const box = emptyTextHintBox(mf, group)
    if (box) {
      const width = Math.min(10, Math.max(2, props.fontSize * 0.08))
      const height = props.fontSize * 0.76
      emptyTextCaretBox.value = {
        left: box.left - width / 2,
        top: box.top + (box.height - height) / 2,
        width,
        height,
      }
      simulated = true
    }
  }
  if (!simulated) {
    emptyTextCaretBox.value = null
  }
  mf.classList.toggle('empty-text-caret', simulated)
}

function onSelectionChange() {
  syncPlaceholderSelected()
  syncCaretInText()
  scheduleUpdateTextHints()
}

function onMfInput(mf: MathfieldElement) {
  ensureMathMode(mf)
  publishState(mf)
  scheduleRestorePlaceholders(mf)
  syncCaretInText()
  scheduleUpdateTextHints()
}

function onUndoStateChange(mf: MathfieldElement) {
  disableNativeHistory(mf)
  emitUndoState()
  scheduleUpdateTextHints()
}

// While the math field is focused, force the English (ASCII-capable) input
// source so a non-Latin IME never activates and pops its candidate window.
// This is a macOS-only native switch; on other platforms the command is a no-op
// and the JS composition blocking handles it. The switch is scoped to the math
// field's focus/blur, leaving every other input (e.g. the LaTeX source
// textarea) with its original input-method behavior.
let englishImeRequestPending = false

async function requestEnglishIme() {
  if (!isTauriRuntime() || englishImeRequestPending) {
    return
  }
  englishImeRequestPending = true
  try {
    await invoke('force_ascii_ime')
  } catch {
    // Best-effort: the JS layer still blocks IME text if the switch fails.
  } finally {
    englishImeRequestPending = false
  }
}

async function restoreImeAfterBlur() {
  if (!isTauriRuntime()) {
    return
  }
  try {
    await invoke('restore_ime')
  } catch {
    // Ignore: nothing to restore or the runtime has gone away.
  }
}

function isAcceptedTextFile(file: File): boolean {
  if (file.size > MAX_FILE_SIZE) {
    return false
  }
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  if (TEXT_FILE_EXTENSIONS.includes(ext)) {
    return true
  }
  return file.type.startsWith('text/')
}

function loadDroppedFile(file: File): void {
  if (!isAcceptedTextFile(file)) {
    emit('toast', t('toast.onlyTextFiles'), 'error')
    return
  }
  file
    .text()
    .then((contents) => {
      const mf = getMf()
      if (!mf || !contents.trim()) return
      if (mf.value !== contents) {
        mf.setValue(addTextBoundaries(contents), { mode: 'math', silenceNotifications: true })
      }
      publishState(mf)
      emit('toast', t('toast.loadedFile', { file: file.name }), 'success')
    })
    .catch(() => emit('toast', t('toast.couldNotRead'), 'error'))
}

function configureMathfield(mf: MathfieldElement) {
  mf.placeholder = t('workspace.placeholder')
  mf.mathVirtualKeyboardPolicy = 'manual'
  mf.maxMatrixCols = MAX_MATRIX_COLUMNS
  mf.defaultMode = props.displayStyle ? 'math' : 'inline-math'
  mf.style.fontSize = `${props.fontSize}px`
  const normalized = addTextBoundaries(mf.value)
  if (normalized !== mf.value) {
    mf.setValue(normalized, { mode: 'math', silenceNotifications: true })
  }
  ensurePlaceholderSupport(mf)
  ensureAccentPositioning(mf)
  observeFractionRendering(mf)
  attachImeBlocker(mf)
  configureContextMenu(mf)
  publishState(mf)
}

async function ensureMathfield(): Promise<MathfieldElement | null> {
  if (mathfield) {
    return mathfield
  }
  try {
    await customElements.whenDefined('math-field')
  } catch {
    return null
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    if (disposed) {
      return null
    }
    const element = containerEl.value?.querySelector('math-field') as MathfieldElement | null
    if (element && typeof element.canUndo === 'function') {
      mathfield = element
      configureMathfield(element)
      return mathfield
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return null
}

function onDragOver(event: DragEvent): void {
  dragController.onDragOver(event)
}

function onDragLeave(event: DragEvent): void {
  dragController.onDragLeave(event)
}

function onDrop(event: DragEvent): void {
  dragController.onDrop(event)
}

async function insertElement(
  element: EquationElement,
  targetOffset?: number,
  placeholderIndex = -1,
  x?: number,
  y?: number,
) {
  const mf = await ensureMathfield()
  if (!mf) {
    emit('toast', t('toast.notReady'), 'error')
    return
  }
  if (
    isFontStyleElement(element.id) &&
    typeof x === 'number' &&
    typeof y === 'number' &&
    applyFontStyle(mf, element.id, x, y)
  ) {
    publishState(mf)
    scheduleUpdateTextHints()
    return
  }
  let positioned = false
  if (placeholderIndex >= 0 && typeof x === 'number' && typeof y === 'number') {
    positioned = selectPlaceholderAtPoint(mf, x, y)
  }
  if (!positioned) {
    if (targetOffset != null && Number.isInteger(targetOffset) && targetOffset >= 0) {
      mf.position = targetOffset
    }
  }
  const inserted = withEmptyTextSentinel(element.latex)
  if (inserted !== element.latex && !positioned && textGroupNearPosition(mf, mf.position)) {
    // Inserting an empty Text box inside or right next to another one would
    // only merge into it; skip the insertion but keep the caret (and the
    // keyboard focus) where it was.
    if (document.activeElement !== mf) {
      mf.focus()
      if (document.activeElement !== mf) {
        const keyboardSink = mf.shadowRoot?.querySelector<HTMLElement>('.ML__keyboard-sink')
        keyboardSink?.focus()
      }
    }
    return
  }
  if (!positioned) {
    mf.position = clampOffsetOutsideText(mf, mf.position, x)
  }
  mf.insert(addTextBoundaries(inserted), {
    selectionMode: 'placeholder',
    mode: 'math',
    focus: true,
    scrollIntoView: true,
  })
  requestAnimationFrame(() => {
    if (disposed || getMf() !== mf) {
      return
    }
    // A drag-and-drop insert can leave the field without real keyboard focus
    // (MathLive's focus() skips when its state is stale); the caret would stay
    // invisible. Restore it, then park the caret inside an inserted empty Text.
    if (document.activeElement !== mf) {
      mf.focus()
      if (document.activeElement !== mf) {
        const keyboardSink = mf.shadowRoot?.querySelector<HTMLElement>('.ML__keyboard-sink')
        keyboardSink?.focus()
      }
    }
    if (inserted !== element.latex) {
      snapCaretIntoEmptyText(mf)
    }
    syncCaretInText()
    scheduleUpdateTextHints()
  })
}

async function insertLatex(text: string, targetOffset?: number) {
  const mf = await ensureMathfield()
  if (!mf) {
    emit('toast', t('toast.notReady'), 'error')
    return
  }
  if (targetOffset != null && Number.isInteger(targetOffset) && targetOffset >= 0) {
    mf.position = targetOffset
  }
  mf.position = clampOffsetOutsideText(mf, mf.position)
  mf.insert(addTextBoundaries(text), {
    selectionMode: 'placeholder',
    mode: 'math',
    focus: true,
    scrollIntoView: true,
  })
}

// Mathstyle switch commands (`\displaystyle`, ...). They are `{:rest}` commands,
// so MathLive's native completion inserts them in a fresh parse context where
// the rest is empty, producing an ineffective `{\displaystyle}`. They are
// completed by wrapping the first following atom instead.
const STYLE_SWITCH_COMMANDS = new Set([
  'displaystyle',
  'textstyle',
  'scriptstyle',
  'scriptscriptstyle',
])

// Commands whose completion inserts a root atom (`isRoot: true`), replacing the
// model root with an environment that serializes to '' and cannot be cleared.
// `\displaylines` is the only `\command`-completable one (`\begin{...}`
// environments are not reachable through single-command completion).
const ROOT_ENVIRONMENT_COMMANDS = new Set(['displaylines'])

// Completing a typed `\command` inserts the matching palette element (with its
// full placeholder template) instead of MathLive's bare `\command{□}`. Style
// switches and root environments are handled specially; everything else keeps
// the native completion behavior.
function completeCommand(mf: MathfieldElement, event: KeyboardEvent): boolean {
  if (mf.mode !== 'latex') {
    return false
  }
  const name = typedCommandName(mf)
  if (!name) {
    return false
  }
  const element = getElementByCommand(name)
  if (element) {
    event.preventDefault()
    event.stopPropagation()
    // Discard the in-progress command and switch back to math mode using
    // MathLive's own completion path, then insert the element like a drag-drop.
    mf.executeCommand(['complete', 'reject'])
    void insertElement(element)
    return true
  }
  if (DISABLED_LATEX_AUTOCOMPLETE_COMMANDS.has(name)) {
    event.preventDefault()
    event.stopPropagation()
    mf.executeCommand(['complete', 'reject'])
    return true
  }
  if (STYLE_SWITCH_COMMANDS.has(name)) {
    completeStyleSwitch(mf, name, event)
    return true
  }
  if (ROOT_ENVIRONMENT_COMMANDS.has(name)) {
    // Never let a root environment be inserted: it would replace the model root
    // and leave the field in an un-clearable state. Discard the command.
    event.preventDefault()
    event.stopPropagation()
    mf.executeCommand(['complete', 'reject'])
    return true
  }
  return false
}

// Complete a mathstyle switch by wrapping the first atom after the caret (its
// scripts included), e.g. `\displaystyle` before `\sum_{}^{}` becomes
// `\displaystyle\sum_{}^{}`. When nothing follows, insert an empty placeholder
// group instead.
function completeStyleSwitch(mf: MathfieldElement, name: string, event: KeyboardEvent): void {
  event.preventDefault()
  event.stopPropagation()
  mf.executeCommand(['complete', 'reject'])
  const range = firstElementRangeAfter(mf)
  if (range) {
    mf.selection = { ranges: [range] }
    // `#@` captures the selection; no braces so `\displaystyle` stays a `{:rest}`
    // switch applied to the captured content (`\displaystyle\sum`) instead of an
    // extra `{...}` group.
    mf.insert(`\\${name}#@`, {
      insertionMode: 'replaceSelection',
      format: 'latex',
      mode: 'math',
      focus: true,
      scrollIntoView: true,
    })
  } else {
    mf.insert(`\\${name}{#0}`, {
      selectionMode: 'placeholder',
      format: 'latex',
      mode: 'math',
      focus: true,
      scrollIntoView: true,
    })
  }
  publishState(mf)
  scheduleUpdateTextHints()
}

function onSuggestionClick(event: MouseEvent): void {
  const item = (event.target as Element | null)?.closest<HTMLElement>(
    '#mathlive-suggestion-popover [data-command]',
  )
  const name = item?.dataset.command?.match(/^\\([a-zA-Z]+)/)?.[1]
  const mf = getMf()
  if (!name || !DISABLED_LATEX_AUTOCOMPLETE_COMMANDS.has(name) || mf?.mode !== 'latex') {
    return
  }
  event.preventDefault()
  event.stopImmediatePropagation()
  mf.executeCommand(['complete', 'reject'])
}

const RESTORE_PLACEHOLDER_GLOBAL_RE = /\\placeholder(?:\[[^\]]*\])?\{\}/g

// Re-inject placeholders into emptied groups. Runs as a microtask right after
// the content change so it lands before MathLive's next (rAF-deferred) render,
// avoiding a visible frame of the collapsed empty group.
function scheduleRestorePlaceholders(mf: MathfieldElement) {
  queueMicrotask(() => restoreEmptyGroups(mf))
}

function moveToPlaceholder(mf: MathfieldElement, index: number) {
  mf.position = 0
  for (let i = 0; i <= index && i < 64; i++) {
    mf.executeCommand('moveToNextPlaceholder')
  }
}

function restoreEmptyGroups(mf: MathfieldElement) {
  if (disposed || !mf.hasFocus()) {
    return
  }
  const original = mf.value
  const withPlaceholders = restoreEmptyGroupLatex(original) ?? original
  const fixed = addTextBoundaries(normalizePublicLatex(withPlaceholders))
  if (fixed === original) {
    return
  }
  // Count the placeholders before the caret so the restored placeholder ends up
  // focused (rather than always the first one in the formula).
  const caretPlaceholderIndex = (
    mf.getValue(0, mf.position).match(RESTORE_PLACEHOLDER_GLOBAL_RE) ?? []
  ).length
  const publicPrefixLength = normalizePublicLatex(mf.getValue(0, mf.position)).length
  mf.setValue(fixed, { mode: 'math', silenceNotifications: true })
  publishState(mf)
  if (withPlaceholders !== original) {
    moveToPlaceholder(mf, caretPlaceholderIndex)
  } else {
    mf.position = publicStringOffsetToModel(mf, publicPrefixLength)
  }
}

const CARET_MARKER = '\\bigstar'

// Locate the placeholder under the caret in the serialized LaTeX. Model
// offsets do not map reliably to string offsets inside operator branches
// (a sum's scripts serialize in the opposite order of the model, so counting
// placeholder atoms before the caret lands on the wrong token). Instead the
// caret's placeholder is briefly replaced by a unique marker, located in the
// serialized value, and the original value is restored immediately. Undo
// Native recording stays disabled; the semantic history never sees this round-trip.
function unwrapElementAtCaret(mf: MathfieldElement): { latex: string; caretOffset: number } | null {
  const original = mf.value
  const controls = mf as unknown as { stopRecording?: () => void }
  controls.stopRecording?.()
  let marked = ''
  try {
    mf.insert(CARET_MARKER, {
      insertionMode: 'replaceSelection',
      format: 'latex',
      mode: 'math',
      silenceNotifications: true,
    })
    marked = mf.value
  } catch {
    marked = ''
  } finally {
    mf.setValue(original, { mode: 'math', silenceNotifications: true })
    controls.stopRecording?.()
  }
  const markerIndex = marked.indexOf(CARET_MARKER)
  if (markerIndex < 0 || marked.indexOf(CARET_MARKER, markerIndex + 1) >= 0) {
    return null
  }
  const latex = marked.replace(CARET_MARKER, '\\placeholder{}')
  return removeElementAtPlaceholder(latex, markerIndex + '\\placeholder{}'.length)
}

// True when the caret sits just after a single non-placeholder atom inside a
// `\sqrt[...]{...}` optional index. In that state Backspace would empty the
// index, and MathLive serializes an empty index as `\sqrt{...}` (dropping the
// `[...]`), so we intercept it and restore the index placeholder instead. The
// caret is located in the serialized LaTeX with a marker round-trip (same trick
// as unwrapElementAtCaret); the caret position is preserved across the trip.
function rootIndexAtomBeforeCaret(mf: MathfieldElement): boolean {
  const atom = mf.getElementInfo(mf.position) ?? mf.getElementInfo(mf.position - 1)
  if (
    !atom?.latex ||
    atom.latex === '' ||
    /\\placeholder|\\text/.test(atom.latex) ||
    /[\s{}]/.test(atom.latex)
  ) {
    return false
  }
  if (!mf.value.includes('\\sqrt[')) {
    return false
  }
  const position = mf.position
  const original = mf.value
  const controls = mf as unknown as { stopRecording?: () => void }
  controls.stopRecording?.()
  let marked = ''
  try {
    mf.insert(CARET_MARKER, {
      insertionMode: 'replaceSelection',
      format: 'latex',
      mode: 'math',
      silenceNotifications: true,
    })
    marked = mf.value
  } catch {
    marked = ''
  } finally {
    mf.setValue(original, { mode: 'math', silenceNotifications: true })
    controls.stopRecording?.()
  }
  mf.position = position
  const markerPos = marked.indexOf(CARET_MARKER)
  if (markerPos < 0) {
    return false
  }
  const re = /\\sqrt\[([^\]]*)\]/g
  let match
  while ((match = re.exec(marked))) {
    const indexStart = match.index + '\\sqrt['.length
    const indexEnd = match.index + match[0].length - 1
    if (markerPos >= indexStart && markerPos < indexEnd) {
      return true
    }
  }
  return false
}

// Whether the caret last moved via navigation (arrow key or a click past the
// right edge of the content). A caret that reached a Text box edge that way
// has left the box (the user wants to type outside it), while the same
// position reached by typing/clicking inside belongs to the box.
let caretArrivedByNavigation = false
// The direction of the last arrow navigation. This capture handler runs before
// MathLive's shadow-DOM key handler, and MathLive can represent the last caret
// stop inside a Text box and the first stop outside it with the same edge
// offset. The direction plus the `caret-in-text` state updated by
// `selection-change` disambiguates which side the caret reached.
let lastArrowDirection: 'left' | 'right' | null = null

function executeMatrixCommands(mf: MathfieldElement, commands: readonly MatrixMenuCommand[]) {
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
  restoreEmptyGroups(mf)
  publishState(mf)
  scheduleUpdateTextHints()
}

function executeContextMatrixCommand(command: MatrixMenuCommand) {
  const mf = getMf()
  const model = mf && internalModel(mf)
  const target = contextMatrixTarget
  if (!mf || !model || !target) return
  const offset = model.offsetOf(target)
  if (offset < 0) return
  if (target.type === 'placeholder') mf.selection = { ranges: [[offset - 1, offset]] }
  else mf.position = offset
  executeMatrixCommands(mf, [command])
}

function elementRange(mf: MathfieldElement, end: number, latex: string): [number, number] | null {
  for (let start = end; start >= 0; start--) {
    if (mf.getValue(start, end) === latex) return [start, end]
  }
  return null
}

function unwrapTargetAtPoint(
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
    const range = replacement != null && elementRange(mf, end, latex)
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

function unwrapContextTarget() {
  const mf = getMf()
  const target = contextUnwrapTarget
  if (!mf || !target) return
  const publicCaretOffset = normalizePublicLatex(target.latex.slice(0, target.caretOffset)).length
  mf.setValue(target.latex, { mode: 'math', silenceNotifications: true })
  restoreEmptyGroups(mf)
  mf.position = publicStringOffsetToModel(mf, publicCaretOffset)
  publishState(mf)
  scheduleUpdateTextHints()
}

function configureContextMenu(mf: MathfieldElement) {
  mf.menuItems = [
    ...(mf.menuItems ?? []).map((item) => {
      const command = 'id' in item && item.id ? MATRIX_MENU_COMMANDS[item.id] : undefined
      if (!command) return item
      const rowCommand = command === 'addRowBefore' || command === 'addRowAfter' || command === 'removeRow'
      return {
        ...item,
        ...(rowCommand ? { visible: () => matrixContextAtCaret(mf) !== null } : {}),
        onMenuSelect: () => executeContextMatrixCommand(command),
      }
    }),
    { type: 'divider' },
    {
      id: 'unwrap-element',
      label: () => t('workspace.unwrap'),
      visible: () => contextUnwrapTarget !== null,
      onMenuSelect: unwrapContextTarget,
    },
  ]
}

function handleMatrixResizeKey(event: KeyboardEvent, mf: MathfieldElement): boolean {
  if (
    (event.key !== 'Enter' && event.key !== 'Backspace' && event.key !== 'Delete') ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    (!mf.selectionIsCollapsed && !isSinglePlaceholderSelection(mf))
  ) {
    return false
  }
  const context = matrixContextAtCaret(mf)
  if (!context) return false
  const commands = matrixCommandsForKey(
    {
      row: context.row,
      column: context.column,
      rows: context.matrix.rowCount,
      columns: context.matrix.colCount,
      rowEmpty: context.rowEmpty,
      columnEmpty: context.columnEmpty,
    },
    event.key === 'Enter' ? 'Enter' : 'Delete',
  )
  if (commands.length === 0) return false

  event.preventDefault()
  event.stopPropagation()
  executeMatrixCommands(mf, commands)
  return true
}

function onMfContextMenu(event: MouseEvent) {
  const mf = getMf()
  const model = mf && internalModel(mf)
  if (!mf || !model) return

  const unwrap = contextUnwrapTarget ?? unwrapTargetAtPoint(mf, event.clientX, event.clientY)

  const matrix = matrixAtPoint(
    mf,
    event.clientX,
    event.clientY,
    Math.max(20, props.fontSize),
  )
  const offset = matrix
    ? matrixOffsetAtPoint(mf, matrix, event.clientX, event.clientY)
    : mf.getOffsetFromPoint(event.clientX, event.clientY)
  if (offset == null || offset < 0) return
  const atom = model.at(offset)
  if (atom?.type === 'placeholder') mf.selection = { ranges: [[offset - 1, offset]] }
  else mf.position = offset
  contextMatrixTarget = matrixContextAtCaret(mf) ? atom : null

  mf.focus()
  if (unwrap) {
    contextUnwrapTarget = unwrap
    mf.selection = { ranges: [unwrap.range] }
    onSelectionChange()
    requestAnimationFrame(() => {
      if (contextUnwrapTarget !== unwrap) return
      mf.selection = { ranges: [unwrap.range] }
      onSelectionChange()
    })
  }
}

const NON_ASCII_RE = /[^\x00-\x7F]/

function hasNonAsciiText(data: string | null | undefined): boolean {
  return typeof data === 'string' && data.length > 0 && NON_ASCII_RE.test(data)
}

function handleUndoShortcut(event: KeyboardEvent): boolean {
  const shortcut = event.key.toLowerCase()
  if (
    !event.altKey &&
    (event.metaKey || event.ctrlKey) &&
    (shortcut === 'z' || shortcut === 'y')
  ) {
    event.preventDefault()
    event.stopPropagation()
    if (shortcut === 'y' || event.shiftKey) redo()
    else undo()
    return true
  }
  return false
}

function onWindowKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (target?.matches('input, textarea, [contenteditable="true"]')) return
  handleUndoShortcut(event)
}

function onMfKeydown(event: KeyboardEvent) {
  // Re-assert the English input source on every key press so a manual switch
  // back to a non-Latin IME (e.g. Cmd+Space) while the field is focused is
  // reverted immediately instead of popping the candidate window.
  void requestEnglishIme()
  if (handleUndoShortcut(event)) return
  // During IME composition the browser emits keydown events that carry the
  // composition state (`key === 'Process'` or `keyCode 229`); WKWebView even
  // reports `isComposing: false` there but still exposes the physical key in
  // `key`/`code`. MathLive handles composition natively, so intercepting these
  // keys to rebuild `\text{...}` groups mid-composition would corrupt input.
  // Instead, recover printable letters typed under a non-Latin IME so the field
  // keeps working as English-only input.
  if (event.isComposing || event.key === 'Process' || event.keyCode === 229) {
    if (/^[a-zA-Z]$/.test(event.key)) {
      event.preventDefault()
      event.stopPropagation()
      const mf = getMf()
      if (mf) {
        mf.insert(event.key, {
          insertionMode: 'replaceSelection',
          format: 'auto',
          mode: 'math',
          silenceNotifications: true,
        })
        publishState(mf)
        scheduleUpdateTextHints()
      }
    }
    return
  }
  const isArrowKey = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
  const isModifierKey =
    event.key === 'Shift' ||
    event.key === 'Control' ||
    event.key === 'Alt' ||
    event.key === 'Meta'
  const direction =
    event.key === 'ArrowLeft' ? 'left' : event.key === 'ArrowRight' ? 'right' : null
  try {
    handleKeydown(event)
  } finally {
    if (isArrowKey) {
      caretArrivedByNavigation = true
      if (direction) {
        lastArrowDirection = direction
      }
    } else if (!isModifierKey) {
      // Shift is part of the physical key sequence for characters such as
      // `(` (Shift+9). Keep the navigation state through modifier keydowns so
      // the following printable key still knows the caret left the Text box.
      caretArrivedByNavigation = false
    }
  }
}

// IME composition is blocked entirely: the math field is English-only, so
// Chinese/Japanese/Korean and other scripts must never enter the model.
function blockImeEvent(event: Event) {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}

function onCompositionStart(event: CompositionEvent) {
  blockImeEvent(event)
}

function onCompositionUpdate(event: CompositionEvent) {
  blockImeEvent(event)
}

function onCompositionEnd(event: CompositionEvent) {
  blockImeEvent(event)
}

function onBeforeInput(event: Event) {
  const inputEvent = event as InputEvent
  if (inputEvent.inputType === 'insertCompositionText' || hasNonAsciiText(inputEvent.data)) {
    blockImeEvent(event)
  }
}

// Chromium composes the composition events across the shadow-DOM boundary, so
// the host-level `@composition*.capture` handlers above catch them and stop
// MathLive's internal keyboard-sink handler. WKWebView composes them too, but
// its IME commits the final text through a plain `insertText` `input` event
// (with non-ASCII `data`) that MathLive does not discard. Attach capture-phase
// listeners directly to MathLive's shadow root (an ancestor of the keyboard
// sink) so both the composition events and the committed IME text are blocked
// before they reach MathLive in every engine.
function attachImeBlocker(mf: MathfieldElement) {
  const root = mf.shadowRoot
  if (!root || typeof root.addEventListener !== 'function') {
    return
  }
  root.addEventListener('compositionstart', blockImeEvent, true)
  root.addEventListener('compositionupdate', blockImeEvent, true)
  root.addEventListener('compositionend', blockImeEvent, true)
  root.addEventListener('beforeinput', onBeforeInput, true)
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

function handleKeydown(event: KeyboardEvent) {
  const mf = getMf()
  if (!mf || !mf.hasFocus()) {
    return
  }
  if (handleMatrixResizeKey(event, mf)) return
  if (
    (event.key === 'Enter' || event.key === 'Tab') &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey
  ) {
    if (completeCommand(mf, event)) return
  }
  const textInput = handleTextInput(
    mf,
    event,
    caretArrivedByNavigation,
    lastArrowDirection,
  )
  if (textInput === 'changed') {
    publishState(mf)
    syncCaretInText()
    scheduleUpdateTextHints()
  }
  if (textInput !== 'continue') return
  // Escape the empty text box: its interior spans the invisible phantom atoms,
  // so a single arrow press jumps out on either side (right before the closing
  // boundary, left before the opening one) where typing lands in math mode.
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const accentTarget = accentArrowTarget(mf, event.key)
    if (accentTarget != null) {
      event.preventDefault()
      event.stopPropagation()
      mf.position = accentTarget
      const emptyAccent = accentGroupAtAtom(mf, accentTarget)
      if (emptyAccent && isAccentArgEmpty(mf, emptyAccent)) {
        mf.selection = {
          ranges: [[emptyAccent.start - 1, emptyAccent.start]],
        }
      }
      onSelectionChange()
      return
    }
    const textNavigation = handleEmptyTextNavigation(mf, event)
    if (textNavigation === 'changed') {
      publishState(mf)
      scheduleUpdateTextHints()
      return
    }
  }
  if (event.key !== 'Backspace' && event.key !== 'Delete') {
    return
  }
  // Range deletions are left entirely to MathLive. The caret surgery below
  // (placeholder unwrapping, text rebuilds, boundary relocation) is only valid
  // for a collapsed caret or the single placeholder MathLive selects on
  // capture; running it on a broader selection collapses it and can
  // re-serialize the whole formula as text. A full-range deletion is handled
  // explicitly so select-all + Delete clears cleanly on every engine.
  if (!mf.selectionIsCollapsed && !isSinglePlaceholderSelection(mf)) {
    const range = mf.selection?.ranges?.[0]
    if (range && range[0] === 0 && range[1] >= mf.lastOffset) {
      event.preventDefault()
      event.stopPropagation()
      mf.value = ''
      ensureMathMode(mf)
      publishState(mf)
      scheduleUpdateTextHints()
    }
    return
  }
  // Never let a collapsed caret's native deletion target a managed zero-width
  // marker: step the caret across it first (into the text for a right marker,
  // so Delete right after a Text box edits the text instead of corrupting the
  // formula).
  if (mf.selectionIsCollapsed) {
    const relocated = relocateCaretAcrossBoundaries(mf, event.key)
    if (relocated !== mf.position) {
      mf.position = relocated
    }
  }
  // User-facing deletion semantics: Backspace deletes the character before the
  // caret (atom at `position`), Delete the one after it (atom at `position + 1`).
  const target = event.key === 'Delete' ? mf.position + 1 : mf.position
  const info = mf.getElementInfo(mf.position)
  const isPlaceholder =
    isSinglePlaceholderSelection(mf) ||
    (info?.latex != null && /^\\placeholder(?:\[[^\]]*\])?\{\}$/.test(info.latex))
  // Deleting a character inside an accent argument: MathLive treats the accent
  // construct as opaque, so its native deletion removes the whole accent or
  // nothing. Rebuild the argument without the targeted atom, like a Text box.
  const accentTarget = accentGroupAtAtom(mf, target)
  if (accentTarget && !isPlaceholder) {
    event.preventDefault()
    event.stopPropagation()
    const parts: string[] = []
    for (let offset = accentTarget.start; offset <= accentTarget.end; offset++) {
      parts.push(mf.getElementInfo(offset)?.latex ?? '')
    }
    const content = parts.filter((_, index) => accentTarget.start + index !== target).join('')
    const argument = content || '\\placeholder{}'
    const originalAccent = mf.getElementInfo(accentTarget.constructOffset)?.latex
    const replacement =
      originalAccent && (accentTarget.command === 'overbrace' || accentTarget.command === 'underbrace')
        ? originalAccent.replace(`{${parts.join('')}}`, `{${argument}}`)
        : `\\${accentTarget.command}{${argument}}`
    {
      // Replacing a nested branch selection can make MathLive move the rebuilt
      // accent into another placeholder of its parent. Replace it in the
      // complete formula instead, then restore the caret inside the accent.
      if (originalAccent) {
        const deletedIndex = target - accentTarget.start
        let occurrence = 0
        for (let offset = 0; offset < accentTarget.constructOffset; offset++) {
          if (mf.getElementInfo(offset)?.latex === originalAccent) occurrence++
        }
        let stringIndex = -1
        for (let i = 0; i <= occurrence; i++) {
          stringIndex = mf.value.indexOf(originalAccent, stringIndex + 1)
        }
        if (stringIndex >= 0) {
          const next =
            mf.value.slice(0, stringIndex) +
            replacement +
            mf.value.slice(stringIndex + originalAccent.length)
          const replacementOccurrence = next.slice(0, stringIndex).split(replacement).length - 1
          mf.setValue(next, { mode: 'math', silenceNotifications: true })
          let seen = 0
          for (let offset = 0; offset <= mf.lastOffset; offset++) {
            if (mf.getElementInfo(offset)?.latex !== replacement) continue
            if (seen++ !== replacementOccurrence) continue
            const rebuiltAccent = accentGroupAtOffset(mf, offset)
            if (rebuiltAccent) {
              if (content) {
                mf.position = Math.max(
                  rebuiltAccent.start - 1,
                  Math.min(rebuiltAccent.end, rebuiltAccent.start + deletedIndex - 1),
                )
              } else {
                mf.selection = { ranges: [[rebuiltAccent.start - 1, rebuiltAccent.start]] }
              }
            }
            break
          }
          publishState(mf)
          onSelectionChange()
          scheduleUpdateTextHints()
          return
        }
      }
    }
    mf.selection = {
      ranges: [[accentTarget.start - 1, accentTarget.constructOffset]],
    }
    mf.insert(replacement, {
      insertionMode: 'replaceSelection',
      mode: 'math',
      format: 'latex',
      silenceNotifications: true,
    })
    if (content) {
      mf.position = Math.min(Math.max(0, target - 1), mf.lastOffset)
    }
    publishState(mf)
    onSelectionChange()
    scheduleUpdateTextHints()
    return
  }
  const textDeletion = handleTextDeletion(mf, event, target)
  if (textDeletion === 'changed') {
    publishState(mf)
    syncCaretInText()
    scheduleUpdateTextHints()
  }
  if (textDeletion !== 'continue') return
  if (!isPlaceholder) {
    if (event.key === 'Backspace') {
      // Backspace on the last remaining character of a `\sqrt[n]{...}` index
      // restores the index placeholder (a second Backspace then drops the index
      // via removeOptionalIndex, turning it into a plain root).
      if (rootIndexAtomBeforeCaret(mf)) {
        event.preventDefault()
        event.stopPropagation()
        const pos = mf.position
        mf.selection = { ranges: [[pos - 1, pos]] }
        mf.insert('\\placeholder{}', {
          insertionMode: 'replaceSelection',
          selectionMode: 'placeholder',
          mode: 'math',
          format: 'latex',
          silenceNotifications: true,
        })
        publishState(mf)
        return
      }
    }
    // Let MathLive delete the content; the input handler re-injects
    // placeholders and removes any markers that became orphaned.
    return
  }
  const result = unwrapElementAtCaret(mf)
  if (!result) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  const publicCaretOffset = stripTextBoundaries(result.latex.slice(0, result.caretOffset)).length
  const restoredWithoutBoundaries = restoreEmptyGroupLatex(result.latex) ?? result.latex
  const restored = addTextBoundaries(restoredWithoutBoundaries)
  mf.setValue(restored, { mode: 'math', silenceNotifications: true })
  mf.position = publicStringOffsetToModel(mf, publicCaretOffset)
  if (restoredWithoutBoundaries !== result.latex) {
    // The unwrap left an empty slot behind (e.g. the argument of a root or a
    // script of an operator); move the caret into the restored placeholder.
    enterPlaceholder(mf, mf.position)
  }
  publishState(mf)
}

// Workaround for MathLive bug arnog/mathlive#2806/#2926: clicking a placeholder
// inside an accent (hat, bar, vec, ...) does not move the caret into it. The
// accent glyph overlays the placeholder box, so we detect the click by geometry
// and drive the caret into the placeholder with the navigation commands. The
// selection is only assigned after MathLive's own click/focus handling has
// settled (rAF) and without any focus() call, both of which otherwise leave the
// keyboard input state broken.
function placeholderAtPoint(mf: MathfieldElement, x: number, y: number): boolean {
  return placeholderIndexAtPoint(mf, x, y) >= 0
}

// An accent construct (`\hat{...}`, `\bar{...}`, ...) located in the model. The
// construct atom serializes the whole command and sits at `constructOffset`;
// its argument's content atoms are the contiguous non-empty run(s) right before
// it. `start`/`end` mark the argument's content atom range.
interface AccentGroup {
  start: number
  end: number
  constructOffset: number
  command: string
}

function accentGroupAtOffset(mf: MathfieldElement, offset: number): AccentGroup | null {
  const latex = mf.getElementInfo(offset)?.latex
  if (!latex || !isAccentConstructLatex(latex)) {
    return null
  }
  const command = latex.match(/^\\([a-zA-Z]+)\{/)?.[1] ?? ''
  const isBrace = command === 'overbrace' || command === 'underbrace'
  // Collect the contiguous non-empty atom runs walking backward from just
  // before the construct. For overbrace/underbrace the run closest to the
  // construct is the script (`^{...}`/`_{...}`), so the argument is the run
  // before it; for every other accent there is only one run.
  const runs: [number, number][] = []
  let i = offset - 1
  while (i >= 0) {
    if ((mf.getElementInfo(i)?.latex ?? '') !== '') {
      const end = i
      while (i >= 0 && (mf.getElementInfo(i)?.latex ?? '') !== '') {
        i--
      }
      runs.push([i + 1, end])
    } else {
      i--
    }
  }
  const range = isBrace && runs.length >= 2 ? runs[1]! : runs[0]
  if (!range) {
    return null
  }
  return { start: range[0], end: range[1], constructOffset: offset, command }
}

function accentBoundsAt(
  mf: MathfieldElement,
  group: AccentGroup,
): { left: number; right: number; top: number; bottom: number } | null {
  let bounds: { left: number; right: number; top: number; bottom: number } | null = null
  const merge = (b: { left: number; right: number; top: number; bottom: number } | undefined) => {
    if (!b) {
      return
    }
    if (!bounds) {
      bounds = { left: b.left, right: b.right, top: b.top, bottom: b.bottom }
      return
    }
    bounds.left = Math.min(bounds.left, b.left)
    bounds.right = Math.max(bounds.right, b.right)
    bounds.top = Math.min(bounds.top, b.top)
    bounds.bottom = Math.max(bounds.bottom, b.bottom)
  }
  merge(mf.getElementInfo(group.constructOffset)?.bounds)
  for (let offset = group.start; offset <= group.end; offset++) {
    merge(mf.getElementInfo(offset)?.bounds)
  }
  if (group.command === 'overbrace' || group.command === 'underbrace') {
    // Include the script run in the highlighted construct bounds.
    for (let offset = group.constructOffset - 1; offset > group.end; offset--) {
      merge(mf.getElementInfo(offset)?.bounds)
    }
  }
  return bounds
}

function accentAtPoint(mf: MathfieldElement, x: number, y: number): AccentGroup | null {
  if (braceAnnotationOffsetAtPoint(mf, x, y) != null) {
    return null
  }
  for (let offset = 0; offset <= mf.lastOffset; offset++) {
    const group = accentGroupAtOffset(mf, offset)
    if (!group) {
      continue
    }
    const bounds = accentBoundsAt(mf, group)
    if (
      bounds &&
      x >= bounds.left - 2 &&
      x <= bounds.right + 2 &&
      y >= bounds.top - 4 &&
      y <= bounds.bottom + 4
    ) {
      return group
    }
  }
  return null
}

function braceAnnotationOffsetAtPoint(
  mf: MathfieldElement,
  x: number,
  y: number,
): number | null {
  for (let constructOffset = 0; constructOffset <= mf.lastOffset; constructOffset++) {
    const group = accentGroupAtOffset(mf, constructOffset)
    if (!group || (group.command !== 'overbrace' && group.command !== 'underbrace')) {
      continue
    }
    for (let offset = group.end + 1; offset < group.constructOffset; offset++) {
      const info = mf.getElementInfo(offset)
      if (PLACEHOLDER_LATEX_RE.test(info?.latex ?? '')) {
        continue
      }
      const bounds = info?.bounds
      if (
        bounds &&
        bounds.width >= 0.5 &&
        x >= bounds.left - PLACEHOLDER_CLICK_PAD &&
        x <= bounds.right + PLACEHOLDER_CLICK_PAD &&
        y >= bounds.top - PLACEHOLDER_CLICK_PAD &&
        y <= bounds.bottom + PLACEHOLDER_CLICK_PAD
      ) {
        return offset
      }
    }
  }
  return null
}

// The accent whose argument content atoms cover the given model offset.
function accentGroupAtAtom(mf: MathfieldElement, atom: number): AccentGroup | null {
  for (let offset = 0; offset <= mf.lastOffset; offset++) {
    const group = accentGroupAtOffset(mf, offset)
    if (group && atom >= group.start && atom <= group.end) {
      return group
    }
  }
  return null
}

// The accent whose argument currently contains the caret (the caret sits inside
// the argument's content, between the branch start and the construct atom).
function accentGroupAtCaret(mf: MathfieldElement): AccentGroup | null {
  const pos = mf.position
  for (let offset = 0; offset <= mf.lastOffset; offset++) {
    const group = accentGroupAtOffset(mf, offset)
    if (group && pos >= group.start - 1 && pos <= group.end) {
      return group
    }
  }
  return null
}

// An accent whose argument is still the empty placeholder is handled by the
// placeholder click path (placeholderAtPoint -> enterPlaceholder), which selects
// the placeholder; the accent path below only re-enters filled arguments.
function isAccentArgEmpty(mf: MathfieldElement, group: AccentGroup): boolean {
  return (
    group.start === group.end &&
    PLACEHOLDER_LATEX_RE.test(mf.getElementInfo(group.start)?.latex ?? '')
  )
}

function reenterAccent(mf: MathfieldElement, group: AccentGroup): void {
  if (document.activeElement !== mf) {
    mf.focus()
    if (document.activeElement !== mf) {
      const keyboardSink = mf.shadowRoot?.querySelector<HTMLElement>('.ML__keyboard-sink')
      keyboardSink?.focus()
    }
  }
  mf.position = Math.min(group.end, mf.lastOffset)
  onSelectionChange()
}

// MathLive treats an accent construct as opaque to arrow navigation: a single
// ArrowLeft/ArrowRight skips the whole argument instead of stepping through it.
// Step the caret one position at a time across the accent's extent (the branch
// start immediately before the argument through the atom just after it) so the
// argument is navigable like a Text box.
function accentArrowTarget(mf: MathfieldElement, key: 'ArrowLeft' | 'ArrowRight'): number | null {
  if (!mf.selectionIsCollapsed) {
    return null
  }
  const pos = mf.position
  for (let offset = 0; offset <= mf.lastOffset; offset++) {
    const group = accentGroupAtOffset(mf, offset)
    if (!group) {
      continue
    }
    const before = group.start - 2
    const after = group.end + 1
    if (isAccentArgEmpty(mf, group)) {
      // The empty accent's interior is just the placeholder; a single arrow
      // press from either side selects it.
      if (key === 'ArrowRight' && pos === before) {
        return group.start
      }
      if (key === 'ArrowLeft' && pos === after) {
        return group.start
      }
      continue
    }
    if (key === 'ArrowRight' && pos >= before && pos < after) {
      return Math.max(before, Math.min(after, pos + 1))
    }
    if (key === 'ArrowLeft' && pos > before && pos <= after) {
      return Math.max(before, Math.min(after, pos - 1))
    }
  }
  return null
}

function onMfPointerDown(event: PointerEvent) {
  const mf = getMf()
  if (!mf) {
    return
  }
  // MathLive dispatches a menu command after a short blink animation. Do not
  // let the menu item's earlier pointerdown retarget the formula selection.
  if (
    event.composedPath().some(
      (node) => node instanceof HTMLElement && node.getAttribute('role') === 'menuitem',
    )
  ) {
    event.stopPropagation()
    return
  }
  contextUnwrapTarget = null
  contextMatrixTarget = null
  if (event.button === 2) {
    contextUnwrapTarget = unwrapTargetAtPoint(mf, event.clientX, event.clientY)
    return
  }
  // Clicking an empty Text box: take over the click so the caret lands in
  // front of the gray "Text" word and the field really gets keyboard focus
  // (MathLive's own click handling lands on the invisible phantom atoms and
  // can leave the focus on the body).
  const emptyGroup = emptyTextGroupAtPoint(mf, event.clientX, event.clientY)
  if (emptyGroup) {
    event.preventDefault()
    if (document.activeElement !== mf) {
      mf.blur()
    }
    mf.focus()
    if (document.activeElement !== mf) {
      const keyboardSink = mf.shadowRoot?.querySelector<HTMLElement>('.ML__keyboard-sink')
      keyboardSink?.focus()
    }
    mf.position = Math.min(emptyGroup.start, mf.lastOffset)
    caretArrivedByNavigation = false
    onSelectionChange()
    return
  }
  // Clicking a filled accent (or the accent glyph over it): MathLive maps the
  // click to either side of the opaque construct, so take over the click and
  // park the caret inside the argument (at its end) instead.
  const annotationOffset = braceAnnotationOffsetAtPoint(mf, event.clientX, event.clientY)
  if (annotationOffset != null) {
    event.preventDefault()
    if (document.activeElement !== mf) {
      mf.focus()
      if (document.activeElement !== mf) {
        const keyboardSink = mf.shadowRoot?.querySelector<HTMLElement>('.ML__keyboard-sink')
        keyboardSink?.focus()
      }
    }
    mf.position = annotationOffset
    caretArrivedByNavigation = false
    onSelectionChange()
    return
  }
  const accent = accentAtPoint(mf, event.clientX, event.clientY)
  if (
    accent &&
    !isAccentArgEmpty(mf, accent) &&
    !placeholderAtPoint(mf, event.clientX, event.clientY)
  ) {
    event.preventDefault()
    if (document.activeElement !== mf) {
      mf.blur()
    }
    reenterAccent(mf, accent)
    caretArrivedByNavigation = false
    return
  }
  let contentRight = -Infinity
  for (let offset = 0; offset <= mf.lastOffset; offset++) {
    const bounds = mf.getElementInfo(offset)?.bounds
    if (bounds && bounds.width >= 0.5) {
      contentRight = Math.max(contentRight, bounds.right)
    }
  }
  if (!Number.isFinite(contentRight) || event.clientX <= contentRight) {
    return
  }
  event.preventDefault()
  if (document.activeElement !== mf) {
    mf.blur()
  }
  mf.focus()
  if (document.activeElement !== mf) {
    // MathLive can retain a stale hasFocus() state and skip refocusing its sink.
    const keyboardSink = mf.shadowRoot?.querySelector<HTMLElement>('.ML__keyboard-sink')
    keyboardSink?.focus()
  }
  mf.position = mf.lastOffset
  caretArrivedByNavigation = true
  onSelectionChange()
}

function onPointerUp(event: PointerEvent) {
  const mf = getMf()
  if (!mf) {
    return
  }
  // Clicking an empty Text box: MathLive's click handler can leave the caret
  // just outside the box (at the zero-width left marker) without moving the
  // keyboard focus. Snap the caret in front of the gray "Text" word and make
  // sure the field actually receives keyboard input.
  const emptyGroup = emptyTextGroupAtPoint(mf, event.clientX, event.clientY)
  if (emptyGroup) {
    const x = event.clientX
    const y = event.clientY
    requestAnimationFrame(() => {
      if (disposed || getMf() !== mf) {
        return
      }
      const group = emptyTextGroupAtPoint(mf, x, y)
      if (!group) {
        return
      }
      if (document.activeElement !== mf) {
        mf.focus()
        if (document.activeElement !== mf) {
          const keyboardSink = mf.shadowRoot?.querySelector<HTMLElement>('.ML__keyboard-sink')
          keyboardSink?.focus()
        }
      }
      mf.position = Math.min(group.start, mf.lastOffset)
      syncCaretInText()
      scheduleUpdateTextHints()
    })
    return
  }
  // Clicking a filled accent: re-apply the caret inside its argument after
  // MathLive's click handling settles (it may still move the caret to either
  // side of the opaque construct).
  const accent = accentAtPoint(mf, event.clientX, event.clientY)
  if (
    accent &&
    !isAccentArgEmpty(mf, accent) &&
    !placeholderAtPoint(mf, event.clientX, event.clientY)
  ) {
    const x = event.clientX
    const y = event.clientY
    requestAnimationFrame(() => {
      if (disposed || getMf() !== mf) {
        return
      }
      const group = accentAtPoint(mf, x, y)
      if (!group || isAccentArgEmpty(mf, group)) {
        return
      }
      reenterAccent(mf, group)
    })
    return
  }
  if (!placeholderAtPoint(mf, event.clientX, event.clientY)) {
    return
  }
  if (!mf.selectionIsCollapsed) {
    // A working placeholder was already selected by MathLive itself.
    return
  }
  let offset = mf.getOffsetFromPoint(event.clientX, event.clientY)
  if (!Number.isInteger(offset) || offset < 0) {
    // Clicking an accent glyph can map to no offset; fall back to the end so
    // the placeholder navigation below can still reach the placeholder.
    offset = mf.lastOffset
  }
  const valueAtClick = mf.value
  requestAnimationFrame(() => {
    if (mf.value !== valueAtClick) {
      return
    }
    enterPlaceholder(mf, offset)
    // MathLive's focus handling can settle asynchronously after the click and
    // revert the selection; re-apply once on the next frame (unless the user
    // already typed in the meantime).
    requestAnimationFrame(() => {
      if (mf.value === valueAtClick) {
        enterPlaceholder(mf, offset)
      }
    })
  })
}

function loadLatex(mf: MathfieldElement, value: string): void {
  const internalValue = addTextBoundaries(value)
  if (mf.value !== internalValue) {
    mf.setValue(internalValue, { mode: 'math', silenceNotifications: true })
  }
  // Re-inject placeholders into empty groups so the loaded value shows the
  // editable gray boxes again.
  const restored = restoreEmptyGroupLatex(mf.value)
  if (restored !== null && restored !== mf.value) {
    mf.setValue(addTextBoundaries(restored), { mode: 'math', silenceNotifications: true })
  }
  ensureMathMode(mf)
}

function setLatex(value: string): { value: string; errors: string[] } {
  const mf = getMf()
  if (!mf) {
    return { value, errors: [] }
  }
  loadLatex(mf, value)
  publishState(mf)
  scheduleUpdateTextHints()
  return {
    value: publicLatex(mf),
    errors: formatLatexErrors(mf.errors ?? []),
  }
}

function undo() {
  const mf = getMf()
  if (!mf) return
  const entry = history.undo()
  if (!entry) return
  loadLatex(mf, entry.latex)
  mf.position = Math.min(entry.position, mf.lastOffset)
  publishState(mf, false)
  scheduleUpdateTextHints()
}

function redo() {
  const mf = getMf()
  if (!mf) return
  const entry = history.redo()
  if (!entry) return
  loadLatex(mf, entry.latex)
  mf.position = Math.min(entry.position, mf.lastOffset)
  publishState(mf, false)
  scheduleUpdateTextHints()
}

function clear() {
  const mf = getMf()
  if (!mf) {
    return
  }
  if (mf.value !== '') {
    mf.value = ''
  }
  ensureMathMode(mf)
  publishState(mf)
  scheduleUpdateTextHints()
}

function focus() {
  getMf()?.focus()
}

function setFontSize(px: number) {
  const mf = getMf()
  if (mf) {
    mf.style.fontSize = `${px}px`
  }
  dragController.setFontSize(px)
  scheduleUpdateTextHints()
}

function setDisplayStyle(value: boolean) {
  const mf = getMf()
  if (mf) {
    mf.defaultMode = value ? 'math' : 'inline-math'
    // MathLive's option setter does not re-render existing content for a
    // `defaultMode` change alone, so re-parse the current value to apply the
    // new mathstyle (limits above/below vs. side sub/superscripts). Preserve
    // the caret position across the round-trip.
    const position = mf.position
    mf.setValue(mf.value, { mode: 'math', silenceNotifications: true })
    mf.position = Math.min(position, mf.lastOffset)
    scheduleUpdateTextHints()
  }
  dragController.setDisplayStyle(value)
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown)
  document.addEventListener('click', onSuggestionClick, true)
  void ensureMathfield()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown)
  document.removeEventListener('click', onSuggestionClick, true)
  disposed = true
  dragController.dispose()
  cancelAnimationFrame(textHintRaf)
  cancelAnimationFrame(fractionRaf)
  fractionObserver?.disconnect()
  fractionObserver = null
})

watch(() => props.fontSize, (px) => setFontSize(px))
watch(() => props.displayStyle, (value) => setDisplayStyle(value))

defineExpose({
  setLatex,
  insertElement,
  insertLatex,
  undo,
  redo,
  clear,
  focus,
  setFontSize,
})
</script>

<template>
    <div
      ref="containerEl"
      class="workspace"
      :class="{ 'workspace-dragging': dragging }"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
      @pointerup="onPointerUp"
    >
      <div class="workspace-paper">
        <div
          v-if="caretTextBox"
          class="caret-text-hl"
          :style="{
            left: `${caretTextBox.left}px`,
            top: `${caretTextBox.top}px`,
            width: `${caretTextBox.width}px`,
            height: `${caretTextBox.height}px`,
          }"
          aria-hidden="true"
        ></div>
        <div
          v-if="emptyTextCaretBox"
          class="sim-caret"
          :style="{
            left: `${emptyTextCaretBox.left}px`,
            top: `${emptyTextCaretBox.top}px`,
            width: `${emptyTextCaretBox.width}px`,
            height: `${emptyTextCaretBox.height}px`,
          }"
          aria-hidden="true"
        ></div>
        <math-field
          class="workspace-field"
          :style="{ fontSize: `${fontSize}px` }"
          inputmode="latin"
          lang="en"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          @input="onMfInput($event.target as unknown as MathfieldElement)"
          @keydown.capture="onMfKeydown"
          @beforeinput.capture="onBeforeInput"
          @compositionstart.capture="onCompositionStart"
          @compositionupdate.capture="onCompositionUpdate"
          @compositionend.capture="onCompositionEnd"
          @pointerdown.capture="onMfPointerDown"
          @contextmenu.capture="onMfContextMenu"
          @undo-state-change="onUndoStateChange($event.target as unknown as MathfieldElement)"
          @focus="requestEnglishIme(); syncPlaceholderSelected(); syncCaretInText(); scheduleUpdateTextHints()"
          @blur="restoreImeAfterBlur(); syncPlaceholderSelected(); syncCaretInText(); scheduleUpdateTextHints()"
          @focusin="syncCaretInText(); scheduleUpdateTextHints()"
          @focusout="syncCaretInText(); scheduleUpdateTextHints()"
          @selection-change="onSelectionChange"
        ></math-field>
      </div>
      <div
        v-for="(hint, index) in visibleTextHints"
        :key="index"
        class="text-hint"
        :style="{
          left: `${hint.left}px`,
          top: `${hint.top}px`,
          width: `${hint.width}px`,
          fontSize: `${fontSize}px`,
          lineHeight: `${hint.height}px`,
          fontFamily: hint.font.fontFamily,
          fontWeight: hint.font.fontWeight,
          fontStyle: hint.font.fontStyle,
        }"
        aria-hidden="true"
      >{{ hint.text }}</div>
      <div
        v-if="insertionPreview"
        class="insertion-preview"
        :style="{
          left: `${previewBox?.left ?? 0}px`,
          top: `${previewBox?.top ?? 0}px`,
          width: `${previewBox?.width ?? 0}px`,
          height: `${previewBox?.height ?? 0}px`,
          fontSize: `${fontSize}px`,
        }"
        aria-hidden="true"
        v-html="insertionPreview"
      ></div>
      <Transition name="fade">
        <div v-if="dragging" class="workspace-drop-hint" aria-hidden="true">
          {{ t('workspace.dropHint') }}
        </div>
      </Transition>
    </div>
  </template>

<style scoped>
.workspace {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  padding: 20px;
  overflow-y: auto;
  background: var(--workspace-bg);
  border: 3px solid transparent;
  border-radius: 12px;
  transition: border-color 120ms ease, background-color 120ms ease;
}

.workspace-dragging {
  border-color: var(--accent);
  background: var(--workspace-bg-active);
}

.workspace-paper {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  flex: 1;
  min-height: 0;
  padding: 0;
}

.workspace-field {
  position: relative;
  z-index: 31;
  display: block;
  width: 100%;
  min-height: 90px;
  background: transparent;
  color: var(--text);
}

.caret-text-hl {
  position: fixed;
  z-index: 30;
  pointer-events: none;
  background: var(--text-box-highlight, #93c5fd);
}

.sim-caret {
  position: fixed;
  z-index: 45;
  pointer-events: none;
  border-radius: 2px;
  background: var(--accent);
  animation: sim-caret-blink 1.05s step-end infinite;
}

@keyframes sim-caret-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

.insertion-preview {
  position: fixed;
  z-index: 50;
  pointer-events: none;
  background: transparent;
}

.text-hint {
  position: fixed;
  z-index: 40;
  pointer-events: none;
  color: var(--text-muted);
  opacity: 0.7;
  white-space: nowrap;
  text-align: center;
}

.workspace-drop-hint {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  padding: 6px 14px;
  border-radius: 999px;
  background: var(--accent);
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
  pointer-events: none;
  box-shadow: 0 4px 14px rgb(0 0 0 / 25%);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 120ms ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
