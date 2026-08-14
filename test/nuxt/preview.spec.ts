import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import MathPreview from '~/components/MathPreview.vue'
import { renderEquationSvg } from '~/utils/svg-export'

vi.mock('~/utils/svg-export', () => ({
  renderEquationSvg: vi.fn(),
  stripXmlDeclaration: (svg: string) => svg,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const SVG_A = '<svg id="a"></svg>'
const SVG_B = '<svg id="b"></svg>'

function result(svg: string) {
  return { svg, width: 10, height: 10, hasErrors: false }
}

describe('MathPreview render ordering', () => {
  it('ignores stale renders that resolve after a newer one', async () => {
    const first = deferred<ReturnType<typeof result>>()
    const second = deferred<ReturnType<typeof result>>()
    vi.mocked(renderEquationSvg)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const wrapper = mount(MathPreview, {
      props: { latex: 'a', delay: 0 },
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await wrapper.setProps({ latex: 'b' })
    await new Promise((resolve) => setTimeout(resolve, 5))

    second.resolve(result(SVG_B))
    await new Promise((resolve) => setTimeout(resolve, 5))
    first.resolve(result(SVG_A))
    await new Promise((resolve) => setTimeout(resolve, 5))

    const html = wrapper.find('.math-preview-canvas').element.innerHTML
    expect(html).toContain('id="b"')
    expect(html).not.toContain('id="a"')
  })

  it('reports rendering attempts so consumers can reset error state', async () => {
    vi.mocked(renderEquationSvg).mockResolvedValue(result(SVG_A))
    const wrapper = mount(MathPreview, { props: { latex: 'a', delay: 0 } })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(wrapper.emitted('rendering')).toBeTruthy()
    expect(wrapper.emitted('ready')).toBeTruthy()
  })
})
