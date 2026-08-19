<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

interface ContextMenuItem {
  id: string
  label: string
  danger?: boolean
  disabled?: boolean
  dividerBefore?: boolean
}

const props = defineProps<{
  open: boolean
  x: number
  y: number
  items: ContextMenuItem[]
}>()

const emit = defineEmits<{
  close: []
  select: [id: string]
}>()

const menu = ref<HTMLDivElement | null>(null)
const position = ref({ left: 0, top: 0 })

function close() {
  emit('close')
}

async function place() {
  position.value = { left: props.x, top: props.y }
  await nextTick()
  const rect = menu.value?.getBoundingClientRect()
  if (!rect) return
  position.value = {
    left: Math.max(8, Math.min(props.x, window.innerWidth - rect.width - 8)),
    top: Math.max(8, Math.min(props.y, window.innerHeight - rect.height - 8)),
  }
  await nextTick()
  menu.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    close()
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const buttons = [...(menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
  if (buttons.length === 0) return
  event.preventDefault()
  const step = event.key === 'ArrowDown' ? 1 : -1
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const start = current < 0 ? (step > 0 ? -1 : 0) : current
  buttons[(start + step + buttons.length) % buttons.length]?.focus()
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      void place()
      document.addEventListener('pointerdown', close)
      window.addEventListener('blur', close)
      window.addEventListener('resize', close)
      window.addEventListener('keydown', onKeydown)
    } else {
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKeydown)
    }
  },
)

watch(
  () => [props.x, props.y],
  () => {
    if (props.open) void place()
  },
)

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', close)
  window.removeEventListener('blur', close)
  window.removeEventListener('resize', close)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="menu"
      class="context-menu"
      role="menu"
      :style="{ left: `${position.left}px`, top: `${position.top}px` }"
      @contextmenu.prevent
      @pointerdown.stop
    >
      <template v-for="item in items" :key="item.id">
        <div v-if="item.dividerBefore" class="context-menu-divider" role="separator"></div>
        <button
          type="button"
          role="menuitem"
          :class="{ 'context-menu-danger': item.danger }"
          :disabled="item.disabled"
          @click="emit('select', item.id); close()"
        >
          {{ item.label }}
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 1000;
  min-width: 190px;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--paper-bg);
  box-shadow: var(--paper-shadow);
}

button {
  display: block;
  width: 100%;
  padding: 7px 9px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

button:hover:not(:disabled),
button:focus-visible {
  outline: none;
  background: var(--hover-bg);
}

button:disabled {
  opacity: 0.4;
  cursor: default;
}

.context-menu-danger {
  color: var(--danger);
}

.context-menu-divider {
  height: 1px;
  margin: 4px;
  background: var(--border);
}
</style>
