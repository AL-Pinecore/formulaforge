import { describe, expect, it } from 'vitest'
import { EQUATION_ELEMENTS, getElementByCommand, getElementById } from '../../app/data/equation-elements'
import { ELEMENT_CATEGORY_ORDER } from '../../app/types/equation'

describe('equation element palette data', () => {
  it('has unique ids', () => {
    const ids = EQUATION_ELEMENTS.map((element) => element.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('only uses supported placeholder tokens in templates', () => {
    for (const element of EQUATION_ELEMENTS) {
      expect(element.latex.trim().length).toBeGreaterThan(0)
      expect(element.latex).not.toMatch(/\\placeholder\{/)
      const stripped = element.latex.replace(/#0|#\?|#@/g, '')
      expect(stripped).not.toContain('#')
    }
  })

  it('has renderable display LaTeX without tokens', () => {
    for (const element of EQUATION_ELEMENTS) {
      expect(element.display.trim().length).toBeGreaterThan(0)
      expect(element.display).not.toContain('#')
    }
  })

  it('assigns every element to a known category', () => {
    const known = new Set(ELEMENT_CATEGORY_ORDER)
    for (const element of EQUATION_ELEMENTS) {
      expect(known.has(element.category)).toBe(true)
    }
  })

  it('covers every category', () => {
    const used = new Set(EQUATION_ELEMENTS.map((element) => element.category))
    expect(used.size).toBe(ELEMENT_CATEGORY_ORDER.length)
  })

  it('looks elements up by id', () => {
    const first = EQUATION_ELEMENTS[0]!
    expect(getElementById(first.id)).toBe(first)
    expect(getElementById('does-not-exist')).toBeUndefined()
  })

  it('maps typed commands to the palette element', () => {
    expect(getElementByCommand('frac')?.id).toBe('frac')
    expect(getElementByCommand('mathrm')?.id).toBe('mathrm')
    // Unique aliases where the id differs from the command name.
    expect(getElementByCommand('pm')?.id).toBe('plus-minus')
    expect(getElementByCommand('ne')?.id).toBe('not-equal')
    expect(getElementByCommand('infty')?.id).toBe('infinity')
    // Collisions prefer the exact-id element.
    expect(getElementByCommand('sqrt')?.id).toBe('sqrt')
    expect(getElementByCommand('lim')?.id).toBe('lim')
    expect(getElementByCommand('mathbb')?.id).toBe('mathbb')
    // Ambiguous commands without an id match stay unmapped.
    expect(getElementByCommand('left')).toBeUndefined()
    expect(getElementByCommand('begin')).toBeUndefined()
    expect(getElementByCommand('does-not-exist')).toBeUndefined()
  })
})
