import { expect, test } from '@nuxt/test-utils/playwright'

test('loads the editor shell', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await expect(page.locator('.toolbar')).toBeVisible()
  await expect(page.locator('.palette')).toBeVisible()
  await expect(page.locator('.workspace-paper')).toBeVisible()
  await expect(page.locator('.latex-source')).toBeVisible()
  await expect(page.locator('.export-panel')).toBeVisible()
})

test('inserts a fraction from the palette into the equation', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await expect(page.locator('math-field')).toBeVisible()
  await page.getByRole('button', { name: 'Insert Fraction' }).click()
  const latex = await page.locator('.latex-textarea').inputValue()
  expect(latex).toContain('\\frac')
})

test('search narrows the palette', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const before = await page.locator('.palette-item').count()
  await page.fill('#palette-search', 'sqrt')
  const after = await page.locator('.palette-item').count()
  expect(after).toBeGreaterThan(0)
  expect(after).toBeLessThan(before)
})

test('renders the MathJax SVG preview from raw LaTeX input', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  await textarea.fill('\\frac{a}{b} + \\sqrt{c}')
  await textarea.blur()
  const previewSvg = page.locator('.math-preview-canvas svg')
  await expect(previewSvg.first()).toBeVisible({ timeout: 15000 })
  expect(await previewSvg.count()).toBeGreaterThan(0)
})

test('palette scrolls independently at a short viewport', async ({ page, goto }) => {
  await page.setViewportSize({ width: 1360, height: 600 })
  await goto('/', { waitUntil: 'hydration' })
  const scroll = page.locator('.palette-scroll')
  await expect(scroll).toBeVisible()
  const canScroll = await scroll.evaluate((el) => el.scrollHeight > el.clientHeight)
  expect(canScroll).toBe(true)
  await scroll.evaluate((el) => {
    el.scrollTop = 400
  })
  const scrollTop = await scroll.evaluate((el) => el.scrollTop)
  expect(scrollTop).toBeGreaterThan(0)
  await expect(page.locator('#palette-search')).toBeInViewport()
})

test('drags a fraction from the palette into the equation', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await expect(page.locator('math-field')).toBeVisible()
  const source = page.getByRole('button', { name: 'Insert Fraction' })
  const target = page.locator('.workspace-paper')
  await source.dragTo(target)
  await expect(page.locator('.latex-textarea')).toHaveValue(/\\frac/, { timeout: 10000 })
})

test('palette icons render with mathlive markup layout', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await expect(page.locator('.palette-item .ML__mfrac').first()).toBeVisible({ timeout: 15000 })
})

test('typing replaces the selected placeholder after inserting an accent element', async ({
  page,
  goto,
}) => {
  await goto('/', { waitUntil: 'hydration' })
  await page.getByRole('button', { name: 'Insert Bar' }).click()
  const textarea = page.locator('.latex-textarea')
  await expect(textarea).toHaveValue(/\\bar/, { timeout: 10000 })
  await page.keyboard.type('x')
  await expect(textarea).toHaveValue(/\\bar\{x\}/, { timeout: 10000 })
})

test('clicking an accent placeholder focuses it and accepts input', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await page.getByRole('button', { name: 'Insert Bar' }).click()
  const textarea = page.locator('.latex-textarea')
  await expect(textarea).toHaveValue(/\\bar/, { timeout: 10000 })
  await page.keyboard.press('ArrowLeft')
  const placeholder = page
    .locator('math-field')
    .locator('text=▢')
    .filter({ visible: true })
    .first()
  await placeholder.click()
  // The workaround drives the caret into the placeholder on the next frames.
  await page.waitForTimeout(50)
  await page.keyboard.type('y')
  await expect(textarea).toHaveValue(/\\bar\{y\}/, { timeout: 10000 })
})

test('palette ellipsis icon renders the symbol without errors', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const chip = page.getByRole('button', { name: 'Insert Ellipsis' })
  await expect(chip).toContainText('…', { timeout: 15000 })
  await expect(chip.locator('.ML__error')).toHaveCount(0)
})

test('drag preview reflects the drop position', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  await textarea.fill('12')
  await textarea.blur()
  await expect(textarea).toHaveValue('12')
  await page.waitForTimeout(100)

  const contentBox = await page.locator('.workspace-field').evaluate((el) => {
    const root = (el as HTMLElement & { shadowRoot: ShadowRoot }).shadowRoot
    const r = root!.querySelector('.ML__base')!.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  })
  const y = contentBox.top + contentBox.height / 2
  const mirrorValue = () =>
    page.evaluate(() => (document.querySelector('math-field.workspace-mirror') as unknown as { value: string })?.value)

  await page.evaluate(() => {
    document
      .querySelector('button[aria-label="Insert Plus"]')!
      .dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
  })
  const dragOver = (x: number) =>
    page.evaluate(
      ([cx, cy]) => {
        document
          .querySelector('.workspace')!
          .dispatchEvent(
            new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, dataTransfer: new DataTransfer() }),
          )
      },
      [x, y],
    )

  await dragOver(contentBox.left + 1)
  await expect.poll(mirrorValue).toContain('\\textcolor{#9ca3af}{+}12')

  await dragOver(contentBox.left + contentBox.width / 2)
  await expect.poll(mirrorValue).toContain('1\\textcolor{#9ca3af}{+}2')
  // the SVG overlay renders the full equation (3 glyphs), not just the first
  await expect
    .poll(async () =>
      page.locator('.insertion-preview svg').first().evaluate((el) => {
        const uses = el.querySelectorAll('use').length
        const width = parseFloat(el.getAttribute('width') ?? '0')
        return { uses, width }
      }),
    )
    .toMatchObject({ uses: expect.any(Number) })
  const overlay = await page
    .locator('.insertion-preview svg')
    .first()
    .evaluate((el) => ({
      uses: el.querySelectorAll('use').length,
      width: parseFloat(el.getAttribute('width') ?? '0'),
    }))
  expect(overlay.uses).toBeGreaterThanOrEqual(3)
  expect(overlay.width).toBeGreaterThan(15)

  await dragOver(contentBox.left + contentBox.width - 1)
  await expect.poll(mirrorValue).toContain('12\\textcolor{#9ca3af}{+}')

  await page.evaluate(() => {
    document
      .querySelector('button[aria-label="Insert Plus"]')!
      .dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
  })
})

test('dragging onto a placeholder replaces it in the preview and reverts on leave', async ({
  page,
  goto,
}) => {
  await goto('/', { waitUntil: 'hydration' })
  await page.getByRole('button', { name: 'Insert Square root' }).click()
  const textarea = page.locator('.latex-textarea')
  await expect(textarea).toHaveValue(/\\sqrt/, { timeout: 10000 })
  await page.waitForTimeout(100)

  const placeholder = page
    .locator('math-field')
    .locator('text=▢')
    .filter({ visible: true })
    .first()
  const phBox = await placeholder.boundingBox()
  const mirrorValue = () =>
    page.evaluate(() => (document.querySelector('math-field.workspace-mirror') as unknown as { value: string })?.value)

  await page.evaluate(() => {
    document
      .querySelector('button[aria-label="Insert Plus"]')!
      .dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
  })

  await page.evaluate(
    ([cx, cy]) => {
      document
        .querySelector('.workspace')!
        .dispatchEvent(
          new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, dataTransfer: new DataTransfer() }),
        )
    },
    [phBox!.x + phBox!.width / 2, phBox!.y + phBox!.height / 2],
  )
  await expect.poll(mirrorValue).toContain('\\sqrt{\\textcolor{#9ca3af}{+}}')

  // moving away from the placeholder restores it in the preview
  await page.evaluate(
    ([cx, cy]) => {
      document
        .querySelector('.workspace')!
        .dispatchEvent(
          new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, dataTransfer: new DataTransfer() }),
        )
    },
    [phBox!.x + phBox!.width + 40, phBox!.y + phBox!.height / 2],
  )
  await expect.poll(mirrorValue).toContain('\\placeholder')

  await page.evaluate(() => {
    document
      .querySelector('button[aria-label="Insert Plus"]')!
      .dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
  })
})

test('deleting a group content restores a focused placeholder', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await page.getByRole('button', { name: 'Insert Square root' }).click()
  const textarea = page.locator('.latex-textarea')
  await expect(textarea).toHaveValue(/\\sqrt/, { timeout: 10000 })
  await page.waitForTimeout(50)
  await page.keyboard.type('x+1')
  await expect(textarea).toHaveValue(/\\sqrt\{x\+1\}/, { timeout: 10000 })

  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Backspace')
  }
  await expect(textarea).toHaveValue(/\\sqrt\{\\placeholder\{\}\}/, { timeout: 10000 })

  // the restored placeholder is focused: typing fills it
  await page.keyboard.type('z')
  await expect(textarea).toHaveValue(/\\sqrt\{z\}/, { timeout: 10000 })
})

test('clear resets the editor, source, preview and export', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await page.getByRole('button', { name: 'Insert Fraction' }).click()
  await expect(page.locator('.latex-textarea')).toHaveValue(/\\frac/)
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(page.locator('.latex-textarea')).toHaveValue('')
  const svgCount = await page.locator('.math-preview-canvas svg').count()
  expect(svgCount).toBe(0)
  await expect(page.locator('.export-button')).toBeDisabled()
})
