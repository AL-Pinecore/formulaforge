<script setup lang="ts">
import type { MathfieldElement, LatexSyntaxError } from 'mathlive'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getElementById } from '~/data/equation-elements'
import { DRAG_ELEMENT_MIME, draggedElementId } from '~/utils/drag-payload'
import { restoreEmptyGroupLatex } from '~/utils/empty-group'
import { renderEquationSvg, stripXmlDeclaration } from '~/utils/svg-export'
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
let previewRenderId = 0
let lastPreviewKey = ''
let dragOffset = -1
let restoreTimer: ReturnType<typeof setTimeout> | null = null

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
  // Offscreen: this field only computes the post-insertion LaTeX, it is never
  // rendered to the user (the preview is drawn as an SVG overlay instead).
  // It must keep its natural width — a 1px width makes MathLive line-break and
  // truncate the value to the first element.
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
  let offset = mf.getOffsetFromPoint(event.clientX, event.clientY)
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
  const key = `${element.id}|${mf.value}|${dragOffset}`
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

async function renderPreview(element: EquationElement) {
  const mf = getMf()
  const mirror = mirrorField
  if (!mf || !mirror) {
    return
  }
  const id = ++previewRenderId
  mirror.value = mf.value
  mirror.position = dragOffset >= 0 ? dragOffset : mf.position
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
  try {
    const result = await renderEquationSvg(previewLatex, {
      display: false,
      color: '#1a1a1a',
      padding: 8,
      scale: 1,
    })
    if (id !== previewRenderId || !dragging.value) {
      return
    }
    const rect = mf.getBoundingClientRect()
    previewBox.value = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    insertionPreview.value = stripXmlDeclaration(result.svg)
  } catch {
    if (id === previewRenderId && dragging.value) {
      insertionPreview.value = null
      previewBox.value = null
    }
  }
}

function hidePreview() {
  cancelAnimationFrame(previewRaf)
  lastPreviewKey = ''
  dragOffset = -1
  previewRenderId++
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
      void insertElement(element, offset)
      return
    }
  }
  const text = dataTransfer?.getData('text/plain')?.trim()
  if (text) {
    void insertLatex(text, offset)
  }
}

async function insertElement(element: EquationElement, targetOffset?: number) {
  const mf = await ensureMathfield()
  if (!mf) {
    emit('toast', 'The equation editor is not ready yet.', 'error')
    return
  }
  if (targetOffset != null && Number.isInteger(targetOffset) && targetOffset >= 0) {
    mf.position = targetOffset
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

function scheduleRestorePlaceholders(mf: MathfieldElement) {
  if (restoreTimer) {
    clearTimeout(restoreTimer)
  }
  restoreTimer = setTimeout(() => {
    restoreTimer = null
    restoreEmptyGroups(mf)
  }, 200)
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

// Workaround for MathLive bug arnog/mathlive#2806/#2926: clicking a placeholder
// inside an accent (hat, bar, vec, ...) does not move the caret into it. The
// accent glyph overlays the placeholder box, so we detect the click by geometry
// and drive the caret into the placeholder with the navigation commands. The
// selection is only assigned after MathLive's own click/focus handling has
// settled (rAF) and without any focus() call, both of which otherwise leave the
// keyboard input state broken.
function placeholderAtPoint(mf: MathfieldElement, x: number, y: number): boolean {
  const root = mf.shadowRoot
  if (!root) {
    return false
  }
  for (const node of root.querySelectorAll('*')) {
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
}

.insertion-preview :deep(svg) {
  max-width: 100%;
  height: auto;
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
