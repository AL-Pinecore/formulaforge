<script setup lang="ts">
import { ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { copyTextToClipboard, downloadTextFile } from '~/utils/clipboard'
import { isTauriRuntime } from '~/composables/useEquationExport'

const props = defineProps<{ latex: string; errors: string[] }>()

const emit = defineEmits<{
  apply: [value: string]
  toast: [message: string, kind: 'success' | 'error']
}>()

const draft = ref(props.latex)
const editing = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

watch(
  () => props.latex,
  (value) => {
    if (editing.value) {
      return
    }
    if (draft.value !== value) {
      draft.value = value
    }
  },
)

function onInput() {
  emit('apply', draft.value)
}

function onFocus() {
  editing.value = true
}

function onBlur() {
  editing.value = false
  draft.value = props.latex
}

async function onCopy() {
  const ok = await copyTextToClipboard(props.latex)
  emit('toast', ok ? 'LaTeX copied to clipboard.' : 'Clipboard unavailable.', ok ? 'success' : 'error')
}

async function onSaveTex() {
  if (!props.latex.trim()) {
    emit('toast', 'The equation is empty.', 'error')
    return
  }
  try {
    if (isTauriRuntime()) {
      const savedPath = await invoke<string | null>('save_text_file_approved', {
        request: { contents: props.latex },
      })
      if (savedPath) {
        emit('toast', `Saved to ${savedPath}`, 'success')
      }
    } else {
      downloadTextFile(props.latex, 'equation.tex', 'application/x-tex')
      emit('toast', 'Downloaded equation.tex', 'success')
    }
  } catch (error) {
    emit('toast', error instanceof Error ? error.message : String(error), 'error')
  }
}

async function onImportTex() {
  try {
    if (isTauriRuntime()) {
      const contents = await invoke<string | null>('read_text_file_approved')
      if (contents === null) {
        return
      }
      draft.value = contents
      emit('apply', contents)
      emit('toast', 'Loaded LaTeX file', 'success')
    } else {
      fileInput.value?.click()
    }
  } catch (error) {
    emit('toast', error instanceof Error ? error.message : String(error), 'error')
  }
}

function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) {
    return
  }
  file
    .text()
    .then((contents) => {
      draft.value = contents
      emit('apply', contents)
      emit('toast', `Loaded ${file.name}`, 'success')
    })
    .catch(() => emit('toast', 'Could not read the selected file.', 'error'))
    .finally(() => {
      input.value = ''
    })
}
</script>

<template>
  <section class="latex-source">
    <div class="panel-header">
      <h2 class="panel-title">LaTeX Source</h2>
      <div class="panel-actions">
        <button type="button" class="btn btn-ghost btn-sm" @click="onCopy">Copy</button>
        <button type="button" class="btn btn-ghost btn-sm" @click="onImportTex">Import</button>
        <button type="button" class="btn btn-ghost btn-sm" @click="onSaveTex">Save .tex</button>
      </div>
    </div>
    <textarea
      v-model="draft"
      class="latex-textarea"
      rows="5"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      aria-label="LaTeX source"
      :aria-invalid="errors.length > 0"
      :aria-describedby="errors.length > 0 ? 'latex-errors' : undefined"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
    ></textarea>
    <ul v-if="errors.length > 0" id="latex-errors" class="latex-errors" aria-live="polite">
      <li v-for="error in errors" :key="error">{{ error }}</li>
    </ul>
    <input ref="fileInput" type="file" accept=".tex,.latex,text/plain" hidden @change="onFilePicked" />
  </section>
</template>

<style scoped>
.latex-source {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.panel-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.panel-actions {
  display: flex;
  gap: 4px;
}

.latex-textarea {
  width: 100%;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--input-bg);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
}

.latex-textarea:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.latex-errors {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--danger-border);
  border-radius: 8px;
  background: var(--danger-bg);
  color: var(--danger);
  font-size: 12px;
  list-style: none;
}

.latex-errors li + li {
  margin-top: 4px;
}
</style>
