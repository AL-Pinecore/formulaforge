<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { ELEMENT_CATEGORY_LABELS, ELEMENT_CATEGORY_ORDER } from '~/types/equation'
import type { ElementCategory, EquationElement } from '~/types/equation'
import { EQUATION_ELEMENTS } from '~/data/equation-elements'
import { DRAG_ELEMENT_MIME, draggedElementId } from '~/utils/drag-payload'
import { useI18n } from '~/composables/useI18n'

const emit = defineEmits<{ insert: [element: EquationElement] }>()

const { t } = useI18n()

const search = ref('')

const collapsed = ref<Set<ElementCategory>>(new Set(ELEMENT_CATEGORY_ORDER))

function elementLabel(element: EquationElement): string {
  const key = `element.${element.id.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())}`
  return t(key, undefined, element.label)
}

const TOOLTIP_DELAY_MS = 600
const TOOLTIP_MARGIN = 8
const TOOLTIP_GAP = 6

const tooltip = ref<{ text: string } | null>(null)
const tooltipEl = ref<HTMLElement | null>(null)
let tooltipTimer: ReturnType<typeof setTimeout> | null = null
let tooltipAnchor: { left: number; right: number; top: number; bottom: number } | null = null

function clearTooltip() {
  if (tooltipTimer) {
    clearTimeout(tooltipTimer)
    tooltipTimer = null
  }
  tooltip.value = null
  tooltipAnchor = null
}

function positionTooltip() {
  const el = tooltipEl.value
  if (!el || !tooltipAnchor) {
    return
  }
  const width = el.offsetWidth
  const height = el.offsetHeight
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const center = (tooltipAnchor.left + tooltipAnchor.right) / 2

  let left = center - width / 2
  left = Math.max(TOOLTIP_MARGIN, Math.min(left, viewportWidth - width - TOOLTIP_MARGIN))

  let top = tooltipAnchor.bottom + TOOLTIP_GAP
  if (top + height + TOOLTIP_MARGIN > viewportHeight) {
    top = tooltipAnchor.top - height - TOOLTIP_GAP
  }
  top = Math.max(TOOLTIP_MARGIN, top)

  el.style.left = `${left}px`
  el.style.top = `${top}px`
}

function onItemEnter(event: MouseEvent, element: EquationElement) {
  clearTooltip()
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const text = elementLabel(element)
  tooltipAnchor = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
  tooltipTimer = setTimeout(() => {
    tooltip.value = { text }
    void nextTick(positionTooltip)
  }, TOOLTIP_DELAY_MS)
}

function onItemLeave() {
  clearTooltip()
}

onBeforeUnmount(() => {
  clearTooltip()
})

function isOpen(category: ElementCategory): boolean {
  return search.value.trim() !== '' || !collapsed.value.has(category)
}

function toggle(category: ElementCategory) {
  const next = new Set(collapsed.value)
  if (next.has(category)) {
    next.delete(category)
  } else {
    next.add(category)
  }
  collapsed.value = next
}

const filtered = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) {
    return EQUATION_ELEMENTS
  }
  return EQUATION_ELEMENTS.filter((element) => {
    const haystack = [
      elementLabel(element),
      element.label,
      element.id,
      t(ELEMENT_CATEGORY_LABELS[element.category]),
      element.category,
      ...element.keywords,
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(query)
  })
})

const grouped = computed(() => {
  const map = new Map<ElementCategory, EquationElement[]>()
  for (const category of ELEMENT_CATEGORY_ORDER) {
    map.set(category, [])
  }
  for (const element of filtered.value) {
    map.get(element.category)!.push(element)
  }
  return [...map.entries()].filter(([, items]) => items.length > 0)
})

function onDragStart(event: DragEvent, element: EquationElement) {
  clearTooltip()
  draggedElementId.value = element.id
  if (event.dataTransfer) {
    event.dataTransfer.setData(DRAG_ELEMENT_MIME, element.id)
    event.dataTransfer.setData('text/plain', element.latex)
    event.dataTransfer.effectAllowed = 'copy'
    // Hide the default drag image; the workspace shows an insertion preview
    // instead. Never let this abort the drag (WebKit throws if the image
    // element is not connected to the document).
    try {
      event.dataTransfer.setDragImage(transparentDragImage(), 0, 0)
    } catch {
      // Fall back to the default drag image.
    }
  }
}

let dragImage: HTMLCanvasElement | null = null

function transparentDragImage(): HTMLCanvasElement {
  if (!dragImage) {
    dragImage = document.createElement('canvas')
    dragImage.width = 1
    dragImage.height = 1
    // setDragImage requires the element to be in the document in WebKit.
    dragImage.style.position = 'fixed'
    dragImage.style.left = '-9999px'
    dragImage.style.top = '0'
    dragImage.style.pointerEvents = 'none'
    document.body.appendChild(dragImage)
  }
  return dragImage
}

function onDragEnd() {
  draggedElementId.value = null
}
</script>

<template>
  <aside class="palette">
    <div class="palette-search">
      <label class="sr-only" for="palette-search">{{ t('palette.searchLabel') }}</label>
      <input
        id="palette-search"
        v-model="search"
        type="search"
        :placeholder="t('palette.search')"
        autocomplete="off"
        spellcheck="false"
      />
    </div>
    <div class="palette-scroll" @scroll="clearTooltip">
      <section v-for="[category, items] in grouped" :key="category" class="palette-section">
        <button
          type="button"
          class="palette-heading"
          :aria-expanded="isOpen(category)"
          @click="toggle(category)"
        >
          <span class="palette-chevron" :class="{ 'palette-chevron-open': isOpen(category) }" aria-hidden="true"></span>
          <span>{{ t(ELEMENT_CATEGORY_LABELS[category]) }}</span>
        </button>
        <ul v-show="isOpen(category)" class="palette-grid">
          <li v-for="element in items" :key="element.id">
            <button
              type="button"
              class="palette-item"
              draggable="true"
              :aria-label="t('palette.insert', { label: elementLabel(element) })"
              @mouseenter="onItemEnter($event, element)"
              @mouseleave="onItemLeave"
              @dragstart="onDragStart($event, element)"
              @dragend="onDragEnd"
              @click="emit('insert', element)"
            >
              <MathChip :latex="element.display" />
            </button>
          </li>
        </ul>
      </section>
      <p v-if="grouped.length === 0" class="palette-empty">{{ t('palette.empty') }}</p>
    </div>
    <Transition name="tooltip">
      <div
        v-if="tooltip"
        ref="tooltipEl"
        class="palette-tooltip"
        role="tooltip"
      >
        {{ tooltip.text }}
      </div>
    </Transition>
  </aside>
</template>

<style scoped>
.palette {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--panel-bg);
  border-right: 1px solid var(--border);
}

.palette-search {
  padding: 10px;
  border-bottom: 1px solid var(--border);
}

.palette-search input {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--input-bg);
  color: var(--text);
  font-size: 13px;
}

.palette-search input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.palette-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 10px 24px;
}

@media (max-width: 940px) {
  .palette-scroll {
    max-height: 45vh;
  }
}

.palette-section {
  margin-top: 12px;
}

.palette-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  margin: 0 0 6px 2px;
  padding: 4px 2px;
  border: none;
  background: transparent;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
  cursor: pointer;
  text-align: left;
}

.palette-heading:hover {
  color: var(--text);
}

.palette-heading:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.palette-chevron {
  flex: none;
  width: 0;
  height: 0;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 5px solid currentColor;
  transition: transform 120ms ease;
}

.palette-chevron-open {
  transform: rotate(90deg);
}

.palette-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.palette-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 44px;
  padding: 2px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  cursor: grab;
  overflow: hidden;
}

.palette-item:hover {
  background: var(--hover-bg);
  border-color: var(--border);
}

.palette-item:active {
  cursor: grabbing;
}

.palette-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.palette-empty {
  padding: 16px 4px;
  font-size: 13px;
  color: var(--text-muted);
}

.palette-tooltip {
  position: fixed;
  z-index: 100;
  max-width: 320px;
  padding: 5px 9px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--input-bg);
  color: var(--text);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
  text-align: center;
  pointer-events: none;
  box-shadow: 0 4px 12px rgb(0 0 0 / 25%);
}

.tooltip-enter-active,
.tooltip-leave-active {
  transition: opacity 120ms ease;
}

.tooltip-enter-from,
.tooltip-leave-to {
  opacity: 0;
}
</style>
