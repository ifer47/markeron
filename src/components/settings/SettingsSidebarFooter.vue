<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useI18n } from '../../i18n'
import {
  bundledSponsors,
  loadSponsors,
  refreshSponsors,
  sponsorHue,
  sponsorMonogram,
  type SponsorEntry,
} from '../../data/sponsors'

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
const creditsRef = ref<HTMLElement | null>(null)
const sponsorsBtnRef = ref<HTMLElement | null>(null)
const trackRef = ref<HTMLElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

/** Instant paint from bundle; refreshed from GitHub raw when available. */
const sponsors = ref<SponsorEntry[]>(bundledSponsors.sponsors)
const hasSponsors = computed(() => sponsors.value.length > 0)
const loopEnabled = computed(() => hasSponsors.value)

/** 加载失败的头像（按 URL 去重），失败后回退到下一候选或首字徽章。 */
const failedAvatarUrls = ref<Set<string>>(new Set())
/** 已经从 GitHub raw 成功加载的远程头像，加载后优先展示。 */
const remoteAvatarUrls = ref<Set<string>>(new Set())
const remotePreloads = new Map<string, HTMLImageElement>()
let disposed = false

function onAvatarError(url?: string) {
  if (!url || failedAvatarUrls.value.has(url)) return
  const next = new Set(failedAvatarUrls.value)
  next.add(url)
  failedAvatarUrls.value = next
}

function onAvatarErrorEvent(event: Event) {
  const target = event.target
  if (target instanceof HTMLImageElement) {
    onAvatarError(target.getAttribute('src') ?? undefined)
  }
}

/** 本地图片先显示；远程预加载成功后再替换，避免离线时等待网络。 */
function activeAvatarUrl(sponsor: SponsorEntry): string | undefined {
  const remote = sponsor.avatarRemoteUrl
  if (remote && remoteAvatarUrls.value.has(remote) && !failedAvatarUrls.value.has(remote)) {
    return remote
  }
  if (sponsor.avatarUrl && !failedAvatarUrls.value.has(sponsor.avatarUrl)) return sponsor.avatarUrl
  if (remote && !failedAvatarUrls.value.has(remote)) return remote
  return undefined
}

function preloadRemoteAvatars() {
  for (const sponsor of sponsors.value) {
    const remote = sponsor.avatarRemoteUrl
    // 没有本地图时 <img> 会直接请求远程，无需重复预加载
    if (!remote || !sponsor.avatarUrl || remotePreloads.has(remote) || remoteAvatarUrls.value.has(remote)) {
      continue
    }
    const image = new Image()
    remotePreloads.set(remote, image)
    image.onload = () => {
      remotePreloads.delete(remote)
      const next = new Set(remoteAvatarUrls.value)
      next.add(remote)
      remoteAvatarUrls.value = next
    }
    image.onerror = () => {
      remotePreloads.delete(remote)
    }
    image.src = remote
  }
}

function maybePreloadRemoteAvatars() {
  if (phase.value === 'idle') return
  preloadRemoteAvatars()
}

/** Refresh the official sponsors.json; the GitHub raw cache may still serve a recent copy. */
function refreshSponsorList() {
  void refreshSponsors()
    .then((list) => {
      if (disposed) return
      sponsors.value = list
      maybePreloadRemoteAvatars()
    })
    .catch((error) => {
      console.warn('[sponsors] refresh failed, keeping current list', error)
    })
}

type SponsorTier = 'supporter' | 'patron' | 'guardian' | 'contributor'

const PLAN_META: Record<string, { tier: SponsorTier; key: string }> = {
  supporter: { tier: 'supporter', key: 'settings.creditsRoll.planSupporter' },
  'markeron 支持者': { tier: 'supporter', key: 'settings.creditsRoll.planSupporter' },
  'markeron supporter': { tier: 'supporter', key: 'settings.creditsRoll.planSupporter' },
  支持者: { tier: 'supporter', key: 'settings.creditsRoll.planSupporter' },
  patron: { tier: 'patron', key: 'settings.creditsRoll.planPatron' },
  同行者: { tier: 'patron', key: 'settings.creditsRoll.planPatron' },
  guardian: { tier: 'guardian', key: 'settings.creditsRoll.planGuardian' },
  守护者: { tier: 'guardian', key: 'settings.creditsRoll.planGuardian' },
  contributor: { tier: 'contributor', key: 'settings.creditsRoll.planContributor' },
  共创者: { tier: 'contributor', key: 'settings.creditsRoll.planContributor' },
  'co-creator': { tier: 'contributor', key: 'settings.creditsRoll.planContributor' },
}

function planMeta(plan?: string) {
  if (!plan) return undefined
  const key = plan.toLowerCase()
  return Object.prototype.hasOwnProperty.call(PLAN_META, key) ? PLAN_META[key] : undefined
}

function planLabel(plan?: string): string {
  const meta = planMeta(plan)
  return meta ? t(meta.key) : (plan ?? '')
}

function planTier(plan?: string): SponsorTier {
  return planMeta(plan)?.tier ?? 'supporter'
}

/** 纯 ASCII 名字（英文 / 数字）在楷体里只有 x-height，视觉上比中文名低。 */
function isLatinName(name: string): boolean {
  return /^[\x20-\x7E]+$/.test(name.trim())
}

onMounted(() => {
  void loadSponsors().then((list) => {
    if (disposed) return
    sponsors.value = list
    maybePreloadRemoteAvatars()
  })
  window.addEventListener('blur', onWindowBlur)
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('pointermove', onDocumentPointerMove)
})

let sequenceTimers: ReturnType<typeof setTimeout>[] = []
let closeTimers: ReturnType<typeof setTimeout>[] = []
/** 离开面板后的延迟关闭：只由 pointerenter 取消 */
let leaveTimer: ReturnType<typeof setTimeout> | null = null
/** 无人交互时的兜底关闭：只由 resetEasterEgg 取消 */
let guardTimer: ReturnType<typeof setTimeout> | null = null
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

function clearLeaveTimer() {
  if (leaveTimer === null) return
  clearTimeout(leaveTimer)
  leaveTimer = null
}

function clearGuardTimer() {
  if (guardTimer === null) return
  clearTimeout(guardTimer)
  guardTimer = null
}

/** 离开后延迟关闭。与兜底计时器互不影响，避免一方把另一方清掉。 */
function armLeaveClose(delayMs = LEAVE_CLOSE_DELAY_MS) {
  clearLeaveTimer()
  leaveTimer = setTimeout(() => {
    leaveTimer = null
    beginClose()
  }, delayMs)
}

function armGuardClose(delayMs: number) {
  clearGuardTimer()
  guardTimer = setTimeout(() => {
    guardTimer = null
    beginClose()
  }, delayMs)
}

function clearAllTimers() {
  clearSequenceTimers()
  clearCloseTimers()
  clearLeaveTimer()
  clearGuardTimer()
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
  clearLeaveTimer()
  clearGuardTimer()
  phase.value = 'idle'
  creditsHovered.value = false
  resetScrollTrack()
}

function beginClose() {
  if (phase.value === 'idle' || phase.value === 'close') return
  // 悬停中不关闭，但要重排复检：一旦某次 pointerleave 没被派发，
  // 也不能把面板忘在打开状态
  if (creditsHovered.value) {
    armLeaveClose()
    return
  }
  clearAllTimers()
  phase.value = 'close'
  scheduleClose(CLOSE_MS, resetEasterEgg)
}

function beginScroll() {
  const track = trackRef.value
  const list = listRef.value
  if (!track || !list) {
    armGuardClose(HOLD_AFTER_SCROLL_MS)
    return
  }

  const distance = list.offsetHeight
  if (distance <= 0) {
    armGuardClose(HOLD_AFTER_SCROLL_MS)
    return
  }

  // 按单份名单高度循环；无人悬停时给一个较长兜底关闭
  const duration = Math.max(4200, Math.min(14000, distance * 48))

  track.style.setProperty('--credits-distance', `${distance}px`)
  track.style.setProperty('--credits-duration', `${duration}ms`)
  track.classList.add('is-scrolling')

  // 兜底计时器独立维护，不能清掉上面已经排定的“离开后关闭”
  armGuardClose(duration * 2 + HOLD_AFTER_SCROLL_MS)
}

function startEasterEgg() {
  if (phase.value !== 'idle') return

  clearAllTimers()
  resetScrollTrack()
  creditsHovered.value = false
  phase.value = 'shake'
  maybePreloadRemoteAvatars()
  void refreshSponsorList()
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
  // 只取消“离开关闭”，不要打断展开/滚动序列，也不要动兜底计时
  clearLeaveTimer()
}

function onCreditsLeave() {
  creditsHovered.value = false
  if (phase.value === 'idle' || phase.value === 'close' || phase.value === 'shake') return
  armLeaveClose()
}

/**
 * 自愈：只要指针真实移动过，就用命中测试重新同步悬停状态。
 * 这样即使某次 pointerleave 没被派发（合成层、窗口切换等），也不会把面板永久卡在打开状态。
 */
function onDocumentPointerMove(event: PointerEvent) {
  const panel = creditsRef.value
  if (!panel || phase.value === 'idle' || phase.value === 'close') return
  const inside = event.target instanceof Node && panel.contains(event.target)
  if (inside === creditsHovered.value) return
  creditsHovered.value = inside
  if (inside) clearLeaveTimer()
  else if (phase.value !== 'shake') armLeaveClose()
}

/** 窗口失焦（Alt+Tab、切换到其它应用）不会派发 pointerleave，需主动关闭 */
function onWindowBlur() {
  creditsHovered.value = false
  if (phase.value === 'idle') return
  beginClose()
}

/** 点击面板以外的区域关闭 */
function onDocumentPointerDown(event: PointerEvent) {
  const panel = creditsRef.value
  if (!panel || phase.value === 'idle') return
  const target = event.target
  if (!(target instanceof Node)) return
  if (panel.contains(target)) return
  if (sponsorsBtnRef.value?.contains(target)) return
  creditsHovered.value = false
  beginClose()
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

// 面板滚动期间名单变长（刷新或新 contributor）时重新计算滚动距离
watch(
  () => sponsors.value.length,
  () => {
    if (phase.value !== 'scroll') return
    resetScrollTrack()
    void nextTick(beginScroll)
  },
)

onUnmounted(() => {
  disposed = true
  window.removeEventListener('blur', onWindowBlur)
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('pointermove', onDocumentPointerMove)
  clearAllTimers()
  stopShakeAnimation()
  for (const image of remotePreloads.values()) {
    image.onload = null
    image.onerror = null
  }
  remotePreloads.clear()
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
      ref="creditsRef"
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
                  :class="[
                    `settings-sidebar-credits__sponsor--${planTier(sponsor.plan)}`,
                    { 'settings-sidebar-credits__sponsor--latin-name': isLatinName(sponsor.name) },
                  ]"
                >
                  <span
                    class="settings-sidebar-credits__avatar"
                    :style="{ '--credits-avatar-hue': sponsorHue(sponsor.name) }"
                  >
                    <span
                      v-if="!activeAvatarUrl(sponsor)"
                      class="settings-sidebar-credits__avatar-fallback"
                      aria-hidden="true"
                      >{{ sponsorMonogram(sponsor.name) }}</span
                    >
                    <img
                      v-if="activeAvatarUrl(sponsor)"
                      :key="activeAvatarUrl(sponsor) ?? ''"
                      class="settings-sidebar-credits__avatar-img"
                      :src="activeAvatarUrl(sponsor)"
                      alt=""
                      decoding="async"
                      draggable="false"
                      @error="onAvatarErrorEvent"
                    />
                  </span>
                  <span class="settings-sidebar-credits__sponsor-text">
                    <span class="settings-sidebar-credits__sponsor-name">{{ sponsor.name }}</span>
                    <span v-if="sponsor.plan" class="settings-sidebar-credits__sponsor-plan">{{
                      planLabel(sponsor.plan)
                    }}</span>
                  </span>
                </div>
              </div>
              <!-- 第二份用于无缝衔接 -->
              <div class="settings-sidebar-credits__section" aria-hidden="true">
                <div
                  v-for="(sponsor, sponsorIndex) in sponsors"
                  :key="`b-${sponsorIndex}`"
                  class="settings-sidebar-credits__sponsor"
                  :class="[
                    `settings-sidebar-credits__sponsor--${planTier(sponsor.plan)}`,
                    { 'settings-sidebar-credits__sponsor--latin-name': isLatinName(sponsor.name) },
                  ]"
                >
                  <span
                    class="settings-sidebar-credits__avatar"
                    :style="{ '--credits-avatar-hue': sponsorHue(sponsor.name) }"
                  >
                    <span
                      v-if="!activeAvatarUrl(sponsor)"
                      class="settings-sidebar-credits__avatar-fallback"
                      aria-hidden="true"
                      >{{ sponsorMonogram(sponsor.name) }}</span
                    >
                    <img
                      v-if="activeAvatarUrl(sponsor)"
                      :key="activeAvatarUrl(sponsor) ?? ''"
                      class="settings-sidebar-credits__avatar-img"
                      :src="activeAvatarUrl(sponsor)"
                      alt=""
                      decoding="async"
                      draggable="false"
                      @error="onAvatarErrorEvent"
                    />
                  </span>
                  <span class="settings-sidebar-credits__sponsor-text">
                    <span class="settings-sidebar-credits__sponsor-name">{{ sponsor.name }}</span>
                    <span v-if="sponsor.plan" class="settings-sidebar-credits__sponsor-plan">{{
                      planLabel(sponsor.plan)
                    }}</span>
                  </span>
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
