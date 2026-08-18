import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import EquationWorkspace from '~/components/EquationWorkspace.vue'

class FakeMathField extends HTMLElement {
  value = ''
  placeholder = ''
  mathVirtualKeyboardPolicy = 'auto'
  defaultMode = 'math'
  inserted: string[] = []
  private listeners = new Map<string, EventListener>()

  private fakeShadow = {
    addEventListener: (type: string, listener: EventListener) => {
      this.listeners.set(type, listener)
    },
  }

  override get shadowRoot() {
    return this.fakeShadow as unknown as ShadowRoot
  }

  getValue() {
    return this.value
  }

  setValue(next: string) {
    this.value = next
  }

  canUndo() {
    return false
  }

  canRedo() {
    return false
  }

  insert(text: string) {
    this.inserted.push(text)
  }

  dispatchShadow(type: string, event: Event) {
    this.listeners.get(type)?.(event)
  }
}

function blockedEventSpies() {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  } as unknown as Event
}

describe('EquationWorkspace IME blocking (shadow root)', () => {
  beforeAll(() => {
    if (!customElements.get('math-field')) {
      customElements.define('math-field', FakeMathField)
    }
  })

  async function mountConfigured(props: Record<string, unknown> = {}) {
    const wrapper = mount(EquationWorkspace, { props: { fontSize: 24, ...props } })
    await vi.waitFor(() => {
      expect(wrapper.emitted('latex-change')).toBeTruthy()
    })
    return wrapper
  }

  it('blocks composition inside MathLive\'s shadow root', async () => {
    const wrapper = await mountConfigured()
    const field = wrapper.find('math-field').element as FakeMathField
    const event = blockedEventSpies()

    field.dispatchShadow('compositionstart', event)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
    expect(event.stopImmediatePropagation).toHaveBeenCalled()
  })

  it('blocks non-ASCII input events inside the shadow root', async () => {
    const wrapper = await mountConfigured()
    const field = wrapper.find('math-field').element as FakeMathField
    const event = blockedEventSpies()
    Object.defineProperty(event, 'data', { value: '你好' })

    field.dispatchShadow('input', event)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
  })

  it('recovers latin letters typed during IME composition', async () => {
    const wrapper = await mountConfigured()
    const field = wrapper.find('math-field')

    await field.trigger('keydown', { key: 'n', code: 'KeyN', keyCode: 229 })

    const fake = field.element as FakeMathField
    expect(fake.inserted).toContain('n')
  })

  it('sets the mathfield default mode from the displayStyle prop', async () => {
    const inline = await mountConfigured({ displayStyle: false })
    expect((inline.find('math-field').element as FakeMathField).defaultMode).toBe('inline-math')

    const display = await mountConfigured({ displayStyle: true })
    expect((display.find('math-field').element as FakeMathField).defaultMode).toBe('math')
  })
})
