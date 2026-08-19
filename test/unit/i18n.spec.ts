import { afterEach, describe, expect, it } from 'vitest'
import { useI18n } from '../../app/composables/useI18n'

const localeModules = Object.values(import.meta.glob<{
  default: Record<string, unknown>
  mathlive?: Record<string, string>
}>('../../app/locales/*.ts', { eager: true }))

const { locale, t, setLocale } = useI18n()

afterEach(() => {
  setLocale('en')
})

function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) {
    return [prefix]
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  )
}

describe('useI18n', () => {
  it('defaults to English when no system locale is available', () => {
    expect(locale.value).toBe('en')
  })

  it('translates UI keys for both locales', () => {
    setLocale('en')
    expect(t('toolbar.undo')).toBe('Undo')
    setLocale('zh-cn')
    expect(t('toolbar.undo')).toBe('撤销')
  })

  it('falls back to the English key or a provided fallback', () => {
    setLocale('en')
    expect(t('element.plus', undefined, 'Plus')).toBe('Plus')
    setLocale('zh-cn')
    expect(t('element.plus', undefined, 'Plus')).toBe('加号')
  })

  it('interpolates parameters', () => {
    setLocale('en')
    expect(t('toast.savedTo', { path: '/tmp/x.tex' })).toBe('Saved to /tmp/x.tex')
    setLocale('zh-cn')
    expect(t('toast.savedTo', { path: '/tmp/x.tex' })).toBe('已保存到 /tmp/x.tex')
  })

  it('returns the key itself when nothing matches', () => {
    expect(t('does.not.exist')).toBe('does.not.exist')
  })

  it('defines the same set of keys in every locale', () => {
    const expected = keyPaths(localeModules[0]!.default).sort()
    for (const module of localeModules.slice(1)) {
      expect(keyPaths(module.default).sort()).toEqual(expected)
    }
  })

  it('defines the same set of MathLive keys in every locale', () => {
    const expected = Object.keys(localeModules[0]!.mathlive ?? {}).sort()
    for (const module of localeModules) {
      expect(module.mathlive).toBeDefined()
      expect(Object.keys(module.mathlive ?? {}).sort()).toEqual(expected)
    }
  })
})
