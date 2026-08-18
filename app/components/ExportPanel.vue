<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { DEFAULT_EXPORT_SETTINGS } from '~/types/export'
import type { ExportFormat, ExportSettings } from '~/types/export'
import { useEquationExport } from '~/composables/useEquationExport'
import { useEquation } from '~/composables/useEquation'
import { useI18n } from '~/composables/useI18n'

const props = defineProps<{ latex: string }>()

const emit = defineEmits<{ toast: [message: string, kind: 'success' | 'error'] }>()

const { t } = useI18n()
const { displayStyle } = useEquation()

const settings = reactive<ExportSettings>({ ...DEFAULT_EXPORT_SETTINGS })
const { exporting, lastError, exportEquation, formats, formatLabels } = useEquationExport()
const previewError = ref(false)
const previewHasErrors = ref(false)

function selectFormat(format: ExportFormat) {
  settings.format = format
}

function onFormatKeydown(event: KeyboardEvent, format: ExportFormat) {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
    return
  }
  event.preventDefault()
  const navigable = formats
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
  const base = { ...settings, displayStyle: displayStyle.value }
  if (base.format === 'jpeg' && !base.background) {
    return { ...base, background: '#ffffff' }
  }
  return base
})

const backgroundEnabled = computed({
  get: () => settings.background !== null || settings.format === 'jpeg',
  set: (enabled: boolean) => {
    settings.background = enabled ? (settings.background ?? '#ffffff') : null
  },
})

const scaleLabel = computed(() => {
  if (settings.scale >= 3) {
    return t('export.scaleHigh')
  }
  if (settings.scale >= 2) {
    return t('export.scale2')
  }
  return t('export.scale1')
})

async function onExport() {
  const ok = await exportEquation(props.latex, effectiveSettings.value)
  if (ok) {
    emit('toast', t('toast.exported', { format: formatLabels[settings.format] }), 'success')
  } else if (lastError.value) {
    emit('toast', lastError.value, 'error')
  }
}
</script>

<template>
  <section class="export-panel">
    <div class="panel-header">
      <h2 class="panel-title">{{ t('export.title') }}</h2>
    </div>

    <div class="field">
      <span class="field-label">{{ t('export.format') }}</span>
      <div class="format-row" role="radiogroup" :aria-label="t('export.format')">
        <button
          v-for="format in formats"
          :key="format"
          type="button"
          class="format-button"
          :class="{ 'format-button-active': settings.format === format }"
          role="radio"
          :aria-checked="settings.format === format"
          :data-format="format"
          :tabindex="settings.format === format ? 0 : -1"
          @click="selectFormat(format)"
          @keydown="onFormatKeydown($event, format)"
        >
          {{ formatLabels[format] }}
        </button>
      </div>
    </div>

    <div class="field">
      <span class="field-label">{{ t('export.inkColor') }}</span>
      <div class="row">
        <input v-model="settings.color" type="color" class="color-input" :aria-label="t('export.inkColor')" />
        <code class="color-value">{{ settings.color }}</code>
      </div>
    </div>

    <div class="field">
      <label class="checkbox-row">
        <input v-model="backgroundEnabled" type="checkbox" :disabled="settings.format === 'jpeg'" />
        <span>{{ t('export.backgroundColor') }}</span>
      </label>
      <div v-if="backgroundEnabled || settings.format === 'jpeg'" class="row" style="margin-top: 6px">
        <input
          v-model="settings.background"
          type="color"
          class="color-input"
          :aria-label="t('export.backgroundLabel')"
        />
        <code class="color-value">{{ settings.background }}</code>
      </div>
    </div>

    <div class="field">
      <span class="field-label">{{ t('export.padding') }}</span>
      <input
        v-model.number="settings.padding"
        type="number"
        min="0"
        max="200"
        class="text-input"
        :aria-label="t('export.padding')"
      />
    </div>

    <div class="field">
      <span class="field-label">{{ t('export.resolution') }} — {{ scaleLabel }}</span>
      <input v-model.number="settings.scale" type="range" min="1" max="3" step="1" class="range-input" :aria-label="t('export.resolution')" />
    </div>

    <div v-if="settings.format === 'jpeg'" class="field">
      <span class="field-label">{{ t('export.jpegQuality') }} — {{ settings.jpegQuality }}</span>
      <input
        v-model.number="settings.jpegQuality"
        type="range"
        min="10"
        max="100"
        step="1"
        class="range-input"
        :aria-label="t('export.jpegQuality')"
      />
    </div>

    <div class="field">
      <label class="checkbox-row">
        <input v-model="displayStyle" type="checkbox" />
        <span>{{ t('export.displayStyle') }}</span>
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
      {{ t('export.previewHasErrors') }}
    </p>
    <p v-else-if="previewError" class="hint hint-warn">{{ t('export.previewError') }}</p>

    <button
      type="button"
      class="btn btn-primary export-button"
      :disabled="exporting || !latex.trim()"
      @click="onExport"
    >
      {{ exporting ? t('export.exporting') : t('export.exportEquation') }}
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
