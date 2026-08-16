import { describe, expect, it } from 'vitest'
import {
  addTextBoundaries,
  isEmptyTextLatex,
  isTextCommandLatex,
  mergeAdjacentTextCommands,
  removeOrphanedTextBoundaries,
  stripEmptyTextSentinel,
  stripTextBoundaries,
  TEXT_BOUNDARY_LATEX,
  textHintFont,
  withEmptyTextSentinel,
} from '~/utils/text-boundary'

describe('text boundaries', () => {
  it('adds an invisible boundary on both sides of text commands', () => {
    expect(addTextBoundaries('a\\text{Tex}b')).toBe(
      `a${TEXT_BOUNDARY_LATEX}\\text{Tex}${TEXT_BOUNDARY_LATEX}b`,
    )
  })

  it('supports styled text and nested braces', () => {
    expect(addTextBoundaries('\\textbf{a {b} c}')).toBe(
      `${TEXT_BOUNDARY_LATEX}\\textbf{a {b} c}${TEXT_BOUNDARY_LATEX}`,
    )
  })

  it('does not wrap non-text commands with a similar prefix', () => {
    expect(addTextBoundaries('\\textcolor{red}{x}')).toBe('\\textcolor{red}{x}')
  })

  it('normalizes existing boundaries without duplicating them', () => {
    const marked = `${TEXT_BOUNDARY_LATEX}\\text{x}${TEXT_BOUNDARY_LATEX}`
    expect(addTextBoundaries(marked)).toBe(marked)
  })

  it('strips all internal boundaries from public LaTeX', () => {
    expect(stripTextBoundaries(`a${TEXT_BOUNDARY_LATEX}\\text{x}${TEXT_BOUNDARY_LATEX}b`)).toBe(
      'a\\text{x}b',
    )
  })

  it('preserves a zero kern that is not a Text boundary', () => {
    expect(stripTextBoundaries('a\\mkern0mub')).toBe('a\\mkern0mub')
  })

  it('keeps markers attached to text commands', () => {
    const marked = `${TEXT_BOUNDARY_LATEX}\\text{x}${TEXT_BOUNDARY_LATEX}`
    expect(removeOrphanedTextBoundaries(marked)).toBe(marked)
    const joined = `\\text{a}${TEXT_BOUNDARY_LATEX}${TEXT_BOUNDARY_LATEX}\\text{b}`
    expect(removeOrphanedTextBoundaries(joined)).toBe(joined)
  })

  it('removes markers that are no longer attached to a text command', () => {
    expect(removeOrphanedTextBoundaries(`${TEXT_BOUNDARY_LATEX}x${TEXT_BOUNDARY_LATEX}`)).toBe('x')
    expect(removeOrphanedTextBoundaries(`a${TEXT_BOUNDARY_LATEX}b`)).toBe('ab')
    expect(
      removeOrphanedTextBoundaries(
        `${TEXT_BOUNDARY_LATEX}${TEXT_BOUNDARY_LATEX}`,
      ),
    ).toBe('')
  })

  it('recognizes empty text boxes with the phantom sentinel', () => {
    expect(isEmptyTextLatex('\\text{\\phantom{Text}}')).toBe(true)
    expect(isEmptyTextLatex('\\textbf{\\phantom{Text}}')).toBe(true)
    expect(isEmptyTextLatex('\\textbf{\\phantom{\\textbf{Text}}}')).toBe(true)
    expect(isEmptyTextLatex('\\text{hello}')).toBe(false)
    expect(isEmptyTextLatex('\\text{}')).toBe(false)
  })

  it('converts the sentinel back to an empty group in public LaTeX', () => {
    expect(stripEmptyTextSentinel('a\\text{\\phantom{Text}}b')).toBe('a\\text{}b')
    expect(stripEmptyTextSentinel('\\textbf{\\phantom{Text}}')).toBe('\\textbf{}')
    expect(stripEmptyTextSentinel('\\textbf{\\phantom{\\textbf{Text}}}')).toBe('\\textbf{}')
    expect(stripEmptyTextSentinel('\\text{hello}')).toBe('\\text{hello}')
  })

  it('replaces only text-command #0 slots with the sentinel', () => {
    expect(withEmptyTextSentinel('\\text{#0}')).toBe('\\text{\\phantom{Text}}')
    expect(withEmptyTextSentinel('\\textbf{#0}')).toBe('\\textbf{\\phantom{Text}}')
    expect(withEmptyTextSentinel('\\frac{#0}{#?}')).toBe('\\frac{#0}{#?}')
    expect(withEmptyTextSentinel('\\sqrt{#0}')).toBe('\\sqrt{#0}')
  })

  it('merges adjacent text commands of the same command', () => {
    expect(mergeAdjacentTextCommands('\\text{a}\\text{b}')).toBe('\\text{ab}')
    expect(mergeAdjacentTextCommands('\\text{a}\\text{b}\\text{c}')).toBe('\\text{abc}')
    expect(mergeAdjacentTextCommands('\\textbf{a}\\textbf{b}')).toBe('\\textbf{ab}')
    expect(mergeAdjacentTextCommands('\\textbf{a}\\text{b}')).toBe('\\textbf{a}\\text{b}')
    expect(mergeAdjacentTextCommands('x\\text{a}\\text{b}y')).toBe('x\\text{ab}y')
    expect(mergeAdjacentTextCommands('\\text{a}\\sqrt{b}')).toBe('\\text{a}\\sqrt{b}')
  })

  it('merges empty text boxes away', () => {
    expect(mergeAdjacentTextCommands('\\text{\\phantom{Text}}\\text{\\phantom{Text}}')).toBe(
      '\\text{\\phantom{Text}}',
    )
    expect(mergeAdjacentTextCommands('\\text{\\phantom{Text}}\\text{a}')).toBe('\\text{a}')
    expect(mergeAdjacentTextCommands('\\text{a}\\text{\\phantom{Text}}')).toBe('\\text{a}')
    expect(
      mergeAdjacentTextCommands('\\textbf{\\phantom{Text}}\\textbf{\\phantom{Text}}'),
    ).toBe('\\textbf{\\phantom{Text}}')
    expect(
      mergeAdjacentTextCommands('\\textbf{\\phantom{Text}}\\text{\\phantom{Text}}'),
    ).toBe('\\textbf{\\phantom{Text}}\\text{\\phantom{Text}}')
  })

  it('recognizes math-font commands as text boxes', () => {
    expect(isTextCommandLatex('\\mathbf{a}')).toBe(true)
    expect(isTextCommandLatex('\\bm{a}')).toBe(true)
    expect(isTextCommandLatex('\\mathcal{a}')).toBe(true)
    expect(isTextCommandLatex('\\text{a}')).toBe(true)
    expect(isTextCommandLatex('\\frac{a}{b}')).toBe(false)
    expect(isTextCommandLatex('a')).toBe(false)
    expect(isTextCommandLatex(undefined)).toBe(false)
  })

  it('adds boundaries around math-font commands', () => {
    expect(addTextBoundaries('a\\mathbf{Tex}b')).toBe(
      `a${TEXT_BOUNDARY_LATEX}\\mathbf{Tex}${TEXT_BOUNDARY_LATEX}b`,
    )
    expect(addTextBoundaries('\\bm{x}')).toBe(
      `${TEXT_BOUNDARY_LATEX}\\bm{x}${TEXT_BOUNDARY_LATEX}`,
    )
  })

  it('uses the text-mode phantom sentinel for math-font empty boxes', () => {
    expect(withEmptyTextSentinel('\\mathbf{#0}')).toBe(
      '\\mathbf{\\phantom{\\text{Text}}}',
    )
    expect(withEmptyTextSentinel('\\text{#0}')).toBe('\\text{\\phantom{Text}}')
    expect(isEmptyTextLatex('\\mathbf{\\phantom{\\text{Text}}}')).toBe(true)
    expect(isEmptyTextLatex('\\bm{\\phantom{\\text{Text}}}')).toBe(true)
    expect(isEmptyTextLatex('\\mathcal{\\phantom{\\text{Text}}}')).toBe(true)
  })

  it('strips the math-font sentinel back to an empty group', () => {
    expect(stripEmptyTextSentinel('\\mathbf{\\phantom{\\text{Text}}}')).toBe('\\mathbf{}')
    expect(stripEmptyTextSentinel('\\bm{\\phantom{\\text{Text}}}')).toBe('\\bm{}')
    expect(stripEmptyTextSentinel('\\mathcal{\\phantom{\\text{Text}}}')).toBe('\\mathcal{}')
  })

  it('merges adjacent math-font commands of the same command', () => {
    expect(mergeAdjacentTextCommands('\\mathbf{a}\\mathbf{b}')).toBe('\\mathbf{ab}')
    expect(mergeAdjacentTextCommands('\\mathbf{a}\\mathbfit{b}')).toBe(
      '\\mathbf{a}\\mathbfit{b}',
    )
    expect(
      mergeAdjacentTextCommands('\\mathbf{\\phantom{\\text{Text}}}\\mathbf{a}'),
    ).toBe('\\mathbf{a}')
  })

  it('maps commands to their hint font', () => {
    expect(textHintFont('text').fontFamily).toContain('Times New Roman')
    expect(textHintFont('mathbf')).toEqual({
      fontFamily: 'KaTeX_Main',
      fontWeight: 700,
    })
    expect(textHintFont('bm').fontWeight).toBe(700)
    expect(textHintFont('mathsf').fontFamily).toBe('KaTeX_SansSerif')
    expect(textHintFont('mathfrak').fontFamily).toBe('KaTeX_Fraktur')
  })
})
