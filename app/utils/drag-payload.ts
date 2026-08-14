import { ref } from 'vue'

export const DRAG_ELEMENT_MIME = 'application/x-equation-element'

export const draggedElementId = ref<string | null>(null)
