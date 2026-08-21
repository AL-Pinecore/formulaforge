import { computed, ref } from 'vue'
import { EquationDocument } from '~/editor/EquationDocument'

// The single document owns the formula being edited (public LaTeX, caret,
// errors, undo/redo history). These refs mirror it reactively for the UI; the
// editing workspace commits to the document, never to a backend.
const document = new EquationDocument()
const fontSize = ref(24)
const displayStyle = ref(true)

const latex = ref('')
const errors = ref<string[]>([])
const canUndo = ref(false)
const canRedo = ref(false)

document.subscribe(() => {
  latex.value = document.latex
  errors.value = document.errors
  canUndo.value = document.canUndo
  canRedo.value = document.canRedo
})

export function useEquation() {
  return {
    latex: computed(() => latex.value),
    errors: computed(() => errors.value),
    canUndo,
    canRedo,
    fontSize,
    displayStyle,
    document,
    setFontSize(px: number) {
      fontSize.value = px
    },
    setDisplayStyle(value: boolean) {
      displayStyle.value = value
    },
  }
}
