<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useI18n } from '../../i18n'
import { bundledSponsors, loadSponsors, type SponsorEntry } from '../../data/sponsors'

const { t } = useI18n()

const APP_VERSION = __APP_VERSION__
const RELEASES_LATEST_URL = 'https://github.com/ifer47/markeron/releases/latest'

const SHAKE_MS = 480
const UNROLL_MS = 560
const HOLD_AFTER_SCROLL_MS = 2000
const LEAVE_CLOSE_DELAY_MS = 2000
const CLOSE_MS = 420

type Phase = 'idle' | 'shake' | 'unroll' | 'scroll' | 'close'

const phase = ref<Phase>('idle')
const creditsHovered = ref(false)
const sponsorsBtnRef = ref<HTMLElement | null>(null)
const trackRef = ref<HTMLElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

/** Instant paint from bundle; refreshed from GitHub raw when available. */
const sponsors = ref<SponsorEntry[]>(bundledSponsors.sponsors)
const hasSponsors = computed(() => sponsors.value.length > 0)
const loopEnabled = computed(() => hasSponsors.value)

onMounted(() => {
  void loadSponsors().then((list) => {
    sponsors.value = list
  })
})

let sequenceTimers: ReturnType<typeof setTimeout>[] = []
let closeTimers: ReturnType<typeof setTimeout>[] = []
let shakeAnimation: Animation | null = null

function scheduleSequence(ms: number, fn: () => void) {
  const id = setTimeout(fn, ms)
  sequenceTimers.push(id)
}

function scheduleClose(ms: number, fn: () => void) {
  const id = setTimeout(fn, ms)
  closeTimers.push(id)
}

function clearSequenceTimers() {
  for (const id of sequenceTimers) clearTimeout(id)
  sequenceTimers = []
}

function clearCloseTimers() {
  for (const id of closeTimers) clearTimeout(id)
  closeTimers = []
}

function clearAllTimers() {
  clearSequenceTimers()
  clearCloseTimers()
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
  sponsorsBtnRef.value?.style.removeProperty('transform')
}

function playShake() {
  const el = sponsorsBtnRef.value
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
  creditsHovered.value = false
  resetScrollTrack()
}

function beginClose() {
  if (phase.value === 'idle' || phase.value === 'close') return
  if (creditsHovered.value) return
  clearCloseTimers()
  phase.value = 'close'
  scheduleClose(CLOSE_MS, () => {
    if (creditsHovered.value) return
    resetEasterEgg()
  })
}

function scheduleAutoClose(delayMs: number) {
  clearCloseTimers()
  scheduleClose(delayMs, () => {
    if (creditsHovered.value) return
    beginClose()
  })
}

function beginScroll() {
  const track = trackRef.value
  const list = listRef.value
  if (!track || !list) {
    scheduleAutoClose(HOLD_AFTER_SCROLL_MS)
    return
  }

  const distance = list.offsetHeight
  if (distance <= 0) {
    scheduleAutoClose(HOLD_AFTER_SCROLL_MS)
    return
  }

  // 按单份名单高度循环；无人悬停时给一个较长兜底关闭
  const duration = Math.max(4200, Math.min(14000, distance * 48))

  track.style.setProperty('--credits-distance', `${distance}px`)
  track.style.setProperty('--credits-duration', `${duration}ms`)
  track.classList.add('is-scrolling')

  scheduleAutoClose(duration * 2 + HOLD_AFTER_SCROLL_MS)
}

function startEasterEgg() {
  if (phase.value !== 'idle') return

  clearAllTimers()
  resetScrollTrack()
  creditsHovered.value = false
  phase.value = 'shake'
  void nextTick(playShake)

  scheduleSequence(SHAKE_MS, () => {
    phase.value = 'unroll'
  })

  scheduleSequence(SHAKE_MS + UNROLL_MS, () => {
    phase.value = 'scroll'
    void nextTick(beginScroll)
  })
}

function onCreditsEnter() {
  if (phase.value === 'idle' || phase.value === 'close') return
  creditsHovered.value = true
  // 只取消关闭计时，不要打断展开/滚动序列
  clearCloseTimers()
}

function onCreditsLeave() {
  creditsHovered.value = false
  if (phase.value === 'idle' || phase.value === 'close' || phase.value === 'shake') return
  clearCloseTimers()
  scheduleClose(LEAVE_CLOSE_DELAY_MS, beginClose)
}

function onSponsorsActivate(event: PointerEvent) {
  if (phase.value !== 'idle') return
  if (event.button !== 0) return
  startEasterEgg()
}

async function onVersionActivate(event: PointerEvent) {
  if (event.button !== 0) return
  try {
    await invoke('open_url', { url: RELEASES_LATEST_URL })
  } catch (error) {
    console.error('Failed to open releases URL:', error)
  }
}

const creditsVisible = computed(() => phase.value !== 'idle')
// 关闭阶段同步恢复底部文案，避免弹层淡出后短暂空白
const hideFooterLine = computed(() => phase.value === 'unroll' || phase.value === 'scroll')

onUnmounted(() => {
  clearAllTimers()
  stopShakeAnimation()
})
</script>

<template>
  <div
    class="mt-auto pl-5 pr-3 ui-divider-h settings-sidebar-footer"
    :class="{ 'settings-sidebar-footer--easter-egg': creditsVisible }"
  >
    <div class="settings-sidebar-footer__meta" :class="{ 'settings-sidebar-footer__meta--hidden': hideFooterLine }">
      <button
        ref="sponsorsBtnRef"
        type="button"
        class="settings-sidebar-footer__sponsors-btn"
        :class="{ 'is-shaking': phase === 'shake' }"
        :aria-label="t('settings.sidebarSponsors')"
        @pointerdown="onSponsorsActivate"
      >
        {{ t('settings.sidebarSponsors') }}
      </button>
      <p class="settings-sidebar-footer__line">
        <button
          type="button"
          class="settings-sidebar-footer__version-btn"
          :aria-label="t('settings.sidebarOpenReleases', { version: APP_VERSION })"
          :title="t('settings.sidebarOpenReleases', { version: APP_VERSION })"
          @pointerdown="onVersionActivate"
        >
          v{{ APP_VERSION }}
        </button>
        <span class="settings-sidebar-footer__sep" aria-hidden="true">·</span>
        <span class="settings-sidebar-footer__open">{{ t('settings.sidebarOpenSource') }}</span>
        <span class="settings-sidebar-footer__sep" aria-hidden="true">·</span>
        <span class="settings-sidebar-footer__license">MIT</span>
      </p>
    </div>

    <div
      v-if="creditsVisible"
      class="settings-sidebar-credits"
      :class="{
        'is-unrolled': phase === 'unroll' || phase === 'scroll' || phase === 'close',
        'is-closing': phase === 'close',
      }"
      role="presentation"
      aria-hidden="true"
      @pointerenter="onCreditsEnter"
      @pointerleave="onCreditsLeave"
    >
      <div class="settings-sidebar-credits__body">
        <svg
          class="settings-sidebar-credits__doodle settings-sidebar-credits__doodle--tl"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M7 15c-3.2-1.4-4.6-4.8-2.8-7.2 1.6-2.2 5-2.6 6.6-.4"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <svg
          class="settings-sidebar-credits__doodle settings-sidebar-credits__doodle--tr"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4 8c3.5-3.8 11-3.2 14 1.4M16.5 6.5c1.2 1.4 1.6 3.2.8 4.6"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <svg
          class="settings-sidebar-credits__doodle settings-sidebar-credits__doodle--bl"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M7 6v10c0 1.2.8 2 2.2 2H17M9.5 14.5l-2.8 3.2"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <svg
          class="settings-sidebar-credits__doodle settings-sidebar-credits__doodle--br"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M18 8c2.8 2.2 2.6 7.4-1.2 9.2-2.4 1.2-5.2.4-6-1.4"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>

        <p class="settings-sidebar-credits__title">
          <span>{{ t('settings.creditsRoll.title') }}</span>
          <svg class="settings-sidebar-credits__title-mark" viewBox="0 0 48 12" fill="none" aria-hidden="true">
            <path
              d="M2 7.5c6.5-2.2 12.5-3.4 19-3.2 7.2.2 14.2 1.8 25 4.2"
              stroke="currentColor"
              stroke-width="3.4"
              stroke-linecap="round"
            />
          </svg>
        </p>

        <div class="settings-sidebar-credits__viewport">
          <div ref="trackRef" class="settings-sidebar-credits__track" :class="{ 'is-looping': loopEnabled }">
            <template v-if="hasSponsors">
              <div ref="listRef" class="settings-sidebar-credits__section">
                <div
                  v-for="(sponsor, sponsorIndex) in sponsors"
                  :key="`a-${sponsorIndex}`"
                  class="settings-sidebar-credits__sponsor"
                >
                  <span class="settings-sidebar-credits__sponsor-name">{{ sponsor.name }}</span>
                </div>
              </div>
              <!-- 第二份用于无缝衔接 -->
              <div class="settings-sidebar-credits__section" aria-hidden="true">
                <div
                  v-for="(sponsor, sponsorIndex) in sponsors"
                  :key="`b-${sponsorIndex}`"
                  class="settings-sidebar-credits__sponsor"
                >
                  <span class="settings-sidebar-credits__sponsor-name">{{ sponsor.name }}</span>
                </div>
              </div>
            </template>
            <p v-else class="settings-sidebar-credits__name">{{ t('settings.creditsRoll.sponsorsEmpty') }}</p>
          </div>
        </div>

        <p class="settings-sidebar-credits__closing">
          <span>{{ t('settings.creditsRoll.closing') }}</span>
          <span class="settings-sidebar-credits__ink" aria-hidden="true">
            <span class="settings-sidebar-credits__ink-dot"></span>
            <span class="settings-sidebar-credits__ink-dot"></span>
            <span class="settings-sidebar-credits__ink-dot"></span>
            <span class="settings-sidebar-credits__ink-dot"></span>
          </span>
        </p>
      </div>
    </div>
  </div>
</template>
