<script setup lang="ts">
import { computed, ref, onMounted, nextTick } from 'vue'
import { isMacOS } from '../utils/platform'
import { useI18n } from '../i18n'
import type { TextOutlineStyle } from '../composables/drawingTypes'
import { getActiveTextOutline, hexColorToRgba, resolveAutoTextOutlineColor } from '../constants/textOutline'
import { TEXT_SIZE_PRESETS } from '../constants/tools'

const { t } = useI18n()

const props = defineProps<{
  x: number
  y: number
  color: string
  fontSize: number
  initialText?: string
  textOutline?: TextOutlineStyle
  /** Radians; keeps a rotated text editable in place. */
  rotation?: number
  /** Horizontal stretch (1 = natural) applied by corner handles. */
  stretchX?: number
  /** Frame width in CSS px (action.textWidth) — pivot for rotation / stretch. */
  boxWidthPx?: number
}>()

const emit = defineEmits<{
  commit: [text: string, x: number, y: number, width: number, fontSize: number]
  cancel: []
  contextMenu: [event: MouseEvent]
}>()

const textareaRef = ref<HTMLTextAreaElement | null>(null)
const fs = ref(props.fontSize)
const draftText = ref(props.initialText ?? '')
const boxWidth = ref('auto')
const boxHeight = ref('auto')
const lineHeight = computed(() => Math.round(fs.value * 1.3))
const textBoxTransform = computed(() => {
  const lh = lineHeight.value
  const base = `translate(${props.x}px, ${props.y - lh / 2}px)`
  const rot = props.rotation ?? 0
  const stretch = props.stretchX ?? 1
  if (rot === 0 && stretch === 1) return base
  // Rotate about the frame centre, then stretch horizontally about its left edge (2px padding).
  const lines = Math.max(1, draftText.value.split('\n').length)
  const width = Math.max(0, props.boxWidthPx ?? 0)
  const height = lines * lh
  const left = 2
  const cx = 2 + width / 2
  const cy = height / 2
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const dx = left * (1 - stretch) - cx
  const a = cos * stretch
  const b = sin * stretch
  const c = -sin
  const d = cos
  const e = cx + cos * dx + sin * cy
  const f = cy + sin * dx - cos * cy
  return `${base} matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`
})
const activeTextOutline = computed(() =>
  draftText.value.length > 0 ? getActiveTextOutline(props.textOutline, props.color) : null,
)
const outlineStrokeStyle = computed(() => {
  const outline = activeTextOutline.value
  return outline ? `${outline.width}px ${outline.color}` : undefined
})
const inputChromeStyle = computed(() => {
  const halo = resolveAutoTextOutlineColor(props.color)
  return {
    '--textbox-placeholder-color': hexColorToRgba(props.color, 0.8),
    '--textbox-placeholder-halo': halo === '#000000' ? 'rgba(255, 255, 255, 0.9)' : 'rgba(0, 0, 0, 0.55)',
  }
})
const supportsBlockCaret = typeof CSS !== 'undefined' && CSS.supports('caret-shape', 'block')
const isEmpty = computed(() => draftText.value.length === 0)
const placeholderHintStyle = computed(() => ({
  ...inputChromeStyle.value,
  transform: textBoxTransform.value,
  transformOrigin: '0 0',
  fontSize: fs.value + 'px',
  lineHeight: lineHeight.value + 'px',
  minHeight: lineHeight.value + 'px',
}))

function blockCaretWidthReserve(): number {
  // Block caret at end-of-text needs ~1ch; autoResize used to clip it via overflow-hidden.
  return supportsBlockCaret ? Math.ceil(fs.value) : 0
}

function restoreBlockCaret() {
  if (!supportsBlockCaret) return
  const el = textareaRef.value
  if (!el) return
  el.style.setProperty('caret-shape', 'block')
}

function autoResize() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
  el.style.width = 'auto'
  const contentWidth = Math.max(4, el.scrollWidth + 4)
  const caretReserve = blockCaretWidthReserve()
  el.style.width = contentWidth + caretReserve + 'px'
  boxHeight.value = el.style.height
  boxWidth.value = contentWidth + 'px'
}

function onInput(e: Event) {
  const inputEvent = e as InputEvent
  draftText.value = (e.target as HTMLTextAreaElement).value
  autoResize()
  if (supportsBlockCaret && !inputEvent.isComposing) {
    nextTick(restoreBlockCaret)
  }
}

function onCompositionEnd(e: CompositionEvent) {
  draftText.value = (e.target as HTMLTextAreaElement).value
  autoResize()
  nextTick(restoreBlockCaret)
}

onMounted(() => {
  autoResize()
  const el = textareaRef.value
  if (!el) return
  el.focus()
  requestAnimationFrame(() => {
    el.focus()
  })
})

function getText(): string {
  return draftText.value
}

function commitText() {
  const text = getText()
  emit('commit', text, props.x, props.y, 0, fs.value)
}

function onKeyDown(e: KeyboardEvent) {
  e.stopPropagation()
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('cancel')
  }
  if (e.key === 'Enter' && (e.ctrlKey || (isMacOS() && e.metaKey))) {
    e.preventDefault()
    commitText()
  }
}

function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  emit('contextMenu', e)
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  e.stopPropagation()
  const step = e.deltaY < 0 ? 2 : -2
  // Floor matches the smallest toolbar preset, otherwise a small preset jumps up to 12px here.
  fs.value = Math.max(TEXT_SIZE_PRESETS[0], Math.min(120, fs.value + step))
  nextTick(autoResize)
}

function getFontSize(): number {
  return fs.value
}

defineExpose({ commitText, getText, getFontSize })
</script>

<template>
  <div
    v-if="activeTextOutline"
    aria-hidden="true"
    class="fixed left-0 top-0 z-100001 px-0.5 py-0 pointer-events-none select-none font-text overflow-visible whitespace-pre min-w-1 max-w-[80vw]"
    :style="{
      transform: textBoxTransform,
      transformOrigin: '0 0',
      width: boxWidth,
      height: boxHeight,
      color: 'transparent',
      fontSize: fs + 'px',
      lineHeight: lineHeight + 'px',
      minHeight: lineHeight + 'px',
      WebkitTextStroke: outlineStrokeStyle,
    }"
  >
    {{ draftText }}
  </div>
  <span
    v-if="isEmpty && supportsBlockCaret"
    aria-hidden="true"
    class="textbox-placeholder-hint fixed left-0 top-0 z-100001 px-0.5 py-0 pointer-events-none select-none font-text whitespace-pre max-w-[80vw]"
    :style="placeholderHintStyle"
  >
    {{ t('textBox.placeholder') }}
  </span>
  <textarea
    ref="textareaRef"
    class="textbox-input fixed left-0 top-0 z-100002 px-0.5 py-0 border-none bg-transparent outline-none resize-none font-text whitespace-pre min-w-1 max-w-[80vw]"
    :class="{ 'textbox-input--block-caret': supportsBlockCaret }"
    :value="draftText"
    :style="{
      ...inputChromeStyle,
      transform: textBoxTransform,
      transformOrigin: '0 0',
      color: color,
      fontSize: fs + 'px',
      lineHeight: lineHeight + 'px',
      minHeight: lineHeight + 'px',
      caretColor: color,
    }"
    :placeholder="supportsBlockCaret ? '' : t('textBox.placeholder')"
    spellcheck="false"
    @keydown="onKeyDown"
    @input="onInput"
    @compositionend="onCompositionEnd"
    @mousedown.stop
    @contextmenu="onContextMenu"
    @wheel="onWheel"
  />
</template>
