import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import EquationWorkspace from '~/components/EquationWorkspace.vue'

describe('EquationWorkspace IME blocking', () => {
  it('cancels composition start so IME text never enters the field', async () => {
    const wrapper = mount(EquationWorkspace, { props: { fontSize: 24 } })
    const field = wrapper.find('math-field').element

    const event = new Event('compositionstart', { bubbles: true, cancelable: true })
    field.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.emitted('latex-change')).toBeUndefined()
  })

  it('blocks insertCompositionText beforeinput events', async () => {
    const wrapper = mount(EquationWorkspace, { props: { fontSize: 24 } })
    const field = wrapper.find('math-field').element

    const event = new Event('beforeinput', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'inputType', { value: 'insertCompositionText' })
    field.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  it('blocks beforeinput carrying non-ASCII text', async () => {
    const wrapper = mount(EquationWorkspace, { props: { fontSize: 24 } })
    const field = wrapper.find('math-field').element

    const event = new Event('beforeinput', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'inputType', { value: 'insertText' })
    Object.defineProperty(event, 'data', { value: '你好' })
    field.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves non-composition beforeinput events alone', async () => {
    const wrapper = mount(EquationWorkspace, { props: { fontSize: 24 } })
    const field = wrapper.find('math-field').element

    const event = new Event('beforeinput', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'inputType', { value: 'insertText' })
    Object.defineProperty(event, 'data', { value: 'a' })
    field.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })

  it('declares latin-only input hints on the field', () => {
    const wrapper = mount(EquationWorkspace, { props: { fontSize: 24 } })
    const field = wrapper.find('math-field')

    expect(field.attributes('inputmode')).toBe('latin')
    expect(field.attributes('lang')).toBe('en')
    expect(field.attributes('autocapitalize')).toBe('none')
    expect(field.attributes('autocorrect')).toBe('off')
    expect(field.attributes('spellcheck')).toBe('false')
  })
})
