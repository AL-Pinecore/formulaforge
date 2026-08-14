<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { DEFAULT_EXPORT_SETTINGS } from '~/types/export'
import type { ExportFormat, ExportSettings } from '~/types/export'
import { isTauriRuntime, useEquationExport } from '~/composables/useEquationExport'

const props = defineProps<{ latex: string }>()

const emit = defineEmits<{ toast: [message: string, kind: 'success' | 'error'] }>()

// Detected on the client only: during SSR `window` is undefined and the
// desktop/browser defaults must not diverge between server and client.
const tauri = ref(false)
const settings = reactive<ExportSettings>({ ...DEFAULT_EXPORT_SETTINGS })
const { exporting, lastError, exportEquation, formats, formatLabels } = useEquationExport()
const previewError = ref(false)
const previewHasErrors = ref(false)

onMounted(() => {
  tauri.value = isTauriRuntime()
  if (!tauri.value) {
    settings.format = 'svg'
  }
})

function supportsFormat(format: ExportFormat): boolean {
  return tauri.value || format === 'svg'
}

function selectFormat(format: ExportFormat) {
  if (supportsFormat(format)) {
    settings.format = format
  }
}

function onFormatKeydown(event: KeyboardEvent, format: ExportFormat) {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
    return
  }
  event.preventDefault()
  const navigable = formats.filter(supportsFormat)
  const index = navigable.indexOf(format)
  if (index === -1) {
    return
  }
  const direction = event.key === 'ArrowRight' ? 1 : -1
  const next = navigable[(index + direction + navigable.length) % navigable.length]!
  selectFormat(next)
  const buttons = Array.from(
    (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>(
      'button.format-button',
    ) ?? [],
  )
  buttons.find((button) => button.dataset.format === next)?.focus()
}

const effectiveSettings = computed<ExportSettings>(() => {
  if (settings.format === 'jpeg' && !settings.background) {
    return { ...settings, background: '#ffffff' }
  }
  return { ...settings }
})

const backgroundEnabled = computed({
  get: () => settings.background !== null || settings.format === 'jpeg',
  set: (enabled: boolean) => {
    settings.background = enabled ? (settings.background ?? '#ffffff') : null
  },
})

const scaleLabel = computed(() => {
  if (settings.scale >= 3) {
    return '3× (high DPI)'
  }
  if (settings.scale >= 2) {
    return '2×'
  }
  return '1×'
})

async function onExport() {
  const ok = await exportEquation(props.latex, effectiveSettings.value)
  if (ok) {
    emit('toast', `Exported ${formatLabels[settings.format]}`, 'success')
  } else if (lastError.value) {
    emit('toast', lastError.value, 'error')
  }
}
</script>

<template>
  <section class="export-panel">
    <div class="panel-header">
      <h2 class="panel-title">Export</h2>
    </div>

    <div class="field">
      <span class="field-label">Format</span>
      <div class="format-row" role="radiogroup" aria-label="Export format">
        <button
          v-for="format in formats"
          :key="format"
          type="button"
          class="format-button"
          :class="{ 'format-button-active': settings.format === format }"
          role="radio"
          :aria-checked="settings.format === format"
          :data-format="format"
          :disabled="!supportsFormat(format)"
          :tabindex="settings.format === format ? 0 : -1"
          :title="supportsFormat(format) ? '' : 'Only available in the desktop app'"
          @click="selectFormat(format)"
          @keydown="onFormatKeydown($event, format)"
        >
          {{ formatLabels[format] }}
        </button>
      </div>
    </div>

    <div class="field">
      <span class="field-label">Ink color</span>
      <div class="row">
        <input v-model="settings.color" type="color" class="color-input" aria-label="Ink color" />
        <code class="color-value">{{ settings.color }}</code>
      </div>
    </div>

    <div class="field">
      <label class="checkbox-row">
        <input v-model="backgroundEnabled" type="checkbox" :disabled="settings.format === 'jpeg'" />
        <span>Background color (JPEG always uses one)</span>
      </label>
      <div v-if="backgroundEnabled || settings.format === 'jpeg'" class="row" style="margin-top: 6px">
        <input
          v-model="settings.background"
          type="color"
          class="color-input"
          aria-label="Background color"
        />
        <code class="color-value">{{ settings.background }}</code>
      </div>
    </div>

    <div class="field">
      <span class="field-label">Padding (px)</span>
      <input
        v-model.number="settings.padding"
        type="number"
        min="0"
        max="200"
        class="text-input"
        aria-label="Padding in pixels"
      />
    </div>

    <div class="field">
      <span class="field-label">Resolution — {{ scaleLabel }}</span>
      <input v-model.number="settings.scale" type="range" min="1" max="3" step="1" class="range-input" aria-label="Resolution scale" />
    </div>

    <div v-if="settings.format === 'jpeg'" class="field">
      <span class="field-label">JPEG quality — {{ settings.jpegQuality }}</span>
      <input
        v-model.number="settings.jpegQuality"
        type="range"
        min="10"
        max="100"
        step="1"
        class="range-input"
        aria-label="JPEG quality"
      />
    </div>

    <div class="field">
      <label class="checkbox-row">
        <input v-model="settings.displayStyle" type="checkbox" />
        <span>Display style (limits above and below)</span>
      </label>
    </div>

    <MathPreview
      :latex="latex"
      :display="effectiveSettings.displayStyle"
      :color="effectiveSettings.color"
      :background="effectiveSettings.background"
      :padding="effectiveSettings.padding"
      :scale="effectiveSettings.scale"
      @rendering="previewError = false"
      @error="previewError = true"
      @merror="previewHasErrors = $event"
    />
    <p v-if="previewHasErrors" class="hint hint-warn">
      The expression contains LaTeX errors — export may not reflect what you expect.
    </p>
    <p v-else-if="previewError" class="hint hint-warn">Could not render a preview of this expression.</p>

    <button
      type="button"
      class="btn btn-primary export-button"
      :disabled="exporting || !latex.trim()"
      @click="onExport"
    >
      {{ exporting ? 'Exporting…' : 'Export equation' }}
    </button>
  </section>
</template>

<style scoped>
.export-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.panel-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.format-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.format-button {
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--input-bg);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.format-button:hover:not(:disabled) {
  border-color: var(--accent);
}

.format-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.format-button-active {
  background: var(--accent);
  border-color: var(--accent);
  color: #ffffff;
}

.format-button:focus-visible,
.export-button:focus-visible,
.checkbox-row input:focus-visible,
.text-input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.color-input {
  width: 36px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--input-bg);
  cursor: pointer;
}

.color-value {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-muted);
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  cursor: pointer;
}

.text-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--input-bg);
  color: var(--text);
  font-size: 13px;
}

.range-input {
  width: 100%;
}

.hint {
  margin: 0;
  font-size: 12px;
}

.hint-warn {
  color: var(--danger);
}

.export-button {
  margin-top: 2px;
}

.export-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
