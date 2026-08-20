import { describe, expect, it } from 'vitest'
import { normalizePortableLatex } from '~/utils/latex-normalize'

describe('normalizePortableLatex', () => {
  it('rewrites MathLive-only identifiers to standard LaTeX', () => {
    expect(
      normalizePortableLatex(
        '\\exponentialE \\imaginaryI \\imaginaryJ \\differentialD \\capitalDifferentialD \\degree',
      ),
    ).toBe('\\mathrm{e} \\mathrm{i} \\mathrm{j} \\mathrm{d} \\mathrm{D} {}^{\\circ}')
  })

  it('uses mainstream extensible-arrow commands for MathLive long-arrow arguments', () => {
    expect(normalizePortableLatex('\\longleftarrow[below]{above} + \\longrightarrow{}')).toBe(
      '\\xleftarrow[below]{above} + \\xrightarrow{}',
    )
    expect(normalizePortableLatex('\\longleftarrow + \\longrightarrow')).toBe(
      '\\longleftarrow + \\longrightarrow',
    )
  })

  it('leaves unrelated LaTeX untouched', () => {
    expect(normalizePortableLatex('\\frac{a}{b}')).toBe('\\frac{a}{b}')
    expect(normalizePortableLatex('\\mathrm{d}')).toBe('\\mathrm{d}')
  })
})
