<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { enable, isEnabled, disable } from '@tauri-apps/plugin-autostart'
import type { AppConfig } from '../../types/app'
import { useI18n } from '../../i18n'

const { t, locale, setLocale, availableLocales } = useI18n()

const localeLabels: Record<string, string> = {
  en: 'English',
  'zh-CN': '简体中文',
}

const localeOpen = ref(false)
const localeDropdownRef = ref<HTMLElement | null>(null)

const snapStepOptions = [15, 30, 45] as const

const props = defineProps<{
  enableDragging: boolean
  preserveDrawings: boolean
  whiteboardPreserveDrawings: boolean
  autoStartEnabled: boolean
  angleSnapStep: 15 | 30 | 45
}>()

const emit = defineEmits<{
  'update:enableDragging': [value: boolean]
  'update:preserveDrawings': [value: boolean]
  'update:whiteboardPreserveDrawings': [value: boolean]
  'update:autoStartEnabled': [value: boolean]
  'update:angleSnapStep': [value: 15 | 30 | 45]
}>()

async function changeLocale(loc: string) {
  localeOpen.value = false
  if (loc === locale.locale) return
  setLocale(loc)
  try {
    await invoke('save_locale', { locale: loc })
  } catch (error) {
    console.error('Failed to save locale:', error)
  }
}

function toggleLocaleDropdown() {
  localeOpen.value = !localeOpen.value
  if (localeOpen.value) {
    nextTick(() => {
      document.addEventListener('click', closeLocaleDropdown, { once: true })
    })
  }
}

function closeLocaleDropdown(e: MouseEvent) {
  if (localeDropdownRef.value && !localeDropdownRef.value.contains(e.target as Node)) {
    localeOpen.value = false
  } else if (localeOpen.value) {
    nextTick(() => {
      document.addEventListener('click', closeLocaleDropdown, { once: true })
    })
  }
}

async function toggleAutoStart() {
  try {
    if (props.autoStartEnabled) {
      await disable()
    } else {
      await enable()
    }
    emit('update:autoStartEnabled', await isEnabled())
  } catch (error) {
    console.error('Failed to toggle auto start:', error)
  }
}

async function toggleDragging() {
  const newValue = !props.enableDragging
  emit('update:enableDragging', newValue)
  try {
    const cfg = await invoke<AppConfig>('get_config')
    if (!cfg.general)
      cfg.general = {
        enableDragging: false,
        preserveDrawings: false,
        whiteboardPreserveDrawings: true,
        angleSnapStep: props.angleSnapStep,
      }
    cfg.general.enableDragging = newValue
    await invoke('save_general', { general: cfg.general })
  } catch (error) {
    console.error('Failed to save drag setting:', error)
  }
}

async function togglePreserveDrawings() {
  const newValue = !props.preserveDrawings
  emit('update:preserveDrawings', newValue)
  try {
    const cfg = await invoke<AppConfig>('get_config')
    if (!cfg.general)
      cfg.general = {
        enableDragging: false,
        preserveDrawings: false,
        whiteboardPreserveDrawings: true,
        angleSnapStep: props.angleSnapStep,
      }
    cfg.general.preserveDrawings = newValue
    cfg.general.angleSnapStep = props.angleSnapStep
    await invoke('save_general', { general: cfg.general })
  } catch (error) {
    console.error('Failed to save preserve drawings setting:', error)
  }
}

async function toggleWhiteboardPreserveDrawings() {
  const newValue = !props.whiteboardPreserveDrawings
  emit('update:whiteboardPreserveDrawings', newValue)
  try {
    const cfg = await invoke<AppConfig>('get_config')
    if (!cfg.general)
      cfg.general = {
        enableDragging: false,
        preserveDrawings: false,
        whiteboardPreserveDrawings: true,
        angleSnapStep: props.angleSnapStep,
      }
    cfg.general.whiteboardPreserveDrawings = newValue
    cfg.general.angleSnapStep = props.angleSnapStep
    await invoke('save_general', { general: cfg.general })
  } catch (error) {
    console.error('Failed to save whiteboard preserve drawings setting:', error)
  }
}

async function toggleAngleSnapStep(step: (typeof snapStepOptions)[number]) {
  if (step === props.angleSnapStep) return
  emit('update:angleSnapStep', step)
  try {
    const cfg = await invoke<AppConfig>('get_config')
    if (!cfg.general)
      cfg.general = {
        enableDragging: false,
        preserveDrawings: false,
        whiteboardPreserveDrawings: true,
        angleSnapStep: step,
      }
    cfg.general.angleSnapStep = step
    await invoke('save_general', { general: cfg.general })
  } catch (error) {
    console.error('Failed to save snap step setting:', error)
  }
}
</script>

<template>
  <div class="flex-1 flex flex-col px-7 py-6 overflow-y-auto settings-scroll">
    <h2 class="text-[14px] font-semibold text-white/75 mb-4">{{ t('settings.generalTitle') }}</h2>

    <div class="flex flex-col gap-2">
      <div
        class="flex flex-col gap-3 px-4 py-3.5 rounded-lg border border-white/5 bg-white/2 hover:bg-white/4 hover:border-white/10 transition-all duration-200"
      >
        <div class="flex items-center justify-between">
          <span class="text-[12.5px] text-white/70">{{ t('settings.language') }}</span>
          <div ref="localeDropdownRef" class="relative">
            <button
              class="flex items-center gap-1.5 px-3 py-[5px] rounded-md bg-white/6 border border-white/8 text-[12px] text-white/75 cursor-pointer outline-none hover:bg-white/10 hover:border-white/15 transition-all duration-150"
              @click="toggleLocaleDropdown"
            >
              {{ localeLabels[locale.locale] || locale.locale }}
              <svg
                class="w-3 h-3 text-white/35 transition-transform duration-150"
                :class="localeOpen ? 'rotate-180' : ''"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <Transition name="dropdown">
              <div
                v-if="localeOpen"
                class="absolute right-0 top-full mt-1 min-w-[120px] py-1 rounded-lg bg-[#2a2a2c] border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)] z-50 overflow-hidden"
              >
                <button
                  v-for="loc in availableLocales"
                  :key="loc"
                  class="w-full flex items-center gap-2 px-3 py-[6px] text-[12px] border-none cursor-pointer transition-colors duration-100"
                  :class="
                    locale.locale === loc
                      ? 'bg-accent/12 text-accent'
                      : 'bg-transparent text-white/65 hover:bg-white/8 hover:text-white/90'
                  "
                  @click="changeLocale(loc)"
                >
                  <svg
                    v-if="locale.locale === loc"
                    class="w-3 h-3 shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span v-else class="w-3 shrink-0"></span>
                  {{ localeLabels[loc] || loc }}
                </button>
              </div>
            </Transition>
          </div>
        </div>
      </div>

      <div
        class="flex flex-col gap-3 px-4 py-3.5 rounded-lg border border-white/5 bg-white/2 hover:bg-white/4 hover:border-white/10 transition-all duration-200"
      >
        <div class="flex items-center justify-between">
          <span class="text-[12.5px] text-white/70">{{ t('settings.autoStart') }}</span>
          <button
            role="switch"
            :aria-checked="autoStartEnabled"
            :aria-label="t('settings.autoStart')"
            class="relative w-8 h-4.5 rounded-full transition-colors duration-200 cursor-pointer border-none p-0 outline-none shadow-inner"
            :class="autoStartEnabled ? 'bg-accent/80' : 'bg-white/20 hover:bg-white/30'"
            @click="toggleAutoStart"
          >
            <span
              class="absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-md transition-transform duration-200"
              :class="autoStartEnabled ? 'translate-x-[14px]' : 'translate-x-0'"
            />
          </button>
        </div>
      </div>

      <div
        class="flex flex-col gap-3 px-4 py-3.5 rounded-lg border border-white/5 bg-white/2 hover:bg-white/4 hover:border-white/10 transition-all duration-200"
      >
        <div class="flex items-center justify-between">
          <span class="text-[12.5px] text-white/70">{{ t('settings.enableDragging') }}</span>
          <button
            role="switch"
            :aria-checked="enableDragging"
            :aria-label="t('settings.enableDragging')"
            class="relative w-8 h-4.5 rounded-full transition-colors duration-200 cursor-pointer border-none p-0 outline-none shadow-inner"
            :class="enableDragging ? 'bg-accent/80' : 'bg-white/20 hover:bg-white/30'"
            @click="toggleDragging"
          >
            <span
              class="absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-md transition-transform duration-200"
              :class="enableDragging ? 'translate-x-[14px]' : 'translate-x-0'"
            />
          </button>
        </div>

        <p class="text-[10px] text-white/25 leading-relaxed m-0 border-t border-white/5 pt-2">
          {{ t('settings.enableDraggingDesc') }}
        </p>
      </div>

      <div
        class="flex flex-col gap-3 px-4 py-3.5 rounded-lg border border-white/5 bg-white/2 hover:bg-white/4 hover:border-white/10 transition-all duration-200"
      >
        <div class="flex items-center justify-between gap-4">
          <span class="text-[12.5px] text-white/70">{{ t('settings.angleSnapStep') }}</span>
          <div class="flex items-center gap-1.5 shrink-0">
            <button
              v-for="step in snapStepOptions"
              :key="step"
              class="px-2.5 py-[4px] rounded-md border text-[10.5px] leading-none transition-colors duration-120"
              :class="
                angleSnapStep === step
                  ? 'bg-accent/15 border-accent/40 text-accent'
                  : 'bg-white/6 border-white/8 text-white/65 hover:bg-white/10 hover:text-white/85'
              "
              @click="toggleAngleSnapStep(step)"
            >
              {{ step }}°
            </button>
          </div>
        </div>

        <p class="text-[10px] text-white/25 leading-relaxed m-0 border-t border-white/5 pt-2">
          {{ t('settings.angleSnapStepDesc') }}
        </p>
      </div>

      <div
        class="flex flex-col gap-3 px-4 py-3.5 rounded-lg border border-white/5 bg-white/2 hover:bg-white/4 hover:border-white/10 transition-all duration-200"
      >
        <div class="flex items-center justify-between">
          <span class="text-[12.5px] text-white/70">{{ t('settings.preserveDrawings') }}</span>
          <button
            role="switch"
            :aria-checked="preserveDrawings"
            :aria-label="t('settings.preserveDrawings')"
            class="relative w-8 h-4.5 rounded-full transition-colors duration-200 cursor-pointer border-none p-0 outline-none shadow-inner"
            :class="preserveDrawings ? 'bg-accent/80' : 'bg-white/20 hover:bg-white/30'"
            @click="togglePreserveDrawings"
          >
            <span
              class="absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-md transition-transform duration-200"
              :class="preserveDrawings ? 'translate-x-[14px]' : 'translate-x-0'"
            />
          </button>
        </div>

        <p class="text-[10px] text-white/25 leading-relaxed m-0 border-t border-white/5 pt-2">
          {{ t('settings.preserveDrawingsDesc') }}
        </p>
      </div>

      <div
        class="flex flex-col gap-3 px-4 py-3.5 rounded-lg border border-white/5 bg-white/2 hover:bg-white/4 hover:border-white/10 transition-all duration-200"
      >
        <div class="flex items-center justify-between">
          <span class="text-[12.5px] text-white/70">{{ t('settings.whiteboardPreserveDrawings') }}</span>
          <button
            role="switch"
            :aria-checked="whiteboardPreserveDrawings"
            :aria-label="t('settings.whiteboardPreserveDrawings')"
            class="relative w-8 h-4.5 rounded-full transition-colors duration-200 cursor-pointer border-none p-0 outline-none shadow-inner"
            :class="whiteboardPreserveDrawings ? 'bg-accent/80' : 'bg-white/20 hover:bg-white/30'"
            @click="toggleWhiteboardPreserveDrawings"
          >
            <span
              class="absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-md transition-transform duration-200"
              :class="whiteboardPreserveDrawings ? 'translate-x-[14px]' : 'translate-x-0'"
            />
          </button>
        </div>

        <p class="text-[10px] text-white/25 leading-relaxed m-0 border-t border-white/5 pt-2">
          {{ t('settings.whiteboardPreserveDrawingsDesc') }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dropdown-enter-active,
.dropdown-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.97);
}
</style>
