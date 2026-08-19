import { ref } from 'vue'

export type Locale = string

const STORAGE_KEY = 'formulaforge.locale'

type MessageValue = string | { [key: string]: MessageValue }
type MessageDictionary = {
  languageCode: string
  displayName: string
  [key: string]: MessageValue
}

export type LocaleOption = Pick<MessageDictionary, 'languageCode' | 'displayName'>

export type MessageParams = Record<string, string | number>

const localeModules = import.meta.glob<{
  default: MessageDictionary
  mathlive: Record<string, string>
}>('../locales/*.ts', {
  eager: true,
})

const dictionaries: Record<string, MessageDictionary> = {}
const mathliveStrings: Record<string, Record<string, string>> = {}

for (const module of Object.values(localeModules)) {
  const dict = module?.default
  if (
    !dict ||
    typeof dict !== 'object' ||
    typeof dict.languageCode !== 'string' ||
    typeof dict.displayName !== 'string' ||
    !module.mathlive ||
    typeof module.mathlive !== 'object'
  ) {
    continue
  }
  dictionaries[dict.languageCode] = dict
  mathliveStrings[dict.languageCode] = module.mathlive
}

const availableLocales: LocaleOption[] = Object.values(dictionaries)
  .map(({ languageCode, displayName }) => ({ languageCode, displayName }))
  .sort((a, b) => a.languageCode.localeCompare(b.languageCode))
const availableLanguageCodes = availableLocales.map(({ languageCode }) => languageCode)

function detectSystemLocale(): Locale {
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
    const system = navigator.language.toLowerCase()
    const exact = availableLanguageCodes.find((code) => code.toLowerCase() === system)
    if (exact) {
      return exact
    }
    const prefix = availableLanguageCodes.find((code) => system.startsWith(code.toLowerCase()))
    if (prefix) {
      return prefix
    }
  }
  return availableLanguageCodes[0] ?? 'en'
}

function readStoredLocale(): Locale | null {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored && availableLanguageCodes.includes(stored) ? stored : null
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

function applyDocumentLanguage(code: Locale) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = code
  }
}

function setLocale(next: Locale) {
  if (!availableLanguageCodes.includes(next)) {
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
    mathliveStrings,
  }
}
