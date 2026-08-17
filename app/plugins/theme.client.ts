import { useTheme } from '~/composables/useTheme'

export default defineNuxtPlugin(() => {
  // Importing `useTheme` applies the persisted theme to <html data-theme> as
  // early as possible (before the app mounts), avoiding a wrong-theme flash.
  useTheme()
})
