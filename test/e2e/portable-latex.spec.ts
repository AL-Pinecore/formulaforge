import { expect, test } from '@nuxt/test-utils/playwright'
import { EQUATION_ELEMENTS } from '../../app/data/equation-elements'

test('all palette elements produce MathJax-compatible public LaTeX', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const latex = EQUATION_ELEMENTS.map((element) => element.display).join('\\quad ')
  const textarea = page.locator('.latex-textarea')
  await textarea.fill(latex)
  await textarea.blur()
  const publicLatex = await textarea.inputValue()
  expect(publicLatex).not.toMatch(
    /\\(?:exponentialE|imaginaryI|imaginaryJ|differentialD|capitalDifferentialD|degree)\b/,
  )
  expect(publicLatex).not.toMatch(/\\long(?:left|right)arrow\s*(?:\[|\{)/)
  const preview = page.locator('.math-preview-canvas')
  await expect(preview.locator('svg').first()).toBeVisible({ timeout: 15000 })
  await expect(preview.locator('[data-mml-node="merror"]')).toHaveCount(0)
})
