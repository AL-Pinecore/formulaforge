<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'

const props = defineProps<{ latex: string }>()

const markup = ref('')

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
  <span class="math-chip" aria-hidden="true" v-html="markup"></span>
</template>

<style scoped>
.math-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  min-width: 34px;
  pointer-events: none;
}

.math-chip :deep(.ML__latex),
.math-chip :deep(.ML__mathlive) {
  font-size: 18px;
}
</style>
