import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const LATEX =
  'f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} \\sum_{n=0}^{\\infty} ' +
  '\\int_{-\\infty}^{\\infty} \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix} e^{-\\frac{x^2}{2}}\\,dx'

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.log('[page error]', msg.text())
    }
  })
  page.on('response', (response) => {
    if (response.status() >= 400) {
      console.log(`[http ${response.status()}]`, response.url())
    }
  })
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(2500)
  const textarea = page.locator('.latex-textarea')
  await textarea.fill(LATEX)
  await textarea.blur()
  const preview = page.locator('.math-preview-canvas svg')
  await preview.first().waitFor({ state: 'visible', timeout: 20000 })
  const svg = await preview.first().evaluate((el) => el.outerHTML)
  const merror = await page.locator('.math-preview-canvas svg [data-mml-node="merror"]').count()
  console.log(`[fixture] svg length=${svg.length} merror=${merror}`)
  const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src-tauri/tests/fixtures')
  await mkdir(outDir, { recursive: true })
  await writeFile(path.join(outDir, 'mathjax-eq.svg'), svg)
  console.log(`[fixture] written to ${outDir}/mathjax-eq.svg`)
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
