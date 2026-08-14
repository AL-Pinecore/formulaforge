<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { renderEquationSvg, stripXmlDeclaration } from '~/utils/svg-export'

const props = withDefaults(
  defineProps<{
    latex: string
    display?: boolean
    color?: string
    background?: string | null
    padding?: number
    scale?: number
    delay?: number
  }>(),
  {
    display: false,
    color: '#1a1a1a',
    background: null,
    padding: 8,
    scale: 1,
    delay: 200,
  },
)

const emit = defineEmits<{
  error: [message: string]
  merror: [hasErrors: boolean]
  ready: []
  rendering: []
}>()

const container = ref<HTMLDivElement | null>(null)
const loading = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null
let renderId = 0

async function render() {
  const id = ++renderId
  const target = container.value
  if (!target) {
    return
  }
  if (!props.latex.trim()) {
    target.innerHTML = ''
    loading.value = false
    emit('merror', false)
    emit('ready')
    return
  }
  loading.value = true
  emit('rendering')
  try {
    const result = await renderEquationSvg(props.latex, {
      display: props.display,
      color: props.color,
      background: props.background,
      padding: props.padding,
      scale: props.scale,
    })
    if (id !== renderId || !container.value) {
      return
    }
    container.value.innerHTML = stripXmlDeclaration(result.svg)
    emit('merror', result.hasErrors)
    emit('ready')
  } catch (error) {
    if (id !== renderId) {
      return
    }
    emit('error', error instanceof Error ? error.message : String(error))
  } finally {
    if (id === renderId) {
      loading.value = false
    }
  }
}

function schedule() {
  if (timer) {
    clearTimeout(timer)
  }
  timer = setTimeout(() => {
    void render()
  }, props.delay)
}

onMounted(() => {
  void render()
})

onBeforeUnmount(() => {
  renderId++
  if (timer) {
    clearTimeout(timer)
  }
})

watch(
  () => [props.latex, props.display, props.color, props.background, props.padding, props.scale],
  () => schedule(),
)
</script>

<template>
  <div class="math-preview" :class="{ 'math-preview-loading': loading }">
    <div ref="container" class="math-preview-canvas"></div>
  </div>
</template>

<style scoped>
.math-preview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 64px;
  padding: 8px;
  overflow: auto;
  border-radius: 8px;
  background:
    repeating-conic-gradient(#e8e4dc 0% 25%, #f6f3ec 0% 50%) 0 0 / 20px 20px;
}

.math-preview-canvas {
  display: flex;
  align-items: center;
  justify-content: center;
}

.math-preview-canvas :deep(svg) {
  max-width: 100%;
  height: auto;
}
</style>
