import { describe, expect, it } from 'vitest'
import { normalizeDifferential } from '~/utils/latex-normalize'

describe('normalizeDifferential', () => {
  it('rewrites MathLive differential to standard upright d', () => {
    expect(normalizeDifferential('\\int \\differentialD x')).toBe('\\int \\mathrm{d} x')
  })

  it('rewrites every occurrence', () => {
    expect(normalizeDifferential('\\differentialD x \\differentialD y')).toBe(
      '\\mathrm{d} x \\mathrm{d} y',
    )
  })

  it('leaves unrelated LaTeX untouched', () => {
    expect(normalizeDifferential('\\frac{a}{b}')).toBe('\\frac{a}{b}')
    expect(normalizeDifferential('\\mathrm{d}')).toBe('\\mathrm{d}')
  })
})
