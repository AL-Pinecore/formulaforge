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

function setTauriFlag(value: unknown) {
  ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = value
}

describe('ExportPanel', () => {
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })

  it('defaults to SVG outside Tauri and disables other formats', async () => {
    const wrapper = await mount(ExportPanel, { props: { latex: 'x' } })
    expect(wrapper.find('button[data-format="svg"]').attributes('aria-checked')).toBe('true')
    expect(wrapper.find('button[data-format="png"]').attributes('disabled')).toBeDefined()
  })

  it('keeps the PNG default in Tauri with all formats enabled', async () => {
    setTauriFlag({})
    const wrapper = await mount(ExportPanel, { props: { latex: 'x' } })
    expect(wrapper.find('button[data-format="png"]').attributes('aria-checked')).toBe('true')
    expect(wrapper.find('button[data-format="pdf"]').attributes('disabled')).toBeUndefined()
  })

  it('arrow navigation never selects unsupported formats in the browser', async () => {
    const wrapper = await mount(ExportPanel, { props: { latex: 'x' } })
    const svg = wrapper.find('button[data-format="svg"]')
    await svg.trigger('keydown', { key: 'ArrowRight' })
    expect(svg.attributes('aria-checked')).toBe('true')
    expect(wrapper.find('button[data-format="png"]').attributes('aria-checked')).toBe('false')
  })

  it('arrow navigation wraps across supported formats in Tauri', async () => {
    setTauriFlag({})
    const wrapper = await mount(ExportPanel, { props: { latex: 'x' } })
    await wrapper.find('button[data-format="svg"]').trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.find('button[data-format="pdf"]').attributes('aria-checked')).toBe('true')
  })
})
