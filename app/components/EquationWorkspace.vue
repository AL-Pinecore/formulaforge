<script setup lang="ts">
import { convertLatexToMarkup } from 'mathlive'
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
  // Offscreen & hidden: this field only computes the post-insertion LaTeX, it
  // is never rendered to the user (the preview is drawn as MathLive markup).
  mirror.style.position = 'fixed'
  mirror.style.left = '-10000px'
  mirror.style.top = '0'
  mirror.style.visibility = 'hidden'
  mirror.style.pointerEvents = 'none'
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
  // Position the mirror over the field (invisible) so its placeholder boxes
  // share the field's coordinates for hit-testing.
  mirror.style.left = `${rect.left}px`
  mirror.style.top = `${rect.top}px`
  mirror.style.width = `${rect.width}px`
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
  const previewLatex = mirror.value.replace(/\\placeholder(?:\[[^\]]*\])?\{\}/g, '\\square')
  const markup = convertLatexToMarkup(previewLatex, { letterShapeStyle: 'tex' })
  previewBox.value = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  insertionPreview.value = markup
}

function hidePreview() {
  cancelAnimationFrame(previewRaf)
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

// Map the caret (model offset) to a string offset in mf.value. getValue(0,
// position) is not a reliable prefix when the caret sits inside a placeholder
// or operator branch, so instead count placeholder atoms before the caret and
// locate the matching `\placeholder{}` token in the serialized value.
function placeholderCaretOffset(mf: MathfieldElement): number {
  let index = 0
  for (let offset = 0; offset < mf.position; offset++) {
    const info = mf.getElementInfo(offset)
    if (info?.latex != null && /^\\placeholder(?:\[[^\]]*\])?\{\}$/.test(info.latex)) {
      index++
    }
  }
  const re = /\\placeholder(?:\[[^\]]*\])?\{\}/g
  let match
  let i = 0
  while ((match = re.exec(mf.value))) {
    if (i === index) {
      const openBrace = match[0].lastIndexOf('{')
      return match.index + openBrace + 1
    }
    i++
  }
  return -1
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
  const caretString = placeholderCaretOffset(mf)
  if (caretString < 0) {
    return
  }
  const result = removeElementAtPlaceholder(mf.value, caretString)
  if (!result) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  mf.setValue(result.latex, { silenceNotifications: true })
  mf.position = stringOffsetToModel(mf, result.caretOffset)
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
        minHeight: `${previewBox?.height ?? 0}px`,
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
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 200px;
  padding: 24px;
  border-radius: 8px;
  background: var(--paper-bg);
  box-shadow: var(--paper-shadow);
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
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  box-sizing: border-box;
  padding: 6px;
  pointer-events: none;
  background: var(--paper-bg);
  border-radius: 8px;
  overflow: hidden;
  line-height: 1;
}

.workspace-drop-hint {
  position: sticky;
  bottom: 12px;
  align-self: center;
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
