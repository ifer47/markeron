<script setup lang="ts">
import { ref, onMounted, defineAsyncComponent } from 'vue'
import { useUpdater } from './composables/useUpdater'

const DrawingOverlay = defineAsyncComponent(() => import('./components/DrawingOverlay.vue'))
const SettingsView = defineAsyncComponent(() => import('./components/SettingsView.vue'))

const mode = ref<'overlay' | 'settings'>('overlay')

onMounted(() => {
  if (window.location.hash.startsWith('#settings')) {
    mode.value = 'settings'
    document.documentElement.classList.add('settings')

    const { checkForUpdate } = useUpdater()
    checkForUpdate(true)
  }
})
</script>

<template>
  <SettingsView v-if="mode === 'settings'" />
  <DrawingOverlay v-else />
</template>
