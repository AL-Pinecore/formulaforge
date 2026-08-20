<script setup lang="ts">
import type { MathfieldElement, LatexSyntaxError } from 'mathlive'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getElementByCommand, getElementById } from '~/data/equation-elements'
import { DRAG_ELEMENT_MIME, draggedElementId } from '~/utils/drag-payload'
import { restoreEmptyGroupLatex } from '~/utils/empty-group'
import { isAccentConstructLatex } from '~/utils/accent'
import { FONT_STYLES, FONT_STYLE_TEXT_COMMANDS, isFontStyleElement } from '~/utils/font-styles'
import { ensurePlaceholderSupport } from '~/utils/mathfield-placeholder'
import { ensureAccentPositioning } from '~/utils/mathfield-accent'
import { removeElementAtPlaceholder } from '~/utils/remove-empty-element'
import { normalizePortableLatex } from '~/utils/latex-normalize'
import { DISABLED_LATEX_AUTOCOMPLETE_COMMANDS } from '~/utils/latex-autocomplete'
import { matrixCommandsForKey, type MatrixCommand } from '~/utils/matrix'
import {
  addTextBoundaries,
  emptyTextSentinelLatex,
  isEmptyTextLatex,
  isTextCommandLatex,
  mergeAdjacentTextCommands,
  removeOrphanedTextBoundaries,
  stripEmptyTextSentinel,
  stripTextBoundaries,
  TEXT_BOUNDARY_LATEX,
  textHintFont,
  textHintText,
  withEmptyTextSentinel,
} from '~/utils/text-boundary'
import type { EquationElement } from '~/types/equation'
import { useI18n } from '~/composables/useI18n'
import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from '~/composables/useEquationExport'

const props = withDefaults(defineProps<{ fontSize: number; displayStyle?: boolean }>(), {
  displayStyle: true,
})

const emit = defineEmits<{
  'latex-change': [value: string, errors: string[]]
  'undo-state': [canUndo: boolean, canRedo: boolean]
  toast: [message: string, kind: 'success' | 'error']
}>()

const { t } = useI18n()

const PREVIEW_GREY = '#9ca3af'
const PLACEHOLDER_GLYPH = '▢'
const PLACEHOLDER_CLICK_PAD = 10
const TEXT_FILE_EXTENSIONS = ['tex', 'latex', 'txt', 'md', 'markdown']
const MAX_FILE_SIZE = 1_000_000
// ponytail: practical ceiling; raise this if formulas genuinely need 100+ columns.
const MAX_MATRIX_COLUMNS = 100

type MatrixMenuCommand =
  | MatrixCommand
  | 'addColumnBefore'
  | 'addRowBefore'

interface MatrixMenuTarget {
  x: number
  y: number
  cell: boolean
  rows: number
  columns: number
  minColumns: number
}

const containerEl = ref<HTMLDivElement | null>(null)
const dragging = ref(false)
const matrixMenu = ref<MatrixMenuTarget | null>(null)
const matrixMenuItems = computed(() => {
  const target = matrixMenu.value
  if (!target) return []
  if (!target.cell) {
    return [
      { id: 'addRowAfter', label: t('matrix.addRow') },
      { id: 'addColumnAfter', label: t('matrix.addColumn') },
    ]
  }
  return [
    { id: 'addRowBefore', label: t('matrix.insertRowAbove') },
    { id: 'addRowAfter', label: t('matrix.insertRowBelow') },
    { id: 'addColumnBefore', label: t('matrix.insertColumnBefore'), dividerBefore: true },
    { id: 'addColumnAfter', label: t('matrix.insertColumnAfter') },
    {
      id: 'removeRow',
      label: t('matrix.deleteRow'),
      danger: true,
      disabled: target.rows <= 1,
      dividerBefore: true,
    },
    {
      id: 'removeColumn',
      label: t('matrix.deleteColumn'),
      danger: true,
      disabled: target.columns <= target.minColumns,
    },
  ]
})
const insertionPreview = ref<string | null>(null)
const previewBox = ref<{ left: number; top: number; width: number; height: number } | null>(null)
interface TextHint {
  left: number
  top: number
  width: number
  height: number
  text: string
  font: { fontFamily: string; fontWeight?: number; fontStyle?: string }
}
const textHints = ref<TextHint[]>([])
const previewTextHints = ref<TextHint[]>([])
const visibleTextHints = computed(() => insertionPreview.value ? previewTextHints.value : textHints.value)
const caretTextBox = ref<{ left: number; top: number; width: number; height: number } | null>(null)
const emptyTextCaretBox = ref<{ left: number; top: number; width: number; height: number } | null>(null)
let mathfield: MathfieldElement | null = null
let mirrorField: MathfieldElement | null = null
let disposed = false
let previewRaf = 0
let snapshotRaf = 0
let snapshotTimer: ReturnType<typeof setTimeout> | null = null
let textHintRaf = 0
let fractionRaf = 0
let fractionObserver: MutationObserver | null = null
let lastPreviewKey = ''
let dragOffset = -1
let dragPlaceholderIndex = -1
let dragApplyFont = false
let dragX = -1
let dragY = -1

interface HistoryEntry {
  latex: string
  position: number
}

const HISTORY_LIMIT = 1000
const history: HistoryEntry[] = []
let historyIndex = -1

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

// The model range of the whole `\text{...}` group containing the given point.
// Text atoms serialize to `\text{<char>}` per offset and report their bounds,
// so the atom under the point is found by geometry, then the group's bounds by
// walking over contiguous text atoms. Empty text boxes contain only invisible
// phantom atoms without bounds, so they are hit-tested through their two
// zero-width boundary markers instead.
function textGroupRangeAtPoint(
  mf: MathfieldElement,
  x: number,
  y: number,
): [number, number] | null {
  let atom = -1
  for (let offset = 0; offset <= mf.lastOffset; offset++) {
    const info = mf.getElementInfo(offset)
    const bounds = info?.bounds
    if (!bounds || bounds.width < 0.5) {
      continue
    }
    if (
      isTextAtom(mf, offset) &&
      x >= bounds.left &&
      x <= bounds.right &&
      y >= bounds.top &&
      y <= bounds.bottom
    ) {
      atom = offset
      break
    }
  }
  if (atom < 0) {
    const emptyGroup = emptyTextGroupAtPoint(mf, x, y)
    return emptyGroup ? [emptyGroup.start, emptyGroup.end] : null
  }
  let start = atom
  while (start > 0 && isTextAtom(mf, start - 1)) {
    start--
  }
  let end = atom + 1
  while (end <= mf.lastOffset && isTextAtom(mf, end)) {
    end++
  }
  return [Math.max(0, start - 1), Math.min(end, mf.lastOffset)]
}

function applyFontStyle(mf: MathfieldElement, id: string, x: number, y: number): boolean {
  const style = FONT_STYLES[id]
  if (!style) {
    return false
  }
  const group = textGroupAtPoint(mf, x, y) ?? emptyTextGroupAtPoint(mf, x, y)
  if (!group) {
    return false
  }
  // Dragging the same style again toggles it back off: `\text{x}` + Bold ->
  // `\textbf{x}`, and `\textbf{x}` + Bold -> `\text{x}`. Only text-mode
  // commands toggle; math-font boxes keep the plain apply behavior.
  const expected = FONT_STYLE_TEXT_COMMANDS[id]
  const operation: 'set' | 'toggle' =
    expected != null && group.command === expected ? 'toggle' : 'set'
  mf.applyStyle(style, { range: [group.start, group.end], operation })
  return true
}

// The model range, character count and content of the `\text{...}` group
// adjacent to the caret. Used to turn a backspace on the last remaining
// character into an empty text box instead of deleting the whole element.
interface TextGroup {
  start: number
  end: number
  first: number
  last: number
  count: number
  content: string
  command: string
  latex: string
  bounds: { left: number; top: number; width: number; height: number } | null
}

function isTextAtom(mf: MathfieldElement, offset: number): boolean {
  const latex = mf.getElementInfo(offset)?.latex
  return latex === TEXT_BOUNDARY_LATEX ? false : isTextCommandLatex(latex)
}

function isTextBoundaryAtom(mf: MathfieldElement, offset: number): boolean {
  return mf.getElementInfo(offset)?.latex === TEXT_BOUNDARY_LATEX
}

// A managed boundary is a zero-width marker that is directly attached to a Text
// atom. Standalone `\mkern0mu` typed by the user keeps its native behavior.
function isManagedBoundaryAtom(mf: MathfieldElement, offset: number): boolean {
  if (!isTextBoundaryAtom(mf, offset)) {
    return false
  }
  return isTextAtom(mf, offset - 1) || isTextAtom(mf, offset + 1)
}

// Move a collapsed caret across managed zero-width boundaries so a native
// deletion never edits the markers themselves. MathLive's model places the
// caret AFTER the atom at `position`: Backspace deletes the atom at `position`
// and Delete the atom at `position + 1`. When that target is a managed marker
// the caret steps over it: past a right marker into the text (per the user's
// intent, Delete right after a Text box edits the text), or across a left
// marker either into the text (Delete) or out of it (Backspace, which then
// edits whatever precedes the Text box).
function relocateCaretAcrossBoundaries(
  mf: MathfieldElement,
  key: 'Backspace' | 'Delete',
): number {
  let position = mf.position
  for (let guard = 0; guard < 4; guard++) {
    const target = key === 'Delete' ? position + 1 : position
    if (!isManagedBoundaryAtom(mf, target)) {
      break
    }
    if (isTextAtom(mf, target - 1)) {
      // Right boundary: pull the caret into the text.
      position = key === 'Delete' ? target - 2 : target - 1
    } else if (isTextAtom(mf, target + 1)) {
      // Left boundary: Delete steps into the text, Backspace steps out.
      position = key === 'Delete' ? target : target - 1
    } else {
      break
    }
    position = Math.max(0, Math.min(mf.lastOffset, position))
  }
  return position
}

function textAtomRunKey(mf: MathfieldElement, offset: number): string {
  const info = mf.getElementInfo(offset)
  return JSON.stringify([info?.mode, info?.style ?? null])
}

function decodeTextAtom(latex: string): string {
  const open = latex.indexOf('{')
  if (open < 0 || !latex.endsWith('}')) {
    return ''
  }
  return latex
    .slice(open + 1, -1)
    .replace(/\\textbackslash\{\}/g, '\\')
    .replace(/\\([\^~])\{\}/g, '$1')
    .replace(/\\([\\{}#$&^_~%])/g, '$1')
}

function textGroupFromAtom(mf: MathfieldElement, atom: number): TextGroup | null {
  if (!isTextAtom(mf, atom)) {
    return null
  }
  const runKey = textAtomRunKey(mf, atom)
  let first = atom
  while (
    first > 0 &&
    isTextAtom(mf, first - 1) &&
    textAtomRunKey(mf, first - 1) === runKey
  ) {
    first--
  }
  let last = atom
  while (
    last + 1 <= mf.lastOffset &&
    isTextAtom(mf, last + 1) &&
    textAtomRunKey(mf, last + 1) === runKey
  ) {
    last++
  }
  const content: string[] = []
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (let offset = first; offset <= last; offset++) {
    const info = mf.getElementInfo(offset)
    if (info?.latex) {
      content.push(decodeTextAtom(info.latex))
    }
    const bounds = info?.bounds
    if (bounds) {
      left = Math.min(left, bounds.left)
      top = Math.min(top, bounds.top)
      right = Math.max(right, bounds.right)
      bottom = Math.max(bottom, bounds.bottom)
    }
  }
  const start = Math.max(0, first - 1)
  const end = last
  const serialized = mf.getValue(start, end)
  const command = serialized.match(/^\\([a-zA-Z]+)\{/)?.[1] ?? 'text'
  return {
    start,
    end,
    first,
    last,
    count: last - first + 1,
    content: content.join(''),
    command,
    latex: serialized,
    bounds: Number.isFinite(left)
      ? { left, top, width: right - left, height: bottom - top }
      : null,
  }
}

function textGroupAtCaret(mf: MathfieldElement): TextGroup | null {
  const pos = mf.position
  // The branch-start atom immediately before the first text atom is the
  // insertion point in front of the first character.
  if (isTextAtom(mf, pos + 1)) {
    const group = textGroupFromAtom(mf, pos + 1)
    if (group?.start === pos) {
      return group
    }
  }
  // A caret on a zero-width marker with text to its right belongs to that
  // group; with text only to its left (the closing marker), it still belongs
  // to the group on the left.
  if (isTextBoundaryAtom(mf, pos) && isTextAtom(mf, pos + 1)) {
    return textGroupFromAtom(mf, pos + 1)
  }
  if (isTextAtom(mf, pos)) {
    return textGroupFromAtom(mf, pos)
  }
  if (isTextAtom(mf, pos - 1)) {
    return textGroupFromAtom(mf, pos - 1)
  }
  return null
}

function textGroupAtPoint(mf: MathfieldElement, x: number, y: number): TextGroup | null {
  for (let offset = 0; offset <= mf.lastOffset; offset++) {
    const info = mf.getElementInfo(offset)
    const bounds = info?.bounds
    if (
      isTextAtom(mf, offset) &&
      bounds &&
      x >= bounds.left - 2 &&
      x <= bounds.right + 2 &&
      y >= bounds.top - 4 &&
      y <= bounds.bottom + 4
    ) {
      return textGroupFromAtom(mf, offset)
    }
  }
  return null
}

// The empty text group containing the given point, hit-tested through the
// zero-width boundary markers around it (the phantom atoms report no bounds).
function emptyTextGroupAtPoint(mf: MathfieldElement, x: number, y: number): TextGroup | null {
  const seen = new Set<number>()
  for (let offset = 0; offset <= mf.lastOffset; offset++) {
    if (!isTextAtom(mf, offset)) {
      continue
    }
    const group = textGroupFromAtom(mf, offset)
    if (!group || !isEmptyTextLatex(group.latex) || seen.has(group.first)) {
      continue
    }
    seen.add(group.first)
    const leftMarker = mf.getElementInfo(group.start - 1)?.bounds
    const rightMarker = mf.getElementInfo(group.end + 1)?.bounds
    if (!leftMarker || !rightMarker) {
      continue
    }
    if (
      x >= leftMarker.right - 2 &&
      x <= rightMarker.left + 2 &&
      y >= leftMarker.top - 4 &&
      y <= leftMarker.bottom + 4
    ) {
      return group
    }
  }
  return null
}

// If the given model offset lies INSIDE a text group, clamp it to just outside
// the group (before it when the point is in the left half, after it in the
// right half) so dropped elements never get inserted into text content, where
// MathLive would re-serialize the whole formula as escaped text.
function clampOffsetOutsideText(mf: MathfieldElement, offset: number, x?: number): number {
  if (typeof mf.getElementInfo !== 'function') {
    return offset
  }
  for (let atom = Math.max(0, Math.min(offset, mf.lastOffset)); atom >= 0; atom--) {
    if (!isTextAtom(mf, atom)) {
      continue
    }
    const group = textGroupFromAtom(mf, atom)
    if (!group || offset < group.start || offset > group.end) {
      continue
    }
    const leftMarker = mf.getElementInfo(group.start - 1)?.bounds
    const rightMarker = mf.getElementInfo(group.end + 1)?.bounds
    const center = leftMarker && rightMarker ? (leftMarker.right + rightMarker.left) / 2 : null
    const insertAfter =
      x == null || center == null ? true : x >= center
    return Math.max(0, Math.min(mf.lastOffset, insertAfter ? group.end + 1 : group.start))
  }
  return offset
}

// The text group containing or directly adjacent to the given caret position.
function textGroupNearPosition(mf: MathfieldElement, position: number): TextGroup | null {
  for (let offset = 0; offset <= mf.lastOffset; offset++) {
    if (!isTextAtom(mf, offset)) {
      continue
    }
    const group = textGroupFromAtom(mf, offset)
    if (!group) {
      continue
    }
    if (position >= group.start - 1 && position <= group.end + 1) {
      return group
    }
    offset = group.last
  }
  return null
}

function formatLatexErrors(errors: readonly LatexSyntaxError[]): string[] {
  return errors.map((error) => {
    const code = error.code.replace(/-/g, ' ')
    const near = error.latex ? ` near '${error.latex}'` : ''
    return `LaTeX ${code}${near}`
  })
}

function disableNativeHistory(mf: MathfieldElement): void {
  const controls = mf as unknown as {
    stopRecording?: () => void
    resetUndo?: () => void
  }
  controls.stopRecording?.()
  controls.resetUndo?.()
}

function emitUndoState() {
  emit('undo-state', historyIndex > 0, historyIndex >= 0 && historyIndex < history.length - 1)
}

function recordHistory(mf: MathfieldElement): void {
  const entry = { latex: publicLatex(mf), position: mf.position }
  if (history[historyIndex]?.latex === entry.latex) {
    history[historyIndex] = entry
    return
  }
  history.splice(historyIndex + 1)
  history.push(entry)
  if (history.length > HISTORY_LIMIT) history.shift()
  historyIndex = history.length - 1
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

// The visual box reserved by an empty Text group, derived from its managed
// zero-width boundary markers because phantom atoms report no bounds.
interface VisualBox {
  left: number
  top: number
  width: number
  height: number
}

function emptyTextHintBox(mf: MathfieldElement, group: TextGroup): VisualBox | null {
  const leftMarker = mf.getElementInfo(group.start - 1)?.bounds
  const rightMarker = mf.getElementInfo(group.end + 1)?.bounds
  if (!leftMarker || !rightMarker) {
    return null
  }
  return {
    left: leftMarker.right,
    top: leftMarker.top,
    width: Math.max(0, rightMarker.left - leftMarker.right),
    height: leftMarker.bottom - leftMarker.top,
  }
}

// The empty Text box keeps an invisible `\phantom{Text}` so the gray "Text"
// hint overlaid at its position has room and pushes the surrounding content.
// The hint stays visible while the box is empty — even while the caret sits
// inside it — and disappears as soon as real content is typed (the phantom
// atoms are replaced, so the scan below no longer matches).
function collectTextHints(mf: MathfieldElement): TextHint[] {
  const hints: TextHint[] = []
  if (typeof mf.getElementInfo !== 'function') return hints
  const seen = new Set<number>()
  for (let offset = 0; offset <= mf.lastOffset; offset++) {
    if (!isTextAtom(mf, offset)) {
      continue
    }
    const group = textGroupFromAtom(mf, offset)
    if (!group || !isEmptyTextLatex(group.latex) || seen.has(group.first)) {
      continue
    }
    seen.add(group.first)
    const box = emptyTextHintBox(mf, group)
    if (box) {
      hints.push({ ...box, text: textHintText(group.command), font: textHintFont(group.command) })
    }
  }
  return hints
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
// Whether the selection covers exactly one placeholder atom (used to hide the
// selection highlight in favour of the caret). A wider selection that merely
// includes a placeholder (e.g. Cmd+A) must keep its highlight.
function isSinglePlaceholderSelection(mf: MathfieldElement): boolean {
  const ranges = mf.selection?.ranges
  if (!ranges || ranges.length !== 1) {
    return false
  }
  const range = ranges[0]
  if (!range) {
    return false
  }
  const [start, end] = range
  if (end - start !== 1) {
    return false
  }
  const info = mf.getElementInfo(end) ?? mf.getElementInfo(start)
  if (info?.latex == null) {
    return false
  }
  return PLACEHOLDER_LATEX_RE.test(info.latex)
}

// The empty text box has no placeholder capture, but its interior spans
// several phantom atoms; arrow keys are handled manually so a single press
// leaves the box on either side.
function emptyTextGroupAtCaret(mf: MathfieldElement): TextGroup | null {
  if (!mf.selectionIsCollapsed) {
    return null
  }
  const group = textGroupAtCaret(mf)
  if (!group || !isEmptyTextLatex(group.latex)) {
    return null
  }
  if (mf.position < group.start || mf.position > group.end) {
    return null
  }
  return group
}

// Move the caret to the Text branch start, in front of the first phantom
// character and therefore in front of the gray "Text" word.
function snapCaretIntoEmptyText(mf: MathfieldElement): boolean {
  for (let offset = 0; offset <= mf.lastOffset; offset++) {
    if (!isTextAtom(mf, offset)) {
      continue
    }
    const group = textGroupFromAtom(mf, offset)
    if (!group || !isEmptyTextLatex(group.latex)) {
      continue
    }
    mf.position = Math.min(group.start, mf.lastOffset)
    return true
  }
  return false
}

// The public form of an internal value: orphan markers dropped, boundary
// markers stripped, adjacent same-command text boxes merged. Both the model
// normalization and the caret prefix mapping must use this exact pipeline so
// string lengths stay comparable.
function normalizePublicLatex(latex: string): string {
  return mergeAdjacentTextCommands(stripTextBoundaries(removeOrphanedTextBoundaries(latex)))
}

// MathLive can re-arrange the zero-width markers when text is inserted around
// them (duplicating the left marker and dropping the right one); rebuild the
// marker layout from the current value.
function normalizeTextModel(mf: MathfieldElement): void {
  const fixed = addTextBoundaries(normalizePublicLatex(mf.value))
  if (fixed !== mf.value) {
    mf.setValue(fixed, { mode: 'math', silenceNotifications: true })
  }
}

// After a text rebuild, put the caret after the character at `charIndex`
// (0-based) inside the group whose serialized form is `groupLatex`. Adjacent
// boxes may have been merged into a larger one by the normalization, so fall
// back to locating the content inside the merged group.
function placeCaretInTextGroup(mf: MathfieldElement, groupLatex: string, charIndex: number): void {
  const content = groupLatex.slice(groupLatex.indexOf('{') + 1, -1)
  let fallback: { offset: number; index: number } | null = null
  for (let offset = 0; offset <= mf.lastOffset; offset++) {
    if (!isTextAtom(mf, offset)) {
      continue
    }
    const group = textGroupFromAtom(mf, offset)
    if (!group) {
      continue
    }
    if (group.latex === groupLatex) {
      mf.position = Math.min(group.first + charIndex, mf.lastOffset)
      return
    }
    if (fallback) {
      continue
    }
    const index = group.content.indexOf(content)
    if (index >= 0) {
      fallback = { offset, index }
    }
  }
  if (fallback) {
    const group = textGroupFromAtom(mf, fallback.offset)
    if (group) {
      mf.position = Math.min(group.first + fallback.index + charIndex, mf.lastOffset)
    }
  }
}

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
  dragApplyFont = isFontStyleElement(element.id) && textGroupRangeAtPoint(mf, event.clientX, event.clientY) !== null
  dragX = event.clientX
  dragY = event.clientY
  const key = dragApplyFont
    ? `${element.id}|${mf.value}|font:${dragOffset}`
    : dragPlaceholderIndex >= 0
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
  ensurePlaceholderSupport(mirror)
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
  if (dragApplyFont) {
    const style = FONT_STYLES[element.id]
    const range = textGroupRangeAtPoint(mf, dragX, dragY)
    if (style && range) {
      mirror.applyStyle(style, { range })
    }
    schedulePreviewSnapshot(mirror)
    return
  }
  let positionSet = false
  if (dragPlaceholderIndex >= 0) {
    positionSet = selectPlaceholderAtPoint(mirror, dragX, dragY)
  }
  if (!positionSet) {
    mirror.position = dragOffset >= 0 ? dragOffset : mf.position
  }
  // An empty Text box previews as the gray word "Text" (the same word the hint
  // shows after the drop), so the preview has real width and pushes the
  // surrounding content aside.
  const previewLatex = withEmptyTextSentinel(element.latex)
  mirror.insert(addTextBoundaries(previewLatex), {
    insertionMode: 'replaceSelection',
    selectionMode: 'item',
    format: 'latex',
    silenceNotifications: true,
  })
  const range = mirror.selection?.ranges?.[0]
  if (previewLatex === element.latex && range && range[0] !== range[1]) {
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
    previewTextHints.value = []
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
  previewTextHints.value = collectTextHints(mirror)
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
  dragApplyFont = false
  dragX = -1
  dragY = -1
  insertionPreview.value = null
  previewTextHints.value = []
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
      emit('toast', t('toast.onlyTextFiles'), 'error')
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
          mf.setValue(addTextBoundaries(contents), { mode: 'math', silenceNotifications: true })
        }
        publishState(mf)
        emit('toast', t('toast.loadedFile', { file: file.name }), 'success')
      })
      .catch(() => emit('toast', t('toast.couldNotRead'), 'error'))
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

// The caret-offset range `[start, end]` of the first element after the caret
// (an atom together with its scripts), or null when nothing follows. MathLive
// stores a scripted operator's sub/superscript before the operator in the flat
// atom array, so the range starts at the operator's leading `first` child
// (minus one) and ends at the operator itself. Ancestors (e.g. the enclosing
// `\frac`) are skipped because their range begins before the caret.
function firstElementRangeAfter(mf: MathfieldElement): [number, number] | null {
  const model = internalModel(mf)
  if (!model?.atoms) {
    return null
  }
  const position = mf.position
  const startIndex = position === 0 ? 0 : position + 1
  for (let i = startIndex; i < model.atoms.length; i++) {
    const atom = model.atoms[i]!
    if (atom.type === 'first' || atom.type === 'placeholder') {
      continue
    }
    const end = model.offsetOf(atom)
    const start = atom.firstChild ? model.offsetOf(atom.firstChild) - 1 : end - 1
    if (start < position) {
      continue
    }
    return [start, end]
  }
  return null
}

// The command name being composed in LaTeX mode, read from MathLive's internal
// `latexgroup` atom (its typed characters — including the greyed suggestion
// suffix — are not reflected in `mf.value`, which serializes to '' while a
// command is in progress). This mirrors how MathLive's own `complete` command
// reads the command, and is the same internal-model access the matrix editing
// already relies on.
function typedCommandName(mf: MathfieldElement): string | null {
  const group = internalModel(mf)?.atoms?.find((atom) => atom.type === 'latexgroup')
  if (!group?.body) {
    return null
  }
  const command = group.body
    .filter((atom) => atom.type === 'latex')
    .map((atom) => atom.value ?? '')
    .join('')
  return command.match(/^\\([a-zA-Z]+)/)?.[1] ?? null
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

function publicStringOffsetToModel(mf: MathfieldElement, stringOffset: number): number {
  let bestOffset = 0
  let bestDistance = Infinity
  for (let offset = 0; offset <= mf.lastOffset; offset++) {
    const length = normalizePublicLatex(mf.getValue(0, offset)).length
    if (length <= stringOffset) {
      const distance = stringOffset - length
      if (distance < bestDistance) {
        bestDistance = distance
        bestOffset = offset
      }
    }
  }
  return bestOffset
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

interface InternalAtom {
  type: string
  parent?: InternalAtom
  parentBranch?: unknown
  body?: InternalAtom[]
  value?: string
  firstChild?: InternalAtom
}

interface InternalMatrix extends InternalAtom {
  environmentName: string
  rowCount: number
  colCount: number
  minColumns: number
  getCell: (row: number, column: number) => InternalAtom[] | undefined
}

interface InternalModel {
  at: (position: number) => InternalAtom
  offsetOf: (atom: InternalAtom) => number
  atoms?: InternalAtom[]
  mode: 'math' | 'text' | 'latex'
}

interface MatrixContext {
  matrix: InternalMatrix
  row: number
  column: number
  rowEmpty: boolean
  columnEmpty: boolean
}

function internalModel(mf: MathfieldElement): InternalModel | null {
  return (mf as unknown as { _mathfield?: { model?: InternalModel } })._mathfield?.model ?? null
}

// MathLive's model-level mode (`math`/`text`/`latex`) is not reset by a
// `setValue('')` that empties the field, so a field cleared while its caret was
// inside a `\text{...}` box keeps mode `text` and wraps the next typed
// characters in `\text{}`. Force it back to math whenever the content is empty.
// Only the stale `text` mode is reset — `latex` is the in-progress backslash
// command composition (which also serializes `mf.value` to ''), so it must be
// left alone. Set the internal property directly (rather than `mf.mode =
// 'math'`, which routes through `switchMode`) to avoid an undo snapshot and
// mode-change event.
function ensureMathMode(mf: MathfieldElement): void {
  const model = internalModel(mf)
  if (model && mf.value === '' && model.mode === 'text') {
    model.mode = 'math'
  }
}

function isMatrix(atom: InternalAtom | undefined): atom is InternalMatrix {
  return Boolean(
    atom?.type === 'array' &&
      typeof (atom as InternalMatrix).environmentName === 'string' &&
      /matrix\*?$/.test((atom as InternalMatrix).environmentName),
  )
}

function isEmptyMatrixCell(matrix: InternalMatrix, row: number, column: number): boolean {
  return Boolean(
    matrix.getCell(row, column)?.every((atom) =>
      atom.type === 'first' || atom.type === 'placeholder',
    ),
  )
}

function matrixContextAtCaret(mf: MathfieldElement): MatrixContext | null {
  const model = internalModel(mf)
  let atom = model?.at(mf.position)
  while (atom) {
    const branch = atom.parentBranch
    if (
      Array.isArray(branch) &&
      branch.length === 2 &&
      typeof branch[0] === 'number' &&
      typeof branch[1] === 'number' &&
      isMatrix(atom.parent)
    ) {
      const matrix = atom.parent
      const row = branch[0]
      const column = branch[1]
      return {
        matrix,
        row,
        column,
        rowEmpty: Array.from({ length: matrix.colCount }, (_, col) => col).every((col) =>
          isEmptyMatrixCell(matrix, row, col),
        ),
        columnEmpty: Array.from({ length: matrix.rowCount }, (_, line) => line).every((line) =>
          isEmptyMatrixCell(matrix, line, column),
        ),
      }
    }
    atom = atom.parent
  }
  return null
}

function matrixAtCaret(mf: MathfieldElement): InternalMatrix | null {
  let atom: InternalAtom | undefined = internalModel(mf)?.at(mf.position)
  while (atom) {
    if (isMatrix(atom)) return atom
    atom = atom.parent
  }
  return null
}

function matrixAtPoint(mf: MathfieldElement, x: number, y: number): InternalMatrix | null {
  const model = internalModel(mf)
  if (!model) return null
  const boxes = new Map<InternalMatrix, VisualBox>()

  for (let offset = 0; offset <= mf.lastOffset; offset++) {
    const bounds = mf.getElementInfo(offset)?.bounds
    if (!bounds) continue
    let atom: InternalAtom | undefined = model.at(offset)
    while (atom) {
      if (isMatrix(atom)) {
        const box = boxes.get(atom)
        boxes.set(atom, box
          ? {
              left: Math.min(box.left, bounds.left),
              top: Math.min(box.top, bounds.top),
              width: Math.max(box.left + box.width, bounds.right) - Math.min(box.left, bounds.left),
              height: Math.max(box.top + box.height, bounds.bottom) - Math.min(box.top, bounds.top),
            }
          : {
              left: bounds.left,
              top: bounds.top,
              width: bounds.width,
              height: bounds.height,
            })
      }
      atom = atom.parent
    }
  }

  const padding = Math.max(20, props.fontSize)
  return [...boxes]
    .map(([matrix, box]) => ({
      matrix,
      distance: Math.hypot(
        Math.max(box.left - x, 0, x - box.left - box.width),
        Math.max(box.top - y, 0, y - box.top - box.height),
      ),
    }))
    .filter(({ distance }) => distance <= padding)
    .sort((a, b) => a.distance - b.distance)[0]?.matrix ?? null
}

function executeMatrixCommands(mf: MathfieldElement, commands: readonly MatrixMenuCommand[]) {
  mf.focus()
  for (const command of commands) mf.executeCommand(command)
  restoreEmptyGroups(mf)
  publishState(mf)
  scheduleUpdateTextHints()
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

  const offset = mf.getOffsetFromPoint(event.clientX, event.clientY)
  if (!Number.isInteger(offset) || offset < 0) return
  mf.position = offset

  let context = matrixContextAtCaret(mf)
  const clickedCell = Boolean(context)
  if (!context) {
    const matrix = matrixAtCaret(mf) ?? matrixAtPoint(mf, event.clientX, event.clientY)
    const cell = matrix?.getCell(matrix.rowCount - 1, matrix.colCount - 1)
    const last = cell?.at(-1)
    if (!matrix || !last) return
    mf.position = model.offsetOf(last)
    context = matrixContextAtCaret(mf)
  }
  if (!context) return

  event.preventDefault()
  event.stopPropagation()
  mf.focus()
  matrixMenu.value = {
    x: event.clientX,
    y: event.clientY,
    cell: clickedCell,
    rows: context.matrix.rowCount,
    columns: context.matrix.colCount,
    minColumns: context.matrix.minColumns,
  }
}

function onMatrixMenuSelect(id: string) {
  const mf = getMf()
  if (!mf) return
  executeMatrixCommands(mf, [id as MatrixMenuCommand])
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

function insertMathChar(mf: MathfieldElement, event: KeyboardEvent): void {
  event.preventDefault()
  event.stopPropagation()
  // Raw braces are LaTeX grouping tokens, so inserting `{`/`}` through the
  // programmatic API produces no visible atom. Use their explicit math
  // commands when a brace is typed just outside a Text box.
  const latex = event.key === '{' ? '\\lbrace' : event.key === '}' ? '\\rbrace' : event.key
  mf.insert(latex, {
    insertionMode: 'replaceSelection',
    format: event.key === '{' || event.key === '}' ? 'latex' : 'auto',
    mode: 'math',
    silenceNotifications: true,
  })
  publishState(mf)
  scheduleUpdateTextHints()
}

// The caret sits immediately in front of a Text box, past its leading
// zero-width marker. MathLive's own handling would let smart-fence characters
// (parens, brackets, ...) wrap the whole box instead of inserting before it.
function isCaretBeforeTextBox(mf: MathfieldElement): boolean {
  return isTextBoundaryAtom(mf, mf.position + 1) && isTextAtom(mf, mf.position + 2)
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
  // Typing into a `\text{...}` box: MathLive collapses a single-atom text
  // command and drops the `\text{}` wrapper, so intercept every printable
  // character in a text context and rebuild the whole text group ourselves.
  if (
    event.key.length === 1 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.isComposing
  ) {
    const group = textGroupAtCaret(mf)
    if (group) {
      const sel = mf.selection?.ranges?.[0]
      // Rebuilding a text group is only safe when the selection lies entirely
      // inside it; let MathLive handle selections that span other content.
      if (sel && sel[1] > sel[0] && (sel[0] < group.start || sel[1] > group.end)) {
        return
      }
      const arrowedOut =
        caretArrivedByNavigation &&
        mf.selectionIsCollapsed &&
        !mf.classList.contains('caret-in-text') &&
        ((lastArrowDirection === 'right' && mf.position >= group.end) ||
          (lastArrowDirection === 'left' && mf.position <= group.start))
      if (isEmptyTextLatex(group.latex) || arrowedOut) {
        if (!mf.selectionIsCollapsed) {
          return
        }
        // A caret collapsed OUTSIDE the box (or one that just arrowed past its
        // last character) types in math mode instead of into the text box. The
        // inside range starts at the Text branch-start atom, immediately
        // before its first character. `arrowedOut` must be trusted even when
        // MathLive reports the same numeric edge offset on both sides, so it
        // short-circuits into a math insert.
        if (
          arrowedOut ||
          mf.position < group.start ||
          mf.position > group.end
        ) {
          // Park the caret just beyond the zero-width boundary marker before
          // inserting; the edge offset alone does not reliably identify which
          // side of the marker MathLive selected.
          if (arrowedOut) {
            mf.position =
              lastArrowDirection === 'right'
                ? Math.min(group.end + 1, mf.lastOffset)
                : Math.max(0, group.start - 1)
          }
          insertMathChar(mf, event)
          return
        }
        event.preventDefault()
        event.stopPropagation()
        const escaped = event.key.replace(/([\\{}#$&^_~%])/g, '\\$1')
        mf.selection = { ranges: [[group.start, group.end]] }
        mf.insert(`\\${group.command}{${escaped}}`, {
          insertionMode: 'replaceSelection',
          mode: 'math',
          format: 'latex',
          silenceNotifications: true,
        })
        normalizeTextModel(mf)
        placeCaretInTextGroup(mf, `\\${group.command}{${escaped}}`, 0)
        publishState(mf)
        syncCaretInText()
        scheduleUpdateTextHints()
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const escaped = event.key.replace(/([\\{}#$&^_~%])/g, '\\$1')
      let from = 0
      let content: string
      if (sel && sel[1] > sel[0]) {
        from = Math.max(0, sel[0] - group.start)
        const to = Math.min(group.content.length, sel[1] - group.start)
        content = group.content.slice(0, from) + escaped + group.content.slice(to)
      } else {
        from = Math.max(0, Math.min(group.content.length, mf.position - group.start))
        content =
          group.content.slice(0, from) + escaped + group.content.slice(from)
      }
      mf.selection = { ranges: [[group.start, group.end]] }
      mf.insert(`\\${group.command}{${content}}`, {
        insertionMode: 'replaceSelection',
        mode: 'math',
        format: 'latex',
        silenceNotifications: true,
      })
      normalizeTextModel(mf)
      // Put the caret right after the inserted character (not at the end).
      placeCaretInTextGroup(mf, `\\${group.command}{${content}}`, from)
      publishState(mf)
      syncCaretInText()
      scheduleUpdateTextHints()
      return
    }
    if (isCaretBeforeTextBox(mf)) {
      // The caret is just before a Text box: a printable character here types
      // in math mode. Route it through the explicit math insert so fence
      // characters are not captured by MathLive's smart-fence, which would
      // otherwise wrap the adjacent Text box.
      insertMathChar(mf, event)
      return
    }
  }
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
    const box = emptyTextGroupAtCaret(mf)
    if (box) {
      event.preventDefault()
      event.stopPropagation()
      const target = event.key === 'ArrowRight' ? box.end + 1 : box.start - 1
      mf.position = Math.max(0, Math.min(mf.lastOffset, target))
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
  // Deleting a character inside an accent argument: MathLive treats the accent
  // construct as opaque, so its native deletion removes the whole accent or
  // nothing. Rebuild the argument without the targeted atom, like a Text box.
  const accentTarget = accentGroupAtAtom(mf, target)
  if (accentTarget) {
    event.preventDefault()
    event.stopPropagation()
    const parts: string[] = []
    for (let offset = accentTarget.start; offset <= accentTarget.end; offset++) {
      if (offset === target) {
        continue
      }
      parts.push(mf.getElementInfo(offset)?.latex ?? '')
    }
    const content = parts.join('')
    const replacement = content
      ? `\\${accentTarget.command}{${content}}`
      : `\\${accentTarget.command}{\\placeholder{}}`
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
    } else {
      enterPlaceholder(mf, Math.min(accentTarget.start, mf.lastOffset))
    }
    publishState(mf)
    onSelectionChange()
    scheduleUpdateTextHints()
    return
  }
  let targetGroup = isTextAtom(mf, target) ? textGroupFromAtom(mf, target) : null
  if (!targetGroup && mf.getElementInfo(target)?.latex === '') {
    // The deletion points at the empty container atom in front of a text group
    // (e.g. Delete with the caret just before the box); treat it as the group.
    targetGroup = isTextAtom(mf, target + 1) ? textGroupFromAtom(mf, target + 1) : null
  }
  // Deleting anywhere in an empty Text box removes the whole box (with its
  // markers) and leaves the caret at the deletion point.
  const emptyBox = emptyTextGroupAtCaret(mf)
  if (
    mf.selectionIsCollapsed &&
    (emptyBox || (targetGroup && isEmptyTextLatex(targetGroup.latex)))
  ) {
    const group = emptyBox ?? targetGroup!
    event.preventDefault()
    event.stopPropagation()
    const prefix = mf.getValue(0, Math.max(0, group.start - 2))
    const suffix = mf.getValue(group.end + 1, mf.lastOffset)
    const caretPublicLength = normalizePublicLatex(prefix).length
    mf.setValue(prefix + suffix, { mode: 'math', silenceNotifications: true })
    ensureMathMode(mf)
    mf.position = publicStringOffsetToModel(mf, caretPublicLength)
    publishState(mf)
    syncCaretInText()
    scheduleUpdateTextHints()
    return
  }
  if (targetGroup && targetGroup.count === 1 && !isEmptyTextLatex(targetGroup.latex)) {
    // Deleting the last remaining character of a `\text{...}` box (from either
    // direction) turns it into an empty box (showing the "Text" hint) instead
    // of deleting the whole element; MathLive collapses a single-atom text
    // command. The group's command is preserved so styled text keeps its style.
    event.preventDefault()
    event.stopPropagation()
    mf.selection = { ranges: [[targetGroup.start, targetGroup.end]] }
    mf.insert(`\\${targetGroup.command}{${emptyTextSentinelLatex(targetGroup.command)}}`, {
      insertionMode: 'replaceSelection',
      mode: 'math',
      format: 'latex',
      silenceNotifications: true,
    })
    // Park the caret in front of the gray "Text" hint again.
    snapCaretIntoEmptyText(mf)
    publishState(mf)
    syncCaretInText()
    scheduleUpdateTextHints()
    return
  }
  if (targetGroup && targetGroup.count > 1) {
    // Rebuild the group without the character under the key so the caret ends
    // up exactly at the deletion point (MathLive's native in-text deletion
    // drifts the caret one position).
    const index = Math.max(0, Math.min(targetGroup.content.length - 1, target - targetGroup.first))
    if (index >= 0 && index < targetGroup.content.length) {
      event.preventDefault()
      event.stopPropagation()
      const content =
        targetGroup.content.slice(0, index) + targetGroup.content.slice(index + 1)
      mf.selection = { ranges: [[targetGroup.start, targetGroup.end]] }
      mf.insert(`\\${targetGroup.command}{${content}}`, {
        insertionMode: 'replaceSelection',
        mode: 'math',
        format: 'latex',
        silenceNotifications: true,
      })
      normalizeTextModel(mf)
      placeCaretInTextGroup(mf, `\\${targetGroup.command}{${content}}`, Math.max(0, index - 1))
      publishState(mf)
      syncCaretInText()
      scheduleUpdateTextHints()
      return
    }
  }
  const info = mf.getElementInfo(mf.position)
  const isPlaceholder =
    info?.latex != null && /^\\placeholder(?:\[[^\]]*\])?\{\}$/.test(info.latex)
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
    // Include the script run so clicking the brace annotation also re-enters.
    for (let offset = group.constructOffset - 1; offset > group.end; offset--) {
      merge(mf.getElementInfo(offset)?.bounds)
    }
  }
  return bounds
}

function accentAtPoint(mf: MathfieldElement, x: number, y: number): AccentGroup | null {
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
  const accent = accentAtPoint(mf, event.clientX, event.clientY)
  if (accent && !isAccentArgEmpty(mf, accent)) {
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
  if (accent && !isAccentArgEmpty(mf, accent)) {
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
  if (!mf || historyIndex <= 0) return
  historyIndex--
  const entry = history[historyIndex]!
  loadLatex(mf, entry.latex)
  mf.position = Math.min(entry.position, mf.lastOffset)
  publishState(mf, false)
  scheduleUpdateTextHints()
}

function redo() {
  const mf = getMf()
  if (!mf || historyIndex >= history.length - 1) return
  historyIndex++
  const entry = history[historyIndex]!
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
  if (mirrorField) {
    mirrorField.style.fontSize = `${px}px`
  }
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
  if (mirrorField) {
    mirrorField.defaultMode = value ? 'math' : 'inline-math'
  }
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
  cancelAnimationFrame(previewRaf)
  cancelAnimationFrame(snapshotRaf)
  cancelAnimationFrame(textHintRaf)
  cancelAnimationFrame(fractionRaf)
  fractionObserver?.disconnect()
  fractionObserver = null
  if (snapshotTimer) {
    clearTimeout(snapshotTimer)
    snapshotTimer = null
  }
  if (mirrorField) {
    mirrorField.remove()
    mirrorField = null
  }
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
      <ContextMenu
        :open="Boolean(matrixMenu)"
        :x="matrixMenu?.x ?? 0"
        :y="matrixMenu?.y ?? 0"
        :items="matrixMenuItems"
        @close="matrixMenu = null"
        @select="onMatrixMenuSelect"
      />
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
