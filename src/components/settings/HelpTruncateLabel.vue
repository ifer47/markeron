<script setup lang="ts">
import { ref } from 'vue'

defineProps<{ text: string }>()

const el = ref<HTMLElement | null>(null)
const open = ref(false)
const tipStyle = ref<Record<string, string>>({})

function onEnter() {
  const node = el.value
  if (!node || node.scrollWidth <= node.clientWidth + 1) {
    open.value = false
    return
  }
  const rect = node.getBoundingClientRect()
  const maxWidth = Math.min(320, window.innerWidth - 24)
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - maxWidth - 12))
  tipStyle.value = {
    position: 'fixed',
    left: `${left}px`,
    top: `${rect.bottom + 6}px`,
    maxWidth: `${maxWidth}px`,
    zIndex: '10000',
  }
  open.value = true
}

function onLeave() {
  open.value = false
}
</script>

<template>
  <span ref="el" class="help-truncate-label" @mouseenter="onEnter" @mouseleave="onLeave">
    {{ text }}
  </span>
  <Teleport to="body">
    <div
      v-if="open"
      class="help-truncate-tooltip ui-tooltip rounded-lg px-2.5 py-2 pointer-events-none"
      :style="tipStyle"
      role="tooltip"
    >
      <p class="settings-text-tooltip leading-[1.6] m-0 text-left font-sans text-[12.5px]">
        {{ text }}
      </p>
    </div>
  </Teleport>
</template>

<style scoped>
.help-truncate-label {
  display: block;
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--settings-fs-label, 14.5px);
  color: var(--ui-text-label);
}
</style>
