<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  text: string
  /** Extra explanation shown on hover — keeps the row label short. */
  tip?: string
}>()

const el = ref<HTMLElement | null>(null)
const open = ref(false)
const body = ref('')
const tipStyle = ref<Record<string, string>>({})

function onEnter() {
  const node = el.value
  if (!node) return
  const detail = props.tip?.trim() ?? ''
  const truncated = node.scrollWidth > node.clientWidth + 1
  if (!detail && !truncated) {
    open.value = false
    return
  }
  body.value = detail || props.text
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
  <span
    ref="el"
    class="help-label"
    :class="{ 'help-label--tip': !!tip?.trim() }"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
  >
    {{ text }}
  </span>
  <Teleport to="body">
    <div
      v-if="open"
      class="help-tip ui-tooltip rounded-lg px-2.5 py-2 pointer-events-none"
      :style="tipStyle"
      role="tooltip"
    >
      <p class="settings-text-tooltip leading-[1.6] m-0 text-left font-sans text-[12.5px]">
        {{ body }}
      </p>
    </div>
  </Teleport>
</template>
