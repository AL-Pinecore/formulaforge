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
  // the markup overlay renders the full equation with the grey + (not just the first glyph)
  const overlay = page.locator('.insertion-preview')
  await expect(overlay).toContainText('1')
  await expect(overlay).toContainText('2')
  await expect(overlay.locator('span[style*="#9ca3af"]')).toHaveCount(1)

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

test('dropping onto the sum subscript replaces it', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await page.getByRole('button', { name: 'Insert Sum' }).click()
  const textarea = page.locator('.latex-textarea')
  await expect(textarea).toHaveValue(/\\sum/, { timeout: 10000 })
  await page.waitForTimeout(100)

  const rects = await page.locator('math-field').evaluate((el) => {
    const root = (el as HTMLElement & { shadowRoot: ShadowRoot }).shadowRoot
    const out: { left: number; top: number; width: number; height: number }[] = []
    for (const n of root.querySelectorAll('*')) {
      if (n.textContent?.trim() !== '▢') continue
      const r = n.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) out.push({ left: r.left, top: r.top, width: r.width, height: r.height })
    }
    return out
  })
  expect(rects.length).toBeGreaterThanOrEqual(2)
  // the subscript placeholder is the lowest one on screen
  const sub = rects.reduce((a, b) => (a.top > b.top ? a : b))

  await page.evaluate(() => {
    document
      .querySelector('button[aria-label="Insert Plus"]')!
      .dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
  })
  const dropAt = (cx: number, cy: number) =>
    page.evaluate(
      ([x, y]) => {
        document
          .querySelector('.workspace')!
          .dispatchEvent(
            new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: new DataTransfer() }),
          )
      },
      [cx, cy],
    )

  await dropAt(sub.left + sub.width / 2, sub.top + sub.height / 2)
  const mirrorValue = () =>
    page.evaluate(() => (document.querySelector('math-field.workspace-mirror') as unknown as { value: string })?.value)
  await expect.poll(mirrorValue).toContain('\\sum_{\\textcolor{#9ca3af}{+}}')

  await page.evaluate(
    ([x, y]) => {
      const dt = new DataTransfer()
      dt.setData('application/x-equation-element', 'plus')
      document
        .querySelector('.workspace')!
        .dispatchEvent(
          new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }),
        )
    },
    [sub.left + sub.width / 2, sub.top + sub.height / 2],
  )
  await expect
    .poll(async () => textarea.inputValue())
    .toContain('\\sum_{+}')

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

test('backspace removes an element when only its placeholder remains', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await page.getByRole('button', { name: 'Insert Square root' }).click()
  const textarea = page.locator('.latex-textarea')
  await expect(textarea).toHaveValue(/\\sqrt/, { timeout: 10000 })
  await page.waitForTimeout(50)
  await page.keyboard.press('Backspace')
  await expect(textarea).toHaveValue('', { timeout: 10000 })
})

test('backspace removes a sum when only its placeholders remain', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await page.getByRole('button', { name: 'Insert Sum' }).click()
  const textarea = page.locator('.latex-textarea')
  await expect(textarea).toHaveValue(/\\sum/, { timeout: 10000 })
  await page.waitForTimeout(50)
  await page.keyboard.press('Backspace')
  await expect(textarea).toHaveValue('', { timeout: 10000 })
})

test('backspace removes an integral when only its placeholders remain', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await page.getByRole('button', { name: 'Insert Integral' }).click()
  const textarea = page.locator('.latex-textarea')
  await expect(textarea).toHaveValue(/\\int/, { timeout: 10000 })
  await page.waitForTimeout(50)
  await page.keyboard.press('Backspace')
  await expect(textarea).toHaveValue('', { timeout: 10000 })
})

test('drag preview keeps the insertion point near the target atom', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  await textarea.fill('(x_1+x_2+x_3)')
  await textarea.blur()
  await expect(textarea).toHaveValue('(x_1+x_2+x_3)')
  await page.waitForTimeout(150)

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

  await page.evaluate(
    ([cx, cy]) => {
      document
        .querySelector('.workspace')!
        .dispatchEvent(
          new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, dataTransfer: new DataTransfer() }),
        )
    },
    [contentBox.left + contentBox.width * 0.85, y],
  )

  await expect.poll(mirrorValue).toContain('x_2')
  const value = await mirrorValue()
  // The inserted element must not be placed at the very start of the formula.
  expect(value.indexOf('\\textcolor{#9ca3af}{+}')).toBeGreaterThan(1)
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

test.describe('dark mode', () => {
  test.use({ colorScheme: 'dark' })

  test('palette icons and the equation field follow the dark theme', async ({ page, goto }) => {
    await goto('/', { waitUntil: 'hydration' })

    const paletteColor = await page.locator('.palette-item').first().evaluate((el) => getComputedStyle(el).color)
    expect(paletteColor).toBe('rgb(236, 233, 226)')

    const field = page.locator('.workspace-field')
    const fieldBackground = await field.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(fieldBackground).toBe('rgba(0, 0, 0, 0)')

    const fieldText = await field.evaluate((el) => {
      const root = (el as HTMLElement & { shadowRoot: ShadowRoot }).shadowRoot
      const latex = root!.querySelector('.ML__latex')
      return latex ? getComputedStyle(latex).color : ''
    })
    expect(fieldText).toBe('rgb(236, 233, 226)')

    const paper = await page.locator('.workspace-paper').evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(paper).toBe('rgb(29, 32, 37)')
  })
})
