<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useI18n } from '../../i18n'
import { useUpdater } from '../../composables/useUpdater'
import { resolvePortableMode } from '../../utils/portable'
import sponsorPayUrl from '../../assets/sponsor-pay.png'

const { t } = useI18n()

const portableMode = ref<boolean | null>(null)
const payModalOpen = ref(false)
const { status, newVersion, progress, checkForUpdate, downloadAndInstall } = useUpdater()

const updateUiExpanded = computed(
  () =>
    portableMode.value === false &&
    (status.value === 'available' ||
      status.value === 'downloading' ||
      status.value === 'checking' ||
      status.value === 'up-to-date'),
)

onMounted(async () => {
  portableMode.value = await resolvePortableMode()
})

function onEscape(event: KeyboardEvent) {
  if (event.key === 'Escape' && payModalOpen.value) {
    payModalOpen.value = false
  }
}

watch(payModalOpen, (open) => {
  if (open) {
    window.addEventListener('keydown', onEscape)
  } else {
    window.removeEventListener('keydown', onEscape)
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onEscape)
})

async function openUrl(url: string) {
  try {
    await invoke('open_url', { url })
  } catch (error) {
    console.error('Failed to open URL:', error)
  }
}
</script>

<template>
  <div class="flex-1 flex flex-col min-h-0 overflow-hidden items-center px-7 py-8 w-full">
    <div class="shrink-0 flex flex-col items-center w-full max-w-85">
      <div
        class="settings-app-icon w-16 h-16 rounded-2xl flex items-center justify-center"
        :class="updateUiExpanded ? 'mb-3' : 'mb-4'"
      >
        <svg class="w-8 h-8 text-accent" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M659.498667 412.8l-6.101334-6.058667a233.6 233.6 0 0 0-101.973333-57.557333c-124.032-33.237333-243.157333 37.077333-276.992 163.413333-1.834667 6.826667-2.816 14.506667-4.437333 33.749334-6.570667 79.786667-25.344 139.306667-76.8 199.68 96.426667 37.888 210.688 64.597333 297.557333 64.597333a234.88 234.88 0 0 0 226.56-174.037333 234.538667 234.538667 0 0 0-57.856-223.786667z m-92.501334-147.712l210.730667-163.925333a42.666667 42.666667 0 0 1 56.32 3.541333l127.786667 127.744a42.666667 42.666667 0 0 1 3.498666 56.32l-163.84 210.730667a320.213333 320.213333 0 0 1-310.741333 396.458666C341.333333 895.957333 149.333333 831.872 42.666667 767.872c169.813333-128 130.005333-205.226667 149.333333-277.333333 45.141333-168.533333 206.592-267.008 374.997333-225.450667zM712.533333 345.258667c2.816 2.688 5.546667 5.461333 8.277334 8.234666L769.28 401.92l105.6-135.765333-74.496-74.496-135.765333 105.6L712.533333 345.258667z"
            fill="currentColor"
          />
        </svg>
      </div>

      <h1 class="font-semibold settings-text-heading tracking-wide mb-1">MarkerOn</h1>
      <p class="settings-text-body text-center" :class="updateUiExpanded ? 'mb-3' : 'mb-4'">
        {{ t('about.tagline') }}
      </p>

      <div class="flex flex-col items-center gap-2 w-full" :class="updateUiExpanded ? 'mb-3' : 'mb-6'">
        <p v-if="portableMode === true" class="settings-text-subtle text-center text-xs leading-relaxed m-0 px-2">
          {{ t('about.portableUpdateHint') }}
        </p>

        <template v-else-if="portableMode === false">
          <button
            v-if="status === 'idle' || status === 'error'"
            class="settings-btn-accent-outline px-4 py-1.5 rounded-lg cursor-pointer"
            @click="checkForUpdate()"
          >
            {{ status === 'error' ? t('about.updateError') : t('about.checkUpdate') }}
          </button>

          <span v-else-if="status === 'checking'" class="settings-text-subtle flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {{ t('about.checking') }}
          </span>

          <div v-else-if="status === 'available'" class="flex flex-col items-center gap-1.5">
            <span class="settings-text-accent">{{ t('about.updateAvailable', { version: newVersion }) }}</span>
            <button
              class="settings-btn-accent-primary px-4 py-1.5 rounded-lg cursor-pointer"
              @click="downloadAndInstall()"
            >
              {{ t('about.installAndRestart') }}
            </button>
          </div>

          <div v-else-if="status === 'downloading'" class="flex flex-col items-center gap-1.5 w-full max-w-50">
            <span class="settings-text-subtle">{{ t('about.downloading', { progress: String(progress) }) }}</span>
            <div class="settings-progress-track w-full h-1.5 rounded-full overflow-hidden">
              <div
                class="settings-progress-fill h-full rounded-full transition-all duration-300"
                :style="{ width: progress + '%' }"
              />
            </div>
          </div>

          <span v-else-if="status === 'up-to-date'" class="settings-status-success">
            {{ t('about.upToDate') }}
          </span>
        </template>
      </div>
    </div>

    <div class="w-full max-w-85 shrink-0">
      <div class="settings-card w-full overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3 ui-divider-b settings-row-hover transition-colors">
          <span class="settings-text-row-key">{{ t('about.license') }}</span>
          <span class="settings-text-value">MIT License</span>
        </div>
        <button
          class="w-full flex items-center justify-between px-4 py-3 ui-divider-b settings-row-hover-strong transition-colors cursor-pointer bg-transparent border-x-0 border-t-0"
          @click="openUrl('https://github.com/ifer47/markeron')"
        >
          <span class="settings-text-row-key">GitHub</span>
          <span class="flex items-center gap-1.5 settings-text-accent-link">
            ifer47/markeron
            <svg
              class="w-3 h-3 opacity-50"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </span>
        </button>
        <button
          type="button"
          class="w-full flex items-center justify-between px-4 py-3 ui-divider-b settings-row-hover-strong transition-colors cursor-pointer bg-transparent border-x-0 border-t-0"
          :aria-label="t('about.sponsorPay')"
          :title="t('about.sponsorPay')"
          @click="payModalOpen = true"
        >
          <span class="settings-text-row-key">{{ t('about.sponsor') }}</span>
          <svg
            class="w-3.5 h-3.5 settings-text-accent-link"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <path d="M14 14h3v3h-3z" />
            <path d="M20 14v3" />
            <path d="M14 20h6" />
          </svg>
        </button>
        <button
          class="w-full flex items-center justify-between px-4 py-3 settings-row-hover-strong transition-colors cursor-pointer bg-transparent border-none"
          @click="openUrl('https://github.com/ifer47/markeron/issues')"
        >
          <span class="settings-text-row-key">{{ t('about.feedback') }}</span>
          <svg
            class="w-3.5 h-3.5 settings-text-dim"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    </div>

    <p class="shrink-0 mt-auto pt-6 pb-1 settings-text-footer tracking-wide">&copy; 2026 ifer47 &middot; Open Source</p>

    <Teleport to="body">
      <div
        v-if="payModalOpen"
        class="settings-modal-backdrop fixed inset-0 z-100000 flex items-center justify-center p-6"
        role="dialog"
        aria-modal="true"
        :aria-label="t('about.sponsorPayTitle')"
        @click.self="payModalOpen = false"
      >
        <div class="settings-modal-panel relative max-w-[min(520px,92vw)] w-full rounded-2xl overflow-hidden">
          <button
            type="button"
            class="settings-modal-close absolute top-2.5 right-2.5 z-10 w-7 h-7 rounded-full flex items-center justify-center cursor-pointer border-none"
            :aria-label="t('about.sponsorPayClose')"
            @click="payModalOpen = false"
          >
            <svg
              class="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <img :src="sponsorPayUrl" :alt="t('about.sponsorPayTitle')" class="block w-full h-auto" draggable="false" />
        </div>
      </div>
    </Teleport>
  </div>
</template>
