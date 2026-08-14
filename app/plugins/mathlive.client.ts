import { MathfieldElement } from 'mathlive'

export default defineNuxtPlugin(() => {
  try {
    if (!customElements.get('math-field') && MathfieldElement) {
      customElements.define('math-field', MathfieldElement)
    }
    if (MathfieldElement) {
      // Fonts are bundled and declared in app/assets/css/mathlive-fonts.css;
      // disable MathLive's own dynamic font loading.
      MathfieldElement.fontsDirectory = null
      MathfieldElement.soundsDirectory = null
    }
  } catch (error) {
    console.warn('[formulaforge] math-field registration failed:', error)
  }
})
