// Detect empty LaTeX groups and restore placeholders into them, so that
// deleting a group's content (e.g. the argument of \sqrt) leaves an editable
// placeholder behind instead of a broken empty group.

// A whole matrix/cases/aligned environment body.
const ENVIRONMENT = /(\\begin\{[a-zA-Z]+\*?\}(?:\[[^\]]*\])?)([\s\S]*?)(\\end\{[a-zA-Z]+\*?\})/g

function fillEnvironmentCells(body: string): string {
  return body
    .split(/\\\\/)
    .map((row) =>
      row
        .split('&')
        .map((cell) => (cell.trim() === '' ? '\\placeholder{}' : cell))
        .join('&'),
    )
    .join('\\\\')
}

export function restoreEmptyGroupLatex(latex: string): string | null {
  let result = latex

  // Command with an empty mandatory argument: \sqrt{}, \hat{}, \frac{}{} (first
  // brace), \sqrt[n]{}. \placeholder is excluded so we never nest placeholders.
  result = result.replace(
    /\\(?!placeholder\b)([a-zA-Z]+(?:\[[^\]]*\])*)\{\}/g,
    '\\$1{\\placeholder{}}',
  )

  // Empty superscript/subscript: ^{}, _{}
  result = result.replace(/([_^])\{\}/g, '$1{\\placeholder{}}')

  // Empty \left...\right delimiters (parenthesis/bracket/bar/dot, then braces).
  result = result.replace(
    /(\\left[()\[\]|.])\s*(\\right[()\[\]|.])/g,
    '$1\\placeholder{}$2',
  )
  result = result.replace(
    /(\\left\\[{}])\s*(\\right\\[{}])/g,
    '$1\\placeholder{}$2',
  )

  // Any remaining bare empty group {} (but not a \placeholder argument).
  result = result.replace(/\{\}/g, (match, offset) => {
    if (/(?:\\placeholder(?:\[[^\]]*\])?)$/.test(result.slice(0, offset))) {
      return match
    }
    return '{\\placeholder{}}'
  })

  // Empty cells in matrix/cases/aligned environments.
  result = result.replace(
    ENVIRONMENT,
    (match, begin, body, end) => begin + fillEnvironmentCells(body) + end,
  )

  return result === latex ? null : result
}
