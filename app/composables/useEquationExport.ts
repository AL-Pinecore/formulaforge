import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { renderEquationSvg } from '~/utils/svg-export'
import { EXPORT_FORMAT_EXTENSIONS, EXPORT_FORMAT_LABELS } from '~/types/export'
import type { ExportFormat, ExportSettings } from '~/types/export'
import { buildExportPayload, effectiveExportSettings, EXPORT_FORMAT_ORDER } from '~/utils/export-payload'

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  // Tauri 2 sets both `window.isTauri` (a boolean flag) and
  // `window.__TAURI_INTERNALS__` (the IPC bridge).
  return (window as { isTauri?: boolean }).isTauri === true || '__TAURI_INTERNALS__' in window
}

function downloadBlob(contents: string, mime: string, filename: string) {
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

export function useEquationExport() {
  const exporting = ref(false)
  const lastError = ref<string | null>(null)
  const lastPath = ref<string | null>(null)

  async function exportEquation(latex: string, settings: ExportSettings): Promise<boolean> {
    lastError.value = null
    if (!latex.trim()) {
      lastError.value = 'The equation is empty.'
      return false
    }
    if (!isTauriRuntime() && settings.format !== 'svg') {
      lastError.value = 'Only SVG export is available in the browser. Use the desktop app for other formats.'
      return false
    }
    exporting.value = true
    try {
      const effective = effectiveExportSettings(settings)
      const rendered = await renderEquationSvg(latex, {
        display: effective.displayStyle,
        color: effective.color,
        background: effective.background,
        padding: effective.padding,
        scale: effective.scale,
      })
      const extension = EXPORT_FORMAT_EXTENSIONS[settings.format]

      if (isTauriRuntime()) {
        const savedPath = await invoke<string | null>('export_equation_approved', {
          request: buildExportPayload(effective, rendered.svg),
        })
        if (savedPath) {
          lastPath.value = savedPath
          return true
        }
        // The user cancelled the save dialog: not an error, but not a success either.
        return false
      }
      downloadBlob(rendered.svg, 'image/svg+xml', `equation.${extension}`)
      lastPath.value = `equation.${extension}`
      return true
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return false
    } finally {
      exporting.value = false
    }
  }

  return {
    exporting,
    lastError,
    lastPath,
    exportEquation,
    formatLabels: EXPORT_FORMAT_LABELS,
    formats: EXPORT_FORMAT_ORDER,
  }
}
