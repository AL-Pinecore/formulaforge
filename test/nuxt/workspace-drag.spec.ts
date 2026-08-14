import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import EquationWorkspace from '~/components/EquationWorkspace.vue'
import { DRAG_ELEMENT_MIME, draggedElementId } from '~/utils/drag-payload'

vi.mock('~/utils/svg-export', () => ({
  renderEquationSvg: vi.fn(async () => ({
    svg: '<svg id="preview"></svg>',
    width: 10,
    height: 10,
    hasErrors: false,
  })),
  stripXmlDeclaration: (svg: string) => svg,
}))

class FakeMathField extends HTMLElement {
  inserted: { latex: string; options: Record<string, unknown> }[] = []
  stylesApplied: { style: Record<string, unknown>; range: unknown }[] = []
  value = ''
  errors: unknown[] = []
  position = 0
  lastOffset = 0
  focused = false
  readOnly = false
  mathVirtualKeyboardPolicy = 'manual'
  selection: { ranges: [number, number][] } = { ranges: [[0, 0]] }
  selectionIsCollapsed = true

  canUndo() {
    return false
  }

  canRedo() {
    return false
  }

  hasFocus() {
    return this.focused
  }

  override focus() {
    this.focused = true
  }

  getOffsetFromPoint() {
    return 0
  }

  insert(latex: string, options?: Record<string, unknown>) {
    this.inserted.push({ latex, options: options ?? {} })
    const start = this.value.length
    this.value += latex
    if (options?.selectionMode === 'item') {
      this.selection = { ranges: [[start, start + latex.length]] }
      this.selectionIsCollapsed = false
    }
  }

  setValue(value: string) {
    this.value = value
  }

  applyStyle(style: Record<string, unknown>, options?: Record<string, unknown>) {
    this.stylesApplied.push({ style, range: options?.range })
  }

  executeCommand() {}
}

function dragEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    preventDefault: () => {},
    clientX: 12,
    clientY: 34,
    relatedTarget: null,
    dataTransfer: {
      types: [] as string[],
      files: [] as File[],
      dropEffect: 'none',
      getData: () => '',
    },
    ...overrides,
  }
}

function dataTransferWith(getData: (type: string) => string, types: string[]) {
  return { types, files: [], getData }
}

describe('EquationWorkspace drag and drop', () => {
  beforeAll(() => {
    if (!customElements.get('math-field')) {
      customElements.define('math-field', FakeMathField)
    }
  })

  it('shows an insertion preview while dragging and hides it on drop', async () => {
    const wrapper = mount(EquationWorkspace, { props: { fontSize: 24 } })
    const workspace = wrapper.find('.workspace')
    draggedElementId.value = 'frac'
    await new Promise((resolve) => setTimeout(resolve, 20))

    await workspace.trigger(
      'dragover',
      dragEvent({ dataTransfer: dataTransferWith(() => '', [DRAG_ELEMENT_MIME]) }),
    )
    await new Promise((resolve) => setTimeout(resolve, 100))

    const preview = wrapper.find('.insertion-preview')
    expect(preview.exists()).toBe(true)
    expect(preview.html()).toContain('<svg')

    // the inserted element is greyed via applyStyle on the offscreen mirror
    const mirror = document.querySelector('math-field') as unknown as FakeMathField
    expect(mirror.value).toContain('\\frac')
    expect(mirror.stylesApplied.length).toBeGreaterThan(0)

    await workspace.trigger(
      'drop',
      dragEvent({ dataTransfer: dataTransferWith(() => '', [DRAG_ELEMENT_MIME]) }),
    )
    expect(wrapper.find('.insertion-preview').exists()).toBe(false)
    expect(draggedElementId.value).toBeNull()
    wrapper.unmount()
  })

  it('does not steal focus from an unfocused mathfield during dragover', async () => {
    const wrapper = mount(EquationWorkspace, { props: { fontSize: 24 } })
    const field = wrapper.find('math-field').element as unknown as FakeMathField
    draggedElementId.value = 'frac'

    await wrapper.find('.workspace').trigger('dragover', dragEvent())
    expect(field.focused).toBe(false)
    draggedElementId.value = null
  })

  it('inserts the palette element latex with placeholder focus options', async () => {
    const wrapper = mount(EquationWorkspace, { props: { fontSize: 24 } })
    const field = wrapper.find('math-field').element as unknown as FakeMathField
    draggedElementId.value = 'frac'

    await wrapper.find('.workspace').trigger(
      'drop',
      dragEvent({
        dataTransfer: dataTransferWith(
          (type) => (type === DRAG_ELEMENT_MIME ? 'frac' : ''),
          [DRAG_ELEMENT_MIME],
        ),
      }),
    )
    await vi.waitFor(() => expect(field.inserted.length).toBeGreaterThan(0))
    expect(field.inserted[0]!.latex).toContain('\\frac')
    expect(field.inserted[0]!.options).toMatchObject({
      selectionMode: 'placeholder',
      focus: true,
      scrollIntoView: true,
    })
  })

  it('ignores a stale draggedElementId when dropping plain text', async () => {
    const wrapper = mount(EquationWorkspace, { props: { fontSize: 24 } })
    const field = wrapper.find('math-field').element as unknown as FakeMathField
    draggedElementId.value = 'frac'

    await wrapper.find('.workspace').trigger(
      'drop',
      dragEvent({
        dataTransfer: dataTransferWith(
          (type) => (type === 'text/plain' ? 'x+1' : ''),
          ['text/plain'],
        ),
      }),
    )
    await vi.waitFor(() => expect(field.inserted.length).toBeGreaterThan(0))
    expect(field.inserted[0]!.latex).toBe('x+1')
    expect(field.inserted[0]!.latex).not.toContain('\\frac')
    expect(draggedElementId.value).toBeNull()
  })

  it('rejects non-text file drops without changing the equation', async () => {
    const wrapper = mount(EquationWorkspace, { props: { fontSize: 24 } })
    const field = wrapper.find('math-field').element as unknown as FakeMathField
    const file = new File(['binary'], 'image.png', { type: 'image/png' })

    await wrapper.find('.workspace').trigger(
      'drop',
      dragEvent({ dataTransfer: { types: ['Files'], files: [file], getData: () => '' } }),
    )
    const toast = wrapper.emitted('toast')
    expect(toast).toBeTruthy()
    expect((toast![0] as unknown[])[0]).toContain('Only text files')
    expect(field.value).toBe('')
    wrapper.unmount()
  })
})
