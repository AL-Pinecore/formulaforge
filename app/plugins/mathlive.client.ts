import { MathfieldElement } from 'mathlive'
import { watch } from 'vue'
import { useI18n } from '~/composables/useI18n'

export default defineNuxtPlugin(() => {
  const { locale, mathliveStrings } = useI18n()

  try {
    if (!customElements.get('math-field') && MathfieldElement) {
      customElements.define('math-field', MathfieldElement)
    }
    if (MathfieldElement) {
      // Fonts are bundled and declared in app/assets/css/mathlive-fonts.css;
      // disable MathLive's own dynamic font loading.
      MathfieldElement.fontsDirectory = null
      MathfieldElement.soundsDirectory = null
      MathfieldElement.strings = mathliveStrings
      watch(
        locale,
        (value) => {
          MathfieldElement.locale = value
        },
        { immediate: true },
      )
    }
  } catch (error) {
    console.warn('[formulaforge] math-field registration failed:', error)
  }
})
