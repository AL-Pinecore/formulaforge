<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { restoreEmptyGroupLatex } from '~/utils/empty-group'
import { blockImeBeforeInput, blockImeEvent } from '~/utils/ime-block'
import { isAccentConstructLatex } from '~/utils/accent'
import { isFontStyleElement } from '~/utils/font-styles'
import { removeElementAtPlaceholder } from '~/utils/remove-empty-element'
import { matrixCommandsForKey } from '~/utils/matrix'
import {
  addTextBoundaries,
  isEmptyTextLatex,
  stripTextBoundaries,
  withEmptyTextSentinel,
} from '~/utils/text-boundary'
import type { EquationElement } from '~/types/equation'
import { useI18n } from '~/composables/useI18n'
import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from '~/composables/useEquationExport'
import { useEquation } from '~/composables/useEquation'
import type { EditorAdaptor } from '~/editor/EditorAdaptor'
import { MathLiveEditorAdaptor } from '~/editor/MathLiveEditorAdaptor'
import { DragController, type DragPreviewBox } from '~/editor/DragController'
import { AutocompleteController } from '~/editor/AutocompleteController'
import { ContextMenuController } from '~/editor/ContextMenuController'
import { isSinglePlaceholderSelection } from '~/editor/SelectionController'
import { matrixContextAtCaret } from '~/editor/MatrixController'
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
  toast: [message: string, kind: 'success' | 'error']
}>()

const { t } = useI18n()
const { document: equationDocument } = useEquation()

const PLACEHOLDER_CLICK_PAD = 10
const TEXT_FILE_EXTENSIONS = ['tex', 'latex', 'txt', 'md', 'markdown']
const MAX_FILE_SIZE = 1_000_000
// ponytail: practical ceiling; raise this if formulas genuinely need 100+ columns.
const MAX_MATRIX_COLUMNS = 100

const containerEl = ref<HTMLDivElement | null>(null)
const dragging = ref(false)
const insertionPreview = ref<string | null>(null)
const previewBox = ref<DragPreviewBox | null>(null)
const textHints = ref<TextHint[]>([])
const previewTextHints = ref<TextHint[]>([])
const visibleTextHints = computed(() => insertionPreview.value ? previewTextHints.value : textHints.value)
const caretTextBox = ref<{ left: number; top: number; width: number; height: number } | null>(null)
const emptyTextCaretBox = ref<{ left: number; top: number; width: number; height: number } | null>(null)
let adaptor: EditorAdaptor | null = null
let disposed = false
let textHintRaf = 0

function getAdaptor(): EditorAdaptor | null {
  return adaptor
}

const dragController = new DragController(
  {
    getAdaptor,
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

const autocompleteController = new AutocompleteController({
  getAdaptor,
  insertElement: (element) => { void insertElement(element) },
  commit: (a) => {
    publishState(a)
    scheduleUpdateTextHints()
  },
})

const contextMenuController = new ContextMenuController({
  unwrapLabel: () => t('workspace.unwrap'),
  restoreEmptyGroups,
  publishState,
  updateTextHints: scheduleUpdateTextHints,
  selectionChanged: onSelectionChange,
})

function publishState(a?: EditorAdaptor, record = true) {
  const target = a ?? getAdaptor()
  if (!target) return
  target.resetUndo()
  const latex = target.readPublicLatex()
  const errors = target.readErrors()
  if (record) equationDocument.commit(latex, target.position, errors)
  else equationDocument.restore(latex, target.position, errors)
}

function updateTextHints() {
  const a = getAdaptor()
  textHints.value = a ? collectTextHints(a) : []
}

function scheduleUpdateTextHints() {
  cancelAnimationFrame(textHintRaf)
  textHintRaf = requestAnimationFrame(() => {
    updateTextHints()
    // MathLive also renders on requestAnimationFrame. Measuring here, after
    // its queued render, keeps the highlight in sync with inserted/deleted
    // characters instead of using the previous frame's bounds.
    syncCaretInText()
    getAdaptor()?.scheduleFractionRules()
  })
}

const PLACEHOLDER_LATEX_RE = /^\\placeholder(?:\[[^\]]*\])?\{\}$/

function syncPlaceholderSelected() {
  const a = getAdaptor()
  if (!a) return
  a.element.classList.toggle(
    'placeholder-selected',
    a.hasFocus() && isSinglePlaceholderSelection(a),
  )
}

// The Text branch start is the inside position before the first character; the
// right boundary is outside. While the caret is inside a non-empty box, only
// that box gets a highlight based on its rendered character bounds. A global
// CSS rule would light up every Text box at once.
function syncCaretInText() {
  const a = getAdaptor()
  if (!a) {
    caretTextBox.value = null
    emptyTextCaretBox.value = null
    return
  }
  const position = a.position
  const group = textGroupAtCaret(a)
  const accent = accentGroupAtCaret(a)
  // MathLive's `hasFocus()` (an internal `blurred` flag) can go stale when
  // focus is moved programmatically around its keyboard sink, so use the real
  // DOM focus instead.
  const focused = document.activeElement === a.element
  const inText = Boolean(
    focused &&
      a.selectionIsCollapsed &&
      group &&
      position >= group.start &&
      position <= group.end,
  )
  a.element.classList.toggle('caret-in-text', inText)
  const empty = Boolean(group && isEmptyTextLatex(group.latex))
  // Empty Text shows its gray hint only; Non-empty Text uses the actual
  // character bounds, not marker positions, as its highlight.
  const textBox = inText && group && !empty ? group.bounds : null
  // A filled accent highlights its argument the same way a Text box does.
  const inAccent = Boolean(focused && a.selectionIsCollapsed && accent)
  const accentBounds = accent && inAccent ? accentBoundsAt(a, accent) : null
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
    const box = emptyTextHintBox(a, group)
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
  a.element.classList.toggle('empty-text-caret', simulated)
}

function onSelectionChange() {
  syncPlaceholderSelected()
  syncCaretInText()
  scheduleUpdateTextHints()
}

function onMfInput() {
  const a = getAdaptor()
  if (!a) return
  a.ensureMathMode()
  publishState(a)
  scheduleRestorePlaceholders(a)
  syncCaretInText()
  scheduleUpdateTextHints()
}

function onUndoStateChange() {
  getAdaptor()?.resetUndo()
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
      const a = getAdaptor()
      if (!a || !contents.trim()) return
      if (a.value !== contents) {
        a.setValue(addTextBoundaries(contents), { mode: 'math', silenceNotifications: true })
      }
      publishState(a)
      emit('toast', t('toast.loadedFile', { file: file.name }), 'success')
    })
    .catch(() => emit('toast', t('toast.couldNotRead'), 'error'))
}

function configureAdaptor(a: EditorAdaptor) {
  a.configure({
    placeholder: t('workspace.placeholder'),
    maxMatrixCols: MAX_MATRIX_COLUMNS,
    fontSize: props.fontSize,
    displayStyle: props.displayStyle,
  })
  contextMenuController.configure(a)
  publishState(a)
}

async function ensureAdaptor(): Promise<EditorAdaptor | null> {
  if (adaptor) {
    return adaptor
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
    const element = containerEl.value?.querySelector('math-field') as HTMLElement | null
    if (element && typeof (element as { canUndo?: unknown }).canUndo === 'function') {
      const next = new MathLiveEditorAdaptor(element)
      adaptor = next
      configureAdaptor(next)
      return next
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
  const a = await ensureAdaptor()
  if (!a) {
    emit('toast', t('toast.notReady'), 'error')
    return
  }
  if (
    isFontStyleElement(element.id) &&
    typeof x === 'number' &&
    typeof y === 'number' &&
    applyFontStyle(a, element.id, x, y)
  ) {
    publishState(a)
    scheduleUpdateTextHints()
    return
  }
  let positioned = false
  if (placeholderIndex >= 0 && typeof x === 'number' && typeof y === 'number') {
    positioned = a.selectPlaceholderAtPoint(x, y)
  }
  if (!positioned) {
    if (targetOffset != null && Number.isInteger(targetOffset) && targetOffset >= 0) {
      a.position = targetOffset
    }
  }
  const inserted = withEmptyTextSentinel(element.latex)
  if (inserted !== element.latex && !positioned && textGroupNearPosition(a, a.position)) {
    // Inserting an empty Text box inside or right next to another one would
    // only merge into it; skip the insertion but keep the caret (and the
    // keyboard focus) where it was.
    a.focusKeyboard()
    return
  }
  if (!positioned) {
    a.position = clampOffsetOutsideText(a, a.position, x)
  }
  a.insert(addTextBoundaries(inserted), {
    selectionMode: 'placeholder',
    mode: 'math',
    focus: true,
    scrollIntoView: true,
  })
  requestAnimationFrame(() => {
    if (disposed || getAdaptor() !== a) {
      return
    }
    // A drag-and-drop insert can leave the field without real keyboard focus
    // (MathLive's focus() skips when its state is stale); the caret would stay
    // invisible. Restore it, then park the caret inside an inserted empty Text.
    a.focusKeyboard()
    if (inserted !== element.latex) {
      snapCaretIntoEmptyText(a)
    }
    syncCaretInText()
    scheduleUpdateTextHints()
  })
}

async function insertLatex(text: string, targetOffset?: number) {
  const a = await ensureAdaptor()
  if (!a) {
    emit('toast', t('toast.notReady'), 'error')
    return
  }
  if (targetOffset != null && Number.isInteger(targetOffset) && targetOffset >= 0) {
    a.position = targetOffset
  }
  a.position = clampOffsetOutsideText(a, a.position)
  a.insert(addTextBoundaries(text), {
    selectionMode: 'placeholder',
    mode: 'math',
    focus: true,
    scrollIntoView: true,
  })
}

const RESTORE_PLACEHOLDER_GLOBAL_RE = /\\placeholder(?:\[[^\]]*\])?\{\}/g

// Re-inject placeholders into emptied groups. Runs as a microtask right after
// the content change so it lands before MathLive's next (rAF-deferred) render,
// avoiding a visible frame of the collapsed empty group.
function scheduleRestorePlaceholders(a: EditorAdaptor) {
  queueMicrotask(() => restoreEmptyGroups(a))
}

function moveToPlaceholder(a: EditorAdaptor, index: number) {
  a.position = 0
  for (let i = 0; i <= index && i < 64; i++) {
    a.executeCommand('moveToNextPlaceholder')
  }
}

function restoreEmptyGroups(a: EditorAdaptor) {
  if (disposed || !a.hasFocus()) {
    return
  }
  const original = a.value
  const withPlaceholders = restoreEmptyGroupLatex(original) ?? original
  const fixed = addTextBoundaries(normalizePublicLatex(withPlaceholders))
  if (fixed === original) {
    return
  }
  // Count the placeholders before the caret so the restored placeholder ends up
  // focused (rather than always the first one in the formula).
  const caretPlaceholderIndex = (
    a.getValue(0, a.position).match(RESTORE_PLACEHOLDER_GLOBAL_RE) ?? []
  ).length
  const publicPrefixLength = normalizePublicLatex(a.getValue(0, a.position)).length
  a.setValue(fixed, { mode: 'math', silenceNotifications: true })
  publishState(a)
  if (withPlaceholders !== original) {
    moveToPlaceholder(a, caretPlaceholderIndex)
  } else {
    a.position = publicStringOffsetToModel(a, publicPrefixLength)
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
function unwrapElementAtCaret(a: EditorAdaptor): { latex: string; caretOffset: number } | null {
  const original = a.value
  let marked = ''
  try {
    a.insert(CARET_MARKER, {
      insertionMode: 'replaceSelection',
      format: 'latex',
      mode: 'math',
      silenceNotifications: true,
    })
    marked = a.value
  } catch {
    marked = ''
  } finally {
    a.setValue(original, { mode: 'math', silenceNotifications: true })
    a.resetUndo()
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
function rootIndexAtomBeforeCaret(a: EditorAdaptor): boolean {
  const atom = a.getElementInfo(a.position) ?? a.getElementInfo(a.position - 1)
  if (
    !atom?.latex ||
    atom.latex === '' ||
    /\\placeholder|\\text/.test(atom.latex) ||
    /[\s{}]/.test(atom.latex)
  ) {
    return false
  }
  if (!a.value.includes('\\sqrt[')) {
    return false
  }
  const position = a.position
  const original = a.value
  let marked = ''
  try {
    a.insert(CARET_MARKER, {
      insertionMode: 'replaceSelection',
      format: 'latex',
      mode: 'math',
      silenceNotifications: true,
    })
    marked = a.value
  } catch {
    marked = ''
  } finally {
    a.setValue(original, { mode: 'math', silenceNotifications: true })
    a.resetUndo()
  }
  a.position = position
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

function handleMatrixResizeKey(event: KeyboardEvent, a: EditorAdaptor): boolean {
  if (
    (event.key !== 'Enter' && event.key !== 'Backspace' && event.key !== 'Delete') ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    (!a.selectionIsCollapsed && !isSinglePlaceholderSelection(a))
  ) {
    return false
  }
  const context = matrixContextAtCaret(a)
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
  contextMenuController.executeMatrixCommands(a, commands)
  return true
}

function onMfContextMenu(event: MouseEvent) {
  const a = getAdaptor()
  if (a) contextMenuController.onContextMenu(a, event, Math.max(20, props.fontSize))
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
      const a = getAdaptor()
      if (a) {
        a.insert(event.key, {
          insertionMode: 'replaceSelection',
          format: 'auto',
          mode: 'math',
          silenceNotifications: true,
        })
        publishState(a)
        scheduleUpdateTextHints()
      }
    }
    return
  }
  const a = getAdaptor()
  if (a) autocompleteController.trackKeydown(a, event)
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
  blockImeBeforeInput(event)
}

function handleKeydown(event: KeyboardEvent) {
  const a = getAdaptor()
  if (!a || !a.hasFocus()) {
    return
  }
  if (handleMatrixResizeKey(event, a)) return
  if (
    (event.key === 'Enter' || event.key === 'Tab') &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey
  ) {
    if (autocompleteController.completeCommand(a, event)) return
  }
  const textInput = handleTextInput(
    a,
    event,
    caretArrivedByNavigation,
    lastArrowDirection,
  )
  if (textInput === 'changed') {
    publishState(a)
    syncCaretInText()
    scheduleUpdateTextHints()
  }
  if (textInput !== 'continue') return
  // Escape the empty text box: its interior spans the invisible phantom atoms,
  // so a single arrow press jumps out on either side (right before the closing
  // boundary, left before the opening one) where typing lands in math mode.
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const accentTarget = accentArrowTarget(a, event.key)
    if (accentTarget != null) {
      event.preventDefault()
      event.stopPropagation()
      a.position = accentTarget
      const emptyAccent = accentGroupAtAtom(a, accentTarget)
      if (emptyAccent && isAccentArgEmpty(a, emptyAccent)) {
        a.selection = {
          ranges: [[emptyAccent.start - 1, emptyAccent.start]],
        }
      }
      onSelectionChange()
      return
    }
    const textNavigation = handleEmptyTextNavigation(a, event)
    if (textNavigation === 'changed') {
      publishState(a)
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
  if (!a.selectionIsCollapsed && !isSinglePlaceholderSelection(a)) {
    const range = a.selection?.ranges?.[0]
    if (range && range[0] === 0 && range[1] >= a.lastOffset) {
      event.preventDefault()
      event.stopPropagation()
      a.value = ''
      a.ensureMathMode()
      publishState(a)
      scheduleUpdateTextHints()
    }
    return
  }
  // Never let a collapsed caret's native deletion target a managed zero-width
  // marker: step the caret across it first (into the text for a right marker,
  // so Delete right after a Text box edits the text instead of corrupting the
  // formula).
  if (a.selectionIsCollapsed) {
    const relocated = relocateCaretAcrossBoundaries(a, event.key)
    if (relocated !== a.position) {
      a.position = relocated
    }
  }
  // User-facing deletion semantics: Backspace deletes the character before the
  // caret (atom at `position`), Delete the one after it (atom at `position + 1`).
  const target = event.key === 'Delete' ? a.position + 1 : a.position
  const info = a.getElementInfo(a.position)
  const isPlaceholder =
    isSinglePlaceholderSelection(a) ||
    (info?.latex != null && /^\\placeholder(?:\[[^\]]*\])?\{\}$/.test(info.latex))
  // Deleting a character inside an accent argument: MathLive treats the accent
  // construct as opaque, so its native deletion removes the whole accent or
  // nothing. Rebuild the argument without the targeted atom, like a Text box.
  const accentTarget = accentGroupAtAtom(a, target)
  if (accentTarget && !isPlaceholder) {
    event.preventDefault()
    event.stopPropagation()
    const parts: string[] = []
    for (let offset = accentTarget.start; offset <= accentTarget.end; offset++) {
      parts.push(a.getElementInfo(offset)?.latex ?? '')
    }
    const content = parts.filter((_, index) => accentTarget.start + index !== target).join('')
    const argument = content || '\\placeholder{}'
    const originalAccent = a.getElementInfo(accentTarget.constructOffset)?.latex
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
          if (a.getElementInfo(offset)?.latex === originalAccent) occurrence++
        }
        let stringIndex = -1
        for (let i = 0; i <= occurrence; i++) {
          stringIndex = a.value.indexOf(originalAccent, stringIndex + 1)
        }
        if (stringIndex >= 0) {
          const next =
            a.value.slice(0, stringIndex) +
            replacement +
            a.value.slice(stringIndex + originalAccent.length)
          const replacementOccurrence = next.slice(0, stringIndex).split(replacement).length - 1
          a.setValue(next, { mode: 'math', silenceNotifications: true })
          let seen = 0
          for (let offset = 0; offset <= a.lastOffset; offset++) {
            if (a.getElementInfo(offset)?.latex !== replacement) continue
            if (seen++ !== replacementOccurrence) continue
            const rebuiltAccent = accentGroupAtOffset(a, offset)
            if (rebuiltAccent) {
              if (content) {
                a.position = Math.max(
                  rebuiltAccent.start - 1,
                  Math.min(rebuiltAccent.end, rebuiltAccent.start + deletedIndex - 1),
                )
              } else {
                a.selection = { ranges: [[rebuiltAccent.start - 1, rebuiltAccent.start]] }
              }
            }
            break
          }
          publishState(a)
          onSelectionChange()
          scheduleUpdateTextHints()
          return
        }
      }
    }
    a.selection = {
      ranges: [[accentTarget.start - 1, accentTarget.constructOffset]],
    }
    a.insert(replacement, {
      insertionMode: 'replaceSelection',
      mode: 'math',
      format: 'latex',
      silenceNotifications: true,
    })
    if (content) {
      a.position = Math.min(Math.max(0, target - 1), a.lastOffset)
    }
    publishState(a)
    onSelectionChange()
    scheduleUpdateTextHints()
    return
  }
  const textDeletion = handleTextDeletion(a, event, target)
  if (textDeletion === 'changed') {
    publishState(a)
    syncCaretInText()
    scheduleUpdateTextHints()
  }
  if (textDeletion !== 'continue') return
  if (!isPlaceholder) {
    if (event.key === 'Backspace') {
      // Backspace on the last remaining character of a `\sqrt[n]{...}` index
      // restores the index placeholder (a second Backspace then drops the index
      // via removeOptionalIndex, turning it into a plain root).
      if (rootIndexAtomBeforeCaret(a)) {
        event.preventDefault()
        event.stopPropagation()
        const pos = a.position
        a.selection = { ranges: [[pos - 1, pos]] }
        a.insert('\\placeholder{}', {
          insertionMode: 'replaceSelection',
          selectionMode: 'placeholder',
          mode: 'math',
          format: 'latex',
          silenceNotifications: true,
        })
        publishState(a)
        return
      }
    }
    // Let MathLive delete the content; the input handler re-injects
    // placeholders and removes any markers that became orphaned.
    return
  }
  const result = unwrapElementAtCaret(a)
  if (!result) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  const publicCaretOffset = stripTextBoundaries(result.latex.slice(0, result.caretOffset)).length
  const restoredWithoutBoundaries = restoreEmptyGroupLatex(result.latex) ?? result.latex
  const restored = addTextBoundaries(restoredWithoutBoundaries)
  a.setValue(restored, { mode: 'math', silenceNotifications: true })
  a.position = publicStringOffsetToModel(a, publicCaretOffset)
  if (restoredWithoutBoundaries !== result.latex) {
    // The unwrap left an empty slot behind (e.g. the argument of a root or a
    // script of an operator); move the caret into the restored placeholder.
    a.enterPlaceholder(a.position)
  }
  publishState(a)
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

function accentGroupAtOffset(a: EditorAdaptor, offset: number): AccentGroup | null {
  const latex = a.getElementInfo(offset)?.latex
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
    if ((a.getElementInfo(i)?.latex ?? '') !== '') {
      const end = i
      while (i >= 0 && (a.getElementInfo(i)?.latex ?? '') !== '') {
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
  a: EditorAdaptor,
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
  merge(a.getElementInfo(group.constructOffset)?.bounds)
  for (let offset = group.start; offset <= group.end; offset++) {
    merge(a.getElementInfo(offset)?.bounds)
  }
  if (group.command === 'overbrace' || group.command === 'underbrace') {
    // Include the script run in the highlighted construct bounds.
    for (let offset = group.constructOffset - 1; offset > group.end; offset--) {
      merge(a.getElementInfo(offset)?.bounds)
    }
  }
  return bounds
}

function accentAtPoint(a: EditorAdaptor, x: number, y: number): AccentGroup | null {
  if (braceAnnotationOffsetAtPoint(a, x, y) != null) {
    return null
  }
  for (let offset = 0; offset <= a.lastOffset; offset++) {
    const group = accentGroupAtOffset(a, offset)
    if (!group) {
      continue
    }
    const bounds = accentBoundsAt(a, group)
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
  a: EditorAdaptor,
  x: number,
  y: number,
): number | null {
  for (let constructOffset = 0; constructOffset <= a.lastOffset; constructOffset++) {
    const group = accentGroupAtOffset(a, constructOffset)
    if (!group || (group.command !== 'overbrace' && group.command !== 'underbrace')) {
      continue
    }
    for (let offset = group.end + 1; offset < group.constructOffset; offset++) {
      const info = a.getElementInfo(offset)
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
function accentGroupAtAtom(a: EditorAdaptor, atom: number): AccentGroup | null {
  for (let offset = 0; offset <= a.lastOffset; offset++) {
    const group = accentGroupAtOffset(a, offset)
    if (group && atom >= group.start && atom <= group.end) {
      return group
    }
  }
  return null
}

// The accent whose argument currently contains the caret (the caret sits inside
// the argument's content, between the branch start and the construct atom).
function accentGroupAtCaret(a: EditorAdaptor): AccentGroup | null {
  const pos = a.position
  for (let offset = 0; offset <= a.lastOffset; offset++) {
    const group = accentGroupAtOffset(a, offset)
    if (group && pos >= group.start - 1 && pos <= group.end) {
      return group
    }
  }
  return null
}

// An accent whose argument is still the empty placeholder is handled by the
// placeholder click path (placeholderAtPoint -> enterPlaceholder), which selects
// the placeholder; the accent path below only re-enters filled arguments.
function isAccentArgEmpty(a: EditorAdaptor, group: AccentGroup): boolean {
  return (
    group.start === group.end &&
    PLACEHOLDER_LATEX_RE.test(a.getElementInfo(group.start)?.latex ?? '')
  )
}

function reenterAccent(a: EditorAdaptor, group: AccentGroup): void {
  a.focusKeyboard()
  a.position = Math.min(group.end, a.lastOffset)
  onSelectionChange()
}

// MathLive treats an accent construct as opaque to arrow navigation: a single
// ArrowLeft/ArrowRight skips the whole argument instead of stepping through it.
// Step the caret one position at a time across the accent's extent (the branch
// start immediately before the argument through the atom just after it) so the
// argument is navigable like a Text box.
function accentArrowTarget(a: EditorAdaptor, key: 'ArrowLeft' | 'ArrowRight'): number | null {
  if (!a.selectionIsCollapsed) {
    return null
  }
  const pos = a.position
  for (let offset = 0; offset <= a.lastOffset; offset++) {
    const group = accentGroupAtOffset(a, offset)
    if (!group) {
      continue
    }
    const before = group.start - 2
    const after = group.end + 1
    if (isAccentArgEmpty(a, group)) {
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
  const a = getAdaptor()
  if (!a) {
    return
  }
  if (contextMenuController.handlePointerDown(a, event)) return
  // Clicking an empty Text box: take over the click so the caret lands in
  // front of the gray "Text" word and the field really gets keyboard focus
  // (MathLive's own click handling lands on the invisible phantom atoms and
  // can leave the focus on the body).
  const emptyGroup = emptyTextGroupAtPoint(a, event.clientX, event.clientY)
  if (emptyGroup) {
    event.preventDefault()
    if (document.activeElement !== a.element) {
      a.blur()
    }
    a.focusKeyboard()
    a.position = Math.min(emptyGroup.start, a.lastOffset)
    caretArrivedByNavigation = false
    onSelectionChange()
    return
  }
  // Clicking a filled accent (or the accent glyph over it): MathLive maps the
  // click to either side of the opaque construct, so take over the click and
  // park the caret inside the argument (at its end) instead.
  const annotationOffset = braceAnnotationOffsetAtPoint(a, event.clientX, event.clientY)
  if (annotationOffset != null) {
    event.preventDefault()
    a.focusKeyboard()
    a.position = annotationOffset
    caretArrivedByNavigation = false
    onSelectionChange()
    return
  }
  const accent = accentAtPoint(a, event.clientX, event.clientY)
  if (
    accent &&
    !isAccentArgEmpty(a, accent) &&
    a.placeholderIndexAtPoint(event.clientX, event.clientY) < 0
  ) {
    event.preventDefault()
    if (document.activeElement !== a.element) {
      a.blur()
    }
    reenterAccent(a, accent)
    caretArrivedByNavigation = false
    return
  }
  let contentRight = -Infinity
  for (let offset = 0; offset <= a.lastOffset; offset++) {
    const bounds = a.getElementInfo(offset)?.bounds
    if (bounds && bounds.width >= 0.5) {
      contentRight = Math.max(contentRight, bounds.right)
    }
  }
  if (!Number.isFinite(contentRight) || event.clientX <= contentRight) {
    return
  }
  event.preventDefault()
  if (document.activeElement !== a.element) {
    a.blur()
  }
  a.focusKeyboard()
  a.position = a.lastOffset
  caretArrivedByNavigation = true
  onSelectionChange()
}

function onPointerUp(event: PointerEvent) {
  const a = getAdaptor()
  if (!a) {
    return
  }
  // Clicking an empty Text box: MathLive's click handler can leave the caret
  // just outside the box (at the zero-width left marker) without moving the
  // keyboard focus. Snap the caret in front of the gray "Text" word and make
  // sure the field actually receives keyboard input.
  const emptyGroup = emptyTextGroupAtPoint(a, event.clientX, event.clientY)
  if (emptyGroup) {
    const x = event.clientX
    const y = event.clientY
    requestAnimationFrame(() => {
      if (disposed || getAdaptor() !== a) {
        return
      }
      const group = emptyTextGroupAtPoint(a, x, y)
      if (!group) {
        return
      }
      a.focusKeyboard()
      a.position = Math.min(group.start, a.lastOffset)
      syncCaretInText()
      scheduleUpdateTextHints()
    })
    return
  }
  // Clicking a filled accent: re-apply the caret inside its argument after
  // MathLive's click handling settles (it may still move the caret to either
  // side of the opaque construct).
  const accent = accentAtPoint(a, event.clientX, event.clientY)
  if (
    accent &&
    !isAccentArgEmpty(a, accent) &&
    a.placeholderIndexAtPoint(event.clientX, event.clientY) < 0
  ) {
    const x = event.clientX
    const y = event.clientY
    requestAnimationFrame(() => {
      if (disposed || getAdaptor() !== a) {
        return
      }
      const group = accentAtPoint(a, x, y)
      if (!group || isAccentArgEmpty(a, group)) {
        return
      }
      reenterAccent(a, group)
    })
    return
  }
  if (a.placeholderIndexAtPoint(event.clientX, event.clientY) < 0) {
    return
  }
  if (!a.selectionIsCollapsed) {
    // A working placeholder was already selected by MathLive itself.
    return
  }
  let offset = a.getOffsetFromPoint(event.clientX, event.clientY)
  if (!Number.isInteger(offset) || offset < 0) {
    // Clicking an accent glyph can map to no offset; fall back to the end so
    // the placeholder navigation below can still reach the placeholder.
    offset = a.lastOffset
  }
  const valueAtClick = a.value
  requestAnimationFrame(() => {
    if (a.value !== valueAtClick) {
      return
    }
    a.enterPlaceholder(offset)
    // MathLive's focus handling can settle asynchronously after the click and
    // revert the selection; re-apply once on the next frame (unless the user
    // already typed in the meantime).
    requestAnimationFrame(() => {
      if (a.value === valueAtClick) {
        a.enterPlaceholder(offset)
      }
    })
  })
}

function setLatex(value: string) {
  const a = getAdaptor()
  if (!a) {
    return
  }
  a.loadPublicLatex(value)
  publishState(a)
  scheduleUpdateTextHints()
}

function undo() {
  const a = getAdaptor()
  if (!a) return
  const entry = equationDocument.undo()
  if (!entry) return
  a.loadPublicLatex(entry.latex)
  a.position = Math.min(entry.position, a.lastOffset)
  publishState(a, false)
  scheduleUpdateTextHints()
}

function redo() {
  const a = getAdaptor()
  if (!a) return
  const entry = equationDocument.redo()
  if (!entry) return
  a.loadPublicLatex(entry.latex)
  a.position = Math.min(entry.position, a.lastOffset)
  publishState(a, false)
  scheduleUpdateTextHints()
}

function clear() {
  const a = getAdaptor()
  if (!a) {
    return
  }
  if (a.value !== '') {
    a.value = ''
  }
  a.ensureMathMode()
  publishState(a)
  scheduleUpdateTextHints()
}

function focus() {
  getAdaptor()?.focus()
}

function setFontSize(px: number) {
  getAdaptor()?.setFontSize(px)
  dragController.setFontSize(px)
  scheduleUpdateTextHints()
}

function setDisplayStyle(value: boolean) {
  getAdaptor()?.setDisplayStyle(value)
  dragController.setDisplayStyle(value)
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown)
  document.addEventListener('click', autocompleteController.onSuggestionClick, true)
  void ensureAdaptor()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown)
  document.removeEventListener('click', autocompleteController.onSuggestionClick, true)
  disposed = true
  dragController.dispose()
  cancelAnimationFrame(textHintRaf)
  ;(getAdaptor() as MathLiveEditorAdaptor | null)?.dispose()
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
          @input="onMfInput"
          @keydown.capture="onMfKeydown"
          @beforeinput.capture="onBeforeInput"
          @compositionstart.capture="onCompositionStart"
          @compositionupdate.capture="onCompositionUpdate"
          @compositionend.capture="onCompositionEnd"
          @pointerdown.capture="onMfPointerDown"
          @contextmenu.capture="onMfContextMenu"
          @undo-state-change="onUndoStateChange"
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
