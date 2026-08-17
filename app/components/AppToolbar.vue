<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import type { Locale } from '~/composables/useI18n'
import { useTheme } from '~/composables/useTheme'
import type { ThemePreference } from '~/composables/useTheme'

const props = defineProps<{
  canUndo: boolean
  canRedo: boolean
  fontSize: number
}>()

const emit = defineEmits<{
  undo: []
  redo: []
  clear: []
  'font-size': [px: number]
  copy: [kind: 'raw' | 'inline' | 'display']
}>()

const { locale, t, setLocale, availableLocales, localeDisplayName } = useI18n()
const { theme, setTheme, availableThemes } = useTheme()

const FONT_SIZES = [16, 20, 24, 32]

function onLocaleChange(event: Event) {
  setLocale((event.target as HTMLSelectElement).value as Locale)
}

function onThemeChange(event: Event) {
  setTheme((event.target as HTMLSelectElement).value as ThemePreference)
}
</script>

<template>
  <header class="toolbar">
    <div class="toolbar-brand">
      <span class="brand-mark" aria-hidden="true">
        <span class="brand-bar"></span>
        <span class="brand-top"></span>
        <span class="brand-bottom"></span>
      </span>
      <span class="brand-name">FormulaForge</span>
    </div>

    <div class="toolbar-group" role="group" :aria-label="t('toolbar.editingActions')">
      <button type="button" class="btn btn-ghost" :disabled="!props.canUndo" @click="emit('undo')">
        {{ t('toolbar.undo') }}
      </button>
      <button type="button" class="btn btn-ghost" :disabled="!props.canRedo" @click="emit('redo')">
        {{ t('toolbar.redo') }}
      </button>
      <button type="button" class="btn btn-ghost" @click="emit('clear')">{{ t('toolbar.clear') }}</button>
    </div>

    <div class="toolbar-group" role="group" :aria-label="t('toolbar.fontSize')">
      <select
        class="font-size-select"
        :aria-label="t('toolbar.fontSize')"
        :value="props.fontSize"
        @change="emit('font-size', Number(($event.target as HTMLSelectElement).value))"
      >
        <option v-for="size in FONT_SIZES" :key="size" :value="size">{{ size }} px</option>
      </select>
    </div>

    <div class="toolbar-spacer"></div>

    <div class="toolbar-group" role="group" :aria-label="t('toolbar.theme')">
      <select
        class="font-size-select"
        :aria-label="t('toolbar.theme')"
        :value="theme"
        @change="onThemeChange"
      >
        <option v-for="value in availableThemes" :key="value" :value="value">
          {{ t(`theme.${value}`) }}
        </option>
      </select>
    </div>

    <div class="toolbar-group" role="group" :aria-label="t('toolbar.language')">
      <select
        class="font-size-select"
        :aria-label="t('toolbar.language')"
        :value="locale"
        @change="onLocaleChange"
      >
        <option v-for="l in availableLocales" :key="l" :value="l">
          {{ localeDisplayName(l) }}
        </option>
      </select>
    </div>

    <div class="toolbar-group" role="group" :aria-label="t('toolbar.copy')">
      <button type="button" class="btn btn-ghost" @click="emit('copy', 'raw')">
        {{ t('toolbar.copyLatex') }}
      </button>
      <button type="button" class="btn btn-ghost" @click="emit('copy', 'inline')">
        {{ t('toolbar.copyInline') }}
      </button>
      <button type="button" class="btn btn-ghost" @click="emit('copy', 'display')">
        {{ t('toolbar.copyDisplay') }}
      </button>
    </div>
  </header>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  min-height: 52px;
  padding: 6px 14px;
  background: var(--toolbar-bg);
  border-bottom: 1px solid var(--border);
}

.toolbar-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  user-select: none;
}

.brand-name {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.brand-mark {
  position: relative;
  display: inline-block;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  background: var(--accent);
}

.brand-bar {
  position: absolute;
  left: 4px;
  right: 4px;
  top: 50%;
  height: 2px;
  margin-top: -1px;
  background: #ffffff;
}

.brand-top,
.brand-bottom {
  position: absolute;
  left: 7px;
  right: 7px;
  height: 3px;
  background: #ffffff;
}

.brand-top {
  top: 4px;
}

.brand-bottom {
  bottom: 4px;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-spacer {
  flex: 1;
}

.font-size-select {
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--input-bg);
  color: var(--text);
  font-size: 12px;
}

.font-size-select:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
</style>
