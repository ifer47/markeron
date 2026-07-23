<script setup lang="ts">
import { ref, onMounted, defineAsyncComponent, markRaw, nextTick, shallowRef, type Component } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useUpdater } from './composables/useUpdater'
import { applyTheme, type ThemePreference } from './composables/useAppTheme'
import type { AppConfig } from './types/app'
import { isInstalledMode } from './utils/portable'

const DrawingOverlay = defineAsyncComponent(() => import('./components/DrawingOverlay.vue'))
const ToolbarWindow = defineAsyncComponent(() => import('./components/ToolbarWindow.vue'))

type AppMode = 'overlay' | 'settings' | 'toolbar'

function resolveAppMode(): AppMode {
  if (window.location.hash.startsWith('#settings')) return 'settings'
  if (window.location.hash.startsWith('#toolbar')) return 'toolbar'
  return 'overlay'
}

function resolveThemePref(general?: AppConfig['general']): ThemePreference {
  const value = general?.theme
  return value === 'light' || value === 'system' || value === 'dark' ? value : 'dark'
}

const mode = ref<AppMode>(resolveAppMode())
const SettingsView = shallowRef<Component | null>(null)

if (mode.value === 'settings') {
  document.documentElement.classList.add('settings')
  document.documentElement.dataset.theme = 'dark'
}

function afterAnimationFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/** macOS needs Regular activation policy right before show; route through Rust. */
async function revealSettingsWindow() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await invoke('reveal_settings_window')
      return
    } catch (error) {
      if (attempt === 2) {
        console.error('Failed to reveal settings window:', error)
        return
      }
      await delay(40 * (attempt + 1))
    }
  }
}

onMounted(async () => {
  if (mode.value === 'settings') {
    try {
      const cfg = await invoke<AppConfig>('get_config')
      await applyTheme(resolveThemePref(cfg.general))
    } catch {
      /* keep FOUC dark guard */
    }
    // Show the settings shell; load tab content afterward.
    await revealSettingsWindow()
    try {
      const module = await import('./components/SettingsView.vue')
      SettingsView.value = markRaw(module.default)
      await nextTick()
      await afterAnimationFrame()
      await revealSettingsWindow()
    } catch (error) {
      console.error('Failed to load settings view:', error)
    }

    if (await isInstalledMode()) {
      const { checkForUpdate } = useUpdater()
      checkForUpdate(true)
    }
  }
})
</script>

<template>
  <component :is="SettingsView" v-if="mode === 'settings' && SettingsView" />
  <ToolbarWindow v-else-if="mode === 'toolbar'" />
  <DrawingOverlay v-else-if="mode === 'overlay'" />
</template>
