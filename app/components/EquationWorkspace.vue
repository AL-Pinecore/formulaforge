<script setup lang="ts">
import type { MathfieldElement, LatexSyntaxError } from 'mathlive'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getElementById } from '~/data/equation-elements'
import { DRAG_ELEMENT_MIME, draggedElementId } from '~/utils/drag-payload'
import { restoreEmptyGroupLatex } from '~/utils/empty-group'
import { removeElementAtPlaceholder } from '~/utils/remove-empty-element'
import type { EquationElement } from '~/types/equation'

const props = defineProps<{ fontSize: number }>()

const emit = defineEmits<{
  'latex-change': [value: string, errors: string[]]
  'undo-state': [canUndo: boolean, canRedo: boolean]
  toast: [message: string, kind: 'success' | 'error']
}>()

const PREVIEW_GREY = '#9ca3af'
const PLACEHOLDER_GLYPH = '▢'
const PLACEHOLDER_CLICK_PAD = 10
const TEXT_FILE_EXTENSIONS = ['tex', 'latex', 'txt', 'md', 'markdown']
const MAX_FILE_SIZE = 1_000_000

const containerEl = ref<HTMLDivElement | null>(null)
const dragging = ref(false)
const insertionPreview = ref<string | null>(null)
const previewBox = ref<{ left: number; top: number; width: number; height: number } | null>(null)
let mathfield: MathfieldElement | null = null
let mirrorField: MathfieldElement | null = null
let disposed = false
let previewRaf = 0
let snapshotRaf = 0
let snapshotTimer: ReturnType<typeof setTimeout> | null = null
let lastPreviewKey = ''
let dragOffset = -1
let dragPlaceholderIndex = -1
let dragX = -1
let dragY = -1
let restoreTimer: ReturnType<typeof setTimeout> | null = null

// MathLive's getOffsetFromPoint is unreliable with sub/superscripts and groups:
// it returns 0 (the start of the formula) for many positions, which makes the
// drag preview jump to the beginning. Instead, derive the caret offset from the
// per-atom bounding boxes reported by getElementInfo, which are accurate.
interface OffsetEdge {
  x: number
  offset: number
  depth: number
}

let offsetEdgesKey = ''
let offsetEdges: OffsetEdge[] = []

function buildOffsetEdges(mf: MathfieldElement, left: number, right: number): OffsetEdge[] {
  const key = `${mf.value}|${Math.round(right - left)}`
  if (key === offsetEdgesKey) {
    return offsetEdges
  }
  const edges: OffsetEdge[] = [
    { x: left, offset: 0, depth: 0 },
    { x: right, offset: mf.lastOffset, depth: 0 },
  ]
  for (let offset = 1; offset < mf.lastOffset; offset++) {
    const info = mf.getElementInfo(offset)
    const bounds = info?.bounds
    if (!bounds || bounds.width < 0.5) {
      continue
    }
    const depth = info?.depth ?? 0
    edges.push({ x: bounds.left, offset: offset - 1, depth })
    edges.push({ x: bounds.right, offset, depth })
  }
  edges.sort((a, b) => a.x - b.x)
  offsetEdgesKey = key
  offsetEdges = edges
  return edges
}

function offsetFromPoint(mf: MathfieldElement, x: number, y: number): number {
  const root = mf.shadowRoot
  const latex = root?.querySelector('.ML__latex') as HTMLElement | null
  if (!root || !latex) {
    return -1
  }
  const rect = latex.getBoundingClientRect()
  if (x < rect.left - 4 || x > rect.right + 4 || y < rect.top - 8 || y > rect.bottom + 8) {
    return -1
  }
  if (mf.lastOffset <= 0) {
    return 0
  }
  const edges = buildOffsetEdges(mf, rect.left, rect.right)
  let best = edges[0]!
  let bestDistance = Infinity
  for (const edge of edges) {
    const distance = Math.abs(edge.x - x)
    if (distance < bestDistance || (distance === bestDistance && edge.depth > best.depth)) {
      bestDistance = distance
      best = edge
    }
  }
  return Math.max(0, Math.min(mf.lastOffset, best.offset))
}

function getMf(): MathfieldElement | null {
  return mathfield
}

function formatLatexErrors(errors: readonly LatexSyntaxError[]): string[] {
  return errors.map((error) => {
    const code = error.code.replace(/-/g, ' ')
    const near = error.latex ? ` near '${error.latex}'` : ''
    return `LaTeX ${code}${near}`
  })
}

function publishState(mf: MathfieldElement) {
  emit('latex-change', mf.value, formatLatexErrors(mf.errors ?? []))
  emit('undo-state', mf.canUndo(), mf.canRedo())
}

function onMfInput(mf: MathfieldElement) {
  publishState(mf)
  scheduleRestorePlaceholders(mf)
}

function onUndoStateChange(mf: MathfieldElement) {
  emit('undo-state', mf.canUndo(), mf.canRedo())
}

function hasDragPayload(event: DragEvent): boolean {
  const types = event.dataTransfer?.types
  const typeList = types ? Array.from(types) : []
  return Boolean(
    draggedElementId.value ||
      typeList.includes(DRAG_ELEMENT_MIME) ||
      typeList.includes('text/plain') ||
      typeList.includes('Files') ||
      (event.dataTransfer && event.dataTransfer.files.length > 0),
  )
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

function configureMathfield(mf: MathfieldElement) {
  mf.placeholder = 'Type LaTeX or drag elements here…'
  mf.mathVirtualKeyboardPolicy = 'manual'
  mf.style.fontSize = `${props.fontSize}px`
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

async function ensureMirrorField(): Promise<MathfieldElement | null> {
  if (mirrorField) {
    return mirrorField
  }
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
  // Offscreen & hidden: this field computes the post-insertion LaTeX and is
  // briefly shown over the real field as the insertion preview. It must match
  // the field's box model (transparent background, text color, no selection
  // highlight) so the preview is pixel-identical to the final result.
  mirror.style.position = 'fixed'
  mirror.style.left = '-10000px'
  mirror.style.top = '0'
  mirror.style.visibility = 'hidden'
  mirror.style.pointerEvents = 'none'
  mirror.style.background = 'transparent'
  mirror.style.color = 'var(--text)'
  mirror.style.zIndex = '50'
  mirror.style.setProperty('--selection-background-color', 'transparent')
  mirror.style.setProperty('--contains-highlight-background-color', 'transparent')
  mirror.style.fontSize = `${props.fontSize}px`
  document.body.appendChild(mirror)
  mirrorField = mirror
  return mirror
}

function updateInsertionPreview(event: DragEvent) {
  const element = draggedElementId.value ? getElementById(draggedElementId.value) : undefined
  const mf = getMf()
  if (!element || !mf) {
    hidePreview()
    return
  }
  let offset = offsetFromPoint(mf, event.clientX, event.clientY)
  if (!Number.isInteger(offset) || offset < 0) {
    // The cursor is over the field's empty area; clamp to the end of the
    // content instead of falling back to the caret (which would make the
    // preview jump around).
    const rect = mf.getBoundingClientRect()
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    offset = inside ? mf.lastOffset : -1
  }
  dragOffset = offset
  dragPlaceholderIndex = placeholderIndexAtPoint(mf, event.clientX, event.clientY)
  dragX = event.clientX
  dragY = event.clientY
  const key =
    dragPlaceholderIndex >= 0
      ? `${element.id}|${mf.value}|placeholder:${dragPlaceholderIndex}`
      : `${element.id}|${mf.value}|${dragOffset}`
  if (key === lastPreviewKey) {
    return
  }
  lastPreviewKey = key
  cancelAnimationFrame(previewRaf)
  previewRaf = requestAnimationFrame(async () => {
    await ensureMirrorField()
    if (!dragging.value) {
      return
    }
    void renderPreview(element)
  })
}

function renderPreview(element: EquationElement) {
  const mf = getMf()
  const mirror = mirrorField
  if (!mf || !mirror) {
    return
  }
  const rect = mf.getBoundingClientRect()
  // Position the mirror exactly over the field so the preview shares the
  // field's box (and its placeholder boxes the field's coordinates for
  // hit-testing). The mirror is rendered by the same MathLive renderer as the
  // field, so the preview is pixel-identical to the final result.
  mirror.style.left = `${rect.left}px`
  mirror.style.top = `${rect.top}px`
  mirror.style.width = `${rect.width}px`
  mirror.style.height = `${rect.height}px`
  mirror.value = mf.value
  let positionSet = false
  if (dragPlaceholderIndex >= 0) {
    positionSet = selectPlaceholderAtPoint(mirror, dragX, dragY)
  }
  if (!positionSet) {
    mirror.position = dragOffset >= 0 ? dragOffset : mf.position
  }
  mirror.insert(element.latex, {
    insertionMode: 'replaceSelection',
    selectionMode: 'item',
    format: 'latex',
    silenceNotifications: true,
  })
  const range = mirror.selection?.ranges?.[0]
  if (range && range[0] !== range[1]) {
    mirror.applyStyle({ color: PREVIEW_GREY }, { range })
  }
  schedulePreviewSnapshot(mirror)
}

// MathLive renders fields asynchronously (on the next animation frame), so the
// mirror must not be shown directly — that would flash stale content. Instead,
// snapshot its rendered DOM once it has settled and display the snapshot as a
// static, pixel-identical overlay. A rAF gives the fast path in real browsers;
// a setTimeout fallback covers environments that suppress nested rAF callbacks
// (e.g. happy-dom) — the two are idempotent.
function schedulePreviewSnapshot(mirror: MathfieldElement) {
  const run = () => {
    if (!dragging.value || disposed) {
      return
    }
    snapshotPreview(mirror)
  }
  cancelAnimationFrame(snapshotRaf)
  if (snapshotTimer) {
    clearTimeout(snapshotTimer)
    snapshotTimer = null
  }
  snapshotRaf = requestAnimationFrame(run)
  snapshotTimer = setTimeout(run, 32)
}

function snapshotPreview(mirror: MathfieldElement) {
  const latex = mirror.shadowRoot?.querySelector('.ML__latex') as HTMLElement | null
  if (!latex) {
    insertionPreview.value = null
    previewBox.value = null
    return
  }
  // Hide the real field while the preview is up so its original (un-reflowed)
  // content never shows through — including placeholder boxes whose top edge
  // would otherwise peek above the overlay.
  const mf = getMf()
  if (mf) {
    mf.style.visibility = 'hidden'
  }
  const box = latex.getBoundingClientRect()
  previewBox.value = { left: box.left, top: box.top, width: box.width, height: box.height }
  insertionPreview.value = `<span class="ML__container">${latex.outerHTML}</span>`
}

function hidePreview() {
  cancelAnimationFrame(previewRaf)
  cancelAnimationFrame(snapshotRaf)
  if (snapshotTimer) {
    clearTimeout(snapshotTimer)
    snapshotTimer = null
  }
  if (mathfield) {
    mathfield.style.visibility = ''
  }
  lastPreviewKey = ''
  dragOffset = -1
  dragPlaceholderIndex = -1
  dragX = -1
  dragY = -1
  insertionPreview.value = null
  previewBox.value = null
}

function onDragOver(event: DragEvent) {
  if (!hasDragPayload(event)) {
    return
  }
  event.preventDefault()
  dragging.value = true
  updateInsertionPreview(event)
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
}

function onDragLeave(event: DragEvent) {
  const related = event.relatedTarget
  if (!related || !containerEl.value?.contains(related as Node)) {
    dragging.value = false
    hidePreview()
  }
}

function onDrop(event: DragEvent) {
  event.preventDefault()
  const offset = dragOffset
  const placeholderIndex = dragPlaceholderIndex
  const x = dragX
  const y = dragY
  dragging.value = false
  hidePreview()
  const dataTransfer = event.dataTransfer
  const typeList = dataTransfer?.types ? Array.from(dataTransfer.types) : []

  const file = dataTransfer?.files?.[0]
  if (file) {
    if (!isAcceptedTextFile(file)) {
      emit('toast', 'Only text files (.tex, .txt) can be loaded.', 'error')
      return
    }
    file
      .text()
      .then((contents) => {
        const mf = getMf()
        if (!mf || !contents.trim()) {
          return
        }
        if (mf.value !== contents) {
          mf.setValue(contents, { silenceNotifications: true })
        }
        publishState(mf)
        emit('toast', `Loaded ${file.name}`, 'success')
      })
      .catch(() => emit('toast', 'Could not read the dropped file.', 'error'))
    return
  }

  // Only trust the in-memory id when the drag payload advertises the custom
  // MIME type; a stale id must not hijack plain-text or file drops.
  const id =
    dataTransfer?.getData(DRAG_ELEMENT_MIME) ||
    (typeList.includes(DRAG_ELEMENT_MIME) ? draggedElementId.value : null)
  draggedElementId.value = null
  if (id) {
    const element = getElementById(id)
    if (element) {
      void insertElement(element, offset, placeholderIndex, x, y)
      return
    }
  }
  const text = dataTransfer?.getData('text/plain')?.trim()
  if (text) {
    void insertLatex(text, offset)
  }
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
    emit('toast', 'The equation editor is not ready yet.', 'error')
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
  mf.insert(element.latex, {
    selectionMode: 'placeholder',
    focus: true,
    scrollIntoView: true,
  })
}

async function insertLatex(text: string, targetOffset?: number) {
  const mf = await ensureMathfield()
  if (!mf) {
    emit('toast', 'The equation editor is not ready yet.', 'error')
    return
  }
  if (targetOffset != null && Number.isInteger(targetOffset) && targetOffset >= 0) {
    mf.position = targetOffset
  }
  mf.insert(text, {
    selectionMode: 'placeholder',
    focus: true,
    scrollIntoView: true,
  })
}

const RESTORE_PLACEHOLDER_DELAY = 30

function scheduleRestorePlaceholders(mf: MathfieldElement) {
  if (restoreTimer) {
    clearTimeout(restoreTimer)
  }
  restoreTimer = setTimeout(() => {
    restoreTimer = null
    restoreEmptyGroups(mf)
  }, RESTORE_PLACEHOLDER_DELAY)
}

function restoreEmptyGroups(mf: MathfieldElement) {
  if (disposed || !mf.hasFocus()) {
    return
  }
  const fixed = restoreEmptyGroupLatex(mf.value)
  if (fixed === null || fixed === mf.value) {
    return
  }
  mf.setValue(fixed)
  publishState(mf)
  mf.position = 0
  mf.executeCommand('moveToNextPlaceholder')
}

function stringOffsetToModel(mf: MathfieldElement, stringOffset: number): number {
  let lo = 0
  let hi = mf.lastOffset
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (mf.getValue(0, mid).length <= stringOffset) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  return lo
}

const CARET_MARKER = '\\bigstar'

// Locate the placeholder under the caret in the serialized LaTeX. Model
// offsets do not map reliably to string offsets inside operator branches
// (a sum's scripts serialize in the opposite order of the model, so counting
// placeholder atoms before the caret lands on the wrong token). Instead the
// caret's placeholder is briefly replaced by a unique marker, located in the
// serialized value, and the original value is restored immediately. Undo
// recording is paused so the round-trip leaves the undo history untouched.
function unwrapElementAtCaret(mf: MathfieldElement): { latex: string; caretOffset: number } | null {
  const original = mf.value
  const controls = mf as unknown as { stopRecording?: () => void; startRecording?: () => void }
  controls.stopRecording?.()
  let marked = ''
  try {
    mf.insert(CARET_MARKER, {
      insertionMode: 'replaceSelection',
      format: 'latex',
      silenceNotifications: true,
    })
    marked = mf.value
  } catch {
    marked = ''
  } finally {
    controls.startRecording?.()
  }
  mf.setValue(original, { silenceNotifications: true })
  const markerIndex = marked.indexOf(CARET_MARKER)
  if (markerIndex < 0 || marked.indexOf(CARET_MARKER, markerIndex + 1) >= 0) {
    return null
  }
  const latex = marked.replace(CARET_MARKER, '\\placeholder{}')
  return removeElementAtPlaceholder(latex, markerIndex + '\\placeholder{}'.length)
}

// When the caret sits inside a placeholder that is the sole content of its
// slot, Backspace/Delete removes the whole enclosing element (promoting any
// real content from sibling slots) instead of just deleting the placeholder.
function onMfKeydown(event: KeyboardEvent) {
  if (event.key !== 'Backspace' && event.key !== 'Delete') {
    return
  }
  const mf = getMf()
  if (!mf || !mf.hasFocus()) {
    return
  }
  const info = mf.getElementInfo(mf.position)
  const isPlaceholder =
    info?.latex != null && /^\\placeholder(?:\[[^\]]*\])?\{\}$/.test(info.latex)
  if (!isPlaceholder) {
    return
  }
  const result = unwrapElementAtCaret(mf)
  if (!result) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  const restored = restoreEmptyGroupLatex(result.latex) ?? result.latex
  mf.setValue(restored, { silenceNotifications: true })
  mf.position = stringOffsetToModel(mf, result.caretOffset)
  if (restored !== result.latex) {
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

function placeholderIndexAtPoint(mf: MathfieldElement, x: number, y: number): number {
  const root = mf.shadowRoot
  if (!root) {
    return -1
  }
  let index = 0
  for (const node of root.querySelectorAll('*')) {
    if (node.textContent?.trim() !== PLACEHOLDER_GLYPH) {
      continue
    }
    const rect = node.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      if (
        x >= rect.left - PLACEHOLDER_CLICK_PAD &&
        x <= rect.right + PLACEHOLDER_CLICK_PAD &&
        y >= rect.top - PLACEHOLDER_CLICK_PAD &&
        y <= rect.bottom + PLACEHOLDER_CLICK_PAD
      ) {
        return index
      }
      index++
    }
  }
  return -1
}

// Select the placeholder (in model order) whose rendered box contains the
// given point. MathLive's moveToNextPlaceholder walks placeholders in model
// order, so this handles structures where the visual order differs from the
// model order (e.g. \sum's sub/superscript).
function selectedPlaceholderAtPoint(mf: MathfieldElement, x: number, y: number): boolean {
  const root = mf.shadowRoot
  if (!root) {
    return false
  }
  for (const node of root.querySelectorAll('.ML__selected')) {
    if (node.textContent?.trim() !== PLACEHOLDER_GLYPH) {
      continue
    }
    const rect = node.getBoundingClientRect()
    if (
      rect.width > 0 &&
      rect.height > 0 &&
      x >= rect.left - PLACEHOLDER_CLICK_PAD &&
      x <= rect.right + PLACEHOLDER_CLICK_PAD &&
      y >= rect.top - PLACEHOLDER_CLICK_PAD &&
      y <= rect.bottom + PLACEHOLDER_CLICK_PAD
    ) {
      return true
    }
  }
  return false
}

function selectPlaceholderAtPoint(mf: MathfieldElement, x: number, y: number): boolean {
  mf.position = 0
  let prevStart = -1
  for (let i = 0; i < 64; i++) {
    mf.executeCommand('moveToNextPlaceholder')
    const start = mf.selection?.ranges?.[0]?.[0]
    if (typeof start !== 'number' || start === prevStart) {
      return false
    }
    prevStart = start
    if (selectedPlaceholderAtPoint(mf, x, y)) {
      return true
    }
  }
  return false
}

function enterPlaceholder(mf: MathfieldElement, offset: number) {
  if (!mf.selectionIsCollapsed) {
    return
  }
  mf.position = offset
  mf.executeCommand(
    offset >= mf.lastOffset ? 'moveToPreviousPlaceholder' : 'moveToNextPlaceholder',
  )
}

function onPointerUp(event: PointerEvent) {
  const mf = getMf()
  if (!mf) {
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

function setLatex(value: string): { value: string; errors: string[] } {
  const mf = getMf()
  if (!mf) {
    return { value, errors: [] }
  }
  if (mf.value !== value) {
    mf.setValue(value, { silenceNotifications: true })
  }
  return { value: mf.value, errors: formatLatexErrors(mf.errors ?? []) }
}

function undo() {
  getMf()?.executeCommand('undo')
}

function redo() {
  getMf()?.executeCommand('redo')
}

function clear() {
  const mf = getMf()
  if (!mf) {
    return
  }
  if (mf.value !== '') {
    mf.value = ''
  }
  publishState(mf)
}

function focus() {
  getMf()?.focus()
}

function setFontSize(px: number) {
  const mf = getMf()
  if (mf) {
    mf.style.fontSize = `${px}px`
  }
  if (mirrorField) {
    mirrorField.style.fontSize = `${px}px`
  }
}

onMounted(() => {
  void ensureMathfield()
})

onBeforeUnmount(() => {
  disposed = true
  cancelAnimationFrame(previewRaf)
  cancelAnimationFrame(snapshotRaf)
  if (snapshotTimer) {
    clearTimeout(snapshotTimer)
    snapshotTimer = null
  }
  if (restoreTimer) {
    clearTimeout(restoreTimer)
    restoreTimer = null
  }
  if (mirrorField) {
    mirrorField.remove()
    mirrorField = null
  }
})

watch(() => props.fontSize, (px) => setFontSize(px))

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
        <math-field
          class="workspace-field"
          :style="{ fontSize: `${fontSize}px` }"
          @input="onMfInput($event.target as unknown as MathfieldElement)"
          @keydown.capture="onMfKeydown"
          @undo-state-change="onUndoStateChange($event.target as unknown as MathfieldElement)"
        ></math-field>
      </div>
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
          Drop to insert at the caret
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
  display: block;
  width: 100%;
  min-height: 90px;
  background: transparent;
  color: var(--text);
}

.insertion-preview {
  position: fixed;
  z-index: 50;
  pointer-events: none;
  background: transparent;
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
