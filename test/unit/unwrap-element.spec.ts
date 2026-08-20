import { describe, expect, it } from 'vitest'
import { unwrapCommandLatex } from '~/utils/unwrap-element'

describe('unwrapCommandLatex', () => {
  it('unwraps one slot and concatenates multiple slots', () => {
    expect(unwrapCommandLatex('\\sqrt{x}')).toBe('x')
    expect(unwrapCommandLatex('\\frac{a}{b}')).toBe('ab')
    expect(unwrapCommandLatex('\\sqrt[3]{x}')).toBe('3x')
    expect(unwrapCommandLatex('\\overbrace{x}^{n}')).toBe('xn')
    expect(unwrapCommandLatex('\\frac{\\placeholder{}}{b}')).toBe('b')
    expect(unwrapCommandLatex('\\frac{a}{\\placeholder[selected]{}}')).toBe('a')
  })

  it('keeps nested content intact and ignores structural commands', () => {
    expect(unwrapCommandLatex('\\hat{\\frac{a}{b}}')).toBe('\\frac{a}{b}')
    expect(unwrapCommandLatex('\\begin{matrix}')).toBeNull()
    expect(unwrapCommandLatex('x')).toBeNull()
  })
})
