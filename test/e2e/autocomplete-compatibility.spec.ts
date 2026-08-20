import { expect, test } from '@nuxt/test-utils/playwright'
import { normalizePortableLatex } from '../../app/utils/latex-normalize'
import { DISABLED_LATEX_AUTOCOMPLETE_COMMANDS } from '../../app/utils/latex-autocomplete'

test('disabled autocomplete commands remain unknown to MathJax', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  await textarea.fill('x')
  await textarea.blur()
  await page.locator('.math-preview-canvas svg').first().waitFor({ state: 'visible', timeout: 15000 })

  const unexpectedlySupported = await page.evaluate(async (candidates) => {
    const result: string[] = []
    for (const { command, latex } of candidates) {
      const node = await window.MathJax!.tex2svgPromise(latex, { display: true })
      if (!node.querySelector('[data-mml-node="mtext"][fill="red"]')) result.push(command)
    }
    return result
  }, [...DISABLED_LATEX_AUTOCOMPLETE_COMMANDS].map((name) => ({
    command: `\\${name}`,
    latex: normalizePortableLatex(`\\${name}{x}{y}`),
  })))

  expect(unexpectedlySupported).toEqual([])
})

test('rejects a disabled completion from the keyboard and suggestion popover', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const field = page.locator('math-field.workspace-field')
  const focusEmptyField = async () => {
    await field.evaluate((element) => {
      const mf = element as unknown as { value: string; focus(): void }
      mf.value = ''
      mf.focus()
    })
    await page.waitForTimeout(200)
  }

  await focusEmptyField()
  await page.keyboard.type('\\Alpha')
  await page.keyboard.press('Enter')
  await expect(page.locator('.latex-textarea')).toHaveValue('')
  expect(await field.evaluate((element) => (element as unknown as { mode: string }).mode)).toBe('math')

  await focusEmptyField()
  await page.keyboard.type('\\Alpha')
  await page.evaluate(() => {
    const panel = document.createElement('div')
    panel.id = 'mathlive-suggestion-popover'
    const item = document.createElement('button')
    item.dataset.command = '\\Alpha'
    panel.append(item)
    document.body.append(panel)
    item.click()
    panel.remove()
  })
  await expect(page.locator('.latex-textarea')).toHaveValue('')
  expect(await field.evaluate((element) => (element as unknown as { mode: string }).mode)).toBe('math')
})
