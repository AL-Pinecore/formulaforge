export const TEXT_BOUNDARY_LATEX = '\\mkern0mu'

// Invisible width-bearing content of an empty Text box: it keeps the space the
// gray "Text" hint needs without a placeholder (no selection capture, no
// highlight). It is stripped again when exporting public LaTeX.
export const EMPTY_TEXT_INNER_LATEX = '\\phantom{Text}'

// Math-mode font commands render `\phantom{Text}` as bare bound-less math
// letters, so their empty box uses a text-mode phantom instead: the letters
// serialize as `\text{T}` etc., giving the box the same atom structure as a
// regular Text box.
export const EMPTY_MATH_INNER_LATEX = '\\phantom{\\text{Text}}'

export function emptyTextSentinelLatex(command: string): string {
  return MATH_FONT_COMMANDS.has(command) ? EMPTY_MATH_INNER_LATEX : EMPTY_TEXT_INNER_LATEX
}

// Text-mode font commands (`\text`, `\textbf`, ...). Their content renders in
// the text font and supports the empty-box phantom sentinel.
export const TEXT_COMMANDS = new Set([
  'text',
  'textbf',
  'textit',
  'textmd',
  'textnormal',
  'textrm',
  'textsc',
  'textsf',
  'textsl',
  'texttt',
  'textup',
])

// Math-mode font commands (`\mathbf`, `\mathit`, ...). They are treated like
// Text boxes too: empty boxes show the same gray hint, virtual caret, boundary
// markers and editing behavior. `\bm` is MathLive's canonical bold math
// command (it re-serializes a bold `\phantom{...}` as `\bm{...}`).
export const MATH_FONT_COMMANDS = new Set([
  'mathrm',
  'mathbf',
  'bm',
  'mathit',
  'mathsf',
  'mathtt',
  'mathcal',
  'mathbb',
  'mathfrak',
])

const ALL_TEXT_COMMANDS = new Set([...TEXT_COMMANDS, ...MATH_FONT_COMMANDS])

// The font used by the gray "Text" hint, mirroring how MathLive renders the
// corresponding command so the hint matches the eventual content exactly.
export interface HintFont {
  fontFamily: string
  fontWeight?: number
  fontStyle?: string
}

const TEXT_FONT_FAMILY = "'Times New Roman', 'STIX Two Math', serif"

const HINT_FONTS: Record<string, HintFont> = {
  text: { fontFamily: TEXT_FONT_FAMILY },
  textnormal: { fontFamily: TEXT_FONT_FAMILY },
  textrm: { fontFamily: TEXT_FONT_FAMILY },
  textmd: { fontFamily: TEXT_FONT_FAMILY },
  textup: { fontFamily: TEXT_FONT_FAMILY },
  textsc: { fontFamily: TEXT_FONT_FAMILY },
  textbf: { fontFamily: TEXT_FONT_FAMILY, fontWeight: 700 },
  textit: { fontFamily: TEXT_FONT_FAMILY, fontStyle: 'italic' },
  textsl: { fontFamily: TEXT_FONT_FAMILY, fontStyle: 'italic' },
  textsf: { fontFamily: "'Helvetica Neue', Arial, sans-serif" },
  texttt: { fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" },
  mathrm: { fontFamily: 'KaTeX_Main' },
  mathbf: { fontFamily: 'KaTeX_Main', fontWeight: 700 },
  bm: { fontFamily: 'KaTeX_Main', fontWeight: 700 },
  mathit: { fontFamily: 'KaTeX_Math', fontStyle: 'italic' },
  mathsf: { fontFamily: 'KaTeX_SansSerif' },
  mathtt: { fontFamily: 'KaTeX_Typewriter' },
  mathcal: { fontFamily: 'KaTeX_Caligraphic' },
  mathbb: { fontFamily: 'KaTeX_AMS' },
  mathfrak: { fontFamily: 'KaTeX_Fraktur' },
}

export function textHintFont(command: string): HintFont {
  return HINT_FONTS[command] ?? { fontFamily: TEXT_FONT_FAMILY }
}

function matchingBrace(source: string, open: number): number {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '\\') {
      i++
      continue
    }
    if (source[i] === '{') {
      depth++
    } else if (source[i] === '}') {
      depth--
      if (depth === 0) {
        return i
      }
    }
  }
  return -1
}

function textCommandEnd(source: string, start: number): number {
  if (source[start] !== '\\') {
    return -1
  }
  let commandEnd = start + 1
  while (commandEnd < source.length && /[A-Za-z]/.test(source[commandEnd]!)) {
    commandEnd++
  }
  const command = source.slice(start + 1, commandEnd)
  let argumentStart = commandEnd
  while (argumentStart < source.length && /\s/.test(source[argumentStart]!)) {
    argumentStart++
  }
  if (!ALL_TEXT_COMMANDS.has(command) || source[argumentStart] !== '{') {
    return -1
  }
  const argumentEnd = matchingBrace(source, argumentStart)
  return argumentEnd < 0 ? -1 : argumentEnd + 1
}

// Operator commands whose argument renders in text mode (`\operatorname`,
// `\operatorname*`). They are opaque to the text-box machinery: wrapping the
// inner `\mathrm{...}` MathLive re-serializes them as in zero-width markers
// corrupts the model (e.g. `\operatorname{\mathrm{mm}}` breaking integral
// limits), so the whole command must be copied through untouched.
const OPAQUE_TEXT_COMMANDS = new Set(['operatorname'])

function opaqueTextCommandEnd(source: string, start: number): number {
  if (source[start] !== '\\') {
    return -1
  }
  let commandEnd = start + 1
  while (commandEnd < source.length && /[A-Za-z]/.test(source[commandEnd]!)) {
    commandEnd++
  }
  const command = source.slice(start + 1, commandEnd)
  if (!OPAQUE_TEXT_COMMANDS.has(command)) {
    return -1
  }
  let argumentStart = commandEnd
  if (source[argumentStart] === '*') {
    argumentStart++
  }
  while (argumentStart < source.length && /\s/.test(source[argumentStart]!)) {
    argumentStart++
  }
  if (source[argumentStart] !== '{') {
    return -1
  }
  const argumentEnd = matchingBrace(source, argumentStart)
  return argumentEnd < 0 ? -1 : argumentEnd + 1
}

// Whether a serialized atom (e.g. `\text{a}`, `\mathbf{b}`) is one of the text
// box commands (text-mode or math-mode font commands).
export function isTextCommandLatex(latex: string | undefined): boolean {
  if (!latex) {
    return false
  }
  const match = latex.match(/^\\([a-zA-Z]+)\{/)
  return match != null && ALL_TEXT_COMMANDS.has(match[1]!)
}

export function stripTextBoundaries(latex: string): string {
  let result = ''
  let cursor = 0

  while (cursor < latex.length) {
    if (
      latex.startsWith(TEXT_BOUNDARY_LATEX, cursor) &&
      textCommandEnd(latex, cursor + TEXT_BOUNDARY_LATEX.length) >= 0
    ) {
      cursor += TEXT_BOUNDARY_LATEX.length
      continue
    }
    const commandEnd = textCommandEnd(latex, cursor)
    if (commandEnd >= 0) {
      result += latex.slice(cursor, commandEnd)
      cursor = commandEnd
      if (latex.startsWith(TEXT_BOUNDARY_LATEX, cursor)) {
        cursor += TEXT_BOUNDARY_LATEX.length
      }
      continue
    }
    result += latex[cursor]
    cursor++
  }

  return result
}

// Drops zero-width markers that are no longer directly attached to a text
// command (e.g. after a deletion removed only the `\text{...}` group). Managed
// markers must always sit immediately before or after their text command;
// anything else is an editing artifact and is removed to prevent MathLive from
// re-interpreting it as text content.
export function removeOrphanedTextBoundaries(latex: string): string {
  let result = ''
  let cursor = 0
  let lastCommandEnd = -1

  while (cursor < latex.length) {
    if (latex.startsWith(TEXT_BOUNDARY_LATEX, cursor)) {
      const after = cursor + TEXT_BOUNDARY_LATEX.length
      const beforeCommand = textCommandEnd(latex, after) >= 0
      const afterCommand = lastCommandEnd === cursor
      if (beforeCommand || afterCommand) {
        result += TEXT_BOUNDARY_LATEX
        cursor = after
        continue
      }
      cursor += TEXT_BOUNDARY_LATEX.length
      continue
    }
    const commandEnd = textCommandEnd(latex, cursor)
    if (commandEnd >= 0) {
      result += latex.slice(cursor, commandEnd)
      cursor = commandEnd
      lastCommandEnd = commandEnd
      continue
    }
    result += latex[cursor]
    cursor++
  }

  return result
}

export function addTextBoundaries(latex: string): string {
  const source = stripTextBoundaries(latex)
  let result = ''
  let cursor = 0

  while (cursor < source.length) {
    const opaqueEnd = opaqueTextCommandEnd(source, cursor)
    if (opaqueEnd >= 0) {
      result += source.slice(cursor, opaqueEnd)
      cursor = opaqueEnd
      continue
    }
    const commandEnd = textCommandEnd(source, cursor)
    if (commandEnd < 0) {
      result += source[cursor]
      cursor++
      continue
    }
    result += TEXT_BOUNDARY_LATEX
    result += source.slice(cursor, commandEnd)
    result += TEXT_BOUNDARY_LATEX
    cursor = commandEnd
  }

  return result
}

// A serialized text command whose whole content is the empty-box sentinel, e.g.
// `\text{\phantom{Text}}` or `\textbf{\phantom{Text}}`. MathLive re-serializes
// the phantom inside styled text with the style repeated (`\textbf{\phantom{
// \textbf{Text}}}`), so nested text-style wrappers are unwrapped first.
function unwrapTextStyles(latex: string): string {
  let result = latex
  for (;;) {
    let changed = false
    const next = result.replace(/\\([a-zA-Z]+)\{([^{}]*)\}/g, (match, command: string, inner: string) => {
      if (ALL_TEXT_COMMANDS.has(command)) {
        changed = true
        return inner
      }
      return match
    })
    if (!changed) {
      return result
    }
    result = next
  }
  return result
}

export function isEmptyTextLatex(latex: string): boolean {
  const match = latex.match(/^\\([a-zA-Z]+)\{(.*)\}$/)
  if (!match || !ALL_TEXT_COMMANDS.has(match[1]!)) {
    return false
  }
  return unwrapTextStyles(match[2]!) === '\\phantom{Text}'
}

// Public export: an empty Text box serializes as `\text{}` (the internal
// phantom sentinel is never exposed).
export function stripEmptyTextSentinel(latex: string): string {
  return latex.replace(
    /\\([a-zA-Z]+)\{[^{}]*\\phantom\{(?:\\(?:text|math)[a-zA-Z]*\{)*Text\}*[^{}]*\}[^{}]*\}/g,
    (match, command: string) => {
      if (!ALL_TEXT_COMMANDS.has(command)) {
        return match
      }
      const inner = match.slice(command.length + 2, -1)
      return unwrapTextStyles(inner) === '\\phantom{Text}' ? `\\${command}{}` : match
    },
  )
}

// Merge adjacent text commands of the SAME command into one, e.g.
// `\text{a}\text{b}` -> `\text{ab}` and `\mathbf{a}\mathbf{b}` ->
// `\mathbf{ab}`. Different commands are kept separate. Empty boxes (whose
// content is the phantom sentinel) merge away: empty + empty stays empty,
// empty + content yields the content. Boundaries between the commands must be
// stripped first. Content with braces is skipped.
export function mergeAdjacentTextCommands(latex: string): string {
  const commands = [...ALL_TEXT_COMMANDS].sort((a, b) => b.length - a.length)
  const commandPattern = `\\\\(?:${commands.join('|')})`
  // Empty boxes are either `\phantom{Text}` (text commands) or
  // `\phantom{\text{Text}}` (math commands).
  const re = new RegExp(
    `(${commandPattern})\\{([^{}]*|\\\\phantom\\{Text\\}|\\\\phantom\\{\\\\text\\{Text\\}\\})\\}\\s*\\1\\{([^{}]*|\\\\phantom\\{Text\\}|\\\\phantom\\{\\\\text\\{Text\\}\\})\\}`,
    'g',
  )
  let result = latex
  for (;;) {
    let changed = false
    const next = result.replace(re, (match, command: string, first: string, second: string) => {
      changed = true
      const isEmpty = (s: string) =>
        s === EMPTY_TEXT_INNER_LATEX || s === EMPTY_MATH_INNER_LATEX
      const content = isEmpty(first) ? second : isEmpty(second) ? first : `${first}${second}`
      return `${command}{${content}}`
    })
    if (!changed) {
      return result
    }
    result = next
  }
}

// Insert template: `\text{#0}` slots of text commands become the phantom
// sentinel instead of a MathLive placeholder (other elements keep `#0`).
export function withEmptyTextSentinel(latex: string): string {
  return latex.replace(/^\\([a-zA-Z]+)\{#0\}/, (match, command: string) =>
    ALL_TEXT_COMMANDS.has(command) ? `\\${command}{${emptyTextSentinelLatex(command)}}` : match,
  )
}
