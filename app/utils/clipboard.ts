export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      textarea.remove()
    }
  }
}

export function wrapInlineMath(latex: string): string {
  return `$${latex}$`
}

export function downloadTextFile(contents: string, filename: string, mime: string) {
  const blob = new Blob([contents], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function wrapDisplayMath(latex: string): string {
  return `\\[${latex}\\]`
}

export function wrapStandaloneDocument(latex: string): string {
  return [
    '\\documentclass[12pt]{article}',
    '\\usepackage{amsmath,amssymb}',
    '\\begin{document}',
    `\\[${latex}\\]`,
    '\\end{document}',
    '',
  ].join('\n')
}
