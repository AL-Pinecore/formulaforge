<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'

const ICON_SIZE = 100
const GAP = 30

const ICON_FADE_MS = 200
const HOLD_MS = 400
const ANIMATION_MS = 800
const SHRINK_DELAY_MS = 0
const FADE_DELAY_MS = 400
const FADE_MS = 400

const INITIAL_ICON_SCALE = 2
const TITLE_INITIAL_SCALE = 0.55

const EASE_FUN = 'cubic-bezier(0.65, 0, 0.35, 1)'

const isTestEnv =
    import.meta.env.MODE === 'test' ||
    (typeof navigator !== 'undefined' && navigator.webdriver)

const nameRef = ref<HTMLElement | null>(null)

const iconShift = ref(0)
const nameShift = ref(0)

const ready = ref(false)
const iconVisible = ref(false)
const titleVisible = ref(false)
const moving = ref(false)
const shrinking = ref(false)
const fading = ref(false)
const hidden = ref(isTestEnv)

const iconMoverStyle = computed(() => ({
  width: `${ICON_SIZE}px`,
  height: `${ICON_SIZE}px`,
  opacity: iconVisible.value ? 1 : 0,
  transform: moving.value
      ? `translate(-50%, -50%) translateX(${iconShift.value}px)`
      : 'translate(-50%, -50%)',
  transition: moving.value
      ? `opacity ${ICON_FADE_MS}ms ease-out, transform ${ANIMATION_MS}ms ${EASE_FUN}`
      : `opacity ${ICON_FADE_MS}ms ease-out`,
}))

const iconStyle = computed(() => ({
  transform: shrinking.value
      ? 'scale(1)'
      : `scale(${INITIAL_ICON_SCALE})`,
  transition: shrinking.value
      ? `transform ${ANIMATION_MS - SHRINK_DELAY_MS}ms ${EASE_FUN}`
      : 'none',
}))

const nameMoverStyle = computed(() => ({
  transform: moving.value
      ? `translate(-50%, -50%) translateX(${nameShift.value}px)`
      : 'translate(-50%, -50%)',
  transition: moving.value
      ? `transform ${ANIMATION_MS}ms ${EASE_FUN}`
      : 'none',
}))

const nameStyle = computed(() => ({
  opacity: titleVisible.value ? 1 : 0,
  transform: moving.value
      ? 'scale(1)'
      : `scale(${TITLE_INITIAL_SCALE})`,
  transition: moving.value
      ? `transform ${ANIMATION_MS}ms ${EASE_FUN}`
      : 'none',
}))

onMounted(async () => {
  if (isTestEnv) return

  await nextTick()

  if (document.fonts) {
    await document.fonts.ready
  }

  await nextTick()

  const nameWidth = nameRef.value?.offsetWidth ?? 0

  iconShift.value = -(nameWidth + GAP) / 2
  nameShift.value = (ICON_SIZE + GAP) / 2

  ready.value = true

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      iconVisible.value = true
    })
  })

  window.setTimeout(() => {
    titleVisible.value = true
  }, ICON_FADE_MS)

  window.setTimeout(() => {
    moving.value = true
  }, ICON_FADE_MS + HOLD_MS)

  window.setTimeout(() => {
    shrinking.value = true
  }, ICON_FADE_MS + HOLD_MS + SHRINK_DELAY_MS)

  window.setTimeout(() => {
    fading.value = true
  }, ICON_FADE_MS + HOLD_MS + ANIMATION_MS + FADE_DELAY_MS)

  window.setTimeout(() => {
    hidden.value = true
  }, ICON_FADE_MS + HOLD_MS + ANIMATION_MS + FADE_DELAY_MS + FADE_MS)
})
</script>

<template>
  <div
      v-if="!hidden"
      class="splash"
      :class="{
        'splash--ready': ready,
        'splash--fading': fading,
      }"
      aria-hidden="true"
  >
    <div
        class="splash-stage"
        :style="{ height: `${ICON_SIZE}px` }"
    >
      <div
          class="splash-name-mover"
          :style="nameMoverStyle"
      >
        <span
            ref="nameRef"
            class="splash-name"
            :style="nameStyle"
        >
          FormulaForge
        </span>
      </div>

      <div
          class="splash-icon-mover"
          :style="iconMoverStyle"
      >
        <div
            class="splash-icon"
            :style="iconStyle"
        >
          <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 512 512"
          >
            <rect
                width="512"
                height="512"
                rx="96"
                fill="#2563eb"
            />

            <g fill="#ffffff">
              <rect
                  x="96"
                  y="112"
                  width="320"
                  height="64"
                  rx="32"
              />

              <rect
                  x="96"
                  y="240"
                  width="320"
                  height="32"
              />

              <rect
                  x="96"
                  y="336"
                  width="320"
                  height="64"
                  rx="32"
              />
            </g>
          </svg>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.splash {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  background: var(--workspace-bg);
  opacity: 1;
  transition: opacity 500ms ease;
}

.splash--fading {
  opacity: 0;
  pointer-events: none;
}

.splash-stage {
  position: relative;
  width: 0;
  opacity: 0;
}

.splash--ready .splash-stage {
  opacity: 1;
}

.splash-icon-mover,
.splash-name-mover {
  position: absolute;
  top: 50%;
  left: 50%;
}

.splash-icon-mover {
  z-index: 2;
}

.splash-icon {
  width: 100%;
  height: 100%;
  transform-origin: center;
}

.splash-icon svg {
  display: block;
  width: 100%;
  height: 100%;
}

.splash-name-mover {
  z-index: 1;
}

.splash-name {
  display: block;
  color: var(--text);
  font-size: 36px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.01em;
  white-space: nowrap;
  transform-origin: center;
  user-select: none;
}

@media (prefers-reduced-motion: reduce) {
  .splash,
  .splash-icon-mover,
  .splash-icon,
  .splash-name-mover,
  .splash-name {
    transition: none !important;
  }
}
</style>