export type ExportFormat = 'svg' | 'png' | 'jpeg' | 'webp' | 'pdf'

export interface ExportSettings {
  format: ExportFormat
  color: string
  background: string | null
  padding: number
  scale: number
  jpegQuality: number
  displayStyle: boolean
}

export interface ExportRequestPayload {
  format: ExportFormat
  svg: string
  jpegQuality?: number
}

export interface SvgRenderResult {
  svg: string
  width: number
  height: number
  hasErrors: boolean
}

export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  svg: 'SVG',
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WebP',
  pdf: 'PDF',
}

export const EXPORT_FORMAT_EXTENSIONS: Record<ExportFormat, string> = {
  svg: 'svg',
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
  pdf: 'pdf',
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: 'png',
  color: '#1a1a1a',
  background: null,
  padding: 8,
  scale: 1,
  jpegQuality: 90,
  displayStyle: true,
}
