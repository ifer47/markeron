<script setup lang="ts">
import { ref, watch, computed, onMounted, nextTick } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { enable, disable } from '@tauri-apps/plugin-autostart'
import type { AppConfig } from '../../types/app'
import type { DragMode } from '../../utils/dragMode'
import { DRAG_MODE_OPTIONS } from '../../utils/dragMode'
import type { DefaultEntryMode } from '../../utils/entryMode'
import { DEFAULT_ENTRY_MODE_OPTIONS } from '../../utils/entryMode'
import type { EraserMode } from '../../utils/eraserMode'
import { ERASER_MODE_OPTIONS } from '../../utils/eraserMode'
import { STROKE_SMOOTHING_OPTIONS, type StrokeSmoothing } from '../../utils/strokeSmoothing'
import { applyTheme, type ThemePreference } from '../../composables/useAppTheme'
import { useI18n } from '../../i18n'
import { isMacOS } from '../../utils/platform'
import { isInstalledMode, resolvePortableMode, supportsAutostart } from '../../utils/portable'

const autoStartBusy = ref(false)
const autoStartError = ref<string | null>(null)
let autoStartErrorTimer: ReturnType<typeof setTimeout> | null = null

function showAutoStartError(text: string) {
  autoStartError.value = text
  if (autoStartErrorTimer) clearTimeout(autoStartErrorTimer)
  autoStartErrorTimer = setTimeout(() => {
    autoStartError.value = null
    autoStartErrorTimer = null
  }, 5000)
}

const { t, locale, setLocale, availableLocales } = useI18n()

const portableMode = ref<boolean | null>(null)
const autostartAvailable = ref(false)

const localeLabels: Record<string, string> = {
  en: 'English',
  'zh-CN': '\u7b80\u4f53\u4e2d\u6587',
}

const localeOpen = ref(false)
const localeDropdownRef = ref<HTMLElement | null>(null)

const themeOptions = ['dark', 'light', 'system'] as const
const dragModeOptions = DRAG_MODE_OPTIONS
const defaultEntryModeOptions = DEFAULT_ENTRY_MODE_OPTIONS
const eraserModeOptions = ERASER_MODE_OPTIONS
const strokeSmoothingOptions = STROKE_SMOOTHING_OPTIONS
const modKeyLabel = computed(() => (isMacOS() ? 'Command' : 'Ctrl'))

function strokeSmoothingLabelKey(level: StrokeSmoothing): string {
  if (level === 'off') return 'settings.strokeSmoothingOff'
  if (level === 'strong') return 'settings.strokeSmoothingStrong'
  return 'settings.strokeSmoothingStandard'
}

function themeLabelKey(opt: ThemePreference): string {
  if (opt === 'dark') return 'settings.themeDark'
  if (opt === 'light') return 'settings.themeLight'
  return 'settings.themeSystem'
}

const dragModeDescKey = computed(() => {
  switch (props.dragMode) {
    case 'hover':
      return 'settings.dragModeDescHover'
    case 'modifier':
      return 'settings.dragModeDescModifier'
    default:
      return 'settings.dragModeDescOff'
  }
})

const props = defineProps<{
  theme: ThemePreference
  dragMode: DragMode
  defaultEntryMode: DefaultEntryMode
  eraserMode: EraserMode
  strokeSmoothing: StrokeSmoothing
  preserveDrawings: boolean
  whiteboardPreserveDrawings: boolean
  autoStartEnabled: boolean
  angleSnapStep: number
}>()

const emit = defineEmits<{
  'update:theme': [value: ThemePreference]
  'update:dragMode': [value: DragMode]
  'update:defaultEntryMode': [value: DefaultEntryMode]
  'update:eraserMode': [value: EraserMode]
  'update:strokeSmoothing': [value: StrokeSmoothing]
  'update:preserveDrawings': [value: boolean]
  'update:whiteboardPreserveDrawings': [value: boolean]
  'update:autoStartEnabled': [value: boolean]
  'update:angleSnapStep': [value: number]
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
  // Never touch OS autostart unless we confirmed a normal install.
  if (autoStartBusy.value || !autostartAvailable.value || portableMode.value !== false || !(await isInstalledMode()))
    return
  const nextValue = !props.autoStartEnabled
  autoStartBusy.value = true
  autoStartError.value = null
  try {
    if (nextValue) {
      await enable()
    } else {
      await disable()
    }
    const cfg = await invoke<AppConfig>('get_config')
    if (!cfg.general)
      cfg.general = {
        dragMode: props.dragMode,
        preserveDrawings: false,
        whiteboardPreserveDrawings: true,
        angleSnapStep: props.angleSnapStep,
        autoStart: nextValue,
      }
    cfg.general.autoStart = nextValue
    await invoke('save_general', { general: cfg.general })
    emit('update:autoStartEnabled', nextValue)
  } catch (error) {
    console.error('Failed to toggle auto start:', error)
    showAutoStartError(nextValue ? t('settings.autoStartFailedEnable') : t('settings.autoStartFailedDisable'))
  } finally {
    autoStartBusy.value = false
  }
}

onMounted(async () => {
  portableMode.value = await resolvePortableMode()
  autostartAvailable.value = await supportsAutostart()
})

function dragModeLabel(mode: DragMode): string {
  if (mode === 'modifier') return t('settings.dragModeModifier', { modKey: modKeyLabel.value })
  return t(`settings.dragMode${mode === 'off' ? 'Off' : 'Hover'}`)
}

async function setDragMode(mode: DragMode) {
  if (mode === props.dragMode) return
  emit('update:dragMode', mode)
  try {
    const cfg = await invoke<AppConfig>('get_config')
    if (!cfg.general)
      cfg.general = {
        dragMode: mode,
        preserveDrawings: false,
        whiteboardPreserveDrawings: true,
        angleSnapStep: props.angleSnapStep,
      }
    cfg.general.dragMode = mode
    await invoke('save_general', { general: cfg.general })
  } catch (error) {
    console.error('Failed to save drag mode:', error)
  }
}

async function setTheme(next: ThemePreference) {
  if (next === props.theme) return
  emit('update:theme', next)
  await applyTheme(next)
  try {
    const cfg = await invoke<AppConfig>('get_config')
    if (!cfg.general)
      cfg.general = {
        dragMode: props.dragMode,
        preserveDrawings: props.preserveDrawings,
        whiteboardPreserveDrawings: props.whiteboardPreserveDrawings,
        angleSnapStep: props.angleSnapStep,
        theme: next,
      }
    cfg.general.theme = next
    await invoke('save_general', { general: cfg.general })
  } catch (error) {
    console.error('Failed to save theme:', error)
  }
}

async function setEraserMode(mode: EraserMode) {
  if (mode === props.eraserMode) return
  emit('update:eraserMode', mode)
  try {
    const cfg = await invoke<AppConfig>('get_config')
    if (!cfg.general)
      cfg.general = {
        dragMode: props.dragMode,
        defaultEntryMode: props.defaultEntryMode,
        eraserMode: mode,
        strokeSmoothing: props.strokeSmoothing,
        preserveDrawings: false,
        whiteboardPreserveDrawings: true,
        angleSnapStep: props.angleSnapStep,
      }
    cfg.general.eraserMode = mode
    await invoke('save_general', { general: cfg.general })
  } catch (error) {
    console.error('Failed to save eraser mode:', error)
  }
}

async function setStrokeSmoothing(level: StrokeSmoothing) {
  if (level === props.strokeSmoothing) return
  emit('update:strokeSmoothing', level)
  try {
    const cfg = await invoke<AppConfig>('get_config')
    if (!cfg.general)
      cfg.general = {
        dragMode: props.dragMode,
        defaultEntryMode: props.defaultEntryMode,
        eraserMode: props.eraserMode,
        strokeSmoothing: level,
        preserveDrawings: false,
        whiteboardPreserveDrawings: true,
        angleSnapStep: props.angleSnapStep,
      }
    cfg.general.strokeSmoothing = level
    await invoke('save_general', { general: cfg.general })
  } catch (error) {
    console.error('Failed to save stroke smoothing:', error)
  }
}

async function setDefaultEntryMode(mode: DefaultEntryMode) {
  if (mode === props.defaultEntryMode) return
  emit('update:defaultEntryMode', mode)
  try {
    const cfg = await invoke<AppConfig>('get_config')
    if (!cfg.general)
      cfg.general = {
        dragMode: props.dragMode,
        defaultEntryMode: mode,
        preserveDrawings: false,
        whiteboardPreserveDrawings: true,
        angleSnapStep: props.angleSnapStep,
      }
    cfg.general.defaultEntryMode = mode
    await invoke('save_general', { general: cfg.general })
  } catch (error) {
    console.error('Failed to save default entry mode:', error)
  }
}

async function togglePreserveDrawings() {
  const newValue = !props.preserveDrawings
  emit('update:preserveDrawings', newValue)
  try {
    const cfg = await invoke<AppConfig>('get_config')
    if (!cfg.general)
      cfg.general = {
        dragMode: props.dragMode,
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
        dragMode: props.dragMode,
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

const angleSnapDraft = ref(props.angleSnapStep)

watch(
  () => props.angleSnapStep,
  (value) => {
    angleSnapDraft.value = value
  },
)

function clampAngleSnapStep(value: number): number {
  return Math.min(90, Math.max(1, value))
}

function onAngleSliderInput(e: Event) {
  angleSnapDraft.value = clampAngleSnapStep(Number((e.target as HTMLInputElement).value))
}

async function onAngleSliderChange(e: Event) {
  await commitAngleSnapStep(clampAngleSnapStep(Number((e.target as HTMLInputElement).value)))
}

function onAngleNumberInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value
  if (raw === '') return
  const parsed = Number(raw)
  if (!Number.isNaN(parsed)) angleSnapDraft.value = clampAngleSnapStep(parsed)
}

async function onAngleNumberChange(e: Event) {
  const target = e.target as HTMLInputElement
  const raw = target.value
  const parsed = raw === '' ? props.angleSnapStep : Number(raw)
  const step = Number.isFinite(parsed) ? clampAngleSnapStep(parsed) : props.angleSnapStep
  target.value = String(step)
  await commitAngleSnapStep(step)
}

async function commitAngleSnapStep(step: number) {
  angleSnapDraft.value = step
  if (step === props.angleSnapStep) return
  emit('update:angleSnapStep', step)
  try {
    const cfg = await invoke<AppConfig>('get_config')
    if (!cfg.general)
      cfg.general = {
        dragMode: props.dragMode,
        preserveDrawings: false,
        whiteboardPreserveDrawings: true,
        angleSnapStep: props.angleSnapStep,
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
    <h2 class="font-semibold settings-text-title mb-4">{{ t('settings.generalTitle') }}</h2>

    <div class="flex flex-col gap-2">
      <div class="settings-card settings-card--popover-host" :class="{ 'relative z-20': localeOpen }">
        <div class="settings-card-row">
          <span class="settings-text-label">{{ t('settings.language') }}</span>
          <div ref="localeDropdownRef" class="relative">
            <button
              class="flex items-center gap-1.5 px-3 py-1.25 rounded-md ui-select cursor-pointer outline-none"
              @click="toggleLocaleDropdown"
            >
              {{ localeLabels[locale.locale] || locale.locale }}
              <svg
                class="w-3 h-3 settings-text-icon transition-transform duration-150"
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
                class="absolute right-0 top-full mt-1 min-w-30 py-1 rounded-lg ui-popover z-50 overflow-hidden"
              >
                <button
                  v-for="loc in availableLocales"
                  :key="loc"
                  class="w-full flex items-center gap-2 px-3 py-1.5 settings-text-value border-none cursor-pointer transition-colors duration-100"
                  :class="locale.locale === loc ? 'settings-locale-item--active' : 'settings-locale-item'"
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

      <div class="settings-card">
        <div class="settings-card-row">
          <span class="settings-text-label">{{ t('settings.theme') }}</span>
          <div class="flex items-center gap-1">
            <button
              v-for="opt in themeOptions"
              :key="opt"
              type="button"
              class="px-2 py-1 rounded-md ui-segment leading-none transition-colors duration-120 whitespace-nowrap"
              :class="{ 'ui-segment--active': theme === opt }"
              @click="setTheme(opt)"
            >
              {{ t(themeLabelKey(opt)) }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="autostartAvailable" class="settings-card">
        <div class="settings-card-row">
          <span class="settings-text-label">{{ t('settings.autoStart') }}</span>
          <button
            role="switch"
            :aria-checked="autoStartEnabled"
            :aria-label="t('settings.autoStart')"
            :disabled="autoStartBusy"
            class="relative w-8 h-4.5 rounded-full transition-colors duration-200 cursor-pointer border-none p-0 outline-none shadow-inner disabled:opacity-50 disabled:cursor-wait"
            :class="autoStartEnabled ? 'settings-toggle-on' : 'settings-toggle-off'"
            @click="toggleAutoStart"
          >
            <span
              class="absolute top-0.5 left-0.5 size-3.5 rounded-full bg-white shadow-md transition-transform duration-200"
              :class="autoStartEnabled ? 'translate-x-3.5' : 'translate-x-0'"
            />
          </button>
        </div>
        <Transition name="msg">
          <div v-if="autoStartError" class="px-3.5 pb-2.5 -mt-1">
            <div class="px-3 py-1.5 rounded-md settings-msg-error text-xs leading-snug">
              {{ autoStartError }}
            </div>
          </div>
        </Transition>
      </div>

      <div class="settings-card">
        <div class="settings-card-row">
          <span class="settings-text-label">{{ t('settings.dragMode') }}</span>
          <div class="flex items-center gap-1 shrink-0 flex-wrap justify-end max-w-[62%]">
            <button
              v-for="mode in dragModeOptions"
              :key="mode"
              class="px-2 py-1 rounded-md ui-segment leading-none transition-colors duration-120 whitespace-nowrap"
              :class="{ 'ui-segment--active': dragMode === mode }"
              :aria-pressed="dragMode === mode"
              @click="setDragMode(mode)"
            >
              {{ dragModeLabel(mode) }}
            </button>
          </div>
        </div>
        <p class="settings-card-desc">
          {{ t(dragModeDescKey, dragMode === 'modifier' ? { modKey: modKeyLabel } : undefined) }}
        </p>
      </div>

      <div class="settings-card">
        <div class="settings-card-row">
          <span class="settings-text-label">{{ t('settings.angleSnapStep') }}</span>
          <div class="flex items-center gap-2 shrink-0">
            <input
              type="range"
              class="angle-snap-range"
              min="1"
              max="90"
              step="1"
              :value="angleSnapDraft"
              :aria-label="t('settings.angleSnapStep')"
              @input="onAngleSliderInput"
              @change="onAngleSliderChange"
            />
            <input
              type="number"
              class="angle-snap-number"
              min="1"
              max="90"
              step="1"
              :value="angleSnapDraft"
              :aria-label="t('settings.angleSnapStep')"
              @input="onAngleNumberInput"
              @change="onAngleNumberChange"
            />
            <span class="angle-snap-degree">°</span>
          </div>
        </div>
        <p class="settings-card-desc">{{ t('settings.angleSnapStepDesc') }}</p>
      </div>

      <div class="settings-card">
        <div class="settings-card-row">
          <span class="settings-text-label">{{ t('settings.eraserMode') }}</span>
          <div class="flex items-center gap-1 shrink-0 flex-wrap justify-end max-w-[62%]">
            <button
              v-for="mode in eraserModeOptions"
              :key="mode"
              class="px-2 py-1 rounded-md ui-segment leading-none transition-colors duration-120 whitespace-nowrap"
              :class="{ 'ui-segment--active': eraserMode === mode }"
              :aria-pressed="eraserMode === mode"
              @click="setEraserMode(mode)"
            >
              {{ t(`settings.eraserMode${mode === 'stroke' ? 'Stroke' : 'Object'}`) }}
            </button>
          </div>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-row">
          <span class="settings-text-label">{{ t('settings.strokeSmoothing') }}</span>
          <div class="flex items-center gap-1 shrink-0 flex-wrap justify-end max-w-[62%]">
            <button
              v-for="level in strokeSmoothingOptions"
              :key="level"
              class="px-2 py-1 rounded-md ui-segment leading-none transition-colors duration-120 whitespace-nowrap"
              :class="{ 'ui-segment--active': strokeSmoothing === level }"
              :aria-pressed="strokeSmoothing === level"
              @click="setStrokeSmoothing(level)"
            >
              {{ t(strokeSmoothingLabelKey(level)) }}
            </button>
          </div>
        </div>
        <p class="settings-card-desc">{{ t('settings.strokeSmoothingDesc') }}</p>
      </div>

      <div class="settings-card">
        <div class="settings-card-header">
          <span class="settings-text-label">{{ t('settings.whiteboardSection') }}</span>
        </div>

        <div class="settings-card-row settings-card-row--divided">
          <span class="settings-text-label">{{ t('settings.defaultEntryMode') }}</span>
          <div class="flex items-center gap-1 shrink-0 flex-wrap justify-end max-w-[62%]">
            <button
              v-for="mode in defaultEntryModeOptions"
              :key="mode"
              class="px-2 py-1 rounded-md ui-segment leading-none transition-colors duration-120 whitespace-nowrap"
              :class="{ 'ui-segment--active': defaultEntryMode === mode }"
              :aria-pressed="defaultEntryMode === mode"
              @click="setDefaultEntryMode(mode)"
            >
              {{ t(`settings.defaultEntryMode${mode === 'screen' ? 'Screen' : 'Whiteboard'}`) }}
            </button>
          </div>
        </div>

        <div class="settings-card-row settings-card-row--divided">
          <span class="settings-text-label">{{ t('settings.preserveDrawings') }}</span>
          <button
            role="switch"
            :aria-checked="preserveDrawings"
            :aria-label="t('settings.preserveDrawings')"
            class="relative w-8 h-4.5 rounded-full transition-colors duration-200 cursor-pointer border-none p-0 outline-none shadow-inner"
            :class="preserveDrawings ? 'settings-toggle-on' : 'settings-toggle-off'"
            @click="togglePreserveDrawings"
          >
            <span
              class="absolute top-0.5 left-0.5 size-3.5 rounded-full bg-white shadow-md transition-transform duration-200"
              :class="preserveDrawings ? 'translate-x-3.5' : 'translate-x-0'"
            />
          </button>
        </div>

        <div class="settings-card-row settings-card-row--divided">
          <span class="settings-text-label">{{ t('settings.whiteboardPreserveDrawings') }}</span>
          <button
            role="switch"
            :aria-checked="whiteboardPreserveDrawings"
            :aria-label="t('settings.whiteboardPreserveDrawings')"
            class="relative w-8 h-4.5 rounded-full transition-colors duration-200 cursor-pointer border-none p-0 outline-none shadow-inner"
            :class="whiteboardPreserveDrawings ? 'settings-toggle-on' : 'settings-toggle-off'"
            @click="toggleWhiteboardPreserveDrawings"
          >
            <span
              class="absolute top-0.5 left-0.5 size-3.5 rounded-full bg-white shadow-md transition-transform duration-200"
              :class="whiteboardPreserveDrawings ? 'translate-x-3.5' : 'translate-x-0'"
            />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.angle-snap-range {
  width: 8.5rem;
  height: 16px;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  cursor: pointer;
  outline: none;
}

.angle-snap-range::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: var(--ui-control-bg-strong);
}

.angle-snap-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  margin-top: -5px;
  border-radius: 50%;
  border: 1px solid var(--ui-accent-border-strong);
  background: var(--ui-accent);
  box-shadow: 0 0 0 2px var(--ui-accent-ring);
  transition: transform 0.12s ease;
}

.angle-snap-range:hover::-webkit-slider-thumb,
.angle-snap-range:focus-visible::-webkit-slider-thumb {
  transform: scale(1.15);
}

.angle-snap-range::-moz-range-track {
  height: 4px;
  border-radius: 999px;
  background: var(--ui-control-bg-strong);
}

.angle-snap-range::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border: 1px solid var(--ui-accent-border-strong);
  border-radius: 50%;
  background: var(--ui-accent);
  box-shadow: 0 0 0 2px var(--ui-accent-ring);
}

.angle-snap-number {
  width: 3.5rem;
  padding: 0.25rem 0.4rem;
  border-radius: 6px;
  border: 1px solid var(--ui-control-border);
  background: var(--ui-control-bg);
  color: var(--ui-control-text-hover);
  font-size: 0.75rem;
  text-align: center;
  outline: none;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
  -moz-appearance: textfield;
  appearance: textfield;
}

.angle-snap-number::-webkit-inner-spin-button,
.angle-snap-number::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.angle-snap-number:hover {
  border-color: var(--ui-control-border-hover);
  background: var(--ui-control-bg-hover);
}

.angle-snap-number:focus {
  border-color: var(--ui-accent-border);
  box-shadow: 0 0 0 2px var(--ui-accent-ring);
}

.angle-snap-degree {
  color: var(--ui-control-text);
  font-size: 0.75rem;
}

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
