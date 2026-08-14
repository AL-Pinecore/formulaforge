import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { useEquationExport } from '~/composables/useEquationExport'
import { DEFAULT_EXPORT_SETTINGS } from '~/types/export'
import type { ExportSettings } from '~/types/export'

const MOCK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('~/utils/svg-export', () => ({
  renderEquationSvg: vi.fn(async () => ({
    svg: MOCK_SVG,
    width: 10,
    height: 10,
    hasErrors: false,
  })),
}))

function tauriSettings(): ExportSettings {
  return { ...DEFAULT_EXPORT_SETTINGS, format: 'png' }
}

function setTauriFlag(value: unknown) {
  ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = value
}

describe('useEquationExport native flow', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })

  it('invokes the approved command with a nested request payload', async () => {
    setTauriFlag({})
    vi.mocked(invoke).mockResolvedValue('/tmp/equation.png')
    const { exportEquation, lastPath } = useEquationExport()
    const ok = await exportEquation('x+1', tauriSettings())
    expect(ok).toBe(true)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('export_equation_approved', {
      request: {
        format: 'png',
        svg: MOCK_SVG,
        jpegQuality: undefined,
      },
    })
    expect(lastPath.value).toBe('/tmp/equation.png')
  })

  it('sends jpeg quality inside the request for jpeg exports', async () => {
    setTauriFlag({})
    vi.mocked(invoke).mockResolvedValue('/tmp/equation.jpg')
    const { exportEquation } = useEquationExport()
    const settings: ExportSettings = {
      ...DEFAULT_EXPORT_SETTINGS,
      format: 'jpeg',
      jpegQuality: 42,
      background: null,
    }
    await exportEquation('x', settings)
    expect(invoke).toHaveBeenCalledWith('export_equation_approved', {
      request: {
        format: 'jpeg',
        svg: MOCK_SVG,
        jpegQuality: 42,
      },
    })
  })

  it('treats a cancelled save dialog as a non-success without an error', async () => {
    setTauriFlag({})
    vi.mocked(invoke).mockResolvedValue(null)
    const { exportEquation, lastError, lastPath } = useEquationExport()
    const ok = await exportEquation('x+1', tauriSettings())
    expect(ok).toBe(false)
    expect(lastError.value).toBeNull()
    expect(lastPath.value).toBeNull()
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('rejects non-SVG formats outside Tauri', async () => {
    const { exportEquation, lastError } = useEquationExport()
    const ok = await exportEquation('x+1', tauriSettings())
    expect(ok).toBe(false)
    expect(lastError.value).toContain('Only SVG export is available in the browser')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('downloads real SVG bytes in the browser', async () => {
    const { exportEquation, lastPath } = useEquationExport()
    const ok = await exportEquation('x+1', { ...DEFAULT_EXPORT_SETTINGS, format: 'svg' })
    expect(ok).toBe(true)
    expect(lastPath.value).toBe('equation.svg')
    expect(invoke).not.toHaveBeenCalled()
  })
})
