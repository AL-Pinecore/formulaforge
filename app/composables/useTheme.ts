import { ref } from 'vue'

export type ThemePreference = 'light' | 'dark' | 'system'

export const SUPPORTED_THEMES: ThemePreference[] = ['system', 'light', 'dark']

const STORAGE_KEY = 'formulaforge.theme'

function readStoredTheme(): ThemePreference | null {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : null
  } catch {
    return null
  }
}

const theme = ref<ThemePreference>(readStoredTheme() ?? 'system')

function applyTheme(next: ThemePreference) {
  if (typeof document === 'undefined') {
    return
  }
  document.documentElement.dataset.theme = next
}

applyTheme(theme.value)

function setTheme(next: ThemePreference) {
  if (!SUPPORTED_THEMES.includes(next)) {
    return
  }
  theme.value = next
  applyTheme(next)
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Storage may be unavailable (private mode); the in-memory value still applies.
    }
  }
}

export function useTheme() {
  return { theme, setTheme, availableThemes: SUPPORTED_THEMES }
}
