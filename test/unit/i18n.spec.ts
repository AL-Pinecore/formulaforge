import { afterEach, describe, expect, it } from 'vitest'
import { useI18n } from '../../app/composables/useI18n'
import en from '../../app/locales/en'
import zh from '../../app/locales/zh'

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
    setLocale('zh')
    expect(t('toolbar.undo')).toBe('撤销')
  })

  it('falls back to the English key or a provided fallback', () => {
    setLocale('en')
    expect(t('element.plus', undefined, 'Plus')).toBe('Plus')
    setLocale('zh')
    expect(t('element.plus', undefined, 'Plus')).toBe('加号')
  })

  it('interpolates parameters', () => {
    setLocale('en')
    expect(t('toast.savedTo', { path: '/tmp/x.tex' })).toBe('Saved to /tmp/x.tex')
    setLocale('zh')
    expect(t('toast.savedTo', { path: '/tmp/x.tex' })).toBe('已保存到 /tmp/x.tex')
  })

  it('returns the key itself when nothing matches', () => {
    expect(t('does.not.exist')).toBe('does.not.exist')
  })

  it('defines the same set of keys in every locale', () => {
    const enKeys = keyPaths(en).sort()
    const zhKeys = keyPaths(zh).sort()
    expect(zhKeys).toEqual(enKeys)
  })
})
