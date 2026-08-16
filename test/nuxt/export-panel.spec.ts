import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ExportPanel from '~/components/ExportPanel.vue'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('~/utils/svg-export', () => ({
  renderEquationSvg: vi.fn(async () => ({
    svg: '<svg></svg>',
    width: 10,
    height: 10,
    hasErrors: false,
  })),
  stripXmlDeclaration: (svg: string) => svg,
}))

vi.mock('~/utils/browser-export', () => ({
  svgToRasterBlob: vi.fn(async () => new Blob(['raster'], { type: 'image/png' })),
  svgToPdfBlob: vi.fn(async () => new Blob(['pdf'], { type: 'application/pdf' })),
}))

describe('ExportPanel', () => {
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })

  it('defaults to PNG with all formats enabled', async () => {
    const wrapper = await mount(ExportPanel, { props: { latex: 'x' } })
    expect(wrapper.find('button[data-format="png"]').attributes('aria-checked')).toBe('true')
    expect(wrapper.find('button[data-format="pdf"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('button[data-format="jpeg"]').attributes('disabled')).toBeUndefined()
  })

  it('arrow navigation moves to the next format', async () => {
    const wrapper = await mount(ExportPanel, { props: { latex: 'x' } })
    const svg = wrapper.find('button[data-format="svg"]')
    await svg.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.find('button[data-format="png"]').attributes('aria-checked')).toBe('true')
  })

  it('arrow navigation wraps across formats', async () => {
    const wrapper = await mount(ExportPanel, { props: { latex: 'x' } })
    await wrapper.find('button[data-format="svg"]').trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.find('button[data-format="pdf"]').attributes('aria-checked')).toBe('true')
  })
})
