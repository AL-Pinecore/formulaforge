import { describe, expect, it } from 'vitest'
import { restoreEmptyGroupLatex } from '../../app/utils/empty-group'

describe('restoreEmptyGroupLatex', () => {
  it('restores a placeholder into an empty sqrt', () => {
    expect(restoreEmptyGroupLatex('\\sqrt{}')).toBe('\\sqrt{\\placeholder{}}')
    expect(restoreEmptyGroupLatex('\\sqrt[3]{}')).toBe('\\sqrt[3]{\\placeholder{}}')
  })

  it('restores empty fraction arguments', () => {
    expect(restoreEmptyGroupLatex('\\frac{}{}')).toBe(
      '\\frac{\\placeholder{}}{\\placeholder{}}',
    )
    expect(restoreEmptyGroupLatex('\\frac{x}{}')).toBe(
      '\\frac{x}{\\placeholder{}}',
    )
    expect(restoreEmptyGroupLatex('\\frac{}{y}')).toBe(
      '\\frac{\\placeholder{}}{y}',
    )
  })

  it('restores empty accent and function arguments', () => {
    expect(restoreEmptyGroupLatex('\\hat{}')).toBe('\\hat{\\placeholder{}}')
    expect(restoreEmptyGroupLatex('\\sin{}')).toBe('\\sin{\\placeholder{}}')
  })

  it('restores empty superscripts and subscripts', () => {
    expect(restoreEmptyGroupLatex('x^{}')).toBe('x^{\\placeholder{}}')
    expect(restoreEmptyGroupLatex('x_{}')).toBe('x_{\\placeholder{}}')
  })

  it('restores empty delimiters', () => {
    expect(restoreEmptyGroupLatex('\\left(\\right)')).toBe(
      '\\left(\\placeholder{}\\right)',
    )
    expect(restoreEmptyGroupLatex('\\left( \\right)')).toBe(
      '\\left(\\placeholder{}\\right)',
    )
  })

  it('restores empty matrix cells', () => {
    expect(restoreEmptyGroupLatex('\\begin{pmatrix} & \\\\ & \\end{pmatrix}')).toBe(
      '\\begin{pmatrix}\\placeholder{}&\\placeholder{}\\\\\\placeholder{}&\\placeholder{}\\end{pmatrix}',
    )
  })

  it('leaves already-filled groups and existing placeholders alone', () => {
    expect(restoreEmptyGroupLatex('\\sqrt{x+1}')).toBeNull()
    expect(restoreEmptyGroupLatex('\\sqrt{\\placeholder{}}')).toBeNull()
    expect(restoreEmptyGroupLatex('\\frac{a}{b}')).toBeNull()
    expect(restoreEmptyGroupLatex('x+1')).toBeNull()
  })

  it('does not nest placeholders inside placeholders', () => {
    expect(restoreEmptyGroupLatex('\\placeholder{}')).toBeNull()
  })
})
