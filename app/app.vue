<script setup lang="ts">
import { ref } from 'vue'
import { useEquation } from '~/composables/useEquation'
import { copyTextToClipboard, wrapDisplayMath, wrapInlineMath } from '~/utils/clipboard'
import type { EquationElement } from '~/types/equation'
import EquationWorkspace from '~/components/EquationWorkspace.vue'
import EquationPalette from '~/components/EquationPalette.vue'
import LatexSource from '~/components/LatexSource.vue'
import ExportPanel from '~/components/ExportPanel.vue'
import AppToolbar from '~/components/AppToolbar.vue'

const eq = useEquation()
const workspace = ref<InstanceType<typeof EquationWorkspace> | null>(null)
const toast = ref<{ message: string; kind: 'success' | 'error' } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null

useHead({
  title: 'FormulaForge — LaTeX Equation Editor',
  htmlAttrs: { lang: 'en' },
})

function showToast(message: string, kind: 'success' | 'error' = 'success') {
  toast.value = { message, kind }
  if (toastTimer) {
    clearTimeout(toastTimer)
  }
  toastTimer = setTimeout(() => {
    toast.value = null
  }, 3200)
}

function onInsert(element: EquationElement) {
  workspace.value?.insertElement(element)
}

function onLatexChange(value: string, errors: string[]) {
  eq.setState(value, errors)
}

function onUndoState(canUndo: boolean, canRedo: boolean) {
  eq.setUndoState(canUndo, canRedo)
}

function onApplyRawLatex(value: string) {
  const result = workspace.value?.setLatex(value)
  if (result) {
    eq.setState(result.value, result.errors)
  }
}

function onFontSize(px: number) {
  eq.setFontSize(px)
}

async function onCopy(kind: 'raw' | 'inline' | 'display') {
  const latex = eq.latex.value
  if (!latex.trim()) {
    showToast('The equation is empty.', 'error')
    return
  }
  const text = kind === 'raw' ? latex : kind === 'inline' ? wrapInlineMath(latex) : wrapDisplayMath(latex)
  const ok = await copyTextToClipboard(text)
  showToast(ok ? 'Copied to clipboard.' : 'Clipboard unavailable.', ok ? 'success' : 'error')
}
</script>

<template>
  <div class="app">
    <AppToolbar
      :can-undo="eq.canUndo.value"
      :can-redo="eq.canRedo.value"
      :font-size="eq.fontSize.value"
      @undo="workspace?.undo()"
      @redo="workspace?.redo()"
      @clear="workspace?.clear()"
      @font-size="onFontSize"
      @copy="onCopy"
    />
    <main class="app-body">
      <EquationPalette @insert="onInsert" />
      <EquationWorkspace
        ref="workspace"
        :font-size="eq.fontSize.value"
        @latex-change="onLatexChange"
        @undo-state="onUndoState"
        @toast="showToast"
      />
      <aside class="app-side">
        <LatexSource :latex="eq.latex.value" :errors="eq.errors.value" @apply="onApplyRawLatex" @toast="showToast" />
        <ExportPanel :latex="eq.latex.value" @toast="showToast" />
      </aside>
    </main>
    <Transition name="toast">
      <div v-if="toast" class="toast" :class="`toast-${toast.kind}`" role="status" aria-live="polite">
        {{ toast.message }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.app-body {
  display: grid;
  grid-template-columns: 240px minmax(320px, 1fr) 320px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.app-side {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  padding: 14px;
  overflow-y: auto;
  background: var(--panel-bg);
  border-left: 1px solid var(--border);
}

@media (max-width: 1100px) {
  .app-body {
    grid-template-columns: 200px minmax(300px, 1fr) 280px;
  }
}

@media (max-width: 940px) {
  .app-body {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(320px, 1fr) auto;
    overflow-y: auto;
  }

  .app-side {
    border-left: none;
    border-top: 1px solid var(--border);
  }
}

.toast {
  position: fixed;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  max-width: min(80vw, 480px);
  padding: 9px 16px;
  border-radius: 999px;
  background: var(--toast-bg);
  color: var(--toast-text);
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 6px 22px rgb(0 0 0 / 28%);
}

.toast-success {
  border-left: 4px solid #22c55e;
}

.toast-error {
  border-left: 4px solid #ef4444;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
