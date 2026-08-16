// Remove the math construct surrounding a placeholder that is the sole content
// of one of its argument slots, promoting any real content held in sibling
// slots up to the parent level. Used when the caret sits inside an empty
// placeholder and the user presses Backspace/Delete.

const PLACEHOLDER_RE = /\\placeholder(?:\[[^\]]*\])?\{\}/g

// Template connectors that join placeholders (e.g. `\lim_{\placeholder{} \to
// \placeholder{}}`). They carry no user content, so they are ignored when
// deciding whether a slot is empty.
const CONNECTOR_RE = /\\(?:to|rightarrow)\b/g

function stripPlaceholders(s: string): string {
  return s.replace(PLACEHOLDER_RE, '')
}

// True when `s` contains no real tokens — only placeholders, connectors and
// whitespace.
function isPlaceholderOnly(s: string): boolean {
  return s.replace(PLACEHOLDER_RE, '').replace(CONNECTOR_RE, '').trim() === ''
}

// Like isPlaceholderOnly but also ignores matrix/cases separators (& and \\).
function isPlaceholderGrid(s: string): boolean {
  return s
    .replace(PLACEHOLDER_RE, '')
    .replace(CONNECTOR_RE, '')
    .replace(/[\s&]/g, '')
    .replace(/\\\\/g, '')
    .trim() === ''
}

export interface RemoveResult {
  latex: string
  caretOffset: number
}

// Locate the `\placeholder{}` whose body contains the caret. MathLive may map
// the caret to just after the opening `{`, between the braces, or immediately
// after the closing `}` depending on whether the placeholder sits in a regular
// group or in an operator branch, so accept any of those positions.
function placeholderAtCaret(latex: string, caret: number): { start: number; end: number } | null {
  const re = /\\placeholder(?:\[[^\]]*\])?\{\}/g
  let match
  while ((match = re.exec(latex))) {
    const start = match.index
    const end = match.index + match[0].length
    const openBrace = match[0].lastIndexOf('{')
    if (caret >= start + openBrace + 1 && caret <= end) {
      return { start, end }
    }
  }
  return null
}

function matchingBrace(latex: string, open: number): number {
  let depth = 0
  for (let i = open; i < latex.length; i++) {
    const ch = latex.charAt(i)
    if (ch === '{') {
      if (i > 0 && latex.charAt(i - 1) === '\\') continue
      depth++
    } else if (ch === '}') {
      if (i > 0 && latex.charAt(i - 1) === '\\') continue
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function matchingBraceBackward(latex: string, close: number): number {
  let depth = 0
  for (let i = close; i >= 0; i--) {
    const ch = latex.charAt(i)
    if (ch === '{') {
      if (i > 0 && latex.charAt(i - 1) === '\\') continue
      depth--
      if (depth === 0) return i
    } else if (ch === '}') {
      if (i > 0 && latex.charAt(i - 1) === '\\') continue
      depth++
    }
  }
  return -1
}

function matchingParen(latex: string, open: number): number {
  let depth = 0
  for (let i = open; i < latex.length; i++) {
    if (latex.charAt(i) === '(') depth++
    else if (latex.charAt(i) === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

// The `{...}` group whose body contains only the placeholder at `ph.start`.
// Returns null when the placeholder shares its group with real content (then
// MathLive's default delete applies).
function enclosingBraceSlot(latex: string, phStart: number): { open: number; close: number } | null {
  let i = phStart - 1
  while (i >= 0 && /\s/.test(latex.charAt(i))) i--
  if (i < 0 || latex.charAt(i) !== '{' || (i > 0 && latex.charAt(i - 1) === '\\')) return null
  const close = matchingBrace(latex, i)
  if (close < 0) return null
  if (!isPlaceholderOnly(latex.slice(i + 1, close))) return null
  return { open: i, close }
}

const FRAC_CMD = /\\frac$|\\dfrac$|\\tfrac$|\\binom$/

function removeFraction(latex: string, ph: { start: number; end: number }): RemoveResult | null {
  const slot = enclosingBraceSlot(latex, ph.start)
  if (!slot) return null
  const before = latex.slice(0, slot.open)

  // Caret in the first argument: `\frac{<slot>}{...}`
  const firstCmd = before.match(FRAC_CMD)
  if (firstCmd) {
    const cmdStart = slot.open - firstCmd[0]!.length
    let j = slot.close + 1
    while (j < latex.length && /\s/.test(latex.charAt(j))) j++
    if (latex.charAt(j) !== '{') return null
    const secondClose = matchingBrace(latex, j)
    if (secondClose < 0) return null
    const promoted =
      stripPlaceholders(latex.slice(slot.open + 1, slot.close)) +
      stripPlaceholders(latex.slice(j + 1, secondClose))
    if (promoted.trim() === '') {
      return { latex: latex.slice(0, cmdStart) + latex.slice(secondClose + 1), caretOffset: cmdStart }
    }
    return { latex: latex.slice(0, cmdStart) + promoted + latex.slice(secondClose + 1), caretOffset: cmdStart }
  }

  // Caret in the second argument: `\frac{...}{<slot>}`
  if (before.endsWith('}')) {
    const firstOpen = matchingBraceBackward(latex, before.length - 1)
    if (firstOpen < 0) return null
    const cmd = latex.slice(0, firstOpen).match(FRAC_CMD)
    if (!cmd) return null
    const cmdStart = firstOpen - cmd[0]!.length
    const promoted =
      stripPlaceholders(latex.slice(firstOpen + 1, before.length - 1)) +
      stripPlaceholders(latex.slice(slot.open + 1, slot.close))
    if (promoted.trim() === '') {
      return { latex: latex.slice(0, cmdStart) + latex.slice(slot.close + 1), caretOffset: cmdStart }
    }
    return { latex: latex.slice(0, cmdStart) + promoted + latex.slice(slot.close + 1), caretOffset: cmdStart }
  }

  return null
}

const OVER_UNDER_RE = /\\(?:overbrace|underbrace)$/

function removeOverUnder(latex: string, ph: { start: number; end: number }): RemoveResult | null {
  const slot = enclosingBraceSlot(latex, ph.start)
  if (!slot) return null
  const before = latex.slice(0, slot.open)
  const cmd = before.match(OVER_UNDER_RE)
  if (!cmd) return null
  const cmdStart = slot.open - cmd[0]!.length
  // Include a trailing script (the brace annotation) when present.
  let end = slot.close
  let j = slot.close + 1
  while (j < latex.length && /\s/.test(latex.charAt(j))) j++
  if (latex.charAt(j) === '^' || latex.charAt(j) === '_') {
    let open = j + 1
    while (open < latex.length && /\s/.test(latex.charAt(open))) open++
    if (latex.charAt(open) === '{') {
      const close = matchingBrace(latex, open)
      if (close >= 0) end = close
    }
  }
  return { latex: latex.slice(0, cmdStart) + latex.slice(end + 1), caretOffset: cmdStart }
}

const OPERATOR_RE = /\\(?:iiint|iint|oint|int|sum|prod|lim|bigcup|bigcap)$/

function removeOperator(latex: string, ph: { start: number; end: number }): RemoveResult | null {
  const slot = enclosingBraceSlot(latex, ph.start)
  if (!slot) return null
  let scriptIdx = slot.open - 1
  while (scriptIdx >= 0 && /\s/.test(latex.charAt(scriptIdx))) scriptIdx--
  if (scriptIdx < 0 || (latex.charAt(scriptIdx) !== '^' && latex.charAt(scriptIdx) !== '_')) return null

  const scripts: { token: number; open: number; close: number }[] = [
    { token: scriptIdx, open: slot.open, close: slot.close },
  ]

  let right = slot.close + 1
  while (right < latex.length && /\s/.test(latex.charAt(right))) right++
  if (latex.charAt(right) === '^' || latex.charAt(right) === '_') {
    let open = right + 1
    while (open < latex.length && /\s/.test(latex.charAt(open))) open++
    if (latex.charAt(open) === '{') {
      const close = matchingBrace(latex, open)
      if (close >= 0) scripts.push({ token: right, open, close })
    }
  }

  let left = scriptIdx - 1
  while (left >= 0 && /\s/.test(latex.charAt(left))) left--
  if (latex.charAt(left) === '}') {
    const open = matchingBraceBackward(latex, left)
    if (open >= 0) {
      let token = open - 1
      while (token >= 0 && /\s/.test(latex.charAt(token))) token--
      if (latex.charAt(token) === '^' || latex.charAt(token) === '_') {
        scripts.push({ token, open, close: left })
      }
    }
  }

  let minToken = scripts[0]!.token
  for (const s of scripts) minToken = Math.min(minToken, s.token)
  let opIdx = minToken - 1
  while (opIdx >= 0 && /\s/.test(latex.charAt(opIdx))) opIdx--
  const opMatch = latex.slice(0, opIdx + 1).match(OPERATOR_RE)
  if (!opMatch) return null
  const opStart = opIdx + 1 - opMatch[0]!.length

  const allEmpty = scripts.every((s) => isPlaceholderOnly(latex.slice(s.open + 1, s.close)))
  if (allEmpty) {
    let maxClose = scripts[0]!.close
    for (const s of scripts) maxClose = Math.max(maxClose, s.close)
    return { latex: latex.slice(0, opStart) + latex.slice(maxClose + 1), caretOffset: opStart }
  }

  // Only the caret's own empty slot is removed.
  return { latex: latex.slice(0, scriptIdx) + latex.slice(slot.close + 1), caretOffset: scriptIdx }
}

const LOG_RE = /\\log$/

// `\log_{base}(arg)`: promotes whichever slot still holds content, and removes
// the whole command when both slots are empty.
function removeLog(latex: string, ph: { start: number; end: number }): RemoveResult | null {
  // Caret in the base slot `_{...}`.
  const braceSlot = enclosingBraceSlot(latex, ph.start)
  if (braceSlot) {
    let token = braceSlot.open - 1
    while (token >= 0 && /\s/.test(latex.charAt(token))) token--
    if (latex.charAt(token) === '_') {
      let opIdx = token - 1
      while (opIdx >= 0 && /\s/.test(latex.charAt(opIdx))) opIdx--
      const op = latex.slice(0, opIdx + 1).match(LOG_RE)
      if (op) {
        const cmdStart = opIdx + 1 - op[0]!.length
        let j = braceSlot.close + 1
        while (j < latex.length && /\s/.test(latex.charAt(j))) j++
        if (latex.charAt(j) === '(') {
          const parenClose = matchingParen(latex, j)
          if (parenClose >= 0) {
            const promoted =
              stripPlaceholders(latex.slice(braceSlot.open + 1, braceSlot.close)) +
              stripPlaceholders(latex.slice(j + 1, parenClose))
            if (promoted.trim() === '') {
              return { latex: latex.slice(0, cmdStart) + latex.slice(parenClose + 1), caretOffset: cmdStart }
            }
            return { latex: latex.slice(0, cmdStart) + promoted + latex.slice(parenClose + 1), caretOffset: cmdStart }
          }
        }
        return { latex: latex.slice(0, token) + latex.slice(braceSlot.close + 1), caretOffset: token }
      }
    }
  }

  // Caret in the paren slot `(...)`.
  let i = ph.start - 1
  while (i >= 0 && /\s/.test(latex.charAt(i))) i--
  if (latex.charAt(i) === '(') {
    const parenClose = matchingParen(latex, i)
    if (parenClose >= 0 && isPlaceholderOnly(latex.slice(i + 1, parenClose))) {
      const before = latex.slice(0, i)
      let opEnd = before.length
      let baseContent = ''
      if (before.endsWith('}')) {
        const baseOpen = matchingBraceBackward(latex, before.length - 1)
        if (baseOpen >= 0) {
          baseContent = latex.slice(baseOpen + 1, before.length - 1)
          let t = baseOpen - 1
          while (t >= 0 && /\s/.test(latex.charAt(t))) t--
          opEnd = latex.charAt(t) === '_' ? t : baseOpen
        }
      }
      const op = latex.slice(0, opEnd).match(LOG_RE)
      if (op) {
        const cmdStart = opEnd - op[0]!.length
        const promoted = stripPlaceholders(baseContent) + stripPlaceholders(latex.slice(i + 1, parenClose))
        if (promoted.trim() === '') {
          return { latex: latex.slice(0, cmdStart) + latex.slice(parenClose + 1), caretOffset: cmdStart }
        }
        return { latex: latex.slice(0, cmdStart) + promoted + latex.slice(parenClose + 1), caretOffset: cmdStart }
      }
    }
  }

  return null
}

// `\sqrt[#]{#}`: deleting the optional-index placeholder drops the index and
// leaves the (possibly empty) main argument behind, turning the n-th root into
// a plain root. A second Backspace on the body then removes the whole command.
function removeOptionalIndex(latex: string, ph: { start: number; end: number }): RemoveResult | null {
  let i = ph.start - 1
  while (i >= 0 && /\s/.test(latex.charAt(i))) i--
  if (i < 0 || latex.charAt(i) !== '[' || (i > 0 && latex.charAt(i - 1) === '\\')) return null
  let depth = 0
  let j = i
  for (; j < latex.length; j++) {
    if (latex.charAt(j) === '[') depth++
    else if (latex.charAt(j) === ']') {
      depth--
      if (depth === 0) break
    }
  }
  if (j >= latex.length || !isPlaceholderOnly(latex.slice(i + 1, j))) return null
  const before = latex.slice(0, i)
  const cmd = before.match(/\\[a-zA-Z]+$/)
  if (!cmd) return null
  return { latex: latex.slice(0, i) + latex.slice(j + 1), caretOffset: i }
}

function removeScripts(latex: string, ph: { start: number; end: number }): RemoveResult | null {
  const slot = enclosingBraceSlot(latex, ph.start)
  if (!slot) return null
  let scriptIdx = slot.open - 1
  while (scriptIdx >= 0 && /\s/.test(latex.charAt(scriptIdx))) scriptIdx--
  if (scriptIdx < 0 || (latex.charAt(scriptIdx) !== '^' && latex.charAt(scriptIdx) !== '_')) return null

  const start = scriptIdx
  const end = slot.close

  return { latex: latex.slice(0, start) + latex.slice(end + 1), caretOffset: start }
}

const EXCLUDED_COMMANDS = new Set([
  '\\frac',
  '\\dfrac',
  '\\tfrac',
  '\\binom',
  '\\overbrace',
  '\\underbrace',
  '\\left',
  '\\right',
  '\\begin',
  '\\end',
  '\\log',
])

function removeSingleArgCommand(latex: string, ph: { start: number; end: number }): RemoveResult | null {
  const slot = enclosingBraceSlot(latex, ph.start)
  if (!slot) return null
  const before = latex.slice(0, slot.open)
  const match = before.match(/\\[a-zA-Z]+\s*(?:\[[^\]]*\]\s*)?$/)
  if (!match) return null
  const bare = match[0]!.match(/^\\[a-zA-Z]+/)?.[0] ?? ''
  if (EXCLUDED_COMMANDS.has(bare)) return null
  const start = slot.open - match[0]!.length
  return { latex: latex.slice(0, start) + latex.slice(slot.close + 1), caretOffset: start }
}

const FUNCTION_RE = /\\(?:sin|cos|tan|arcsin|arccos|arctan|sinh|cosh|tanh|ln|exp)$/

function removeFunctionParen(latex: string, ph: { start: number; end: number }): RemoveResult | null {
  let i = ph.start - 1
  while (i >= 0 && /\s/.test(latex.charAt(i))) i--
  if (i < 0 || latex.charAt(i) !== '(') return null
  let depth = 0
  let j = i
  for (; j < latex.length; j++) {
    if (latex.charAt(j) === '(') depth++
    else if (latex.charAt(j) === ')') {
      depth--
      if (depth === 0) break
    }
  }
  if (j >= latex.length || !isPlaceholderOnly(latex.slice(i + 1, j))) return null
  const before = latex.slice(0, i)
  const match = before.match(FUNCTION_RE)
  if (!match) return null
  const start = before.length - match[0]!.length
  return { latex: latex.slice(0, start) + latex.slice(j + 1), caretOffset: start }
}

function removeDelimiters(latex: string, ph: { start: number; end: number }): RemoveResult | null {
  const prefix = latex.slice(0, ph.start)
  const suffix = latex.slice(ph.end)

  const leftMatch = prefix.match(/(\\left(?:\\[{}]|[()[\]|.]))\s*$/)
  if (leftMatch) {
    const start = prefix.length - leftMatch[0]!.length
    const rightMatch = suffix.match(/^\s*(\\right(?:\\[{}]|[()[\]|.]))/)
    if (!rightMatch) return null
    const end = ph.end + rightMatch[0]!.length
    return { latex: latex.slice(0, start) + latex.slice(end), caretOffset: start }
  }

  const pairs: [string, string][] = [
    ['\\lfloor', '\\rfloor'],
    ['\\lceil', '\\rceil'],
    ['\\langle', '\\rangle'],
    ['\\lvert', '\\rvert'],
    ['\\lVert', '\\rVert'],
  ]
  const trimmedPrefix = prefix.replace(/\s+$/, '')
  for (const [open, close] of pairs) {
    if (!trimmedPrefix.endsWith(open)) continue
    const start = trimmedPrefix.length - open.length
    const closeIdx = suffix.indexOf(close)
    if (closeIdx < 0) continue
    const end = ph.end + closeIdx + close.length
    return { latex: latex.slice(0, start) + latex.slice(end), caretOffset: start }
  }
  return null
}

function removeEnvironment(latex: string, ph: { start: number; end: number }): RemoveResult | null {
  const prefix = latex.slice(0, ph.start)
  const begins = [...prefix.matchAll(/\\begin\{([a-zA-Z]+)\}/g)]
  const beginMatch = begins[begins.length - 1]
  if (!beginMatch || beginMatch.index === undefined) return null
  const env = beginMatch[1]!
  const beginEnd = beginMatch.index + beginMatch[0]!.length
  const endIdx = latex.indexOf(`\\end{${env}}`, beginEnd)
  if (endIdx < 0) return null
  const endClose = endIdx + `\\end{${env}}`.length
  if (!isPlaceholderGrid(latex.slice(beginEnd, endIdx))) return null
  return { latex: latex.slice(0, beginMatch.index) + latex.slice(endClose), caretOffset: beginMatch.index }
}

export function removeElementAtPlaceholder(latex: string, caretOffset: number): RemoveResult | null {
  const ph = placeholderAtCaret(latex, caretOffset)
  if (!ph) return null
  return (
    removeFraction(latex, ph) ??
    removeOverUnder(latex, ph) ??
    removeLog(latex, ph) ??
    removeOperator(latex, ph) ??
    removeScripts(latex, ph) ??
    removeSingleArgCommand(latex, ph) ??
    removeFunctionParen(latex, ph) ??
    removeOptionalIndex(latex, ph) ??
    removeDelimiters(latex, ph) ??
    removeEnvironment(latex, ph)
  )
}
