<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'

const props = defineProps<{ latex: string }>()

const markup = ref('')
const scale = ref(1)
const innerEl = ref<HTMLSpanElement | null>(null)

const MAX_WIDTH = 44
const MAX_HEIGHT = 38

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

async function render() {
  try {
    const module = await import('mathlive')
    const convert = (module as { convertLatexToMarkup?: (latex: string, options?: Record<string, unknown>) => string })
      .convertLatexToMarkup
    markup.value =
      typeof convert === 'function'
        ? convert(props.latex, { letterShapeStyle: 'tex' })
        : escapeHtml(props.latex)
  } catch {
    markup.value = escapeHtml(props.latex)
  }
  await nextTick()
  fitToBox()
}

function fitToBox() {
  const el = innerEl.value
  if (!el) {
    return
  }
  const width = el.scrollWidth
  const height = el.scrollHeight
  if (width <= 0 || height <= 0) {
    return
  }
  scale.value = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height)
}

onMounted(() => {
  void render()
})

watch(
  () => props.latex,
  () => void render(),
)
</script>

<template>
  <span class="math-chip" aria-hidden="true">
    <span
      ref="innerEl"
      class="math-chip-inner"
      :style="{ transform: `scale(${scale})` }"
      v-html="markup"
    ></span>
  </span>
</template>

<style scoped>
.math-chip {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 40px;
  overflow: hidden;
  pointer-events: none;
}

.math-chip-inner {
  display: inline-block;
  line-height: 1;
  transform-origin: center center;
}

.math-chip-inner :deep(.ML__latex),
.math-chip-inner :deep(.ML__mathlive) {
  font-size: 18px;
}
</style>
