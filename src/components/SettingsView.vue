<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { AppConfig, SaveResult } from '../types/app'
import { resolveDragMode, type DragMode } from '../utils/dragMode'
import { applyTheme, watchSystemTheme, type ThemePreference } from '../composables/useAppTheme'
import { resolveDefaultEntryMode, type DefaultEntryMode } from '../utils/entryMode'
import { resolveEraserMode, type EraserMode } from '../utils/eraserMode'
import { resolveAutoStart } from '../utils/autoStart'
import { isMacOS } from '../utils/platform'
import { useI18n, syncLocaleFromConfig } from '../i18n'
import GeneralTab from './settings/GeneralTab.vue'
import DiagnosticsTab from './settings/DiagnosticsTab.vue'
import AboutTab from './settings/AboutTab.vue'
import SettingsSidebarFooter from './settings/SettingsSidebarFooter.vue'

const { t } = useI18n()

const modLabel = computed(() => (isMacOS() ? 'Command' : 'Ctrl'))
const helpMod = computed(() => (isMacOS() ? '⌘' : 'Ctrl'))
const helpOpt = computed(() => (isMacOS() ? '⌥' : 'Alt'))
const helpShift = computed(() => (isMacOS() ? '⇧' : 'Shift'))

const defaultShortcutStrings = computed(() =>
  isMacOS()
    ? {
        toggleDrawing: 'Command+Shift+D',
        clearDrawing: 'Command+Shift+C',
        togglePenetration: 'Command+Shift+X',
      }
    : {
        toggleDrawing: 'Ctrl+Shift+D',
        clearDrawing: 'Ctrl+Shift+C',
        togglePenetration: 'Ctrl+Shift+X',
      },
)

const helpGlobalKeys = computed(() =>
  isMacOS()
    ? { toggle: '⌘+⇧+D', clear: '⌘+⇧+C', through: '⌘+⇧+X' }
    : { toggle: 'Ctrl+Shift+D', clear: 'Ctrl+Shift+C', through: 'Ctrl+Shift+X' },
)

const helpTools = [
  { key: '1', name: 'tools.pen', desc: 'toolDesc.pen' },
  { key: '2', name: 'tools.highlighter', desc: 'toolDesc.highlighter' },
  { key: '3', name: 'tools.arrow', desc: 'toolDesc.arrow' },
  { key: '4', name: 'tools.rect', desc: 'toolDesc.rect' },
  { key: '5', name: 'tools.ellipse', desc: 'toolDesc.ellipse' },
  { key: '6', name: 'tools.line', desc: 'toolDesc.line' },
  { key: '7', name: 'tools.eraser', desc: 'toolDesc.eraser' },
  { key: '8', name: 'tools.laser', desc: 'toolDesc.laser' },
  { key: 'T', name: 'tools.text', desc: 'toolDesc.text' },
  { key: 'N', name: 'tools.stamp', desc: 'toolDesc.stamp' },
] as const

const hashTab = window.location.hash.split('/')[1]
const activeTab = ref(
  hashTab && ['general', 'shortcuts', 'help', 'diagnostics', 'about'].includes(hashTab) ? hashTab : 'general',
)

const tabIds = ['general', 'shortcuts', 'help', 'diagnostics', 'about'] as const
const tabs = computed(() => tabIds.map((id) => ({ id, label: t(`settings.tabs.${id}`) })))

const shortcuts = reactive<AppConfig['shortcuts']>({
  toggleDrawing: '',
  clearDrawing: '',
  togglePenetration: '',
})

const labels = computed<Record<keyof AppConfig['shortcuts'], string>>(() => ({
  toggleDrawing: t('settings.shortcutLabels.toggleDrawing'),
  clearDrawing: t('settings.shortcutLabels.clearDrawing'),
  togglePenetration: t('settings.shortcutLabels.togglePenetration'),
}))

const capturing = ref<keyof AppConfig['shortcuts'] | null>(null)
const capturedKeys = ref('')
const saving = ref(false)
const message = ref<{ type: 'success' | 'error'; text: string } | null>(null)

const keyMap: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ' ': 'Space',
  AudioVolumeUp: 'VolumeUp',
  AudioVolumeDown: 'VolumeDown',
  AudioVolumeMute: 'VolumeMute',
}

function startCapture(action: keyof AppConfig['shortcuts']) {
  capturing.value = action
  capturedKeys.value = ''
  message.value = null
}

function cancelCapture() {
  capturing.value = null
  capturedKeys.value = ''
}

function onKeyDown(e: KeyboardEvent) {
  if (!capturing.value) return
  e.preventDefault()
  e.stopPropagation()

  const hasMod = e.ctrlKey || e.altKey || e.shiftKey || e.metaKey

  if (e.key === 'Escape' && !hasMod) {
    cancelCapture()
    return
  }

  // Backspace / Delete with no modifiers clears (unbinds) the shortcut.
  if ((e.key === 'Backspace' || e.key === 'Delete') && !hasMod) {
    const action = capturing.value
    shortcuts[action] = ''
    capturing.value = null
    capturedKeys.value = ''
    void saveShortcuts()
    return
  }

  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push(isMacOS() ? 'Command' : 'Super')

  const k = e.key
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(k)) {
    capturedKeys.value = parts.join('+') + '+...'
    return
  }

  const isF = /^F(\d{1,2})$/.test(k)
  if (!hasMod && !isF) return

  let name = k.length === 1 ? k.toUpperCase() : k
  if (keyMap[name]) name = keyMap[name]
  parts.push(name)

  const result = parts.join('+')
  capturedKeys.value = result
  shortcuts[capturing.value] = result
  capturing.value = null
  void saveShortcuts()
}

async function saveShortcuts() {
  saving.value = true
  message.value = null
  try {
    const res = await invoke<SaveResult>('save_shortcuts', { shortcuts: { ...shortcuts } })
    if (res.ok) {
      if (res.failed?.length) {
        message.value = {
          type: 'success',
          text: t('settings.shortcutsSavedPartial', { keys: res.failed.join(', ') }),
        }
      } else {
        message.value = { type: 'success', text: t('settings.shortcutsSaved') }
      }
    } else {
      message.value = {
        type: 'error',
        text: t('settings.shortcutsConflict', { keys: res.failed?.join(', ') ?? '' }),
      }
      const cfg = await invoke<AppConfig>('get_config')
      Object.assign(shortcuts, cfg.shortcuts)
    }
  } catch {
    message.value = { type: 'error', text: t('settings.saveFailed') }
  } finally {
    saving.value = false
    setTimeout(() => {
      message.value = null
    }, 3000)
  }
}

async function resetDefaults() {
  const d = defaultShortcutStrings.value
  const res = await invoke<SaveResult>('save_shortcuts', {
    shortcuts: {
      toggleDrawing: d.toggleDrawing,
      clearDrawing: d.clearDrawing,
      togglePenetration: d.togglePenetration,
    },
  })
  if (res.ok) {
    shortcuts.toggleDrawing = d.toggleDrawing
    shortcuts.clearDrawing = d.clearDrawing
    shortcuts.togglePenetration = d.togglePenetration
    if (res.failed?.length) {
      message.value = {
        type: 'success',
        text: t('settings.shortcutsSavedPartial', { keys: res.failed.join(', ') }),
      }
    } else {
      message.value = { type: 'success', text: t('settings.restoredDefaults') }
    }
    setTimeout(() => {
      message.value = null
    }, 3000)
  }
}

const autoStartEnabled = ref(true)
const theme = ref<ThemePreference>('dark')
const dragMode = ref<DragMode>('off')
const defaultEntryMode = ref<DefaultEntryMode>('screen')
const eraserMode = ref<EraserMode>('stroke')
const preserveDrawings = ref(false)
const whiteboardPreserveDrawings = ref(true)
const angleSnapStep = ref<15 | 30 | 45>(15)

function resolveThemePref(general?: AppConfig['general']): ThemePreference {
  const value = general?.theme
  return value === 'light' || value === 'system' || value === 'dark' ? value : 'dark'
}

async function openOnlineHelp() {
  try {
    await invoke('open_url', { url: 'https://markeron.cn/help.html' })
  } catch (error) {
    console.error('Failed to open online help:', error)
  }
}

let unlistenSwitchTab: (() => void) | null = null
let unlistenConfigChanged: (() => void) | null = null
let stopThemeWatch: (() => void) | null = null

onMounted(async () => {
  const cfg = await invoke<AppConfig>('get_config')
  Object.assign(shortcuts, cfg.shortcuts)
  theme.value = resolveThemePref(cfg.general)
  await applyTheme(theme.value)
  stopThemeWatch = watchSystemTheme(() => theme.value)
  dragMode.value = resolveDragMode(cfg.general)
  defaultEntryMode.value = resolveDefaultEntryMode(cfg.general)
  eraserMode.value = resolveEraserMode(cfg.general)
  preserveDrawings.value = cfg.general?.preserveDrawings ?? false
  whiteboardPreserveDrawings.value = cfg.general?.whiteboardPreserveDrawings ?? true
  angleSnapStep.value = (cfg.general?.angleSnapStep as 15 | 30 | 45 | undefined) ?? 15
  autoStartEnabled.value = resolveAutoStart(cfg.general)
  syncLocaleFromConfig(cfg.general?.locale)
  window.addEventListener('keydown', onKeyDown, true)

  unlistenSwitchTab = await listen<string>('switch-tab', (e) => {
    activeTab.value = e.payload
  })

  unlistenConfigChanged = await listen<AppConfig>('config-changed', (event) => {
    autoStartEnabled.value = resolveAutoStart(event.payload.general)
    theme.value = resolveThemePref(event.payload.general)
    void applyTheme(theme.value)
  })
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown, true)
  unlistenSwitchTab?.()
  unlistenConfigChanged?.()
  stopThemeWatch?.()
})
</script>

<template>
  <div class="flex h-full w-full font-text select-none overflow-hidden settings-text-label">
    <!-- Sidebar -->
    <div class="relative z-10 w-41 shrink-0 settings-sidebar flex flex-col ui-divider-v">
      <div class="flex items-center gap-2.5 px-4 pt-5 pb-5">
        <svg class="w-7 h-7 shrink-0" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M659.498667 412.8l-6.101334-6.058667a233.6 233.6 0 0 0-101.973333-57.557333c-124.032-33.237333-243.157333 37.077333-276.992 163.413333-1.834667 6.826667-2.816 14.506667-4.437333 33.749334-6.570667 79.786667-25.344 139.306667-76.8 199.68 96.426667 37.888 210.688 64.597333 297.557333 64.597333a234.88 234.88 0 0 0 226.56-174.037333 234.538667 234.538667 0 0 0-57.856-223.786667z m-92.501334-147.712l210.730667-163.925333a42.666667 42.666667 0 0 1 56.32 3.541333l127.786667 127.744a42.666667 42.666667 0 0 1 3.498666 56.32l-163.84 210.730667a320.213333 320.213333 0 0 1-310.741333 396.458666C341.333333 895.957333 149.333333 831.872 42.666667 767.872c169.813333-128 130.005333-205.226667 149.333333-277.333333 45.141333-168.533333 206.592-267.008 374.997333-225.450667zM712.533333 345.258667c2.816 2.688 5.546667 5.461333 8.277334 8.234666L769.28 401.92l105.6-135.765333-74.496-74.496-135.765333 105.6L712.533333 345.258667z"
            fill="currentColor"
          />
        </svg>
        <span class="font-semibold settings-text-brand tracking-wide leading-tight">MarkerOn</span>
      </div>

      <nav role="tablist" aria-orientation="vertical" class="flex flex-col gap-0.5 px-2">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          role="tab"
          :aria-selected="activeTab === tab.id"
          :aria-controls="`tabpanel-${tab.id}`"
          class="relative flex items-center gap-2 px-3 py-1.75 rounded-lg border-none cursor-pointer transition-all duration-120 overflow-hidden"
          :class="activeTab === tab.id ? 'settings-nav-item--active' : 'settings-nav-item'"
          @click="activeTab = tab.id"
        >
          <div
            v-if="activeTab === tab.id"
            class="absolute left-0 top-1/2 -translate-y-1/2 w-0.75 h-3.5 bg-accent rounded-r-md"
          ></div>
          <svg
            v-if="tab.id === 'general'"
            class="w-3.5 h-3.5 shrink-0 opacity-70"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
            />
          </svg>
          <svg
            v-else-if="tab.id === 'shortcuts'"
            class="w-3.5 h-3.5 shrink-0 opacity-70"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
            <path d="M6 8h.001M10 8h.001M14 8h.001M18 8h.001M8 12h.001M12 12h.001M16 12h.001M7 16h10" />
          </svg>
          <svg
            v-else-if="tab.id === 'help'"
            class="w-3.5 h-3.5 shrink-0 opacity-70"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <svg
            v-else-if="tab.id === 'diagnostics'"
            class="w-3.5 h-3.5 shrink-0 opacity-70"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          <svg
            v-else-if="tab.id === 'about'"
            class="w-3.5 h-3.5 shrink-0 opacity-70"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          {{ tab.label }}
        </button>
      </nav>

      <SettingsSidebarFooter />
    </div>

    <!-- Content -->
    <div class="flex-1 flex flex-col overflow-hidden" style="background: var(--ui-bg)">
      <div v-if="activeTab === 'shortcuts'" class="flex-1 flex flex-col px-7 py-6 overflow-y-auto settings-scroll">
        <div class="flex items-center gap-2 mb-4">
          <h2 class="font-semibold settings-text-title">{{ t('settings.shortcutsTitle') }}</h2>
          <div class="group relative flex items-center">
            <svg
              class="w-3.5 h-3.5 settings-text-icon settings-text-icon-hover cursor-help transition-colors duration-200 outline-none"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M12 16v-4"></path>
              <path d="M12 8h.01"></path>
            </svg>
            <div
              class="absolute left-full top-1/2 -translate-y-1/2 ml-2 mt-4 w-62 p-2.5 ui-tooltip rounded-lg opacity-0 scale-95 invisible group-hover:opacity-100 group-hover:scale-100 group-hover:visible transition-all duration-200 z-50 pointer-events-none origin-left"
            >
              <p class="settings-text-tooltip leading-[1.6] m-0 text-left font-sans">
                {{ t('settings.comboRequirement', { mod: modLabel }) }}
              </p>
            </div>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <div
            v-for="(label, action) in labels"
            :key="action"
            class="settings-card settings-card-row"
            :class="{ 'settings-card--active': capturing === action }"
          >
            <span class="settings-text-label">{{ label }}</span>

            <div class="flex items-center gap-2">
              <template v-if="capturing === action">
                <span class="settings-text-capture font-medium min-w-22.5 text-right tracking-wide">
                  {{ capturedKeys || t('settings.pressComboHint') }}
                </span>
                <button
                  class="px-2.5 py-1 rounded-md ui-btn-outline settings-text-btn cursor-pointer"
                  @click="cancelCapture"
                >
                  {{ t('settings.cancel') }}
                </button>
              </template>
              <template v-else>
                <kbd v-if="shortcuts[action]" class="ui-kbd--shortcut">
                  {{ shortcuts[action] }}
                </kbd>
                <span v-else class="settings-text-muted min-w-22.5 text-right">
                  {{ t('settings.shortcutNotSet') }}
                </span>
                <button
                  class="px-2.5 py-1 rounded-md ui-btn-outline settings-text-btn-strong cursor-pointer shadow-sm"
                  @click="startCapture(action)"
                >
                  {{ t('settings.edit') }}
                </button>
              </template>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex items-center justify-between mt-4">
          <!-- Message -->
          <div class="min-h-8 flex items-center">
            <Transition name="msg">
              <div
                v-if="message"
                class="px-3 py-1.5 rounded-md"
                :class="message.type === 'success' ? 'settings-msg-success' : 'settings-msg-error'"
              >
                {{ message.text }}
              </div>
            </Transition>
          </div>

          <button
            class="px-3.5 py-1.25 rounded-md ui-btn-outline ui-btn-outline--subtle settings-text-btn cursor-pointer shadow-sm ml-auto"
            @click="resetDefaults"
          >
            {{ t('settings.restoreDefaults') }}
          </button>
        </div>
      </div>

      <GeneralTab
        v-else-if="activeTab === 'general'"
        :theme="theme"
        :drag-mode="dragMode"
        :default-entry-mode="defaultEntryMode"
        :eraser-mode="eraserMode"
        :preserve-drawings="preserveDrawings"
        :whiteboard-preserve-drawings="whiteboardPreserveDrawings"
        :auto-start-enabled="autoStartEnabled"
        :angle-snap-step="angleSnapStep"
        @update:theme="theme = $event"
        @update:drag-mode="dragMode = $event"
        @update:default-entry-mode="defaultEntryMode = $event"
        @update:eraser-mode="eraserMode = $event"
        @update:preserve-drawings="preserveDrawings = $event"
        @update:whiteboard-preserve-drawings="whiteboardPreserveDrawings = $event"
        @update:auto-start-enabled="autoStartEnabled = $event"
        @update:angle-snap-step="angleSnapStep = $event"
      />

      <div v-else-if="activeTab === 'help'" class="flex-1 flex flex-col px-7 py-6 overflow-y-auto help-scroll">
        <div class="flex items-center justify-between gap-3 mb-3">
          <h2 class="font-semibold settings-text-title m-0">{{ t('help.basicUsage') }}</h2>
          <button
            type="button"
            class="shrink-0 px-3 py-1.25 rounded-md ui-btn-outline settings-text-btn cursor-pointer"
            @click="openOnlineHelp"
          >
            {{ t('help.openOnline') }}
          </button>
        </div>

        <div class="flex flex-col gap-2">
          <div class="settings-card help-card">
            <div class="px-4 py-2.5 settings-text-body leading-[1.65]">
              <p class="m-0" v-html="t('help.basicDesc')" />
            </div>
          </div>

          <div class="settings-card help-card">
            <div class="help-card-header">{{ t('help.globalShortcuts') }}</div>
            <div class="help-rows">
              <div class="help-row">
                <span class="help-label">{{ t('help.toggleAnnotation') }}</span>
                <div class="help-keys">
                  <kbd class="help-kbd">{{ helpGlobalKeys.toggle }}</kbd>
                </div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('help.clearAll') }}</span>
                <div class="help-keys">
                  <kbd class="help-kbd">{{ helpGlobalKeys.clear }}</kbd>
                </div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('help.togglePenetration') }}</span>
                <div class="help-keys">
                  <kbd class="help-kbd">{{ helpGlobalKeys.through }}</kbd>
                </div>
              </div>
            </div>
          </div>

          <div class="settings-card help-card">
            <div class="help-card-header">{{ t('help.inSessionShortcuts') }}</div>
            <div class="help-rows">
              <div class="help-row">
                <span class="help-label">{{ t('help.togglePenetrationLocal') }}</span>
                <div class="help-keys"><kbd class="help-kbd">X</kbd></div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('help.settingsPanel') }}</span>
                <div class="help-keys"><kbd class="help-kbd">Space</kbd></div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('help.exitDrawing') }}</span>
                <div class="help-keys"><kbd class="help-kbd">Esc</kbd></div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('help.undo') }}</span>
                <div class="help-keys">
                  <kbd class="help-kbd">{{ helpMod }}+Z</kbd>
                </div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('help.redo') }}</span>
                <div class="help-keys">
                  <kbd class="help-kbd">{{ helpMod }}+{{ helpShift }}+Z</kbd>
                </div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('help.strokeWidth') }}</span>
                <div class="help-keys"><kbd class="help-kbd">Ctrl</kbd> + Scroll</div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('help.copyScreen') }}</span>
                <div class="help-keys">
                  <kbd class="help-kbd">{{ helpMod }}+C</kbd>
                </div>
              </div>
            </div>
          </div>

          <div class="settings-card help-card">
            <div class="help-card-header">{{ t('help.toolSwitch') }}</div>
            <div class="help-rows">
              <div v-for="item in helpTools" :key="item.key" class="help-row help-row--tool">
                <span class="help-label">
                  <kbd class="help-kbd">{{ item.key }}</kbd>
                  <span class="ml-2">{{ t(item.name) }}</span>
                </span>
                <span class="help-desc">{{ t(item.desc) }}</span>
              </div>
            </div>
          </div>

          <div class="settings-card help-card">
            <div class="help-card-header">{{ t('help.modifierDraw') }}</div>
            <div class="help-rows">
              <div class="help-row">
                <span class="help-label">{{ t('help.straightLine') }}</span>
                <div class="help-keys">
                  <kbd class="help-kbd">{{ helpOpt }}</kbd> + {{ t('help.dragAction') }}
                </div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('tools.rect') }}</span>
                <div class="help-keys">
                  <kbd class="help-kbd">{{ helpMod }}</kbd> + {{ t('help.dragAction') }}
                </div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('help.square') }}</span>
                <div class="help-keys">
                  <kbd class="help-kbd">{{ helpMod }}+{{ helpOpt }}</kbd> + {{ t('help.dragAction') }}
                </div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('tools.ellipse') }}</span>
                <div class="help-keys">
                  <kbd class="help-kbd">{{ helpShift }}</kbd> + {{ t('help.dragAction') }}
                </div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('help.circle') }}</span>
                <div class="help-keys">
                  <kbd class="help-kbd">{{ helpShift }}+{{ helpOpt }}</kbd> + {{ t('help.dragAction') }}
                </div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('tools.arrow') }}</span>
                <div class="help-keys">
                  <kbd class="help-kbd">{{ helpMod }}+{{ helpShift }}</kbd> + {{ t('help.dragAction') }}
                </div>
              </div>
            </div>
          </div>

          <div class="settings-card help-card">
            <div class="help-card-header">{{ t('help.colorSwitch') }} · {{ t('help.whiteboardMode') }}</div>
            <div class="help-rows">
              <div class="help-row">
                <span class="help-label">{{ t('help.prevColor') }}</span>
                <div class="help-keys"><kbd class="help-kbd">Q</kbd> / <kbd class="help-kbd">E</kbd></div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('help.rightClickColor') }}</span>
                <div class="help-keys">
                  <span class="help-keys-plain">{{ t('help.mouseRightClick') }}</span>
                </div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('help.toggleWhiteboard') }}</span>
                <div class="help-keys"><kbd class="help-kbd">W</kbd></div>
              </div>
              <div class="help-row">
                <span class="help-label">{{ t('help.copyWhiteboard') }}</span>
                <div class="help-keys">
                  <kbd class="help-kbd">{{ helpMod }}+C</kbd>
                </div>
              </div>
            </div>
          </div>

          <div class="settings-card help-card">
            <div class="help-card-header">{{ t('help.dragAndText') }}</div>
            <div class="help-rows">
              <div class="help-row help-row-block">
                <span class="help-label">{{ t('help.dragElement') }}</span>
                <span class="help-desc">{{ t('help.dragDesc') }}</span>
              </div>
              <div class="help-row help-row-block">
                <span class="help-label">{{ t('help.editText') }}</span>
                <span class="help-desc" v-html="t('help.editTextDesc')" />
              </div>
              <div class="help-row help-row-block">
                <span class="help-label">{{ t('help.confirmText') }}</span>
                <span class="help-desc" v-html="t('help.confirmTextDesc')" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <DiagnosticsTab v-else-if="activeTab === 'diagnostics'" />

      <AboutTab v-else-if="activeTab === 'about'" />
    </div>
  </div>
</template>

<style scoped>
.msg-enter-active,
.msg-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.msg-enter-from,
.msg-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.settings-scroll::-webkit-scrollbar,
.help-scroll::-webkit-scrollbar {
  width: 4px;
}

.settings-scroll::-webkit-scrollbar-track,
.help-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.settings-scroll::-webkit-scrollbar-thumb,
.help-scroll::-webkit-scrollbar-thumb {
  background: var(--ui-control-bg-hover);
  border-radius: 2px;
}

.help-card-header {
  padding: 7px 14px;
  font-size: var(--settings-fs-caption, 12.5px);
  font-weight: 500;
  color: var(--ui-text-faint);
  border-bottom: 1px solid var(--ui-card-row-divider);
  letter-spacing: 0.03em;
}

.help-rows {
  display: flex;
  flex-direction: column;
}

.help-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 14px;
  border-bottom: 1px solid var(--ui-bg-subtle-hover);
  min-height: 32px;
  gap: 14px;
}

.help-row:last-child {
  border-bottom: none;
}

.help-row--tool {
  justify-content: flex-start;
  align-items: baseline;
}

.help-row-block {
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 9px 14px;
}

.help-label {
  font-size: var(--settings-fs-label, 14.5px);
  color: var(--ui-text-label);
  display: flex;
  align-items: center;
  white-space: nowrap;
  flex-shrink: 0;
}

.help-desc {
  font-size: var(--settings-fs-caption, 12.5px);
  color: var(--ui-text-footer);
  text-align: left;
  line-height: 1.45;
  min-width: 0;
}

.help-row--tool .help-desc {
  flex: 1;
}

.help-keys {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  font-size: var(--settings-fs-caption, 12.5px);
  color: var(--ui-text-icon);
  white-space: nowrap;
  flex-shrink: 0;
}

.help-keys-plain {
  color: var(--ui-text-subtle);
  font-size: var(--settings-fs-caption, 12.5px);
}

.help-kbd {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--ui-control-bg);
  border: 1px solid var(--ui-kbd-border);
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  font-size: var(--settings-fs-kbd, 12px);
  color: var(--ui-text-body);
  line-height: 1.5;
  white-space: nowrap;
}
</style>
