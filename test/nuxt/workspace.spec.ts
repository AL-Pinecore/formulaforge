import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import EquationWorkspace from '~/components/EquationWorkspace.vue'

describe('EquationWorkspace', () => {
  it('renders the paper surface and mathfield shell', () => {
    const wrapper = mount(EquationWorkspace, { props: { fontSize: 24 } })
    expect(wrapper.find('.workspace-paper').exists()).toBe(true)
    expect(wrapper.find('math-field').exists()).toBe(true)
  })

  it('reports an empty initial state when the custom element is not upgraded', () => {
    const wrapper = mount(EquationWorkspace, { props: { fontSize: 24 } })
    const emitted = wrapper.emitted('latex-change')
    expect(emitted).toBeUndefined()
  })

  it('does not crash when drop events arrive with payloads', async () => {
    const wrapper = mount(EquationWorkspace, { props: { fontSize: 24 } })
    const workspace = wrapper.find('.workspace')
    const event = { preventDefault: () => {}, dataTransfer: { types: ['text/plain'], getData: () => '\\alpha', files: [] } }
    await workspace.trigger('dragover', event)
    await workspace.trigger('drop', event)
    expect(wrapper.find('.workspace').exists()).toBe(true)
  })
})
