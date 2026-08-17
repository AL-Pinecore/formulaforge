import { describe, expect, it } from 'vitest'
import { ACCENT_COMMANDS, isAccentConstructLatex } from '~/utils/accent'

describe('isAccentConstructLatex', () => {
  it('recognizes single-argument accent constructs', () => {
    expect(isAccentConstructLatex('\\hat{x}')).toBe(true)
    expect(isAccentConstructLatex('\\bar{x}')).toBe(true)
    expect(isAccentConstructLatex('\\vec{xy}')).toBe(true)
    expect(isAccentConstructLatex('\\widehat{abc}')).toBe(true)
    expect(isAccentConstructLatex('\\overline{x+1}')).toBe(true)
  })

  it('recognizes overbrace/underbrace constructs with scripts', () => {
    expect(isAccentConstructLatex('\\overbrace{x}^{2}')).toBe(true)
    expect(isAccentConstructLatex('\\underbrace{x}_{n}')).toBe(true)
  })

  it('rejects non-accent commands', () => {
    expect(isAccentConstructLatex('\\sqrt{x}')).toBe(false)
    expect(isAccentConstructLatex('\\frac{a}{b}')).toBe(false)
    expect(isAccentConstructLatex('x')).toBe(false)
    expect(isAccentConstructLatex(undefined)).toBe(false)
    expect(isAccentConstructLatex('')).toBe(false)
  })

  it('covers every accent palette element', () => {
    for (const command of [
      'hat',
      'bar',
      'vec',
      'dot',
      'ddot',
      'tilde',
      'widehat',
      'widetilde',
      'overline',
      'underline',
      'overrightarrow',
      'overleftarrow',
      'overbrace',
      'underbrace',
    ]) {
      expect(ACCENT_COMMANDS.has(command)).toBe(true)
    }
  })
})
