import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import EquationPalette from '~/components/EquationPalette.vue'
import { EQUATION_ELEMENTS } from '~/data/equation-elements'

vi.mock('mathlive', () => ({
  convertLatexToMarkup: (latex: string) => `<span class="test-latex">${latex}</span>`,
}))

describe('EquationPalette', () => {
  it('renders category sections', () => {
    const wrapper = mount(EquationPalette)
    expect(wrapper.findAll('section.palette-section').length).toBeGreaterThan(5)
    expect(wrapper.findAll('button.palette-item').length).toBeGreaterThan(50)
  })

  it('emits the element on click', async () => {
    const wrapper = mount(EquationPalette)
    const first = wrapper.find('button.palette-item')
    await first.trigger('click')
    const emitted = wrapper.emitted('insert')
    expect(emitted).toHaveLength(1)
    const element = emitted![0]![0] as { id: string; latex: string }
    expect(element).toHaveProperty('id')
    expect(element).toHaveProperty('latex')
    expect(element.latex.length).toBeGreaterThan(0)
  })

  it('filters elements by search', async () => {
    const wrapper = mount(EquationPalette)
    await wrapper.find('#palette-search').setValue('fraction')
    const items = wrapper.findAll('button.palette-item')
    const expected = EQUATION_ELEMENTS.filter((element) =>
      [element.label, element.id, element.category, ...element.keywords]
        .join(' ')
        .toLowerCase()
        .includes('fraction'),
    )
    expect(items.length).toBe(expected.length)
    expect(items.length).toBeGreaterThan(0)
  })

  it('shows an empty state when nothing matches', async () => {
    const wrapper = mount(EquationPalette)
    await wrapper.find('#palette-search').setValue('zzzz-no-match-zzzz')
    expect(wrapper.find('.palette-empty').exists()).toBe(true)
  })

  it('collapses categories by default and toggles independently', async () => {
    const wrapper = mount(EquationPalette)
    const headings = wrapper.findAll('button.palette-heading')
    const grids = wrapper.findAll('ul.palette-grid')
    const isHidden = (grid: ReturnType<typeof wrapper.find>) =>
      (grid.attributes('style') ?? '').includes('display: none')
    expect(headings.length).toBeGreaterThan(5)
    expect(grids.length).toBe(headings.length)
    // all grids are collapsed (hidden) by default, but still in the DOM
    expect(grids.every((grid) => isHidden(grid))).toBe(true)
    expect(grids[0]!.exists()).toBe(true)

    await headings[0]!.trigger('click')
    expect(isHidden(grids[0]!)).toBe(false)
    // other categories stay collapsed (independent toggles)
    expect(isHidden(grids[1]!)).toBe(true)

    await headings[0]!.trigger('click')
    expect(isHidden(grids[0]!)).toBe(true)
  })

  it('auto-expands matching categories while searching', async () => {
    const wrapper = mount(EquationPalette)
    await wrapper.find('#palette-search').setValue('sqrt')
    const visibleGrids = wrapper
      .findAll('ul.palette-grid')
      .filter((grid) => !(grid.attributes('style') ?? '').includes('display: none'))
    expect(visibleGrids.length).toBeGreaterThan(0)
  })

  it('marks chips as draggable', () => {
    const wrapper = mount(EquationPalette)
    expect(wrapper.find('button.palette-item').attributes('draggable')).toBe('true')
  })
})
