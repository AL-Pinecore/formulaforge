import { describe, expect, it } from 'vitest'
import { removeElementAtPlaceholder } from '~/utils/remove-empty-element'

const OPEN_LEN = '\\placeholder{'.length

function caretInPlaceholder(latex: string, occurrence = 1): number {
  let idx = -1
  for (let i = 0; i < occurrence; i++) {
    idx = latex.indexOf('\\placeholder{', idx + 1)
  }
  expect(idx).toBeGreaterThanOrEqual(0)
  return idx + OPEN_LEN
}

function remove(latex: string, occurrence = 1): { latex: string; caretOffset: number } | null {
  return removeElementAtPlaceholder(latex, caretInPlaceholder(latex, occurrence))
}

describe('removeElementAtPlaceholder', () => {
  it('removes an empty square root', () => {
    expect(remove('\\sqrt{\\placeholder{}}')).toEqual({ latex: '', caretOffset: 0 })
  })

  it('removes an empty n-th root with an index', () => {
    expect(remove('\\sqrt[3]{\\placeholder{}}')).toEqual({ latex: '', caretOffset: 0 })
  })

  it('removes an empty fraction when both slots are placeholders', () => {
    expect(remove('\\frac{\\placeholder{}}{\\placeholder{}}')).toEqual({ latex: '', caretOffset: 0 })
  })

  it('promotes the numerator when deleting the empty denominator', () => {
    expect(remove('\\frac{x}{\\placeholder{}}')).toEqual({ latex: 'x', caretOffset: 0 })
  })

  it('promotes the denominator when deleting the empty numerator', () => {
    expect(remove('\\frac{\\placeholder{}}{x}')).toEqual({ latex: 'x', caretOffset: 0 })
  })

  it('promotes content from a binomial coefficient', () => {
    expect(remove('\\binom{a}{\\placeholder{}}')).toEqual({ latex: 'a', caretOffset: 0 })
  })

  it('removes an empty superscript', () => {
    expect(remove('x^{\\placeholder{}}')).toEqual({ latex: 'x', caretOffset: 1 })
  })

  it('removes an empty subscript', () => {
    expect(remove('x_{\\placeholder{}}')).toEqual({ latex: 'x', caretOffset: 1 })
  })

  it('keeps the other script when deleting the superscript', () => {
    expect(remove('x_{\\placeholder{}}^{\\placeholder{}}', 2)).toEqual({ latex: 'x_{\\placeholder{}}', caretOffset: 18 })
  })

  it('keeps the other script when deleting the subscript', () => {
    expect(remove('x_{\\placeholder{}}^{\\placeholder{}}', 1)).toEqual({ latex: 'x^{\\placeholder{}}', caretOffset: 1 })
  })

  it('keeps a filled sibling script', () => {
    expect(remove('x_{a}^{\\placeholder{}}')).toEqual({ latex: 'x_{a}', caretOffset: 5 })
  })

  it('removes an empty sum with both limits empty', () => {
    expect(remove('\\sum_{\\placeholder{}}^{\\placeholder{}}')).toEqual({ latex: '', caretOffset: 0 })
  })

  it('tolerates a caret mapped just after the placeholder closing brace', () => {
    const latex = '\\sum_{\\placeholder{}}^{\\placeholder{}}'
    const idx = latex.indexOf('\\placeholder{') + '\\placeholder{}'.length
    expect(removeElementAtPlaceholder(latex, idx)).toEqual({ latex: '', caretOffset: 0 })
  })

  it('keeps the sum when one limit has content', () => {
    expect(remove('\\sum_{x}^{\\placeholder{}}')).toEqual({ latex: '\\sum_{x}', caretOffset: 8 })
  })

  it('removes an empty limit operator', () => {
    expect(remove('\\lim_{\\placeholder{}}')).toEqual({ latex: '', caretOffset: 0 })
  })

  it('removes an empty accent', () => {
    expect(remove('\\hat{\\placeholder{}}')).toEqual({ latex: '', caretOffset: 0 })
  })

  it('removes an empty function call', () => {
    expect(remove('\\sin(\\placeholder{})')).toEqual({ latex: '', caretOffset: 0 })
  })

  it('removes empty left/right delimiters', () => {
    expect(remove('\\left( \\placeholder{} \\right)')).toEqual({ latex: '', caretOffset: 0 })
  })

  it('removes empty escaped brace delimiters', () => {
    expect(remove('\\left\\{ \\placeholder{} \\right\\}')).toEqual({ latex: '', caretOffset: 0 })
  })

  it('removes empty floor delimiters', () => {
    expect(remove('\\lfloor \\placeholder{} \\rfloor')).toEqual({ latex: '', caretOffset: 0 })
  })

  it('removes an empty matrix environment', () => {
    const latex = '\\begin{pmatrix}\\placeholder{}&\\placeholder{}\\\\\\placeholder{}&\\placeholder{}\\end{pmatrix}'
    expect(remove(latex)).toEqual({ latex: '', caretOffset: 0 })
  })

  it('does not touch a placeholder mixed with real content', () => {
    expect(remove('\\sqrt{x+\\placeholder{}}')).toBeNull()
  })

  it('does not act when the caret is not inside a placeholder', () => {
    expect(removeElementAtPlaceholder('x+1', 2)).toBeNull()
  })

  it('does not remove the whole frac when the other slot still has content', () => {
    // caret in the empty denominator while numerator keeps content
    expect(remove('\\frac{x+1}{\\placeholder{}}')).toEqual({ latex: 'x+1', caretOffset: 0 })
  })

  it('removes an empty overbrace', () => {
    expect(remove('\\overbrace{\\placeholder{}}^{\\placeholder{}}')).toEqual({ latex: '', caretOffset: 0 })
  })

  it('removes an empty underbrace', () => {
    expect(remove('\\underbrace{\\placeholder{}}_{\\placeholder{}}')).toEqual({ latex: '', caretOffset: 0 })
  })

  it('removes an empty log with both slots empty', () => {
    expect(remove('\\log_{\\placeholder{}}(\\placeholder{})')).toEqual({ latex: '', caretOffset: 0 })
  })

  it('promotes the log base when the argument is empty', () => {
    expect(remove('\\log_{x}(\\placeholder{})')).toEqual({ latex: 'x', caretOffset: 0 })
  })

  it('promotes the log argument when the base is empty', () => {
    expect(remove('\\log_{\\placeholder{}}(x)')).toEqual({ latex: 'x', caretOffset: 0 })
  })

  it('removes a limit with an arrow connector between placeholders', () => {
    expect(remove('\\lim_{\\placeholder{} \\to \\placeholder{}}')).toEqual({ latex: '', caretOffset: 0 })
  })

  it('drops the index and keeps the radicand when the index placeholder is deleted', () => {
    expect(remove('\\sqrt[\\placeholder{}]{\\placeholder{}}')).toEqual({
      latex: '\\sqrt{\\placeholder{}}',
      caretOffset: 5,
    })
  })

  it('drops only the index when the n-th root radicand has content', () => {
    expect(remove('\\sqrt[\\placeholder{}]{x}')).toEqual({ latex: '\\sqrt{x}', caretOffset: 5 })
  })
})
