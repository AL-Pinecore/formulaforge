import type { MathfieldElement } from 'mathlive'
import { FONT_STYLES, FONT_STYLE_TEXT_COMMANDS } from '~/utils/font-styles'
import { restoreEmptyGroupLatex } from '~/utils/empty-group'
import {
  addTextBoundaries,
  emptyTextSentinelLatex,
  isEmptyTextLatex,
  isTextCommandLatex,
  TEXT_BOUNDARY_LATEX,
  textHintFont,
  textHintText,
} from '~/utils/text-boundary'
import { ensureMathMode } from './MathLiveAdapter'
import { matrixContextAtCaret, selectMatrixCellPlaceholder } from './MatrixController'
import { normalizePublicLatex, publicStringOffsetToModel } from './EditorLatex'

export { normalizePublicLatex, publicStringOffsetToModel } from './EditorLatex'

export interface TextGroup {
  start: number
  end: number
  first: number
  last: number
  count: number
  content: string
  command: string
  latex: string
  bounds: VisualBox | null
}

export interface VisualBox {
  left: number
  top: number
  width: number
  height: number
}

export interface TextHint extends VisualBox {
  text: string
  font: { fontFamily: string; fontWeight?: number; fontStyle?: string }
}

export type TextKeyResult = 'continue' | 'handled' | 'changed'

export function isTextAtom(mf: MathfieldElement, offset: number): boolean {
  const latex = mf.getElementInfo(offset)?.latex
  return latex === TEXT_BOUNDARY_LATEX ? false : isTextCommandLatex(latex)
}

function isTextBoundaryAtom(mf: MathfieldElement, offset: number): boolean {
  return mf.getElementInfo(offset)?.latex === TEXT_BOUNDARY_LATEX
}

function isManagedBoundaryAtom(mf: MathfieldElement, offset: number): boolean {
  return isTextBoundaryAtom(mf, offset) && (
    isTextAtom(mf, offset - 1) || isTextAtom(mf, offset + 1)
  )
}

export function relocateCaretAcrossBoundaries(
  mf: MathfieldElement,
  key: 'Backspace' | 'Delete',
): number {
  let position = mf.position
  for (let guard = 0; guard < 4; guard++) {
    const target = key === 'Delete' ? position + 1 : position
    if (!isManagedBoundaryAtom(mf, target)) break
    if (isTextAtom(mf, target - 1)) {
      position = key === 'Delete' ? target - 2 : target - 1
    } else if (isTextAtom(mf, target + 1)) {
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
  if (open < 0 || !latex.endsWith('}')) return ''
  return latex
    .slice(open + 1, -1)
    .replace(/\\textbackslash\{\}/g, '\\')
    .replace(/\\([\^~])\{\}/g, '$1')
    .replace(/\\([\\{}#$&^_~%])/g, '$1')
}

export function textGroupFromAtom(mf: MathfieldElement, atom: number): TextGroup | null {
  if (!isTextAtom(mf, atom)) return null
  const runKey = textAtomRunKey(mf, atom)
  let first = atom
  while (
    first > 0 &&
    isTextAtom(mf, first - 1) &&
    textAtomRunKey(mf, first - 1) === runKey
  ) first--
  let last = atom
  while (
    last + 1 <= mf.lastOffset &&
    isTextAtom(mf, last + 1) &&
    textAtomRunKey(mf, last + 1) === runKey
  ) last++

  const content: string[] = []
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (let offset = first; offset <= last; offset++) {
    const info = mf.getElementInfo(offset)
    if (info?.latex) content.push(decodeTextAtom(info.latex))
    const bounds = info?.bounds
    if (!bounds) continue
    left = Math.min(left, bounds.left)
    top = Math.min(top, bounds.top)
    right = Math.max(right, bounds.right)
    bottom = Math.max(bottom, bounds.bottom)
  }
  const start = Math.max(0, first - 1)
  const serialized = mf.getValue(start, last)
  return {
    start,
    end: last,
    first,
    last,
    count: last - first + 1,
    content: content.join(''),
    command: serialized.match(/^\\([a-zA-Z]+)\{/)?.[1] ?? 'text',
    latex: serialized,
    bounds: Number.isFinite(left)
      ? { left, top, width: right - left, height: bottom - top }
      : null,
  }
}

export function textGroupAtCaret(mf: MathfieldElement): TextGroup | null {
  const position = mf.position
  if (isTextAtom(mf, position + 1)) {
    const group = textGroupFromAtom(mf, position + 1)
    if (group?.start === position) return group
  }
  if (isTextBoundaryAtom(mf, position) && isTextAtom(mf, position + 1)) {
    return textGroupFromAtom(mf, position + 1)
  }
  if (isTextAtom(mf, position)) return textGroupFromAtom(mf, position)
  if (isTextAtom(mf, position - 1)) return textGroupFromAtom(mf, position - 1)
  return null
}

export function textGroupAtPoint(
  mf: MathfieldElement,
  x: number,
  y: number,
): TextGroup | null {
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
    ) return textGroupFromAtom(mf, offset)
  }
  return null
}

export function emptyTextGroupAtPoint(
  mf: MathfieldElement,
  x: number,
  y: number,
): TextGroup | null {
  const seen = new Set<number>()
  for (let offset = 0; offset <= mf.lastOffset; offset++) {
    if (!isTextAtom(mf, offset)) continue
    const group = textGroupFromAtom(mf, offset)
    if (!group || !isEmptyTextLatex(group.latex) || seen.has(group.first)) continue
    seen.add(group.first)
    const leftMarker = mf.getElementInfo(group.start - 1)?.bounds
    const rightMarker = mf.getElementInfo(group.end + 1)?.bounds
    if (!leftMarker || !rightMarker) continue
    if (
      x >= leftMarker.right - 2 &&
      x <= rightMarker.left + 2 &&
      y >= leftMarker.top - 4 &&
      y <= leftMarker.bottom + 4
    ) return group
  }
  return null
}

export function textGroupRangeAtPoint(
  mf: MathfieldElement,
  x: number,
  y: number,
): [number, number] | null {
  let atom = -1
  for (let offset = 0; offset <= mf.lastOffset; offset++) {
    const bounds = mf.getElementInfo(offset)?.bounds
    if (
      bounds &&
      bounds.width >= 0.5 &&
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
    const group = emptyTextGroupAtPoint(mf, x, y)
    return group ? [group.start, group.end] : null
  }
  let start = atom
  while (start > 0 && isTextAtom(mf, start - 1)) start--
  let end = atom + 1
  while (end <= mf.lastOffset && isTextAtom(mf, end)) end++
  return [Math.max(0, start - 1), Math.min(end, mf.lastOffset)]
}

export function applyFontStyle(
  mf: MathfieldElement,
  id: string,
  x: number,
  y: number,
): boolean {
  const style = FONT_STYLES[id]
  if (!style) return false
  const group = textGroupAtPoint(mf, x, y) ?? emptyTextGroupAtPoint(mf, x, y)
  if (!group) return false
  const expected = FONT_STYLE_TEXT_COMMANDS[id]
  const operation = expected != null && group.command === expected ? 'toggle' : 'set'
  mf.applyStyle(style, { range: [group.start, group.end], operation })
  return true
}

export function clampOffsetOutsideText(
  mf: MathfieldElement,
  offset: number,
  x?: number,
): number {
  if (typeof mf.getElementInfo !== 'function') return offset
  for (let atom = Math.max(0, Math.min(offset, mf.lastOffset)); atom >= 0; atom--) {
    if (!isTextAtom(mf, atom)) continue
    const group = textGroupFromAtom(mf, atom)
    if (!group || offset < group.start || offset > group.end) continue
    const leftMarker = mf.getElementInfo(group.start - 1)?.bounds
    const rightMarker = mf.getElementInfo(group.end + 1)?.bounds
    const center = leftMarker && rightMarker ? (leftMarker.right + rightMarker.left) / 2 : null
    const insertAfter = x == null || center == null || x >= center
    return Math.max(0, Math.min(mf.lastOffset, insertAfter ? group.end + 1 : group.start))
  }
  return offset
}

export function textGroupNearPosition(
  mf: MathfieldElement,
  position: number,
): TextGroup | null {
  for (let offset = 0; offset <= mf.lastOffset; offset++) {
    if (!isTextAtom(mf, offset)) continue
    const group = textGroupFromAtom(mf, offset)
    if (!group) continue
    if (position >= group.start - 1 && position <= group.end + 1) return group
    offset = group.last
  }
  return null
}

export function emptyTextHintBox(
  mf: MathfieldElement,
  group: TextGroup,
): VisualBox | null {
  const leftMarker = mf.getElementInfo(group.start - 1)?.bounds
  const rightMarker = mf.getElementInfo(group.end + 1)?.bounds
  if (!leftMarker || !rightMarker) return null
  return {
    left: leftMarker.right,
    top: leftMarker.top,
    width: Math.max(0, rightMarker.left - leftMarker.right),
    height: leftMarker.bottom - leftMarker.top,
  }
}

export function collectTextHints(mf: MathfieldElement): TextHint[] {
  const hints: TextHint[] = []
  if (typeof mf.getElementInfo !== 'function') return hints
  const seen = new Set<number>()
  for (let offset = 0; offset <= mf.lastOffset; offset++) {
    if (!isTextAtom(mf, offset)) continue
    const group = textGroupFromAtom(mf, offset)
    if (!group || !isEmptyTextLatex(group.latex) || seen.has(group.first)) continue
    seen.add(group.first)
    const box = emptyTextHintBox(mf, group)
    if (box) {
      hints.push({ ...box, text: textHintText(group.command), font: textHintFont(group.command) })
    }
  }
  return hints
}

function emptyTextGroupAtCaret(mf: MathfieldElement): TextGroup | null {
  if (!mf.selectionIsCollapsed) return null
  const group = textGroupAtCaret(mf)
  return group &&
    isEmptyTextLatex(group.latex) &&
    mf.position >= group.start &&
    mf.position <= group.end
    ? group
    : null
}

export function snapCaretIntoEmptyText(mf: MathfieldElement): boolean {
  for (let offset = 0; offset <= mf.lastOffset; offset++) {
    if (!isTextAtom(mf, offset)) continue
    const group = textGroupFromAtom(mf, offset)
    if (!group || !isEmptyTextLatex(group.latex)) continue
    mf.position = Math.min(group.start, mf.lastOffset)
    return true
  }
  return false
}

function normalizeTextModel(mf: MathfieldElement): void {
  const fixed = addTextBoundaries(normalizePublicLatex(mf.value))
  if (fixed !== mf.value) {
    mf.setValue(fixed, { mode: 'math', silenceNotifications: true })
  }
}

function placeCaretInTextGroup(
  mf: MathfieldElement,
  groupLatex: string,
  charIndex: number,
): void {
  const content = groupLatex.slice(groupLatex.indexOf('{') + 1, -1)
  let fallback: { offset: number; index: number } | null = null
  for (let offset = 0; offset <= mf.lastOffset; offset++) {
    if (!isTextAtom(mf, offset)) continue
    const group = textGroupFromAtom(mf, offset)
    if (!group) continue
    if (group.latex === groupLatex) {
      mf.position = Math.min(group.first + charIndex, mf.lastOffset)
      return
    }
    if (!fallback) {
      const index = group.content.indexOf(content)
      if (index >= 0) fallback = { offset, index }
    }
  }
  if (!fallback) return
  const group = textGroupFromAtom(mf, fallback.offset)
  if (group) mf.position = Math.min(group.first + fallback.index + charIndex, mf.lastOffset)
}

function insertMathChar(mf: MathfieldElement, event: KeyboardEvent): void {
  event.preventDefault()
  event.stopPropagation()
  const latex = event.key === '{' ? '\\lbrace' : event.key === '}' ? '\\rbrace' : event.key
  mf.insert(latex, {
    insertionMode: 'replaceSelection',
    format: event.key === '{' || event.key === '}' ? 'latex' : 'auto',
    mode: 'math',
    silenceNotifications: true,
  })
}

function isCaretBeforeTextBox(mf: MathfieldElement): boolean {
  return isTextBoundaryAtom(mf, mf.position + 1) && isTextAtom(mf, mf.position + 2)
}

export function handleTextInput(
  mf: MathfieldElement,
  event: KeyboardEvent,
  arrivedByNavigation: boolean,
  direction: 'left' | 'right' | null,
): TextKeyResult {
  if (
    event.key.length !== 1 ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.isComposing
  ) return 'continue'

  const group = textGroupAtCaret(mf)
  if (!group) {
    if (!isCaretBeforeTextBox(mf)) return 'continue'
    insertMathChar(mf, event)
    return 'changed'
  }
  const selection = mf.selection?.ranges?.[0]
  if (
    selection &&
    selection[1] > selection[0] &&
    (selection[0] < group.start || selection[1] > group.end)
  ) return 'handled'

  const arrowedOut =
    arrivedByNavigation &&
    mf.selectionIsCollapsed &&
    !mf.classList.contains('caret-in-text') &&
    ((direction === 'right' && mf.position >= group.end) ||
      (direction === 'left' && mf.position <= group.start))

  if (isEmptyTextLatex(group.latex) || arrowedOut) {
    if (!mf.selectionIsCollapsed) return 'handled'
    if (arrowedOut || mf.position < group.start || mf.position > group.end) {
      if (arrowedOut) {
        mf.position = direction === 'right'
          ? Math.min(group.end + 1, mf.lastOffset)
          : Math.max(0, group.start - 1)
      }
      insertMathChar(mf, event)
      return 'changed'
    }
    event.preventDefault()
    event.stopPropagation()
    const escaped = event.key.replace(/([\\{}#$&^_~%])/g, '\\$1')
    mf.selection = { ranges: [[group.start, group.end]] }
    const latex = `\\${group.command}{${escaped}}`
    mf.insert(latex, {
      insertionMode: 'replaceSelection',
      mode: 'math',
      format: 'latex',
      silenceNotifications: true,
    })
    normalizeTextModel(mf)
    placeCaretInTextGroup(mf, latex, 0)
    return 'changed'
  }

  event.preventDefault()
  event.stopPropagation()
  const escaped = event.key.replace(/([\\{}#$&^_~%])/g, '\\$1')
  let from = 0
  let content: string
  if (selection && selection[1] > selection[0]) {
    from = Math.max(0, selection[0] - group.start)
    const to = Math.min(group.content.length, selection[1] - group.start)
    content = group.content.slice(0, from) + escaped + group.content.slice(to)
  } else {
    from = Math.max(0, Math.min(group.content.length, mf.position - group.start))
    content = group.content.slice(0, from) + escaped + group.content.slice(from)
  }
  mf.selection = { ranges: [[group.start, group.end]] }
  const latex = `\\${group.command}{${content}}`
  mf.insert(latex, {
    insertionMode: 'replaceSelection',
    mode: 'math',
    format: 'latex',
    silenceNotifications: true,
  })
  normalizeTextModel(mf)
  placeCaretInTextGroup(mf, latex, from)
  return 'changed'
}

export function handleEmptyTextNavigation(
  mf: MathfieldElement,
  event: KeyboardEvent,
): TextKeyResult {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return 'continue'
  const group = emptyTextGroupAtCaret(mf)
  if (!group) return 'continue'
  event.preventDefault()
  event.stopPropagation()
  const target = event.key === 'ArrowRight' ? group.end + 1 : group.start - 1
  mf.position = Math.max(0, Math.min(mf.lastOffset, target))
  return 'changed'
}

export function handleTextDeletion(
  mf: MathfieldElement,
  event: KeyboardEvent,
  target: number,
): TextKeyResult {
  let group = isTextAtom(mf, target) ? textGroupFromAtom(mf, target) : null
  if (!group && mf.getElementInfo(target)?.latex === '') {
    group = isTextAtom(mf, target + 1) ? textGroupFromAtom(mf, target + 1) : null
  }
  const emptyGroup = emptyTextGroupAtCaret(mf)
  if (mf.selectionIsCollapsed && (emptyGroup || (group && isEmptyTextLatex(group.latex)))) {
    const selected = emptyGroup ?? group!
    event.preventDefault()
    event.stopPropagation()
    const wrapped = `${TEXT_BOUNDARY_LATEX}${selected.latex}${TEXT_BOUNDARY_LATEX}`
    let occurrence = 0
    for (let offset = 0; offset < selected.first; offset++) {
      const earlier = textGroupFromAtom(mf, offset)
      if (earlier?.first === offset && earlier.latex === selected.latex) occurrence++
    }
    let stringIndex = -1
    for (let i = 0; i <= occurrence; i++) {
      stringIndex = mf.value.indexOf(wrapped, stringIndex + 1)
    }
    if (stringIndex < 0) return 'handled'
    const matrixContext = matrixContextAtCaret(mf)
    const caretPublicLength = normalizePublicLatex(mf.value.slice(0, stringIndex)).length
    const withoutText = normalizePublicLatex(
      mf.value.slice(0, stringIndex) + mf.value.slice(stringIndex + wrapped.length),
    )
    const restored = restoreEmptyGroupLatex(withoutText) ?? withoutText
    mf.setValue(addTextBoundaries(restored), { mode: 'math', silenceNotifications: true })
    ensureMathMode(mf)
    const placeholderSelected = matrixContext && selectMatrixCellPlaceholder(
      mf,
      matrixContext.matrix.index,
      matrixContext.row,
      matrixContext.column,
    )
    if (!placeholderSelected) {
      mf.position = publicStringOffsetToModel(mf, caretPublicLength)
    }
    return 'changed'
  }

  if (group && group.count === 1 && !isEmptyTextLatex(group.latex)) {
    event.preventDefault()
    event.stopPropagation()
    mf.selection = { ranges: [[group.start, group.end]] }
    mf.insert(`\\${group.command}{${emptyTextSentinelLatex(group.command)}}`, {
      insertionMode: 'replaceSelection',
      mode: 'math',
      format: 'latex',
      silenceNotifications: true,
    })
    snapCaretIntoEmptyText(mf)
    return 'changed'
  }

  if (!group || group.count <= 1) return 'continue'
  const index = Math.max(0, Math.min(group.content.length - 1, target - group.first))
  if (index < 0 || index >= group.content.length) return 'continue'
  event.preventDefault()
  event.stopPropagation()
  const content = group.content.slice(0, index) + group.content.slice(index + 1)
  mf.selection = { ranges: [[group.start, group.end]] }
  const latex = `\\${group.command}{${content}}`
  mf.insert(latex, {
    insertionMode: 'replaceSelection',
    mode: 'math',
    format: 'latex',
    silenceNotifications: true,
  })
  normalizeTextModel(mf)
  placeCaretInTextGroup(mf, latex, Math.max(0, index - 1))
  return 'changed'
}
