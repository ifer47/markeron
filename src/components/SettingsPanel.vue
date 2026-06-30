<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted, computed } from 'vue'
import type { Tool } from '../composables/useDrawing'
import { isMacOS } from '../utils/platform'
import { useI18n } from '../i18n'
import { TOOL_DEFS, WIDTH_PRESETS } from '../constants/tools'
import { COLOR_ROWS } from '../constants/colors'

const { t } = useI18n()

const modKeyLabel = computed(() => (isMacOS() ? 'Command' : 'Ctrl'))

const props = defineProps<{
  currentTool: Tool
  currentColor: string
  lineWidth: number
  x: number
  y: number
}>()

const emit = defineEmits<{
  selectTool: [tool: Tool]
  selectColor: [color: string]
  updateLineWidth: [width: number]
  close: []
}>()

const tools = computed(() => TOOL_DEFS.map((d) => ({ ...d, label: t(`tools.${d.id}`) })))

const colors = COLOR_ROWS

const widths = computed(() => WIDTH_PRESETS.map((v) => ({ value: v, label: t(`widths.${v}`) })))

function needsWhiteCheck(ri: number, ci: number): boolean {
  return ci >= 5 || (ri === colors.length - 1 && ci >= 3)
}

function selectToolAndClose(tool: Tool) {
  emit('selectTool', tool)
  emit('close')
}

function selectColorAndClose(color: string) {
  emit('selectColor', color)
  emit('close')
}

function updateWidthAndClose(width: number) {
  emit('updateLineWidth', width)
  emit('close')
}

const panelW = 272
const panelRef = ref<HTMLDivElement | null>(null)
const panelLeft = ref(0)
const panelTop = ref(0)
const positioned = ref(false)
const isDragging = ref(false)
const dragOffset = ref({ x: 0, y: 0 })

function initPosition() {
  nextTick(() => {
    const panelH = panelRef.value?.offsetHeight ?? 400
    let left = props.x - panelW / 2
    let top = props.y - panelH / 2
    left = Math.max(12, Math.min(left, window.innerWidth - panelW - 12))
    top = Math.max(12, Math.min(top, window.innerHeight - panelH - 12))
    panelLeft.value = left
    panelTop.value = top
    positioned.value = true
  })
}

let cachedPanelH = 400
let lastDragX = 0
let lastDragY = 0
let dragRafId: number | null = null

function startDrag(e: MouseEvent) {
  isDragging.value = true
  cachedPanelH = panelRef.value?.offsetHeight ?? 400
  dragOffset.value = {
    x: e.clientX - panelLeft.value,
    y: e.clientY - panelTop.value,
  }
  e.preventDefault()
}

function onDrag(e: MouseEvent) {
  if (!isDragging.value) return
  lastDragX = e.clientX
  lastDragY = e.clientY
  if (dragRafId !== null) return
  dragRafId = requestAnimationFrame(() => {
    dragRafId = null
    panelLeft.value = Math.max(0, Math.min(lastDragX - dragOffset.value.x, window.innerWidth - panelW))
    panelTop.value = Math.max(0, Math.min(lastDragY - dragOffset.value.y, window.innerHeight - cachedPanelH))
  })
}

function stopDrag() {
  isDragging.value = false
  if (dragRafId !== null) {
    cancelAnimationFrame(dragRafId)
    dragRafId = null
  }
}

onMounted(() => {
  initPosition()
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', stopDrag)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', stopDrag)
  if (dragRafId !== null) {
    cancelAnimationFrame(dragRafId)
    dragRafId = null
  }
})
</script>

<template>
  <div class="fixed top-0 left-0 w-screen h-screen z-100001" @mousedown.self="emit('close')">
    <div
      ref="panelRef"
      class="absolute left-0 top-0 w-[272px]"
      :style="{
        transform: `translate3d(${panelLeft}px,${panelTop}px,0)`,
        willChange: isDragging ? 'transform' : 'auto',
        opacity: positioned ? 1 : 0,
      }"
      @mousedown.stop
    >
      <div class="overlay-panel-surface overlay-panel w-full">
        <div class="h-2.5 cursor-default" @mousedown="startDrag" />

        <!-- Tools -->
        <div class="px-3.5 pt-1 pb-2.5">
          <div class="flex items-center justify-between mb-2 cursor-default" @mousedown="startDrag">
            <span class="text-[11px] font-semibold overlay-text-section tracking-[0.5px] font-sans">{{
              t('panel.tools')
            }}</span>
            <span class="text-[10px] overlay-text-hint font-sans">{{ t('panel.toolsHint') }}</span>
          </div>
          <div class="grid grid-cols-4 gap-1">
            <button
              v-for="tool in tools"
              :key="tool.id"
              :aria-label="`${tool.label} (${tool.key})`"
              :aria-pressed="currentTool === tool.id"
              class="flex flex-col items-center gap-[3px] pt-2 px-1 pb-1.5 border-none rounded-[10px] cursor-pointer relative transition-all duration-150"
              :class="currentTool === tool.id ? 'overlay-tool-btn--active' : 'overlay-tool-btn'"
              :title="`${tool.label} (${tool.key})`"
              @click="selectToolAndClose(tool.id)"
            >
              <component :is="tool.icon" :size="18" />
              <span class="text-[10px] leading-none font-sans">{{ tool.label }}</span>
              <span
                class="absolute top-[3px] right-[5px] text-[8px] font-sans"
                :class="currentTool === tool.id ? 'overlay-text-key--active' : 'overlay-text-key'"
                >{{ tool.key }}</span
              >
            </button>
          </div>
        </div>

        <!-- Colors -->
        <div class="px-3.5 py-2.5 ui-divider-h">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[11px] font-semibold overlay-text-section tracking-[0.5px] font-sans">{{
              t('panel.colors')
            }}</span>
          </div>
          <div class="flex flex-col gap-1.5">
            <div v-for="(row, ri) in colors" :key="ri" class="flex justify-between">
              <button
                v-for="(color, ci) in row"
                :key="color"
                class="w-[30px] h-[30px] p-0 border-none rounded-full bg-transparent cursor-pointer relative flex items-center justify-center transition-transform duration-120"
                :class="currentColor === color ? 'scale-[1.18]' : 'hover:scale-[1.18]'"
                @click="selectColorAndClose(color)"
              >
                <span
                  class="w-6 h-6 rounded-full color-swatch-ring transition-[border-color] duration-120"
                  :class="{ 'color-swatch-ring--active': currentColor === color }"
                  :style="{ backgroundColor: color }"
                />
                <span
                  v-if="currentColor === color"
                  class="absolute text-[11px] font-bold pointer-events-none"
                  :class="
                    needsWhiteCheck(ri, ci)
                      ? 'text-white [text-shadow:0_0_2px_rgba(0,0,0,0.5)]'
                      : 'text-black [text-shadow:0_0_2px_rgba(255,255,255,0.5)]'
                  "
                  >✓</span
                >
              </button>
            </div>
          </div>
          <label
            class="group inline-flex items-center gap-2.5 cursor-pointer py-1.5 pl-1.5 pr-2.5 rounded-lg mt-1.5 transition-[background] duration-120 settings-row-hover-strong"
          >
            <input
              type="color"
              class="absolute w-0 h-0 opacity-0 pointer-events-none"
              :value="currentColor"
              @input="emit('selectColor', ($event.target as HTMLInputElement).value)"
            />
            <span
              class="w-[20px] h-[20px] rounded-full color-picker-ring pointer-events-none flex items-center justify-center shadow-[inset_0_0_2px_rgba(0,0,0,0.5)]"
              style="
                background: conic-gradient(
                  from 90deg,
                  #ff0000,
                  #ff8000,
                  #ffff00,
                  #80ff00,
                  #00ff00,
                  #00ff80,
                  #00ffff,
                  #0080ff,
                  #0000ff,
                  #8000ff,
                  #ff00ff,
                  #ff0080,
                  #ff0000
                );
              "
            >
              <span
                class="text-white text-[14px] leading-none font-light"
                style="text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6)"
                >+</span
              >
            </span>
            <span class="text-[11px] overlay-text-label font-sans">{{ t('panel.customColor') }}</span>
          </label>
        </div>

        <!-- Stroke width -->
        <div class="px-3.5 py-2.5 ui-divider-h">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[11px] font-semibold overlay-text-section tracking-[0.5px] font-sans">{{
              t('panel.strokeWidth')
            }}</span>
          </div>
          <div class="flex gap-1">
            <button
              v-for="w in widths"
              :key="w.value"
              class="group flex-1 flex items-center justify-center h-8 border-none rounded-lg cursor-pointer transition-all duration-120"
              :class="lineWidth === w.value ? 'overlay-width-btn--active' : 'overlay-width-btn'"
              :title="w.label"
              @click="updateWidthAndClose(w.value)"
            >
              <span
                class="w-[70%] rounded-full transition-transform duration-120 group-hover:scale-x-110"
                :class="lineWidth === w.value ? 'overlay-width-line--active' : 'overlay-width-line'"
                :style="{
                  height: Math.max(1.5, w.value * 1.2) + 'px',
                }"
              />
            </button>
          </div>
        </div>

        <!-- Shortcut hints -->
        <div class="flex flex-col gap-1.5 pt-3 px-3.5 pb-3 ui-divider-h">
          <div class="flex items-center justify-between text-[10.5px] font-sans">
            <span class="flex items-center gap-1.5 overlay-text-body">
              <kbd class="ui-kbd">{{ modKeyLabel }}</kbd>
              <span class="overlay-text-separator text-[10px]">+</span>
              <span>{{ t('panel.drag') }}</span>
            </span>
            <span class="overlay-text-secondary text-[10.5px] text-right min-w-[48px]">{{ t('panel.rectShape') }}</span>
          </div>
          <div class="flex items-center justify-between text-[10.5px] font-sans">
            <span class="flex items-center gap-1.5 overlay-text-body">
              <kbd class="ui-kbd">Shift</kbd>
              <span class="overlay-text-separator text-[10px]">+</span>
              <span>{{ t('panel.drag') }}</span>
            </span>
            <span class="overlay-text-secondary text-[10.5px] text-right min-w-[48px]">{{
              t('panel.ellipseShape')
            }}</span>
          </div>
          <div class="flex items-center justify-between text-[10.5px] font-sans">
            <span class="flex items-center gap-1.5 overlay-text-body">
              <kbd class="ui-kbd">{{ modKeyLabel }}</kbd>
              <span class="overlay-text-separator text-[10px]">+</span>
              <kbd class="ui-kbd">Shift</kbd>
              <span class="overlay-text-separator text-[10px]">+</span>
              <span>{{ t('panel.drag') }}</span>
            </span>
            <span class="overlay-text-secondary text-[10.5px] text-right min-w-[48px]">{{
              t('panel.arrowShape')
            }}</span>
          </div>
          <div class="flex items-center justify-between text-[10.5px] font-sans">
            <span class="flex items-center gap-1.5 overlay-text-body">
              <kbd class="ui-kbd">Q</kbd>
              <span class="overlay-text-separator text-[10px]">/</span>
              <kbd class="ui-kbd">E</kbd>
              <span class="overlay-text-separator text-[10px]">/</span>
              <span>{{ t('panel.rightClick') }}</span>
            </span>
            <span class="overlay-text-secondary text-[10.5px] text-right min-w-[48px]">{{
              t('panel.switchColor')
            }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
