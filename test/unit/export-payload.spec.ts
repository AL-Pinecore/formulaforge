import { describe, expect, it } from 'vitest'
import { buildExportPayload, effectiveExportSettings } from '../../app/utils/export-payload'
import { DEFAULT_EXPORT_SETTINGS } from '../../app/types/export'
import type { ExportSettings } from '../../app/types/export'

describe('buildExportPayload', () => {
  it('builds a camelCase payload for the Rust command', () => {
    const payload = buildExportPayload(DEFAULT_EXPORT_SETTINGS, '<svg/>')
    expect(payload).toEqual({
      format: 'png',
      svg: '<svg/>',
      jpegQuality: undefined,
    })
  })

  it('includes jpeg quality only for jpeg', () => {
    const jpegSettings: ExportSettings = { ...DEFAULT_EXPORT_SETTINGS, format: 'jpeg', jpegQuality: 55 }
    expect(buildExportPayload(jpegSettings, '<svg/>').jpegQuality).toBe(55)
  })
})

describe('effectiveExportSettings', () => {
  it('forces a white background for jpeg', () => {
    const jpegSettings: ExportSettings = { ...DEFAULT_EXPORT_SETTINGS, format: 'jpeg', background: null }
    expect(effectiveExportSettings(jpegSettings).background).toBe('#ffffff')
  })

  it('keeps transparent background for png and webp', () => {
    const pngSettings: ExportSettings = { ...DEFAULT_EXPORT_SETTINGS, format: 'png', background: null }
    expect(effectiveExportSettings(pngSettings).background).toBeNull()
  })

  it('clamps padding, scale and quality to sane ranges', () => {
    const settings: ExportSettings = {
      ...DEFAULT_EXPORT_SETTINGS,
      padding: 500,
      scale: 9,
      jpegQuality: 250,
    }
    const effective = effectiveExportSettings(settings)
    expect(effective.padding).toBe(200)
    expect(effective.scale).toBe(3)
    expect(effective.jpegQuality).toBe(100)
  })

  it('falls back to defaults when numeric inputs are NaN', () => {
    const settings: ExportSettings = {
      ...DEFAULT_EXPORT_SETTINGS,
      padding: Number.NaN,
      scale: Number.NaN,
      jpegQuality: Number.NaN,
    }
    const effective = effectiveExportSettings(settings)
    expect(effective.padding).toBe(DEFAULT_EXPORT_SETTINGS.padding)
    expect(effective.scale).toBe(DEFAULT_EXPORT_SETTINGS.scale)
    expect(effective.jpegQuality).toBe(DEFAULT_EXPORT_SETTINGS.jpegQuality)
  })
})
