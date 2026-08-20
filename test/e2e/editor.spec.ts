import { expect, test } from '@nuxt/test-utils/playwright'
import type { Locator, Page } from '@playwright/test'
import { measurePaintedFractionGaps } from './painted-pixels'

// Palette categories are collapsed by default, so expand a category before
// interacting with its buttons.
async function expandCategory(page: Page, label: string) {
  const heading = page.getByRole('button', { name: label, exact: true })
  if ((await heading.getAttribute('aria-expanded')) !== 'true') {
    await heading.click()
  }
}

async function insertElement(page: Page, label: string, category: string) {
  await expandCategory(page, category)
  await page.getByRole('button', { name: `Insert ${label}`, exact: true }).click()
}

async function simCaretDistanceFromHint(caret: Locator, hint: Locator): Promise<number> {
  const [caretBox, hintBox] = await Promise.all([caret.boundingBox(), hint.boundingBox()])
  if (!caretBox || !hintBox) {
    return Infinity
  }
  return Math.abs(caretBox.x + caretBox.width / 2 - hintBox.x)
}

test('loads the editor shell', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await expect(page.locator('.toolbar')).toBeVisible()
  await expect(page.locator('.palette')).toBeVisible()
  await expect(page.locator('.workspace-paper')).toBeVisible()
  await expect(page.locator('.latex-source')).toBeVisible()
  await expect(page.locator('.export-panel')).toBeVisible()
})

test('localizes the MathLive context menu', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await page.getByRole('combobox', { name: 'Language' }).selectOption('zh-cn')
  const field = page.locator('math-field.workspace-field')
  const localization = await field.evaluate((element) => {
    const mathlive = element.constructor as typeof HTMLElement & {
      locale: string
      strings: Record<string, Record<string, string>>
    }
    return {
      locale: mathlive.locale,
      cut: mathlive.strings['zh-cn']?.['menu.cut'],
      insert: mathlive.strings['zh-cn']?.['menu.insert'],
      derivative: mathlive.strings['zh-cn']?.['menu.insert.derivative'],
    }
  })
  expect(localization).toEqual({ locale: 'zh-cn', cut: '剪切', insert: '插入', derivative: '导数' })
})

test('inserts a fraction from the palette into the equation', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await expect(page.locator('math-field')).toBeVisible()
  await insertElement(page, 'Fraction', 'Fractions')
  const latex = await page.locator('.latex-textarea').inputValue()
  expect(latex).toContain('\\frac')
})

test('completes a typed text command into an empty text box', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await page.locator('math-field').evaluate((el) => (el as { focus(): void }).focus())
  await page.waitForTimeout(200)
  await page.keyboard.type('\\mathrm')
  await page.keyboard.press('Enter')
  await expect(page.locator('.latex-textarea')).toHaveValue('\\mathrm{}', { timeout: 10000 })
  await expect(page.locator('.text-hint')).toBeVisible()
})

test('completes a typed command into a fraction with placeholders', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await page.locator('math-field').evaluate((el) => (el as { focus(): void }).focus())
  await page.waitForTimeout(200)
  await page.keyboard.type('\\frac')
  await page.keyboard.press('Enter')
  await expect(page.locator('.latex-textarea')).toHaveValue(/\\frac/, { timeout: 10000 })
})

test('completes a typed symbol command with Tab', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await page.locator('math-field').evaluate((el) => (el as { focus(): void }).focus())
  await page.waitForTimeout(200)
  await page.keyboard.type('\\alpha')
  await page.keyboard.press('Tab')
  await expect(page.locator('.latex-textarea')).toHaveValue('\\alpha', { timeout: 10000 })
})

async function placeCaretBeforeSum(page: import('@playwright/test').Page) {
  await page.locator('math-field').evaluate((el) => {
    const mf = el as unknown as {
      focus(): void
      position: number
      _mathfield?: {
        model?: {
          atoms: { type: string; command?: string; firstChild?: unknown }[]
          offsetOf(atom: unknown): number
        }
      }
    }
    mf.focus()
    const model = mf._mathfield?.model
    if (!model) {
      return
    }
    for (const atom of model.atoms) {
      if (atom.command === '\\sum') {
        mf.position = atom.firstChild
          ? model.offsetOf(atom.firstChild) - 1
          : model.offsetOf(atom) - 1
        return
      }
    }
  })
  await page.waitForTimeout(200)
}

test('completes \\displaystyle by wrapping the first following element', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  await textarea.fill('\\frac{\\sum_{}^{}x}{}')
  await textarea.blur()
  await placeCaretBeforeSum(page)
  await page.keyboard.type('\\displaystyle')
  await page.keyboard.press('Enter')
  await expect(textarea).toHaveValue('\\frac{{\\displaystyle\\sum_{}^{}}x}{}', { timeout: 10000 })
})

test('completes \\textstyle by wrapping only the first following element', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  await textarea.fill('\\frac{xy}{}')
  await textarea.blur()
  await page.locator('math-field').evaluate((el) => {
    const mf = el as unknown as { focus(): void; position: number }
    mf.focus()
    mf.position = 1
  })
  await page.waitForTimeout(200)
  await page.keyboard.type('\\textstyle')
  await page.keyboard.press('Enter')
  await expect(textarea).toHaveValue('\\frac{{\\textstyle x}y}{}', { timeout: 10000 })
})

test('completing a root environment leaves the field usable', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  await page.locator('math-field').evaluate((el) => (el as { focus(): void }).focus())
  await page.waitForTimeout(200)
  await page.keyboard.type('\\displayline')
  await page.keyboard.press('Enter')
  await expect(textarea).toHaveValue('', { timeout: 10000 })
  await page.keyboard.type('y')
  await expect(textarea).toHaveValue('y', { timeout: 10000 })
})

test('dragging a font style onto a Text box restyles it', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await insertElement(page, 'Text', 'Text')
  const textarea = page.locator('.latex-textarea')
  await expect(textarea).toHaveValue('\\text{}', { timeout: 10000 })
  await expect(page.locator('math-field')).toBeFocused()
  await page.keyboard.type('hello')
  await expect(textarea).toHaveValue('\\text{hello}', { timeout: 10000 })
  await page.waitForTimeout(100)

  const target = await page.locator('math-field').evaluate((el) => {
    const root = (el as HTMLElement & { shadowRoot: ShadowRoot }).shadowRoot
    const r = root!.querySelector('.ML__text')!.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  })
  const x = target.left + target.width / 2
  const y = target.top + target.height / 2

  await page.evaluate(() => {
    document
      .querySelector('button[aria-label="Insert Bold"]')!
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
    [x, y],
  )
  await page.evaluate(
    ([cx, cy]) => {
      const dt = new DataTransfer()
      dt.setData('application/x-equation-element', 'mathbf')
      document
        .querySelector('.workspace')!
        .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, dataTransfer: dt }))
      document
        .querySelector('button[aria-label="Insert Bold"]')!
        .dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
    },
    [x, y],
  )
  await expect(textarea).toHaveValue('\\textbf{hello}', { timeout: 10000 })

  const field = page.locator('math-field.workspace-field')
  await field.evaluate((element) => {
    const mf = element as unknown as {
      lastOffset: number
      position: number
      focus(): void
      getElementInfo(offset: number): { latex?: string } | undefined
    }
    mf.focus()
    for (let offset = mf.lastOffset; offset >= 0; offset--) {
      if (mf.getElementInfo(offset)?.latex?.endsWith('{o}')) {
        mf.position = offset
        break
      }
    }
  })
  await expect(field).toBeFocused()
  await page.keyboard.type('z')
  await expect(textarea).toHaveValue('\\textbf{helloz}', { timeout: 10000 })
})

test('text boundaries stay internal and require two left moves at the first character', async ({
  page,
  goto,
}) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  await textarea.fill('\\text{Tex}')
  await textarea.blur()
  await expect(textarea).toHaveValue('\\text{Tex}')

  const field = page.locator('math-field')
  const internal = await field.evaluate((element) => {
    const mf = element as unknown as {
      value: string
      lastOffset: number
      position: number
      focus(): void
      getElementInfo(offset: number): { latex?: string } | undefined
    }
    mf.focus()
    for (let offset = 0; offset <= mf.lastOffset; offset++) {
      if (mf.getElementInfo(offset)?.latex === '\\text{T}') {
        mf.position = offset
        break
      }
    }
    return mf.value
  })
  expect(internal).toContain('\\mkern0mu')
  await expect(field).toBeFocused()

  await page.keyboard.press('ArrowLeft')
  await expect(field).toHaveClass(/caret-in-text/)
  await page.keyboard.press('ArrowLeft')
  await expect(field).not.toHaveClass(/caret-in-text/)
  await page.keyboard.type('a')
  await expect(textarea).toHaveValue('a\\text{Tex}', { timeout: 10000 })
})

test('right arrow and a right-side click continue after a final Text box', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field')
  await textarea.fill('\\text{Tex}')
  await textarea.blur()

  await field.evaluate((element) => {
    const mf = element as unknown as {
      lastOffset: number
      position: number
      focus(): void
      getElementInfo(offset: number): { latex?: string } | undefined
    }
    mf.focus()
    for (let offset = mf.lastOffset; offset >= 0; offset--) {
      if (mf.getElementInfo(offset)?.latex === '\\text{x}') {
        mf.position = offset
        break
      }
    }
  })
  await expect(field).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(field).not.toHaveClass(/caret-in-text/)
  await page.keyboard.type('x')
  await expect(textarea).toHaveValue('\\text{Tex}x', { timeout: 10000 })

  await textarea.fill('\\text{Tex}')
  await textarea.blur()
  await expect(field.locator('.ML__text').first()).toBeVisible()
  const textBounds = await field.locator('.ML__text').evaluateAll((nodes) => {
    const rects = nodes.map((node) => node.getBoundingClientRect())
    return {
      right: Math.max(...rects.map((rect) => rect.right)),
      top: Math.min(...rects.map((rect) => rect.top)),
      bottom: Math.max(...rects.map((rect) => rect.bottom)),
    }
  })
  await page.mouse.click(textBounds.right + 12, (textBounds.top + textBounds.bottom) / 2)
  await page.keyboard.type('y')
  await expect(textarea).toHaveValue('\\text{Tex}y', { timeout: 10000 })
})

test('a fence typed two-left of a Text box inserts before it, not wrapped', async ({
  page,
  goto,
}) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field')
  await textarea.fill('\\text{Tex}')
  await textarea.blur()
  await expect(textarea).toHaveValue('\\text{Tex}')

  await field.evaluate((element) => {
    const mf = element as unknown as {
      lastOffset: number
      position: number
      focus(): void
      getElementInfo(offset: number): { latex?: string } | undefined
    }
    mf.focus()
    for (let offset = 0; offset <= mf.lastOffset; offset++) {
      if (mf.getElementInfo(offset)?.latex === '\\text{T}') {
        mf.position = offset
        break
      }
    }
  })
  await expect(field).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(field).toHaveClass(/caret-in-text/)
  await page.keyboard.press('ArrowLeft')
  await expect(field).not.toHaveClass(/caret-in-text/)
  await page.keyboard.press('Shift+Digit9')
  await expect(textarea).toHaveValue('(\\text{Tex}', { timeout: 10000 })
})

test('fences typed right of a Text box insert after it, not into the text', async ({
  page,
  goto,
}) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field')
  const fenceKeys = [
    ['(', 'Shift+Digit9'],
    [')', 'Shift+Digit0'],
    ['[', 'BracketLeft'],
    [']', 'BracketRight'],
    ['{', 'Shift+BracketLeft'],
    ['}', 'Shift+BracketRight'],
    ['|', 'Shift+Backslash'],
  ] as const

  for (const [fence, key] of fenceKeys) {
    await textarea.fill('\\text{Tex}')
    await textarea.blur()
    await expect(textarea).toHaveValue('\\text{Tex}')

    await field.evaluate((element) => {
      const mf = element as unknown as {
        lastOffset: number
        position: number
        focus(): void
        getElementInfo(offset: number): { latex?: string } | undefined
      }
      mf.focus()
      for (let offset = mf.lastOffset; offset >= 0; offset--) {
        if (mf.getElementInfo(offset)?.latex === '\\text{x}') {
          mf.position = offset
          break
        }
      }
    })
    await expect(field).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(field).not.toHaveClass(/caret-in-text/)
    await page.keyboard.press(key)
    await expect
      .poll(() => textarea.inputValue(), {
        message: `Fence ${JSON.stringify(fence)} should be outside the Text box`,
        timeout: 10000,
      })
      .toMatch(/^\\text\{Tex\}.+/)
  }
})

test('moving to the last character inside Text does not escape the box early', async ({
  page,
  goto,
}) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field')
  await textarea.fill('\\text{Tex}')
  await textarea.blur()

  await field.evaluate((element) => {
    const mf = element as unknown as {
      lastOffset: number
      position: number
      focus(): void
      getElementInfo(offset: number): { latex?: string } | undefined
    }
    mf.focus()
    for (let offset = mf.lastOffset; offset >= 0; offset--) {
      if (mf.getElementInfo(offset)?.latex === '\\text{e}') {
        mf.position = offset
        break
      }
    }
  })
  await expect(field).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(field).toHaveClass(/caret-in-text/)
  await page.keyboard.press('Shift+Digit9')
  await expect(textarea).toHaveValue('\\text{Tex(}', { timeout: 10000 })
})

test('Delete right after a Text box edits the text without corrupting markers', async ({
  page,
  goto,
}) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field')
  await textarea.fill('\\text{jjjj}')
  await textarea.blur()
  await expect(textarea).toHaveValue('\\text{jjjj}')

  const cleanPublic = async () => {
    const latex = await textarea.inputValue()
    expect(latex).not.toContain('mkern')
    expect(latex).not.toContain('phantom')
    expect(latex).not.toContain('textbackslash')
    expect(latex).not.toContain('textbraceleft')
    expect(latex).not.toContain('textbraceright')
  }

  const setCaretAfterText = () =>
    field.evaluate((element) => {
      const mf = element as unknown as {
        lastOffset: number
        position: number
        focus(): void
        getElementInfo(offset: number): { latex?: string } | undefined
      }
      mf.focus()
      for (let offset = mf.lastOffset; offset >= 0; offset--) {
        if (mf.getElementInfo(offset)?.latex === '\\text{j}') {
          mf.position = offset
          break
        }
      }
    })

  await setCaretAfterText()
  await expect(field).toBeFocused()
  await page.keyboard.press('Delete')
  await expect(textarea).toHaveValue('\\text{jjj}', { timeout: 10000 })
  await cleanPublic()

  await page.keyboard.press('Delete')
  await expect(textarea).toHaveValue('\\text{jj}', { timeout: 10000 })
  await page.keyboard.press('Delete')
  await expect(textarea).toHaveValue('\\text{j}', { timeout: 10000 })
  await page.keyboard.press('Delete')
  await expect(textarea).toHaveValue('\\text{}', { timeout: 10000 })
  await cleanPublic()

  await textarea.fill('\\text{jjjj}')
  await textarea.blur()
  await field.evaluate((element) => {
    const mf = element as unknown as { lastOffset: number; position: number; focus(): void }
    mf.focus()
    mf.position = mf.lastOffset
  })
  await expect(field).toBeFocused()
  await page.keyboard.press('Backspace')
  await expect(textarea).toHaveValue('\\text{jjj}', { timeout: 10000 })
  await cleanPublic()

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(textarea).toHaveValue('\\text{jjjj}', { timeout: 10000 })
})

test('undo and redo use public LaTeX across Text rebuilds, source edits, and clear', async ({
  page,
  goto,
}) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  const undo = page.getByRole('button', { name: 'Undo', exact: true })
  const redo = page.getByRole('button', { name: 'Redo', exact: true })

  await insertElement(page, 'Text', 'Text')
  await page.keyboard.type('ab')
  await expect(textarea).toHaveValue('\\text{ab}', { timeout: 10000 })

  await undo.click()
  await expect(textarea).toHaveValue('\\text{a}')
  await redo.click()
  await expect(textarea).toHaveValue('\\text{ab}')

  await textarea.fill('\\frac{1}{2}')
  await textarea.blur()
  await expect(textarea).toHaveValue('\\frac12')
  await undo.click()
  await expect(textarea).toHaveValue('\\text{ab}')
  await redo.click()
  await expect(textarea).toHaveValue('\\frac12')

  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(textarea).toHaveValue('')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(textarea).toHaveValue('\\frac12')
  expect(await textarea.inputValue()).not.toMatch(/mkern|phantom|placeholder/)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(textarea).toHaveValue('')

  await undo.click()
  await textarea.fill('x')
  await textarea.blur()
  await expect(redo).toBeDisabled()
})

test('typing after escaping an empty Text box keeps the box and input clean', async ({
  page,
  goto,
}) => {
  await goto('/', { waitUntil: 'hydration' })
  await insertElement(page, 'Text', 'Text')
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field')
  await expect(textarea).toHaveValue('\\text{}', { timeout: 10000 })
  await expect(field).toBeFocused()

  await page.keyboard.press('ArrowRight')
  await page.keyboard.type('ab')
  await expect(textarea).toHaveValue('\\text{}ab', { timeout: 10000 })
  const latex = await textarea.inputValue()
  expect(latex).not.toContain('mkern')
  expect(latex).not.toContain('textbackslash')

  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await insertElement(page, 'Text', 'Text')
  await expect(textarea).toHaveValue('\\text{}', { timeout: 10000 })
  await expect(field).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.type('xy')
  await expect(textarea).toHaveValue('xy\\text{}', { timeout: 10000 })
})

test('typing after clearing a filled Text box stays in math mode', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field')
  await insertElement(page, 'Text', 'Text')
  await expect(textarea).toHaveValue('\\text{}', { timeout: 10000 })
  await expect(field).toBeFocused()
  await page.keyboard.type('hello')
  await expect(textarea).toHaveValue('\\text{hello}', { timeout: 10000 })

  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(textarea).toHaveValue('')

  await field.evaluate((el) => (el as { focus(): void }).focus())
  await page.waitForTimeout(200)
  await page.keyboard.type('x')
  await expect(textarea).toHaveValue('x', { timeout: 10000 })
})

test('typing after clearing via the LaTeX source stays in math mode', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field')
  await insertElement(page, 'Text', 'Text')
  await expect(textarea).toHaveValue('\\text{}', { timeout: 10000 })
  await page.keyboard.type('hi')
  await expect(textarea).toHaveValue('\\text{hi}', { timeout: 10000 })

  await textarea.fill('')
  await textarea.blur()
  await expect(textarea).toHaveValue('')

  await field.evaluate((el) => (el as { focus(): void }).focus())
  await page.waitForTimeout(200)
  await page.keyboard.type('y')
  await expect(textarea).toHaveValue('y', { timeout: 10000 })
})

test('typing after select-all delete of a Text box stays in math mode', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field')
  await insertElement(page, 'Text', 'Text')
  await expect(textarea).toHaveValue('\\text{}', { timeout: 10000 })
  await page.keyboard.type('hi')
  await expect(textarea).toHaveValue('\\text{hi}', { timeout: 10000 })

  await field.evaluate((element) => {
    const mf = element as unknown as { executeCommand(cmd: string): boolean }
    mf.executeCommand('selectAll')
  })
  await page.keyboard.press('Delete')
  await expect(textarea).toHaveValue('')

  await page.keyboard.type('z')
  await expect(textarea).toHaveValue('z', { timeout: 10000 })
})

test('an empty Text box keeps the gray hint and parks the caret in front of it', async ({
  page,
  goto,
}) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field')
  await insertElement(page, 'Text', 'Text')
  await expect(textarea).toHaveValue('\\text{}', { timeout: 10000 })
  await expect(field).toBeFocused()

  // The hint word is visible while the box is empty, and a simulated caret is
  // overlaid in front of its first character (the native caret is hidden here).
  const hint = page.locator('.text-hint').first()
  await expect(hint).toBeVisible()
  await expect(hint).toHaveText('Text')
  const caret = await field.evaluate((element) => {
    const mf = element as unknown as {
      position: number
      lastOffset: number
      selectionIsCollapsed: boolean
      getElementInfo(offset: number): { latex?: string } | undefined
    }
    let first = -1
    for (let offset = 0; offset <= mf.lastOffset; offset++) {
      const latex = mf.getElementInfo(offset)?.latex
      if (latex === '\\text{\\phantom{Text}}' || latex?.startsWith('\\text{T')) {
        first = offset
        break
      }
    }
    return { position: mf.position, before: first - 1, collapsed: mf.selectionIsCollapsed }
  })
  expect(caret.collapsed).toBe(true)
  expect(caret.position).toBe(caret.before)
  await expect(page.locator('.caret-text-hl')).toHaveCount(0)
  const simCaret = page.locator('.sim-caret')
  await expect(simCaret).toHaveCount(1)
  await expect.poll(() => simCaretDistanceFromHint(simCaret, hint)).toBeLessThan(4)

  await page.keyboard.type('h')
  await expect(textarea).toHaveValue('\\text{h}', { timeout: 10000 })
  await expect(page.locator('.text-hint')).toHaveCount(0)
  await expect(page.locator('.sim-caret')).toHaveCount(0)
  const latex = await textarea.inputValue()
  expect(latex).not.toContain('phantom')
  expect(latex).not.toContain('mkern')
})

test('clicking an empty Text box focuses it and types into the box', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  await textarea.fill('a\\text{}b')
  await textarea.blur()
  await expect(textarea).toHaveValue('a\\text{}b')

  const hint = page.locator('.text-hint').first()
  await expect(hint).toBeVisible()
  const box = await hint.boundingBox()
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
  const caret = await page.locator('math-field').evaluate((element) => {
    const mf = element as unknown as {
      position: number
      lastOffset: number
      selectionIsCollapsed: boolean
      getElementInfo(offset: number): { latex?: string } | undefined
    }
    let first = -1
    for (let offset = 0; offset <= mf.lastOffset; offset++) {
      const latex = mf.getElementInfo(offset)?.latex
      if (latex === '\\text{\\phantom{Text}}' || latex?.startsWith('\\text{T')) {
        first = offset
        break
      }
    }
    return { position: mf.position, before: first - 1, collapsed: mf.selectionIsCollapsed }
  })
  expect(caret.collapsed).toBe(true)
  expect(caret.position).toBe(caret.before)
  await expect(page.locator('.caret-text-hl')).toHaveCount(0)
  const simCaret = page.locator('.sim-caret')
  await expect(simCaret).toHaveCount(1)
  await expect.poll(() => simCaretDistanceFromHint(simCaret, hint)).toBeLessThan(4)

  // MathLive defers the actual keyboard-sink focus ~60ms after focus(); wait for
  // it to settle so a natural blur (moving focus to the source textarea) is not
  // immediately undone by that deferred focus.
  await page.waitForTimeout(150)
  await page.locator('.latex-textarea').focus()
  await expect(page.locator('.sim-caret')).toHaveCount(0)

  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await expect(page.locator('.sim-caret')).toHaveCount(1)
  await page.keyboard.type('z')
  await expect(textarea).toHaveValue('a\\text{z}b', { timeout: 10000 })
  await expect(page.locator('.sim-caret')).toHaveCount(0)
})

async function dropTextElement(page: import('@playwright/test').Page, x: number, y: number) {
  await page.evaluate(() => {
    document
      .querySelector('button[aria-label="Insert Text"]')!
      .dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
  })
  await page.evaluate(
    ([cx, cy]) => {
      document
        .querySelector('.workspace')!
        .dispatchEvent(
          new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            clientX: cx,
            clientY: cy,
            dataTransfer: new DataTransfer(),
          }),
        )
    },
    [x, y],
  )
  await page.evaluate(
    ([cx, cy]) => {
      const dt = new DataTransfer()
      dt.setData('application/x-equation-element', 'text')
      document
        .querySelector('.workspace')!
        .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, dataTransfer: dt }))
      document
        .querySelector('button[aria-label="Insert Text"]')!
        .dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
    },
    [x, y],
  )
}

async function dragStyleElement(
  page: import('@playwright/test').Page,
  id: string,
  label: string,
  x: number,
  y: number,
) {
  await page.evaluate((l) => {
    document
      .querySelector(`button[aria-label="${l}"]`)!
      .dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
  }, label)
  await page.evaluate(
    ([cx, cy]) => {
      document
        .querySelector('.workspace')!
        .dispatchEvent(
          new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, dataTransfer: new DataTransfer() }),
        )
    },
    [x, y],
  )
  await page.evaluate(
    ([cx, cy, eid, l]: [number, number, string, string]) => {
      const dt = new DataTransfer()
      dt.setData('application/x-equation-element', eid)
      document
        .querySelector('.workspace')!
        .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, dataTransfer: dt }))
      document
        .querySelector(`button[aria-label="${l}"]`)!
        .dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
    },
    [x, y, id, label] as [number, number, string, string],
  )
}

test('a dropped Text element lands with a visible caret ready for typing', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field.workspace-field')
  const workspace = page.locator('.workspace')
  const box = await workspace.boundingBox()
  await dropTextElement(page, box!.x + box!.width / 2, box!.y + box!.height / 2)

  await expect(textarea).toHaveValue('\\text{}', { timeout: 10000 })
  await expect(field).toBeFocused()
  await expect(page.locator('.text-hint').first()).toBeVisible()
  await page.keyboard.type('h')
  await expect(textarea).toHaveValue('\\text{h}', { timeout: 10000 })
})

test('dropping a Text element onto an empty Text box is ignored', async ({
  page,
  goto,
}) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  await expandCategory(page, 'Text')
  await page.getByRole('button', { name: 'Insert Text', exact: true }).click()
  await expect(textarea).toHaveValue('\\text{}', { timeout: 10000 })
  await expect(page.locator('math-field')).toBeFocused()
  await page.waitForTimeout(200)

  const hint = page.locator('.text-hint').first()
  await expect(hint).toBeVisible()
  const box = await hint.boundingBox()
  await dropTextElement(page, box!.x + box!.width / 2, box!.y + box!.height / 2)

  // Inserting another Text box inside or next to one is disabled (they would
  // merge anyway): the formula keeps a single empty box.
  await expect(textarea).toHaveValue('\\text{}', { timeout: 10000 })
  const latex = await textarea.inputValue()
  expect(latex).not.toContain('mkern')
  expect(latex).not.toContain('phantom')
  expect(latex).not.toContain('$')
  await expect(page.locator('.text-hint')).toHaveCount(1)
})

test('clicking Insert Text twice keeps a single empty box', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  await expandCategory(page, 'Text')
  await page.getByRole('button', { name: 'Insert Text', exact: true }).click()
  await expect(textarea).toHaveValue('\\text{}', { timeout: 10000 })
  await expect(page.locator('math-field')).toBeFocused()
  await page.waitForTimeout(200)

  await page.getByRole('button', { name: 'Insert Text', exact: true }).click()
  await expect(textarea).toHaveValue('\\text{}', { timeout: 10000 })
  const latex = await textarea.inputValue()
  expect(latex).not.toContain('mkern')
  expect(latex).not.toContain('phantom')
  expect(latex).not.toContain('$')
  await expect(page.locator('.text-hint')).toHaveCount(1)

  await page.keyboard.type('hi')
  await expect(textarea).toHaveValue('\\text{hi}', { timeout: 10000 })
})

test('only the Text box holding the caret is highlighted', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field')
  await textarea.fill('\\text{A}+\\text{B}')
  await textarea.blur()
  await expect(textarea).toHaveValue('\\text{A}+\\text{B}')
  await page.waitForTimeout(200)

  const highlight = page.locator('.caret-text-hl')
  await expect(highlight).toHaveCount(0)

  const setCaretAt = (letter: string) =>
    field.evaluate((element, ch) => {
      const mf = element as unknown as {
        lastOffset: number
        position: number
        focus(): void
        getElementInfo(offset: number): { latex?: string } | undefined
      }
      mf.focus()
      for (let offset = 0; offset <= mf.lastOffset; offset++) {
        if (mf.getElementInfo(offset)?.latex === `\\text{${ch}}`) {
          mf.position = offset
          return
        }
      }
    }, letter)

  const currentTextBounds = () =>
    field.evaluate((element) => {
      const mf = element as unknown as {
        position: number
        lastOffset: number
        getElementInfo(offset: number): {
          latex?: string
          mode?: string
          style?: unknown
          bounds?: { left: number; top: number; right: number; bottom: number }
        } | undefined
      }
      const isText = (offset: number) => {
        const latex = mf.getElementInfo(offset)?.latex
        return Boolean(latex?.startsWith('\\text') && latex !== '\\mkern0mu')
      }
      let atom = mf.position
      if (!isText(atom)) {
        atom = isText(atom + 1) ? atom + 1 : isText(atom - 1) ? atom - 1 : -1
      }
      if (atom < 0) {
        return null
      }
      const runKey = (offset: number) => {
        const info = mf.getElementInfo(offset)
        return JSON.stringify([info?.mode, info?.style ?? null])
      }
      const key = runKey(atom)
      let first = atom
      let last = atom
      while (first > 0 && isText(first - 1) && runKey(first - 1) === key) {
        first--
      }
      while (last < mf.lastOffset && isText(last + 1) && runKey(last + 1) === key) {
        last++
      }
      let left = Infinity
      let top = Infinity
      let right = -Infinity
      let bottom = -Infinity
      for (let offset = first; offset <= last; offset++) {
        const bounds = mf.getElementInfo(offset)?.bounds
        if (bounds) {
          left = Math.min(left, bounds.left)
          top = Math.min(top, bounds.top)
          right = Math.max(right, bounds.right)
          bottom = Math.max(bottom, bounds.bottom)
        }
      }
      return Number.isFinite(left) ? { left, top, right, bottom } : null
    })

  const highlightMatchesCurrentText = async () => {
    const hl = await highlight.boundingBox()
    const bounds = await currentTextBounds()
    return Boolean(
      hl &&
        bounds &&
        Math.abs(hl.x - bounds.left) < 2 &&
        Math.abs(hl.y - bounds.top) < 2 &&
        Math.abs(hl.x + hl.width - bounds.right) < 2 &&
        Math.abs(hl.y + hl.height - bounds.bottom) < 2,
    )
  }

  for (const letter of ['A', 'B']) {
    await setCaretAt(letter)
    await expect(field).toBeFocused()
    await expect(highlight).toHaveCount(1)
    await expect.poll(highlightMatchesCurrentText).toBe(true)
  }

  await field.evaluate((element) => {
    const mf = element as unknown as { lastOffset: number; position: number; focus(): void }
    mf.focus()
    mf.position = mf.lastOffset
  })
  await expect(highlight).toHaveCount(0)
})

test('a Text box nested in a fraction highlights only the text, not the container', async ({
  page,
  goto,
}) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field')
  await textarea.fill('\\frac{\\text{MW}}{x}')
  await textarea.blur()
  await expect(textarea).toHaveValue('\\frac{\\text{MW}}{x}')
  await page.waitForTimeout(200)

  await field.evaluate((element) => {
    const mf = element as unknown as {
      focus(): void
      position: number
      lastOffset: number
      getElementInfo(offset: number): { latex?: string } | undefined
    }
    mf.focus()
    for (let offset = 0; offset <= mf.lastOffset; offset++) {
      if (mf.getElementInfo(offset)?.latex?.startsWith('\\text')) {
        mf.position = offset
        return
      }
    }
  })
  await expect(field).toHaveClass(/caret-in-text/)

  // MathLive's built-in "contains" highlight (which otherwise paints the whole
  // fraction over the text box) must be transparent while the caret is in text.
  await expect
    .poll(() =>
      field.evaluate((element) => {
        const hl = element.shadowRoot?.querySelector('.ML__contains-highlight')
        return hl ? getComputedStyle(hl).backgroundColor === 'rgba(0, 0, 0, 0)' : true
      }),
    )
    .toBe(true)
  await expect(page.locator('.caret-text-hl')).toHaveCount(1)
})

test('Text highlight follows typing and deletion without stale character width', async ({
  page,
  goto,
}) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field')
  const highlight = page.locator('.caret-text-hl')
  await insertElement(page, 'Text', 'Text')
  await expect(textarea).toHaveValue('\\text{}', { timeout: 10000 })
  await expect(highlight).toHaveCount(0)

  const visibleTextBounds = () =>
    field.evaluate((element) => {
      const mf = element as unknown as {
        lastOffset: number
        getElementInfo(offset: number): {
          latex?: string
          bounds?: { left: number; top: number; right: number; bottom: number }
        } | undefined
      }
      let left = Infinity
      let top = Infinity
      let right = -Infinity
      let bottom = -Infinity
      for (let offset = 0; offset <= mf.lastOffset; offset++) {
        const info = mf.getElementInfo(offset)
        if (!info?.latex?.startsWith('\\text') || info.latex === '\\mkern0mu' || !info.bounds) {
          continue
        }
        left = Math.min(left, info.bounds.left)
        top = Math.min(top, info.bounds.top)
        right = Math.max(right, info.bounds.right)
        bottom = Math.max(bottom, info.bounds.bottom)
      }
      return Number.isFinite(left) ? { left, top, right, bottom } : null
    })

  const highlightMatchesText = async () => {
    const hl = await highlight.boundingBox()
    const bounds = await visibleTextBounds()
    return Boolean(
      hl &&
        bounds &&
        Math.abs(hl.x - bounds.left) < 2 &&
        Math.abs(hl.y - bounds.top) < 2 &&
        Math.abs(hl.x + hl.width - bounds.right) < 2 &&
        Math.abs(hl.y + hl.height - bounds.bottom) < 2,
    )
  }

  await page.keyboard.type('M')
  await expect(textarea).toHaveValue('\\text{M}', { timeout: 10000 })
  await expect.poll(highlightMatchesText).toBe(true)

  await page.keyboard.type('W')
  await expect(textarea).toHaveValue('\\text{MW}', { timeout: 10000 })
  await expect.poll(highlightMatchesText).toBe(true)
  const widthBeforeDelete = (await highlight.boundingBox())!.width

  await page.keyboard.press('Backspace')
  await expect(textarea).toHaveValue('\\text{M}', { timeout: 10000 })
  await expect.poll(highlightMatchesText).toBe(true)
  const widthAfterDelete = (await highlight.boundingBox())!.width
  expect(widthAfterDelete).toBeLessThan(widthBeforeDelete)

  await page.keyboard.press('Backspace')
  await expect(textarea).toHaveValue('\\text{}', { timeout: 10000 })
  await expect(highlight).toHaveCount(0)
})

test('a Bold element behaves like a Text box with a styled hint and virtual caret', async ({
  page,
  goto,
}) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field')
  await expandCategory(page, 'Text')
  await page.getByRole('button', { name: 'Insert Bold', exact: true }).click()
  await expect(textarea).toHaveValue('\\bm{}', { timeout: 10000 })
  await expect(field).toBeFocused()

  const hint = page.locator('.text-hint').first()
  await expect(hint).toBeVisible()
  const font = await hint.evaluate((n) => {
    const cs = getComputedStyle(n)
    return { family: cs.fontFamily, weight: cs.fontWeight }
  })
  expect(font.family).toContain('KaTeX_Main')
  expect(font.weight).toBe('700')
  await expect(page.locator('.sim-caret')).toHaveCount(1)

  await page.keyboard.type('ab')
  await expect(textarea).toHaveValue('\\mathbf{ab}', { timeout: 10000 })
  await expect(page.locator('.sim-caret')).toHaveCount(0)

  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await expect(textarea).toHaveValue('\\bm{}', { timeout: 10000 })
  await expect(page.locator('.text-hint')).toHaveCount(1)
  await expect(page.locator('.sim-caret')).toHaveCount(1)
})

test('dragging a font style twice toggles it off', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field')
  await textarea.fill('\\text{hi}')
  await textarea.blur()
  await expect(textarea).toHaveValue('\\text{hi}')
  await page.waitForTimeout(150)

  const target = await field.evaluate((el) => {
    const root = (el as HTMLElement & { shadowRoot: ShadowRoot }).shadowRoot
    const r = root!.querySelector('.ML__text')!.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })

  await dragStyleElement(page, 'mathbf', 'Insert Bold', target.x, target.y)
  await expect(textarea).toHaveValue('\\textbf{hi}', { timeout: 10000 })

  await dragStyleElement(page, 'mathbf', 'Insert Bold', target.x, target.y)
  await expect(textarea).toHaveValue('\\text{hi}', { timeout: 10000 })
})

test('undo covers direct font styling and matrix structure commands', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field.workspace-field')
  const undo = page.getByRole('button', { name: 'Undo', exact: true })
  const redo = page.getByRole('button', { name: 'Redo', exact: true })

  await textarea.fill('\\text{hi}')
  await textarea.blur()
  await page.waitForTimeout(150)
  const text = await field.evaluate((el) => {
    const rect = el.shadowRoot!.querySelector('.ML__text')!.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })
  await dragStyleElement(page, 'mathbf', 'Insert Bold', text.x, text.y)
  await expect(textarea).toHaveValue('\\textbf{hi}', { timeout: 10000 })
  await undo.click()
  await expect(textarea).toHaveValue('\\text{hi}')
  await redo.click()
  await expect(textarea).toHaveValue('\\textbf{hi}')

  const matrix = '\\begin{matrix}a\\end{matrix}'
  await textarea.fill(matrix)
  await textarea.blur()
  await page.waitForTimeout(150)
  const cell = await field.evaluate((element) => {
    const mf = element as unknown as {
      lastOffset: number
      getElementInfo(offset: number): {
        latex?: string
        bounds?: { left: number; top: number; width: number; height: number }
      } | undefined
    }
    for (let offset = 0; offset <= mf.lastOffset; offset++) {
      const info = mf.getElementInfo(offset)
      if (info?.latex === 'a' && info.bounds) {
        return {
          x: info.bounds.left + info.bounds.width / 2,
          y: info.bounds.top + info.bounds.height / 2,
        }
      }
    }
    return null
  })
  expect(cell).not.toBeNull()
  await page.mouse.click(cell!.x, cell!.y, { button: 'right' })
  await page.getByRole('menuitem', { name: /^Insert Row Below/ }).click()
  await expect(textarea).not.toHaveValue(matrix)
  await undo.click()
  await expect(textarea).toHaveValue(matrix)
  await redo.click()
  await expect(textarea).not.toHaveValue(matrix)
})

test('matrix menu keeps a right-clicked placeholder as its command target', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await insertElement(page, 'Plain matrix', 'Matrices')
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field.workspace-field')
  const point = await field.evaluate((element) => {
    const mf = element as unknown as {
      lastOffset: number
      getElementInfo(offset: number): {
        bounds?: { left: number; top: number; width: number; height: number }
      } | undefined
      _mathfield?: { model?: { at(offset: number): { type: string; parentBranch?: unknown } } }
    }
    const model = mf._mathfield?.model
    if (!model) return null
    for (let offset = 0; offset <= mf.lastOffset; offset++) {
      const atom = model.at(offset)
      const bounds = mf.getElementInfo(offset)?.bounds
      if (atom.type === 'placeholder' && bounds && String(atom.parentBranch) === '0,0') {
        return {
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 2,
        }
      }
    }
    return null
  })
  expect(point).not.toBeNull()
  await page.mouse.click(point!.x, point!.y, { button: 'right' })

  const rowBelow = page.getByRole('menuitem', { name: /^Insert Row Below/ })
  await expect(rowBelow).toBeVisible()
  await expect(rowBelow).not.toHaveAttribute('aria-disabled', 'true')
  const itemBox = await rowBelow.boundingBox()
  expect(itemBox).not.toBeNull()
  await page.mouse.move(itemBox!.x + itemBox!.width / 2, itemBox!.y + itemBox!.height / 2)
  await page.mouse.down()
  await expect.poll(() => field.evaluate((element) => {
    const mf = element as unknown as {
      position: number
      _mathfield?: { model?: { at(offset: number): { parentBranch?: unknown } } }
    }
    return String(mf._mathfield?.model?.at(mf.position).parentBranch)
  })).toBe('0,0')
  await page.mouse.up()

  await expect.poll(() => field.evaluate((element) => {
    const model = (element as unknown as {
      _mathfield?: { model?: { atoms: Array<{ type: string; environmentName?: string; rowCount?: number }> } }
    })._mathfield?.model
    return model?.atoms.find((atom) => atom.type === 'array' && atom.environmentName === 'matrix')?.rowCount
  })).toBe(3)
  await expect(textarea).not.toHaveValue(/\\displaylines/)
})

test('native context menu unwraps the innermost pointed element', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field.workspace-field')
  await textarea.fill('\\sqrt{\\frac{a}{b}}')
  await textarea.blur()
  const point = await field.evaluate((element) => {
    const mf = element as unknown as {
      lastOffset: number
      getElementInfo(offset: number): {
        latex?: string
        bounds?: { left: number; top: number; width: number; height: number }
      } | undefined
    }
    for (let offset = 0; offset <= mf.lastOffset; offset++) {
      const info = mf.getElementInfo(offset)
      if (info?.latex === 'a' && info.bounds) {
        return {
          x: info.bounds.left + info.bounds.width / 2,
          y: info.bounds.top + info.bounds.height / 2,
        }
      }
    }
    return null
  })
  expect(point).not.toBeNull()
  await page.mouse.click(point!.x, point!.y, { button: 'right' })
  const unwrap = page.getByRole('menuitem', { name: 'Unwrap', exact: true })
  await expect(unwrap).toBeVisible()
  await expect.poll(() => field.evaluate((element) => {
    const mf = element as unknown as {
      selection: { ranges: Array<[number, number]> }
      getValue(start: number, end: number): string
    }
    const [start, end] = mf.selection.ranges[0] ?? [0, 0]
    return mf.getValue(start, end)
  })).toBe('\\frac{a}{b}')
  await unwrap.click()
  await expect(textarea).toHaveValue('\\sqrt{ab}')
})

test('fraction numerator and denominator painted gaps are symmetric', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field')
  await field.evaluate((el) => {
    el.style.background = '#fff'
    el.style.color = '#000'
  })

  for (const { size, latex } of [
    { size: 16, latex: '\\frac{\\sin(a)}{\\cos(a)}' },
    { size: 24, latex: '\\frac{\\sin(a)}{\\cos(a)}' },
    { size: 32, latex: '\\frac{x}{y}' },
    { size: 24, latex: '\\frac{\\frac{x}{y}}{z}' },
  ]) {
    await page.getByRole('combobox', { name: 'Equation font size' }).selectOption(String(size))
    await textarea.fill(latex)
    await textarea.blur()
    await page.waitForTimeout(300)
    const clip = await field.evaluate((el) => {
      const rect = el.shadowRoot!.querySelector('.ML__latex')!.getBoundingClientRect()
      return { x: rect.left - 4, y: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }
    })
    const gaps = measurePaintedFractionGaps(await page.screenshot({ animations: 'disabled', clip }))
    expect(Math.abs(gaps.top - gaps.bottom)).toBeLessThanOrEqual(1)
    expect(gaps.top).toBeGreaterThan(0)
    expect(gaps.bottom).toBeGreaterThan(0)
  }
})

test('fraction rule stays positioned while focusing and typing', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field')
  await textarea.fill('\\frac{\\sin(a)}{\\cos(a)}')
  await textarea.blur()
  await page.waitForTimeout(300)

  await page.evaluate(() => {
    const state = window as unknown as {
      fractionFrameSamples: { top: number | null; transform: string | null }[]
    }
    state.fractionFrameSamples = []
    let remaining = 36
    const sample = () => {
      const field = document.querySelector('math-field')!
      const line = field.shadowRoot?.querySelector('.ML__frac-line') as HTMLElement | null
      const row = line?.parentElement
      const after = line ? getComputedStyle(line, '::after') : null
      state.fractionFrameSamples.push({
        top: line ? line.getBoundingClientRect().top + (parseFloat(after?.marginTop ?? '0') || 0) : null,
        transform: row?.style.transform ?? null,
      })
      if (remaining-- > 0) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })

  await field.evaluate((element) => {
    const mf = element as unknown as {
      lastOffset: number
      position: number
      focus(): void
      getElementInfo(offset: number): { latex?: string } | undefined
    }
    mf.focus()
    for (let offset = 0; offset <= mf.lastOffset; offset++) {
      const latex = mf.getElementInfo(offset)?.latex
      if (latex === 'a' || latex?.endsWith('{a}')) {
        mf.position = offset
        break
      }
    }
  })
  await page.keyboard.type('bbb', { delay: 35 })
  await page.waitForTimeout(700)

  const samples = await page.evaluate(() => {
    return (window as unknown as {
      fractionFrameSamples: { top: number | null; transform: string | null }[]
    }).fractionFrameSamples
  })
  expect(samples.length).toBeGreaterThan(20)
  expect(samples.every((sample) => sample.top !== null && sample.transform?.startsWith('translateY('))).toBe(true)
  const tops = samples.map((sample) => sample.top!).filter(Number.isFinite)
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(0.5)
})

test('deleting a middle Text box keeps the caret at the deletion point', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field')
  await textarea.fill('\\text{AAA}\\text{BBB}\\text{CCC}')
  await textarea.blur()
  await expect(textarea).toHaveValue('\\text{AAA}\\text{BBB}\\text{CCC}')
  await page.waitForTimeout(150)

  await field.evaluate((element) => {
    const mf = element as unknown as {
      lastOffset: number
      position: number
      focus(): void
      getElementInfo(offset: number): { latex?: string } | undefined
    }
    mf.focus()
    for (let offset = mf.lastOffset; offset >= 0; offset--) {
      if (mf.getElementInfo(offset)?.latex?.endsWith('{B}')) {
        mf.position = offset + 1
        break
      }
    }
  })
  await expect(field).toBeFocused()

  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Backspace')
  }
  await expect(textarea).toHaveValue('\\text{AAACCC}', { timeout: 10000 })

  const caret = await field.evaluate((element) => {
    const mf = element as unknown as {
      position: number
      lastOffset: number
      getElementInfo(offset: number): { latex?: string } | undefined
    }
    let junction = -1
    for (let offset = 0; offset <= mf.lastOffset; offset++) {
      if (mf.getElementInfo(offset)?.latex === '\\text{C}') {
        junction = offset
        break
      }
    }
    return { position: mf.position, junction }
  })
  expect(caret.position).toBe(caret.junction - 1)
  const latex = await textarea.inputValue()
  expect(latex).not.toContain('mkern')
  expect(latex).not.toContain('phantom')
})

test('typing into a box adjacent to another merges them', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field')
  await textarea.fill('\\text{A}\\text{B}')
  await textarea.blur()
  await expect(textarea).toHaveValue('\\text{A}\\text{B}')
  await page.waitForTimeout(150)

  await field.evaluate((element) => {
    const mf = element as unknown as {
      lastOffset: number
      position: number
      focus(): void
      getElementInfo(offset: number): { latex?: string } | undefined
    }
    mf.focus()
    for (let offset = 0; offset <= mf.lastOffset; offset++) {
      if (mf.getElementInfo(offset)?.latex === '\\text{A}') {
        mf.position = offset + 1
        break
      }
    }
  })
  await expect(field).toBeFocused()
  await page.keyboard.type('x')
  await expect(textarea).toHaveValue('\\text{AxB}', { timeout: 10000 })

  const caret = await field.evaluate((element) => {
    const mf = element as unknown as {
      position: number
      lastOffset: number
      getElementInfo(offset: number): { latex?: string } | undefined
    }
    let afterX = -1
    for (let offset = 0; offset <= mf.lastOffset; offset++) {
      if (mf.getElementInfo(offset)?.latex === '\\text{x}') {
        afterX = offset
      }
    }
    return { position: mf.position, afterX }
  })
  expect(caret.position).toBe(caret.afterX)
})

test('typing keeps the caret right after each letter', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field')
  await expandCategory(page, 'Text')
  await page.getByRole('button', { name: 'Insert Text', exact: true }).click()
  await expect(textarea).toHaveValue('\\text{}', { timeout: 10000 })
  await expect(field).toBeFocused()
  await page.waitForTimeout(200)

  for (const ch of 'hel') {
    await page.keyboard.type(ch)
    await expect
      .poll(async () =>
        field.evaluate(
          (element, letter) => {
            const mf = element as unknown as {
              position: number
              lastOffset: number
              getElementInfo(offset: number): { latex?: string } | undefined
            }
          let after = -1
          for (let offset = 0; offset <= mf.lastOffset; offset++) {
            if (mf.getElementInfo(offset)?.latex === `\\text{${letter}}`) {
              after = offset
            }
          }
          return mf.position === after
          },
          ch,
        ),
      )
      .toBe(true)
  }
  await expect(textarea).toHaveValue('\\text{hel}', { timeout: 10000 })
})

test('the Text drag preview shows the gray word and pushes the content apart', async ({
  page,
  goto,
}) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  await textarea.fill('12')
  await textarea.blur()
  await expect(textarea).toHaveValue('12')

  const workspace = page.locator('.workspace')
  const box = await workspace.boundingBox()
  await page.evaluate(() => {
    document
      .querySelector('button[aria-label="Insert Text"]')!
      .dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
  })
  await page.evaluate(
    ([x, y]) => {
      document
        .querySelector('.workspace')!
        .dispatchEvent(
          new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            dataTransfer: new DataTransfer(),
          }),
        )
    },
    [box!.x + box!.width / 2, box!.y + box!.height / 2],
  )

  const mirrorValue = () =>
    page.evaluate(
      () => (document.querySelector('math-field.workspace-mirror') as unknown as { value: string })?.value,
    )
  await expect.poll(mirrorValue).toContain('\\phantom{Text}')
  const previewHint = page.locator('.text-hint').first()
  await expect(previewHint).toHaveText('Text')
  const previewHintBox = await previewHint.boundingBox()
  const previewFont = await previewHint.evaluate((node) => getComputedStyle(node).font)

  await page.evaluate(() => {
    document
      .querySelector('button[aria-label="Insert Text"]')!
      .dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
  })

  await expandCategory(page, 'Text')
  await page.getByRole('button', { name: 'Insert Text', exact: true }).click()
  const placedHint = page.locator('.text-hint').first()
  await expect(placedHint).toHaveText('Text')
  const placedHintBox = await placedHint.boundingBox()
  expect(placedHintBox!.height).toBeCloseTo(previewHintBox!.height, 1)
  expect(await placedHint.evaluate((node) => getComputedStyle(node).font)).toBe(previewFont)
})

test('select all delete and replace clear the field without escaping markers', async ({
  page,
  goto,
}) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field')
  const selectAll = () =>
    field.evaluate((element) => {
      const mf = element as unknown as { focus(): void; executeCommand(cmd: string): boolean }
      mf.focus()
      mf.executeCommand('selectAll')
    })

  await textarea.fill('\\text{abc}x')
  await textarea.blur()
  await expect(textarea).toHaveValue('\\text{abc}x')
  await selectAll()
  await expect(field).toBeFocused()
  await page.keyboard.press('Delete')
  await expect(textarea).toHaveValue('', { timeout: 10000 })

  await textarea.fill('\\text{abc}x')
  await textarea.blur()
  await selectAll()
  await expect(field).toBeFocused()
  await page.keyboard.type('y')
  await expect(textarea).toHaveValue('y', { timeout: 10000 })
})

test('deleting the last character of a styled Text box keeps its style', async ({
  page,
  goto,
}) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field')
  await textarea.fill('\\textbf{a}')
  await textarea.blur()
  await expect(textarea).toHaveValue('\\textbf{a}')

  await field.evaluate((element) => {
    const mf = element as unknown as { lastOffset: number; position: number; focus(): void }
    mf.focus()
    mf.position = mf.lastOffset
  })
  await expect(field).toBeFocused()
  await page.keyboard.press('Backspace')
  await expect(textarea).toHaveValue('\\textbf{}', { timeout: 10000 })
  const latex = await textarea.inputValue()
  expect(latex).not.toContain('mkern')

  await textarea.fill('\\textbf{a}')
  await textarea.blur()
  await field.evaluate((element) => {
    const mf = element as unknown as {
      lastOffset: number
      position: number
      focus(): void
      getElementInfo(offset: number): { latex?: string } | undefined
    }
    mf.focus()
    for (let offset = 0; offset <= mf.lastOffset; offset++) {
      if (mf.getElementInfo(offset)?.latex?.endsWith('{a}')) {
        mf.position = offset
        break
      }
    }
  })
  await expect(field).toBeFocused()
  await page.keyboard.press('Delete')
  await expect(textarea).toHaveValue('\\textbf{}', { timeout: 10000 })
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

test('renders MathLive labels above and below long arrows', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const textarea = page.locator('.latex-textarea')
  await insertElement(page, 'Long left arrow', 'Arrows')
  await expect(
    page.getByRole('button', { name: 'Insert Long left arrow', exact: true }).getByText('□'),
  ).toHaveCount(2)
  await expect(textarea).toHaveValue('\\xleftarrow[]{}')
  const field = page.locator('math-field')
  const placeholders = field.locator('text=▢').filter({ visible: true })
  await expect(placeholders).toHaveCount(2)
  await expect(field).toBeFocused()

  await page.keyboard.press('Delete')
  await expect(placeholders).toHaveCount(1)

  await page.keyboard.press('Delete')
  await expect(textarea).toHaveValue('\\xleftarrow{}')
  await expect(placeholders).toHaveCount(0)

  await textarea.fill('\\longleftarrow[below]{above}')
  await textarea.blur()
  await expect(textarea).toHaveValue('\\xleftarrow[below]{above}')
  const preview = page.locator('.math-preview-canvas')
  await expect(preview.locator('[data-mml-node="munderover"]')).toBeVisible({ timeout: 15000 })
  await expect(preview.locator('[data-mml-node="merror"]')).toHaveCount(0)
})

test('palette scrolls independently at a short viewport', async ({ page, goto }) => {
  await page.setViewportSize({ width: 1360, height: 600 })
  await goto('/', { waitUntil: 'hydration' })
  const scroll = page.locator('.palette-scroll')
  await expect(scroll).toBeVisible()
  const headings = page.locator('button.palette-heading')
  const headingCount = await headings.count()
  for (let i = 0; i < headingCount; i++) {
    if ((await headings.nth(i).getAttribute('aria-expanded')) !== 'true') {
      await headings.nth(i).click()
    }
  }
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
  await expandCategory(page, 'Fractions')
  await source.dragTo(target)
  await expect(page.locator('.latex-textarea')).toHaveValue(/\\frac/, { timeout: 10000 })
})

test('palette icons render with mathlive markup layout', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await expandCategory(page, 'Fractions')
  await expect(page.locator('.palette-item .ML__mfrac').first()).toBeVisible({ timeout: 15000 })
})

test('typing replaces the selected placeholder after inserting an accent element', async ({
  page,
  goto,
}) => {
  await goto('/', { waitUntil: 'hydration' })
  await insertElement(page, 'Bar', 'Accents')
  const textarea = page.locator('.latex-textarea')
  await expect(textarea).toHaveValue(/\\bar/, { timeout: 10000 })
  await page.keyboard.type('x')
  await expect(textarea).toHaveValue(/\\bar\{x\}/, { timeout: 10000 })
})

test('delete removes an accent when only its placeholder remains', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await insertElement(page, 'Hat', 'Accents')
  const textarea = page.locator('.latex-textarea')
  await expect(textarea).toHaveValue(/\\hat/, { timeout: 10000 })
  await page.keyboard.press('Delete')
  await expect(textarea).toHaveValue('', { timeout: 10000 })
})

test('clicking an accent placeholder focuses it and accepts input', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await insertElement(page, 'Bar', 'Accents')
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

test('clicking a filled accent re-enters it so it can be edited again', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await insertElement(page, 'Hat', 'Accents')
  const textarea = page.locator('.latex-textarea')
  const field = page.locator('math-field')
  await expect(textarea).toHaveValue(/\\hat/, { timeout: 10000 })
  await page.keyboard.type('x')
  await expect(textarea).toHaveValue(/\\hat\{x\}/, { timeout: 10000 })
  // Move the caret out of the accent, then click back on its content. The
  // accent glyph overlays the content (which is why MathLive's own click
  // handling misses it), so force the click past the overlay.
  await page.keyboard.press('ArrowRight')
  await field.locator('text=x').filter({ visible: true }).first().click({ force: true })
  await page.keyboard.type('y')
  await expect(textarea).toHaveValue(/\\hat\{xy\}/, { timeout: 10000 })
})

test('arrow keys navigate into and through an accent argument', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await insertElement(page, 'Hat', 'Accents')
  const textarea = page.locator('.latex-textarea')
  await expect(textarea).toHaveValue(/\\hat/, { timeout: 10000 })
  await page.keyboard.type('xy')
  await expect(textarea).toHaveValue(/\\hat\{xy\}/, { timeout: 10000 })
  // Leave the accent, arrow back into it (right before the last character),
  // then append so the caret placement is observable.
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.type('z')
  await expect(textarea).toHaveValue(/\\hat\{xzy\}/, { timeout: 10000 })
})

test('backspace and delete edit the accent argument without removing it', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await insertElement(page, 'Hat', 'Accents')
  const textarea = page.locator('.latex-textarea')
  await expect(textarea).toHaveValue(/\\hat/, { timeout: 10000 })
  await page.keyboard.type('xy')
  await expect(textarea).toHaveValue(/\\hat\{xy\}/, { timeout: 10000 })
  // Backspace removes the last character only.
  await page.keyboard.press('Backspace')
  await expect(textarea).toHaveValue(/\\hat\{x\}/, { timeout: 10000 })
  // Delete removes the character before the caret after stepping left.
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Delete')
  await expect(textarea).toHaveValue(/\\hat\{\}/, { timeout: 10000 })
  // The emptied accent keeps an editable placeholder.
  await page.keyboard.type('w')
  await expect(textarea).toHaveValue(/\\hat\{w\}/, { timeout: 10000 })
})

test('a filled accent highlights its argument while the caret is inside', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await insertElement(page, 'Hat', 'Accents')
  const textarea = page.locator('.latex-textarea')
  await expect(textarea).toHaveValue(/\\hat/, { timeout: 10000 })
  await page.keyboard.type('xy')
  await expect(textarea).toHaveValue(/\\hat\{xy\}/, { timeout: 10000 })
  await expect(page.locator('.caret-text-hl')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.caret-text-hl')).toHaveCount(0)
})

test('palette ellipsis icon renders the symbol without errors', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await expandCategory(page, 'Basic')
  const chip = page.getByRole('button', { name: 'Insert Ellipsis' })
  await expect(chip).toContainText('…', { timeout: 15000 })
  await expect(chip.locator('.ML__error')).toHaveCount(0)
})

test('fixed-width accents stay centered over multi-character content', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await insertElement(page, 'Hat', 'Accents')
  const field = page.locator('math-field')
  const textarea = page.locator('.latex-textarea')
  await page.keyboard.type('abc')
  await expect(textarea).toHaveValue(/\\hat\{abc\}/, { timeout: 10000 })
  await page.waitForTimeout(150)
  // The accent glyph must be horizontally centered over its content. MathLive
  // anchors the fixed glyph at the content center, drifting it right for
  // multi-character content; the render fix re-centers it.
  const error = await field.evaluate((el) => {
    const root = (el as unknown as { shadowRoot: ShadowRoot | null }).shadowRoot
    const vlist = root?.querySelector('.ML__vlist')
    const body = root?.querySelector('.ML__accent-body')
    if (!vlist || !body) {
      return Infinity
    }
    const vr = vlist.getBoundingClientRect()
    const br = body.getBoundingClientRect()
    return Math.abs((br.left + br.right) / 2 - (vr.left + vr.right) / 2)
  })
  expect(error).toBeLessThan(1)
})

test('wide accents span the full content instead of starting at the middle', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await insertElement(page, 'Wide hat', 'Accents')
  const field = page.locator('math-field')
  const textarea = page.locator('.latex-textarea')
  await page.keyboard.type('xy')
  await expect(textarea).toHaveValue(/\\widehat\{xy\}/, { timeout: 10000 })
  await page.waitForTimeout(150)
  const span = await field.evaluate((el) => {
    const root = (el as unknown as { shadowRoot: ShadowRoot | null }).shadowRoot
    const stretchy = root?.querySelector('.ML__stretchy')
    const vlist = root?.querySelector('.ML__vlist')
    if (!stretchy || !vlist) {
      return null
    }
    const sr = stretchy.getBoundingClientRect()
    const vr = vlist.getBoundingClientRect()
    return { left: sr.left - vr.left, right: vr.right - sr.right }
  })
  expect(span).not.toBeNull()
  // The stretchy glyph must start at the content's left edge and end at its
  // right edge (no half-width glyph anchored at the middle).
  expect(Math.abs(span!.left)).toBeLessThan(1)
  expect(Math.abs(span!.right)).toBeLessThan(1)
})

test('wide accents cap at the font size and stay centered over long content', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await insertElement(page, 'Wide hat', 'Accents')
  const field = page.locator('math-field')
  const textarea = page.locator('.latex-textarea')
  await page.keyboard.type('abcdefgh')
  await expect(textarea).toHaveValue(/\\widehat\{abcdefgh\}/, { timeout: 10000 })
  await page.waitForTimeout(150)
  const measure = await field.evaluate((el) => {
    const root = (el as unknown as { shadowRoot: ShadowRoot | null }).shadowRoot
    const stretchy = root?.querySelector('.ML__stretchy')
    const vlist = root?.querySelector('.ML__vlist')
    const svg = root?.querySelector('.ML__stretchy svg')
    if (!stretchy || !vlist) {
      return null
    }
    const sr = stretchy.getBoundingClientRect()
    const vr = vlist.getBoundingClientRect()
    return {
      width: sr.width,
      contentWidth: vr.width,
      centerError: (sr.left + sr.right) / 2 - (vr.left + vr.right) / 2,
      viewBox: svg?.getAttribute('viewBox'),
    }
  })
  expect(measure).not.toBeNull()
  // Long content: the glyph caps below the content width and is centered, and it
  // uses the wide glyph variant rather than the flattened narrow one.
  expect(measure!.width).toBeLessThan(measure!.contentWidth)
  expect(Math.abs(measure!.centerError)).toBeLessThan(1)
  expect(measure!.viewBox).toMatch(/^0 0 23(64|39)/)
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
  // the overlay shows the full equation with the grey + (not just the first glyph)
  const overlay = page.locator('.insertion-preview')
  await expect(overlay).toContainText('1')
  await expect(overlay).toContainText('2')
  expect(await overlay.locator('span[style*="#9ca3af"]').count()).toBeGreaterThanOrEqual(1)
  // the real field is hidden while the preview is up
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.workspace-field')!).visibility))
    .toBe('hidden')
  // the preview is not clipped, so tall placeholders (e.g. integral/sum limits)
  // render at the same height as the final equation
  expect(await overlay.evaluate((el) => getComputedStyle(el).overflow)).not.toBe('hidden')

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
  await insertElement(page, 'Square root', 'Roots')
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
  await insertElement(page, 'Sum', 'Sums & Integrals')
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
  await insertElement(page, 'Square root', 'Roots')
  const textarea = page.locator('.latex-textarea')
  await expect(textarea).toHaveValue(/\\sqrt/, { timeout: 10000 })
  await page.waitForTimeout(50)
  await page.keyboard.type('x+1')
  await expect(textarea).toHaveValue(/\\sqrt\{x\+1\}/, { timeout: 10000 })

  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Backspace')
  }
  await expect(textarea).toHaveValue(/\\sqrt\{\}/, { timeout: 10000 })

  // the restored placeholder is focused: typing fills it
  await page.keyboard.type('z')
  await expect(textarea).toHaveValue(/\\sqrt\{z\}/, { timeout: 10000 })
})

test('backspace removes an element when only its placeholder remains', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await insertElement(page, 'Square root', 'Roots')
  const textarea = page.locator('.latex-textarea')
  await expect(textarea).toHaveValue(/\\sqrt/, { timeout: 10000 })
  await page.waitForTimeout(50)
  await page.keyboard.press('Backspace')
  await expect(textarea).toHaveValue('', { timeout: 10000 })
})

test('backspace removes a sum when only its placeholders remain', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await insertElement(page, 'Sum', 'Sums & Integrals')
  const textarea = page.locator('.latex-textarea')
  await expect(textarea).toHaveValue(/\\sum/, { timeout: 10000 })
  await page.waitForTimeout(50)
  await page.keyboard.press('Backspace')
  await expect(textarea).toHaveValue('', { timeout: 10000 })
})

test('backspace removes an integral when only its placeholders remain', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await insertElement(page, 'Integral', 'Sums & Integrals')
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
  await insertElement(page, 'Fraction', 'Fractions')
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
    expect(paper).toBe('rgba(0, 0, 0, 0)')

    const fieldBorder = await field.evaluate((el) => getComputedStyle(el).borderWidth)
    expect(fieldBorder).toBe('0px')
  })
})

test('drag hint does not shift the workspace layout', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  const measure = () =>
    page.evaluate(() => {
      const paper = document.querySelector('.workspace-paper')!
      const field = document.querySelector('math-field')!
      return {
        paperHeight: paper.getBoundingClientRect().height,
        fieldTop: field.getBoundingClientRect().top,
      }
    })
  const before = await measure()

  await page.evaluate(() => {
    document
      .querySelector('button[aria-label="Insert Plus"]')!
      .dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
    const ws = document.querySelector('.workspace')!
    const r = ws.getBoundingClientRect()
    ws.dispatchEvent(
      new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX: r.left + 100,
        clientY: r.top + 100,
        dataTransfer: new DataTransfer(),
      }),
    )
  })
  await expect(page.locator('.workspace-drop-hint')).toBeVisible()
  const during = await measure()
  expect(Math.abs(during.paperHeight - before.paperHeight)).toBeLessThan(1)
  expect(Math.abs(during.fieldTop - before.fieldTop)).toBeLessThan(1)

  await page.evaluate(() => {
    document
      .querySelector('button[aria-label="Insert Plus"]')!
      .dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
    document
      .querySelector('.workspace')!
      .dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true }))
  })
  await expect(page.locator('.workspace-drop-hint')).toHaveCount(0)
  const after = await measure()
  expect(Math.abs(after.paperHeight - before.paperHeight)).toBeLessThan(1)
  expect(Math.abs(after.fieldTop - before.fieldTop)).toBeLessThan(1)
})

test('backspace unwrapping a sum inside a root restores the root placeholder', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await insertElement(page, 'Square root', 'Roots')
  const textarea = page.locator('.latex-textarea')
  await expect(textarea).toHaveValue(/\\sqrt/, { timeout: 10000 })
  await insertElement(page, 'Sum', 'Sums & Integrals')
  await expect(textarea).toHaveValue(/\\sum/, { timeout: 10000 })
  await expect(page.locator('math-field')).toBeFocused()
  await page.keyboard.press('Backspace')
  await expect(textarea).toHaveValue(/\\sqrt\{\}/, { timeout: 10000 })

  // the restored placeholder is focused: typing fills it
  await page.keyboard.type('z')
  await expect(textarea).toHaveValue(/\\sqrt\{z\}/, { timeout: 10000 })
})

test('unwrapping a nested fraction restores the parent operator placeholder', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await insertElement(page, 'Sum', 'Sums & Integrals')
  const textarea = page.locator('.latex-textarea')
  await expect(textarea).toHaveValue(/\\sum/, { timeout: 10000 })
  await insertElement(page, 'Fraction', 'Fractions')
  await expect(textarea).toHaveValue(/\\frac/, { timeout: 10000 })
  await expect(page.locator('math-field')).toBeFocused()
  await page.keyboard.press('Backspace')
  await expect(textarea).toHaveValue(
    /\\sum_\{\}\^\{?\}?/,
    { timeout: 10000 },
  )
})

test('backspace after dropping a sum onto the root placeholder restores it', async ({ page, goto }) => {
  await goto('/', { waitUntil: 'hydration' })
  await insertElement(page, 'Square root', 'Roots')
  const textarea = page.locator('.latex-textarea')
  await expect(textarea).toHaveValue(/\\sqrt/, { timeout: 10000 })
  await page.waitForTimeout(100)

  const phBox = await page.locator('math-field').locator('text=▢').filter({ visible: true }).first().boundingBox()

  await page.evaluate(() => {
    document
      .querySelector('button[aria-label="Insert Sum"]')!
      .dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
  })
  await page.evaluate(
    ([x, y]) => {
      const dt = new DataTransfer()
      dt.setData('application/x-equation-element', 'sum')
      document
        .querySelector('.workspace')!
        .dispatchEvent(
          new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            dataTransfer: new DataTransfer(),
          }),
        )
      document
        .querySelector('.workspace')!
        .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }))
    },
    [phBox!.x + phBox!.width / 2, phBox!.y + phBox!.height / 2],
  )
  await expect(textarea).toHaveValue(/\\sqrt\{\\sum/, { timeout: 10000 })
  await expect(page.locator('math-field')).toBeFocused()

  await page.keyboard.press('Backspace')
  await expect(textarea).toHaveValue(/\\sqrt\{\}/, { timeout: 10000 })
})
