const EXCLUDED_COMMANDS = new Set(['begin', 'end', 'left', 'right', 'placeholder'])
const EMPTY_PLACEHOLDER_RE = /\\placeholder(?:\[[^\]]*\])?\{\}/g

function groupAt(latex: string, start: number, open: string, close: string): [string, number] | null {
  let depth = 0
  for (let i = start; i < latex.length; i++) {
    const char = latex.charAt(i)
    if (char === '\\') {
      i++
      continue
    }
    if (char === open) depth++
    else if (char === close && --depth === 0) return [latex.slice(start + 1, i), i + 1]
  }
  return null
}

// Strip one command wrapper and concatenate its editable slots in source order.
export function unwrapCommandLatex(latex: string): string | null {
  const match = latex.match(/^\\([a-zA-Z]+)\*?/)
  if (!match || EXCLUDED_COMMANDS.has(match[1]!)) return null

  const parts: string[] = []
  let offset = match[0].length
  while (offset < latex.length) {
    while (/\s/.test(latex.charAt(offset))) offset++
    if (latex.charAt(offset) === '^' || latex.charAt(offset) === '_') {
      offset++
      while (/\s/.test(latex.charAt(offset))) offset++
    }
    const open = latex.charAt(offset)
    if (open !== '{' && open !== '[') return null
    const group = groupAt(latex, offset, open, open === '{' ? '}' : ']')
    if (!group) return null
    parts.push(group[0].replace(EMPTY_PLACEHOLDER_RE, ''))
    offset = group[1]
  }
  return parts.length > 0 ? parts.join('') : null
}
