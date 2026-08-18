import { computed, ref } from 'vue'

const latex = ref('')
const errors = ref<string[]>([])
const canUndo = ref(false)
const canRedo = ref(false)
const fontSize = ref(24)
const displayStyle = ref(true)

export function useEquation() {
  return {
    latex: computed(() => latex.value),
    errors: computed(() => errors.value),
    canUndo,
    canRedo,
    fontSize,
    displayStyle,
    setState(value: string, fieldErrors: string[]) {
      latex.value = value
      errors.value = fieldErrors
    },
    setUndoState(undo: boolean, redo: boolean) {
      canUndo.value = undo
      canRedo.value = redo
    },
    setFontSize(px: number) {
      fontSize.value = px
    },
    setDisplayStyle(value: boolean) {
      displayStyle.value = value
    },
  }
}
