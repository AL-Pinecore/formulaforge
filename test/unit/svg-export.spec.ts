import { describe, expect, it } from 'vitest'
import {
  applyMathstyle,
  composeStandaloneSvg,
  parseExSize,
  sanitizeColor,
  stripXmlDeclaration,
} from '../../app/utils/svg-export'

describe('parseExSize', () => {
  it('parses ex units', () => {
    expect(parseExSize('5.555ex')).toBeCloseTo(5.555)
    expect(parseExSize('1ex')).toBe(1)
  })

  it('rejects other units', () => {
    expect(parseExSize('100px')).toBeNull()
    expect(parseExSize('50%')).toBeNull()
    expect(parseExSize(null)).toBeNull()
    expect(parseExSize(undefined)).toBeNull()
  })
})

describe('sanitizeColor', () => {
  it('accepts hex colors', () => {
    expect(sanitizeColor('#1A2B3C')).toBe('#1a2b3c')
    expect(sanitizeColor('#ff0000aa')).toBe('#ff0000aa')
  })

  it('rejects non-hex values', () => {
    expect(sanitizeColor('red')).toBeNull()
    expect(sanitizeColor('rgb(1,2,3)')).toBeNull()
    expect(sanitizeColor('#12345')).toBeNull()
    expect(sanitizeColor(null)).toBeNull()
  })
})

describe('composeStandaloneSvg', () => {
  it('applies padding, color and background', () => {
    const result = composeStandaloneSvg({
      innerSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="5"></svg>',
      widthPx: 10,
      heightPx: 5,
      padding: 4,
      color: '#000000',
      background: '#ffffff',
    })
    expect(result.width).toBe(18)
    expect(result.height).toBe(13)
    expect(result.svg).toContain('<?xml version="1.0"')
    expect(result.svg).toContain('<rect x="0" y="0" width="18" height="13" fill="#ffffff"/>')
    expect(result.svg).toContain('translate(4,4)')
    expect(result.svg).toContain('fill="#000000" stroke="#000000"')
  })

  it('omits the background rect when transparent', () => {
    const result = composeStandaloneSvg({
      innerSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="5"></svg>',
      widthPx: 10,
      heightPx: 5,
      padding: 0,
      color: '#000000',
      background: null,
    })
    expect(result.svg).not.toContain('<rect')
  })

  it('clamps negative padding', () => {
    const result = composeStandaloneSvg({
      innerSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="5"></svg>',
      widthPx: 10,
      heightPx: 5,
      padding: -50,
      color: '#000000',
      background: null,
    })
    expect(result.width).toBe(10)
  })

  it('treats NaN padding as zero', () => {
    const result = composeStandaloneSvg({
      innerSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="5"></svg>',
      widthPx: 10,
      heightPx: 5,
      padding: Number.NaN,
      color: '#000000',
      background: null,
    })
    expect(result.width).toBe(10)
    expect(result.svg).toContain('width="10" height="5"')
  })
})

describe('applyMathstyle', () => {
  it('keeps display-style latex unchanged', () => {
    expect(applyMathstyle('\\sum_{i=1}^n i', true)).toBe('\\sum_{i=1}^n i')
    expect(applyMathstyle('x+y')).toBe('x+y')
    expect(applyMathstyle('x+y', undefined)).toBe('x+y')
  })

  it('wraps inline style with textstyle', () => {
    expect(applyMathstyle('\\sum_{i=1}^n i', false)).toBe('\\textstyle \\sum_{i=1}^n i')
  })
})

describe('stripXmlDeclaration', () => {
  it('removes the XML declaration', () => {
    const svg = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    const stripped = stripXmlDeclaration(svg)
    expect(stripped.startsWith('<?xml')).toBe(false)
    expect(stripped).toContain('<svg')
  })

  it('leaves SVG without declaration untouched', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    expect(stripXmlDeclaration(svg)).toBe(svg)
  })
})
