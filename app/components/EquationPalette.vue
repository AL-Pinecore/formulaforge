<script setup lang="ts">
import { computed, ref } from 'vue'
import { ELEMENT_CATEGORY_LABELS, ELEMENT_CATEGORY_ORDER } from '~/types/equation'
import type { ElementCategory, EquationElement } from '~/types/equation'
import { EQUATION_ELEMENTS } from '~/data/equation-elements'
import { DRAG_ELEMENT_MIME, draggedElementId } from '~/utils/drag-payload'

const emit = defineEmits<{ insert: [element: EquationElement] }>()

const search = ref('')

const filtered = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) {
    return EQUATION_ELEMENTS
  }
  return EQUATION_ELEMENTS.filter((element) => {
    const haystack = [element.label, element.id, element.category, ...element.keywords]
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
      <label class="sr-only" for="palette-search">Search equation elements</label>
      <input
        id="palette-search"
        v-model="search"
        type="search"
        placeholder="Search symbols…"
        autocomplete="off"
        spellcheck="false"
      />
    </div>
    <div class="palette-scroll">
      <section v-for="[category, items] in grouped" :key="category" class="palette-section">
        <h2 class="palette-heading">{{ ELEMENT_CATEGORY_LABELS[category] }}</h2>
        <ul class="palette-grid">
          <li v-for="element in items" :key="element.id">
            <button
              type="button"
              class="palette-item"
              draggable="true"
              :title="`${element.label} — click or drag into the equation`"
              :aria-label="`Insert ${element.label}`"
              @dragstart="onDragStart($event, element)"
              @dragend="onDragEnd"
              @click="emit('insert', element)"
            >
              <MathChip :latex="element.display" />
            </button>
          </li>
        </ul>
      </section>
      <p v-if="grouped.length === 0" class="palette-empty">No matching elements.</p>
    </div>
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
  margin: 0 0 6px 2px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
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
</style>
