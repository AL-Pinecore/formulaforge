import { ref } from 'vue'

export type Locale = string

const STORAGE_KEY = 'formulaforge.locale'

type MessageValue = string | { [key: string]: MessageValue }
type MessageDictionary = { [key: string]: MessageValue }

export type MessageParams = Record<string, string | number>

const localeModules = import.meta.glob<{ default: MessageDictionary }>('../locales/*.ts', {
  eager: true,
})

function localeCodeFromPath(path: string): string {
  const filename = path.split('/').pop() ?? ''
  return filename.replace(/\.ts$/, '')
}

const dictionaries: Record<string, MessageDictionary> = {}

for (const [path, module] of Object.entries(localeModules)) {
  const dict = module?.default
  if (!dict || typeof dict !== 'object' || typeof dict.displayName !== 'string') {
    continue
  }
  dictionaries[localeCodeFromPath(path)] = dict
}

const availableLocales: Locale[] = Object.keys(dictionaries).sort()

function detectSystemLocale(): Locale {
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
    const system = navigator.language.toLowerCase()
    const exact = availableLocales.find((code) => code.toLowerCase() === system)
    if (exact) {
      return exact
    }
    const prefix = availableLocales.find((code) => system.startsWith(code.toLowerCase()))
    if (prefix) {
      return prefix
    }
  }
  return availableLocales[0] ?? 'en'
}

function readStoredLocale(): Locale | null {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored && availableLocales.includes(stored) ? stored : null
  } catch {
    return null
  }
}

const locale = ref<Locale>(readStoredLocale() ?? detectSystemLocale())

function resolve(dictionary: MessageDictionary | undefined, key: string): string | undefined {
  if (!dictionary) {
    return undefined
  }
  const parts = key.split('.')
  let current: MessageValue | undefined = dictionary
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) {
      return undefined
    }
    current = (current as MessageDictionary)[part]
  }
  return typeof current === 'string' ? current : undefined
}

function interpolate(template: string, params?: MessageParams): string {
  if (!params) {
    return template
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    return value != null ? String(value) : match
  })
}

function t(key: string, params?: MessageParams, fallback?: string): string {
  const current = dictionaries[locale.value]
  let template = resolve(current, key)
  if (template === undefined && current !== dictionaries.en) {
    template = resolve(dictionaries.en, key)
  }
  return interpolate(template ?? fallback ?? key, params)
}

function localeDisplayName(code: Locale): string {
  const name = dictionaries[code]?.displayName
  return typeof name === 'string' ? name : code
}

function applyDocumentLanguage(code: Locale) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = code
  }
}

function setLocale(next: Locale) {
  if (!availableLocales.includes(next)) {
    return
  }
  locale.value = next
  applyDocumentLanguage(next)
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Storage may be unavailable (private mode); the in-memory value still applies.
    }
  }
}

applyDocumentLanguage(locale.value)

export function useI18n() {
  return {
    locale,
    t,
    setLocale,
    availableLocales,
    localeDisplayName,
  }
}
