import type { ExportFormat, ExportRequestPayload, ExportSettings } from '~/types/export'

// The Rust command opens its own save dialog and only accepts the
// document payload; the frontend never sends filesystem paths.
export function buildExportPayload(
  settings: ExportSettings,
  svg: string,
): ExportRequestPayload {
  return {
    format: settings.format,
    svg,
    jpegQuality: settings.format === 'jpeg' ? settings.jpegQuality : undefined,
  }
}

export function effectiveExportSettings(settings: ExportSettings): ExportSettings {
  const clamp = (value: number, min: number, max: number, fallback: number) => {
    const finite = Number.isFinite(value) ? value : fallback
    return Math.min(max, Math.max(min, finite))
  }
  const effective: ExportSettings = {
    ...settings,
    padding: Math.round(clamp(settings.padding, 0, 200, 8)),
    scale: Math.round(clamp(settings.scale, 1, 3, 1)),
    jpegQuality: Math.round(clamp(settings.jpegQuality, 10, 100, 90)),
  }
  if (effective.format === 'jpeg' && !effective.background) {
    return { ...effective, background: '#ffffff' }
  }
  return effective
}

export const EXPORT_FORMAT_ORDER: ExportFormat[] = ['svg', 'png', 'jpeg', 'webp', 'pdf']
