<script setup lang="ts">
import { ref, computed, nextTick, onUnmounted } from 'vue'
import { useI18n } from '../../i18n'
import sponsorsData from '../../data/sponsors'

const { t } = useI18n()

const APP_VERSION = __APP_VERSION__

const CLICKS_NEEDED = 3
const CLICK_WINDOW_MS = 3000
const SHAKE_MS = 480
const UNROLL_MS = 650
const HOLD_AFTER_SCROLL_MS = 2000
const CLOSE_MS = 500

type Phase = 'idle' | 'shake' | 'unroll' | 'scroll' | 'close'

const phase = ref<Phase>('idle')
const versionBtnRef = ref<HTMLElement | null>(null)
const trackRef = ref<HTMLElement | null>(null)
const viewportRef = ref<HTMLElement | null>(null)

const creditSections = computed(() => [
  {
    kind: 'sponsors' as const,
    sponsors: sponsorsData.sponsors,
    emptyText: t('settings.creditsRoll.sponsorsEmpty'),
  },
])

function formatSponsorPlan(plan: string) {
  return plan.replace(/^⭐\s*/, '').trim()
}

const clickTimestamps: number[] = []
let timers: ReturnType<typeof setTimeout>[] = []
let shakeAnimation: Animation | null = null

function schedule(ms: number, fn: () => void) {
  const id = setTimeout(fn, ms)
  timers.push(id)
}

function clearTimers() {
  for (const id of timers) clearTimeout(id)
  timers = []
}

function resetScrollTrack() {
  const track = trackRef.value
  if (!track) return
  track.classList.remove('is-scrolling')
  track.style.removeProperty('--credits-distance')
  track.style.removeProperty('--credits-duration')
}

function stopShakeAnimation() {
  shakeAnimation?.cancel()
  shakeAnimation = null
  versionBtnRef.value?.style.removeProperty('transform')
}

function playShake() {
  const el = versionBtnRef.value
  if (!el || typeof el.animate !== 'function') return

  stopShakeAnimation()
  shakeAnimation = el.animate(
    [
      { transform: 'translateX(0) scale(1)' },
      { transform: 'translateX(-6px) scale(1.03)' },
      { transform: 'translateX(6px) scale(1.02)' },
      { transform: 'translateX(-4px) scale(1.025)' },
      { transform: 'translateX(4px) scale(1.01)' },
      { transform: 'translateX(-2px) scale(1.015)' },
      { transform: 'translateX(0) scale(1)' },
    ],
    {
      duration: SHAKE_MS,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'none',
    },
  )
}

function resetEasterEgg() {
  stopShakeAnimation()
  phase.value = 'idle'
  resetScrollTrack()
}

function beginScroll() {
  const track = trackRef.value
  const viewport = viewportRef.value
  if (!track || !viewport) {
    schedule(HOLD_AFTER_SCROLL_MS, () => {
      phase.value = 'close'
    })
    schedule(HOLD_AFTER_SCROLL_MS + CLOSE_MS, resetEasterEgg)
    return
  }

  const distance = Math.max(0, track.scrollHeight - viewport.clientHeight)
  const duration = Math.max(5200, Math.min(11000, distance * 38))

  track.style.setProperty('--credits-distance', `${distance}px`)
  track.style.setProperty('--credits-duration', `${duration}ms`)
  track.classList.add('is-scrolling')

  schedule(duration + HOLD_AFTER_SCROLL_MS, () => {
    phase.value = 'close'
  })
  schedule(duration + HOLD_AFTER_SCROLL_MS + CLOSE_MS, resetEasterEgg)
}

function startEasterEgg() {
  if (phase.value !== 'idle') return

  clearTimers()
  resetScrollTrack()
  phase.value = 'shake'
  void nextTick(playShake)

  schedule(SHAKE_MS, () => {
    phase.value = 'unroll'
  })

  schedule(SHAKE_MS + UNROLL_MS, () => {
    phase.value = 'scroll'
    void nextTick(beginScroll)
  })
}

function onVersionActivate(event: PointerEvent) {
  if (phase.value !== 'idle') return
  if (event.button !== 0) return

  const now = Date.now()
  while (clickTimestamps.length > 0 && now - clickTimestamps[0]! > CLICK_WINDOW_MS) {
    clickTimestamps.shift()
  }
  clickTimestamps.push(now)

  if (clickTimestamps.length >= CLICKS_NEEDED) {
    clickTimestamps.length = 0
    startEasterEgg()
  }
}

const creditsVisible = computed(() => phase.value !== 'idle')
const hideFooterLine = computed(() => phase.value !== 'idle' && phase.value !== 'shake')

onUnmounted(() => {
  clearTimers()
  stopShakeAnimation()
})
</script>

<template>
  <div
    class="mt-auto pl-5 pr-3 ui-divider-h settings-sidebar-footer"
    :class="{ 'settings-sidebar-footer--easter-egg': creditsVisible }"
  >
    <p class="settings-sidebar-footer__line" :class="{ 'settings-sidebar-footer__line--hidden': hideFooterLine }">
      <button
        ref="versionBtnRef"
        type="button"
        class="settings-sidebar-footer__version-btn"
        :class="{ 'is-shaking': phase === 'shake' }"
        :aria-label="`v${APP_VERSION}`"
        @pointerdown="onVersionActivate"
      >
        v{{ APP_VERSION }}
      </button>
      <span class="settings-sidebar-footer__sep" aria-hidden="true">·</span>
      <span class="settings-sidebar-footer__open">{{ t('settings.sidebarOpenSource') }}</span>
      <span class="settings-sidebar-footer__sep" aria-hidden="true">·</span>
      <span class="settings-sidebar-footer__license">MIT</span>
    </p>

    <div
      v-if="creditsVisible"
      class="settings-sidebar-credits"
      :class="{
        'is-unrolled': phase === 'unroll' || phase === 'scroll' || phase === 'close',
        'is-closing': phase === 'close',
      }"
      role="presentation"
      aria-hidden="true"
    >
      <div class="settings-sidebar-credits__rod" />
      <div class="settings-sidebar-credits__body">
        <div ref="viewportRef" class="settings-sidebar-credits__viewport">
          <div ref="trackRef" class="settings-sidebar-credits__track">
            <p class="settings-sidebar-credits__title">{{ t('settings.creditsRoll.title') }}</p>

            <div v-for="(section, index) in creditSections" :key="index" class="settings-sidebar-credits__section">
              <template v-if="section.kind === 'sponsors'">
                <template v-if="section.sponsors.length > 0">
                  <div
                    v-for="(sponsor, sponsorIndex) in section.sponsors"
                    :key="sponsorIndex"
                    class="settings-sidebar-credits__sponsor"
                  >
                    <span class="settings-sidebar-credits__sponsor-name">{{ sponsor.name }}</span>
                    <span
                      v-if="sponsor.plan && formatSponsorPlan(sponsor.plan)"
                      class="settings-sidebar-credits__sponsor-meta"
                    >
                      {{ formatSponsorPlan(sponsor.plan) }}
                    </span>
                  </div>
                </template>
                <p v-else class="settings-sidebar-credits__name">{{ section.emptyText }}</p>
              </template>
            </div>

            <p class="settings-sidebar-credits__closing">{{ t('settings.creditsRoll.closing') }}</p>
          </div>
        </div>
      </div>
      <div class="settings-sidebar-credits__rod" />
    </div>
  </div>
</template>
