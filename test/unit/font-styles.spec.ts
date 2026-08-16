import { describe, expect, it } from 'vitest'
import { FONT_STYLES, isFontStyleElement } from '~/utils/font-styles'

describe('font styles', () => {
  it('maps the text-applicable font elements to MathLive styles', () => {
    expect(FONT_STYLES.mathrm).toEqual({ fontFamily: 'roman' })
    expect(FONT_STYLES.mathbf).toEqual({ fontSeries: 'b' })
    expect(FONT_STYLES.mathit).toEqual({ fontShape: 'it' })
    expect(FONT_STYLES.mathsf).toEqual({ fontFamily: 'sans-serif' })
    expect(FONT_STYLES.mathtt).toEqual({ fontFamily: 'monospace' })
  })

  it('excludes the Text element and math-only alphabets', () => {
    expect(isFontStyleElement('mathbf')).toBe(true)
    expect(isFontStyleElement('text')).toBe(false)
    expect(isFontStyleElement('mathcal')).toBe(false)
    expect(isFontStyleElement('mathbb')).toBe(false)
    expect(isFontStyleElement('mathfrak')).toBe(false)
    expect(isFontStyleElement('frac')).toBe(false)
  })
})
