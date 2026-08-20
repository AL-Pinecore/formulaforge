import type { MathfieldElement } from 'mathlive'

const PLACEHOLDER_GLYPH = '▢'
const PLACEHOLDER_CLICK_PAD = 10
const PLACEHOLDER_LATEX_RE = /^\\placeholder(?:\[[^\]]*\])?\{\}$/

interface OffsetEdge {
  x: number
  offset: number
  depth: number
}

const offsetCache = new WeakMap<MathfieldElement, { key: string; edges: OffsetEdge[] }>()

function buildOffsetEdges(mf: MathfieldElement, left: number, right: number): OffsetEdge[] {
  const key = `${mf.value}|${Math.round(right - left)}`
  const cached = offsetCache.get(mf)
  if (cached?.key === key) return cached.edges
  const edges: OffsetEdge[] = [
    { x: left, offset: 0, depth: 0 },
    { x: right, offset: mf.lastOffset, depth: 0 },
  ]
  for (let offset = 1; offset < mf.lastOffset; offset++) {
    const info = mf.getElementInfo(offset)
    const bounds = info?.bounds
    if (!bounds || bounds.width < 0.5) continue
    const depth = info?.depth ?? 0
    edges.push({ x: bounds.left, offset: offset - 1, depth })
    edges.push({ x: bounds.right, offset, depth })
  }
  edges.sort((a, b) => a.x - b.x)
  offsetCache.set(mf, { key, edges })
  return edges
}

export function offsetFromPoint(mf: MathfieldElement, x: number, y: number): number {
  const root = mf.shadowRoot
  const latex = root?.querySelector('.ML__latex') as HTMLElement | null
  if (!root || !latex) return -1
  const rect = latex.getBoundingClientRect()
  if (x < rect.left - 4 || x > rect.right + 4 || y < rect.top - 8 || y > rect.bottom + 8) {
    return -1
  }
  if (mf.lastOffset <= 0) return 0
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

export function isSinglePlaceholderSelection(mf: MathfieldElement): boolean {
  const ranges = mf.selection?.ranges
  if (!ranges || ranges.length !== 1) return false
  const range = ranges[0]
  if (!range || range[1] - range[0] !== 1) return false
  const info = mf.getElementInfo(range[1]) ?? mf.getElementInfo(range[0])
  return info?.latex != null && PLACEHOLDER_LATEX_RE.test(info.latex)
}

export function placeholderIndexAtPoint(mf: MathfieldElement, x: number, y: number): number {
  const root = mf.shadowRoot
  if (!root) return -1
  let index = 0
  for (const node of root.querySelectorAll('*')) {
    if (node.textContent?.trim() !== PLACEHOLDER_GLYPH) continue
    const rect = node.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      if (
        x >= rect.left - PLACEHOLDER_CLICK_PAD &&
        x <= rect.right + PLACEHOLDER_CLICK_PAD &&
        y >= rect.top - PLACEHOLDER_CLICK_PAD &&
        y <= rect.bottom + PLACEHOLDER_CLICK_PAD
      ) return index
      index++
    }
  }
  return -1
}

function selectedPlaceholderAtPoint(mf: MathfieldElement, x: number, y: number): boolean {
  const root = mf.shadowRoot
  if (!root) return false
  for (const node of root.querySelectorAll('.ML__selected')) {
    if (node.textContent?.trim() !== PLACEHOLDER_GLYPH) continue
    const rect = node.getBoundingClientRect()
    if (
      rect.width > 0 &&
      rect.height > 0 &&
      x >= rect.left - PLACEHOLDER_CLICK_PAD &&
      x <= rect.right + PLACEHOLDER_CLICK_PAD &&
      y >= rect.top - PLACEHOLDER_CLICK_PAD &&
      y <= rect.bottom + PLACEHOLDER_CLICK_PAD
    ) return true
  }
  return false
}

export function selectPlaceholderAtPoint(mf: MathfieldElement, x: number, y: number): boolean {
  mf.position = 0
  let previousStart = -1
  for (let i = 0; i < 64; i++) {
    mf.executeCommand('moveToNextPlaceholder')
    const start = mf.selection?.ranges?.[0]?.[0]
    if (typeof start !== 'number' || start === previousStart) return false
    previousStart = start
    if (selectedPlaceholderAtPoint(mf, x, y)) return true
  }
  return false
}

export function enterPlaceholder(mf: MathfieldElement, offset: number): void {
  if (!mf.selectionIsCollapsed) return
  mf.position = offset
  mf.executeCommand(
    offset >= mf.lastOffset ? 'moveToPreviousPlaceholder' : 'moveToNextPlaceholder',
  )
}
