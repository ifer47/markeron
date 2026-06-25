import { ref, computed, type Ref, type ComputedRef } from 'vue'
import type { Tool } from './drawingTypes'

const TOOLTIP_DURATION_MS = 1200
const TIP_DURATION_MS = 1500

export interface TooltipState {
  text: Ref<string>
  tool: Ref<Tool | null>
  color: Ref<string | null>
  width: Ref<number | null>
  visible: ComputedRef<boolean>
}

export interface UseTooltipOptions {
  toolLabelMap: ComputedRef<Record<Tool, string>>
  colorNameMap: ComputedRef<Record<string, string>>
  t: (key: string) => string
}

export function useTooltip(options: UseTooltipOptions) {
  const { toolLabelMap, colorNameMap, t } = options

  const text = ref('')
  const tool = ref<Tool | null>(null)
  const color = ref<string | null>(null)
  const width = ref<number | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null

  const visible = computed(() => text.value !== '')

  function clear() {
    text.value = ''
    tool.value = null
    color.value = null
    width.value = null
  }

  function scheduleHide(duration: number) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(clear, duration)
  }

  function showTool(t: Tool) {
    text.value = toolLabelMap.value[t] || t
    tool.value = t
    color.value = null
    width.value = null
    scheduleHide(TOOLTIP_DURATION_MS)
  }

  function showColor(c: string) {
    text.value = colorNameMap.value[c.toUpperCase()] ?? c
    tool.value = null
    color.value = c
    width.value = null
    scheduleHide(TOOLTIP_DURATION_MS)
  }

  function showWidth(w: number, label?: string) {
    const resolved = t(`widths.${w}`)
    text.value = label ?? (resolved !== `widths.${w}` ? resolved : `${w}px`)
    tool.value = null
    color.value = null
    width.value = w
    scheduleHide(TOOLTIP_DURATION_MS)
  }

  function showMessage(msg: string) {
    text.value = msg
    tool.value = null
    color.value = null
    width.value = null
    scheduleHide(TIP_DURATION_MS)
  }

  function dispose() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  return {
    state: { text, tool, color, width, visible } as TooltipState,
    showTool,
    showColor,
    showWidth,
    showMessage,
    dispose,
  }
}
