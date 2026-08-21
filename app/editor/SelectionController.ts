import type { EditorAdaptor } from './EditorAdaptor'

const PLACEHOLDER_LATEX_RE = /^\\placeholder(?:\[[^\]]*\])?\{\}$/

export function isSinglePlaceholderSelection(adaptor: EditorAdaptor): boolean {
  const ranges = adaptor.selection?.ranges
  if (!ranges || ranges.length !== 1) return false
  const range = ranges[0]
  if (!range || range[1] - range[0] !== 1) return false
  const info = adaptor.getElementInfo(range[1]) ?? adaptor.getElementInfo(range[0])
  return info?.latex != null && PLACEHOLDER_LATEX_RE.test(info.latex)
}

export function firstElementRangeAfter(adaptor: EditorAdaptor): [number, number] | null {
  const position = adaptor.position
  for (let end = position + 1; end <= adaptor.lastOffset; end++) {
    const latex = adaptor.getElementInfo(end)?.latex
    if (!latex || PLACEHOLDER_LATEX_RE.test(latex)) continue
    for (let start = position; start < end; start++) {
      if (adaptor.getValue(start, end) === latex) return [start, end]
    }
  }
  return null
}
