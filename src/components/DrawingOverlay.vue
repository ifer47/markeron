<script setup lang="ts">
import { ref, shallowRef, onMounted, onUnmounted, nextTick, computed, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, emit, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useDrawing, type Tool, type DrawAction } from '../composables/useDrawing'
import type { TextOutlineStyle } from '../composables/drawingTypes'
import { useTooltip } from '../composables/useTooltip'
import {
  createKeyDownHandler,
  trackCopyModifierKeyUp,
  resetCopyModifierState,
  invalidateCopyModifierForPointerInteraction,
  markPointerInteractionEnded,
} from '../composables/useOverlayKeyboard'
import {
  OVERLAY_STATE_EVENT,
  TOOLBAR_ACTION_EVENT,
  OVERLAY_STATE_REQUEST_EVENT,
  TOOLBAR_DRAGGING_EVENT,
  TOOLBAR_PANEL_HOVER_EVENT,
  TOOLBAR_POINTER_UP_EVENT,
  TOOLBAR_PANEL_HEIGHT_EVENT,
  OVERLAY_POINTER_SCREEN_EVENT,
  emitOverlayState,
  type ToolbarAction,
} from '../composables/overlayBridge'
import type { AppConfig } from '../types/app'
import { applyTheme, watchSystemTheme, type ThemePreference } from '../composables/useAppTheme'
import TextBox from './TextBox.vue'
import { TOOL_ICON_MAP, WIDTH_PRESETS, eraserLineWidth, resolveLineWidths } from '../constants/tools'
import {
  cycleStampKind as cycleStampKindState,
  getStampKind,
  resetActiveStampCounter,
  stampFontSizeFromWidth,
  takeStampLabel,
} from '../constants/stamp'
import { createDefaultTextOutline, normalizeTextOutline } from '../constants/textOutline'
import {
  EMPTY_TEXT_RMB_CLICK,
  TEXT_RMB_DOUBLE_MS,
  noteTextRmbClick,
  type TextRmbClickState,
} from '../utils/textRmbDoubleClick'
import { COLOR_PALETTE } from '../constants/colors'
import { isMacOS, MAC_HIDDEN_CURSOR, setMacOverlaySystemCursorHidden } from '../utils/platform'
import { canStartElementDrag as canStartElementDragGate } from '../utils/dragInteraction'
import { isDragEnabled, resolveDragMode, type DragMode } from '../utils/dragMode'
import { isToolbarPinned, resolveToolbarVisibility, type ToolbarVisibility } from '../utils/toolbarSettings'
import { resolveDefaultEntryMode, shouldClearWhiteboardOnEntry, type DefaultEntryMode } from '../utils/entryMode'
import { logDiagnostic, logSessionEvent, logActionEvent } from '../utils/diagnosticEvents'
import type { MonitorLogicalBounds } from '../utils/toolbarPosition'
import { toolbarPopupScreenPosition } from '../utils/toolbarPosition'
import { TOOLBAR_PANEL_WIDTH, getToolbarPanelHeight, rememberToolbarPanelHeight } from '../utils/toolbarWindow'
import { resolveEraserMode, type EraserMode } from '../utils/eraserMode'
import { useI18n } from '../i18n'

const { t } = useI18n()

function modDown(e: PointerEvent | KeyboardEvent): boolean {
  return e.ctrlKey || (isMacOS() && e.metaKey)
}

function snapLineModifierDown(e: PointerEvent): boolean {
  return e.altKey
}

const toolIconMap = TOOL_ICON_MAP

const historyCanvasRef = ref<HTMLCanvasElement | null>(null)
const previewCanvasRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const textBoxRef = ref<InstanceType<typeof TextBox> | null>(null)
const active = ref(false)
const penetrationMode = ref(false)
type OverlaySessionMode = 'hidden' | 'drawing' | 'penetration'
let lastOverlayMode: OverlaySessionMode = 'hidden'
const toolbarVisibility = ref<ToolbarVisibility>('space')
const toolbarPinned = computed(() => isToolbarPinned(toolbarVisibility.value))
const showToolbarPopup = ref(false)
const toolbarPanelHovered = ref(false)
const toolbarPanelDragging = ref(false)
/** Hide overlay chrome during screen capture so panels are not in the clipboard image. */
const hideUiForCapture = ref(false)
const sessionActive = computed(() => active.value || penetrationMode.value)
const mousePos = ref({ x: 0, y: 0 })
const textBoxPos = ref<{ x: number; y: number } | null>(null)
const whiteboardMode = ref(false)
const defaultEntryMode = ref<DefaultEntryMode>('screen')

const toolLabelMap = computed<Record<Tool, string>>(() => ({
  pen: t('tools.pen'),
  highlighter: t('tools.highlighter'),
  laser: t('tools.laser'),
  arrow: t('tools.arrow'),
  rect: t('tools.rect'),
  ellipse: t('tools.ellipse'),
  line: t('tools.line'),
  eraser: t('tools.eraser'),
  text: t('tools.text'),
  stamp: t('tools.stamp'),
}))

const colorNameMap = computed<Record<string, string>>(() => ({
  '#FF3B30': t('colors.#FF3B30'),
  '#FF6B35': t('colors.#FF6B35'),
  '#FFCC02': t('colors.#FFCC02'),
  '#34C759': t('colors.#34C759'),
  '#007AFF': t('colors.#007AFF'),
  '#5856D6': t('colors.#5856D6'),
  '#FFFFFF': t('colors.#FFFFFF'),
  '#000000': t('colors.#000000'),
}))

const {
  state: tooltip,
  showTool: showToolTip,
  showColor: showColorTip,
  showWidth: showWidthTip,
  showMessage: showTip,
  dispose: disposeTooltip,
} = useTooltip({ toolLabelMap, colorNameMap, t })

const toolTip = tooltip.text
const toolTipTool = tooltip.tool
const toolTipColor = tooltip.color
const toolTipWidth = tooltip.width

const showQuickColors = ref(false)
const quickColorsPos = ref({ x: 0, y: 0 })

/** Double right-click while editing text commits (issue #32). */
let textRmbClick: TextRmbClickState = { ...EMPTY_TEXT_RMB_CLICK }
/** Swallow trailing contextmenu after text confirm so the palette does not open. */
let suppressQuickColorsUntil = 0

function resetTextRmbDoubleClick() {
  textRmbClick = { ...EMPTY_TEXT_RMB_CLICK }
}

/**
 * While a text box is open: first RMB arms a timer; second nearby RMB commits.
 * Returns true when the event was handled for text editing (do not open quick colors).
 */
function handleTextBoxContextMenu(e: MouseEvent): boolean {
  if (performance.now() < suppressQuickColorsUntil) return true
  if (!active.value || penetrationMode.value || !textBoxPos.value) return false
  // macOS maps Control+click to right-click; skip after a Control+drag.
  if (isMacOS() && e.ctrlKey && pointerMovedSinceDown) return true

  const { isDouble, next } = noteTextRmbClick(textRmbClick, e.clientX, e.clientY, performance.now())
  textRmbClick = next
  if (!isDouble) return true

  hideToolbarPopupForCanvasInteraction()
  showQuickColors.value = false
  commitCurrentTextBox(false)
  // Double-RMB often delivers an extra contextmenu after the box is gone; block palette briefly.
  suppressQuickColorsUntil = performance.now() + TEXT_RMB_DOUBLE_MS + 150
  logActionEvent('text committed', { reason: 'double-right-click' })
  return true
}

const quickColorList = COLOR_PALETTE

function cycleColor(direction: number) {
  const idx = quickColorList.indexOf(currentColor.value)
  const newIdx = idx === -1 ? 0 : (idx + direction + quickColorList.length) % quickColorList.length
  currentColor.value = quickColorList[newIdx]
  showColorTip(currentColor.value)
}

function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  if (handleTextBoxContextMenu(e)) return
  if (performance.now() < suppressQuickColorsUntil) return
  if (!active.value || penetrationMode.value || isDrawing.value) return
  if (isMacOS() && e.ctrlKey && pointerMovedSinceDown) return
  hideToolbarPopupForCanvasInteraction()
  quickColorsPos.value = { x: e.clientX, y: e.clientY }
  showQuickColors.value = true
  logActionEvent('quick colors opened', { reason: 'context-menu' })
}

function selectQuickColor(color: string) {
  currentColor.value = color
  showQuickColors.value = false
  showColorTip(color)
}

function onWheel(e: WheelEvent) {
  if (!active.value || !e.ctrlKey) return
  e.preventDefault()
  const tool = currentTool.value
  const dir = e.deltaY < 0 ? 1 : -1
  const idx = WIDTH_PRESETS.indexOf(lineWidth.value)
  const cur =
    idx !== -1
      ? idx
      : Math.max(
          0,
          WIDTH_PRESETS.findIndex((v) => v >= lineWidth.value),
        )
  const next = Math.max(0, Math.min(WIDTH_PRESETS.length - 1, cur + dir))
  lineWidth.value = WIDTH_PRESETS[next]
  const labelKey = tool === 'text' || tool === 'stamp' ? `textSizes.${lineWidth.value}` : `widths.${lineWidth.value}`
  showWidthTip(lineWidth.value, t(labelKey))
  schedulePersistLineWidths()
}

const {
  currentTool,
  currentColor,
  lineWidth,
  lineWidths,
  setLineWidths,
  setAngleSnapStep,
  setEraserMode,
  isDrawing,
  startDraw,
  draw,
  drawBatch,
  endDraw,
  addTextAction,
  addStampAction,
  findActionAt,
  removeAction,
  undo,
  redo,
  canUndo,
  canRedo,
  canClear,
  clearAll,
  exportAsDataURL,
  hardReset,
  redrawAll,
  beginDrag,
  updateDragOffset,
  endDrag,
  destroy,
} = useDrawing(historyCanvasRef, previewCanvasRef)

const textFontSize = computed(() => Math.max(16, lineWidth.value * 6))
const eraserCursorDiameter = computed(() => Math.min(80, eraserLineWidth(lineWidth.value)))
const eraserCursorRadius = computed(() => eraserCursorDiameter.value / 2)
const textOutline = ref<TextOutlineStyle>(createDefaultTextOutline())

const activeTextBoxColor = ref('#FF0000')
const activeTextBoxFontSize = ref(24)
const activeTextBoxInitialText = ref('')
const activeTextBoxOutline = ref<TextOutlineStyle>(createDefaultTextOutline())
const editingOriginalAction = shallowRef<DrawAction | null>(null)

function applyToolbarFromConfig(general?: AppConfig['general']) {
  const nextVisibility = resolveToolbarVisibility(general)
  toolbarVisibility.value = nextVisibility
  if (isToolbarPinned(nextVisibility)) {
    showToolbarPopup.value = false
    toolbarPanelDragging.value = false
    if (sessionActive.value) {
      void invoke('set_toolbar_visible', { visible: true })
    }
  } else if (sessionActive.value) {
    showToolbarPopup.value = false
    toolbarPanelDragging.value = false
    void invoke('set_toolbar_visible', { visible: false })
  }
}

async function ensureOverlayLayoutReady(): Promise<void> {
  if (overlayLayoutReady.value) return
  if (overlayResizeInFlight) await overlayResizeInFlight
  else await scheduleOverlayResize()
}

async function openToolbarPopupAtPointer(): Promise<void> {
  await ensureOverlayLayoutReady()
  await seedPointerPosition()

  const panelW = TOOLBAR_PANEL_WIDTH
  const panelH = getToolbarPanelHeight()
  let monitorBounds: MonitorLogicalBounds | null = null
  try {
    monitorBounds = await invoke<MonitorLogicalBounds | null>('get_overlay_monitor_logical_bounds')
  } catch {
    // non-fatal for positioning; still log client-side coords
  }
  const { left, top } = toolbarPopupScreenPosition(lastPointerX, lastPointerY, panelW, panelH, monitorBounds, {
    width: window.innerWidth,
    height: window.innerHeight,
  })
  const anchorScreen = monitorBounds
    ? { x: monitorBounds.left + lastPointerX, y: monitorBounds.top + lastPointerY }
    : null
  logActionEvent('toolbar popup opened', {
    pointerClient: { x: lastPointerX, y: lastPointerY },
    pointerScreen: pointerScreenKnown ? { x: lastScreenX, y: lastScreenY } : null,
    anchorScreen,
    panel: { left, top, width: panelW, height: panelH },
    overlayViewport: { width: window.innerWidth, height: window.innerHeight },
    monitorBounds,
    devicePixelRatio: window.devicePixelRatio,
  })
  await invoke('set_toolbar_popup', { visible: true, x: left, y: top, height: panelH })
}

async function setToolbarPopupVisible(visible: boolean) {
  if (toolbarPinned.value) return
  if (showToolbarPopup.value === visible) return
  showToolbarPopup.value = visible
  if (!visible) {
    toolbarPanelHovered.value = false
    toolbarPanelDragging.value = false
    await invoke('set_toolbar_popup', { visible: false, x: null, y: null })
    return
  }
  await openToolbarPopupAtPointer()
}

function toggleToolbarPopupVisible() {
  if (toolbarPinned.value) return
  void setToolbarPopupVisible(!showToolbarPopup.value)
}

function hideToolbarPopupForCanvasInteraction() {
  if (!toolbarPinned.value && showToolbarPopup.value) {
    void setToolbarPopupVisible(false)
  }
}

async function toggleToolbarPin() {
  const nextVisibility: ToolbarVisibility = toolbarPinned.value ? 'space' : 'always'
  try {
    const cfg = await invoke<AppConfig>('get_config')
    if (!cfg.general) return
    cfg.general.toolbarVisibility = nextVisibility
    await invoke('save_general', { general: cfg.general })
    logActionEvent('toolbar pin toggled', { reason: 'toolbar', visibility: nextVisibility })
  } catch (error) {
    console.error('Failed to toggle toolbar pin:', error)
    logActionEvent('toolbar pin toggle failed', { reason: 'toolbar', error: String(error) }, 'error')
  }
}

async function syncOpenToolbarPopupWindow() {
  if (toolbarPinned.value || !showToolbarPopup.value) return
  await openToolbarPopupAtPointer()
}

function applyDefaultEntryFromConfig(general?: AppConfig['general']) {
  defaultEntryMode.value = resolveDefaultEntryMode(general)
}

function applyEraserModeFromConfig(general?: AppConfig['general']) {
  setEraserMode(resolveEraserMode(general))
}

function applyLineWidthsFromConfig(general?: AppConfig['general']) {
  setLineWidths(resolveLineWidths(general?.lineWidths))
}

let persistLineWidthsTimer: ReturnType<typeof setTimeout> | null = null

function schedulePersistLineWidths() {
  if (persistLineWidthsTimer !== null) clearTimeout(persistLineWidthsTimer)
  persistLineWidthsTimer = setTimeout(() => {
    persistLineWidthsTimer = null
    void persistLineWidths()
  }, 250)
}

/** Cancel debounce and persist immediately (exit drawing / unmount). */
function flushPersistLineWidths() {
  if (persistLineWidthsTimer === null) return
  clearTimeout(persistLineWidthsTimer)
  persistLineWidthsTimer = null
  void persistLineWidths()
}

async function persistLineWidths() {
  try {
    // Dedicated IPC patches only lineWidths under the Rust config lock —
    // avoids read-modify-write races with settings `save_general`.
    await invoke('save_line_widths', { lineWidths: resolveLineWidths(lineWidths.value) })
  } catch (error) {
    console.error('Failed to save line widths:', error)
  }
}

function applyDefaultEntryOnActivate() {
  if (defaultEntryMode.value === 'whiteboard') {
    void enterWhiteboardMode({ fromDefaultEntry: true })
  } else {
    whiteboardMode.value = false
    void syncWhiteboardMode(false)
  }
}

async function syncWhiteboardMode(active: boolean) {
  try {
    await invoke('set_whiteboard_mode', { active })
  } catch (error) {
    console.error('Failed to sync whiteboard mode:', error)
  }
}

async function enterWhiteboardMode(options?: { fromDefaultEntry?: boolean }) {
  if (whiteboardMode.value) return
  await resumeDrawingFromToolbar()
  if (
    shouldClearWhiteboardOnEntry({
      whiteboardPreserveDrawings: whiteboardPreserveDrawings.value,
      preserveDrawings: preserveDrawings.value,
      fromDefaultEntry: options?.fromDefaultEntry ?? false,
      hasDrawings: canClear.value,
    })
  ) {
    hardReset()
    logActionEvent('canvas hard reset', { reason: 'whiteboard-entry' })
  }
  whiteboardMode.value = true
  showQuickColors.value = false
  textBoxPos.value = null
  void syncWhiteboardMode(true)
  currentTool.value = 'pen'
  logSessionEvent('whiteboard entered', {
    fromDefaultEntry: options?.fromDefaultEntry ?? false,
  })
  showTip(t('overlay.whiteboardReady'))
}

function exitWhiteboardMode() {
  if (!whiteboardMode.value) return
  whiteboardMode.value = false
  void syncWhiteboardMode(false)
  showQuickColors.value = false
  textBoxPos.value = null
  if (!whiteboardPreserveDrawings.value) {
    hardReset()
    logActionEvent('canvas hard reset', { reason: 'whiteboard-exit' })
  }
  logSessionEvent('whiteboard exited')
  showTip(t('overlay.whiteboardExit'))
}

const hoveredActionInfo = shallowRef<{ action: DrawAction; index: number } | null>(null)
const isMoving = ref(false)
const dragMode = ref<DragMode>('off')
const pointerModDown = ref(false)
const preserveDrawings = ref(false)
const whiteboardPreserveDrawings = ref(true)
let hoverRafId: number | null = null
let isDragging = false
let dragStartX = 0
let dragStartY = 0
let capturedPointerId: number | null = null
/** Suppress Control+click context menu after Control+drag (macOS maps ctrl+click to right-click). */
let pointerDownClient: { x: number; y: number } | null = null
let pointerMovedSinceDown = false
const CONTEXT_MENU_DRAG_THRESHOLD_PX = 5
let lastPointerX = 0
let lastPointerY = 0
let lastScreenX = 0
let lastScreenY = 0
let pointerScreenKnown = false
/** Gate custom SVG cursor until OS pointer is seeded (avoids flash at 0,0). */
const customCursorPositionReady = ref(true)

function emitPointerScreenForToolbar() {
  if (!pointerScreenKnown) return
  void emit(OVERLAY_POINTER_SCREEN_EVENT, { x: lastScreenX, y: lastScreenY })
}

/** macOS transparent overlay may not receive pointermove until click — poll OS cursor via Rust. */
let macPointerPollRafId: number | null = null
let macPointerPollBusy = false

function stopMacPointerPoll() {
  if (macPointerPollRafId !== null) {
    cancelAnimationFrame(macPointerPollRafId)
    macPointerPollRafId = null
  }
}

function scheduleMacPointerPollFrame() {
  if (macPointerPollRafId !== null) return
  macPointerPollRafId = requestAnimationFrame(() => {
    macPointerPollRafId = null
    void runMacPointerPollTick()
  })
}

async function runMacPointerPollTick() {
  if (!isMacOS() || !active.value || penetrationMode.value) return
  if (!macPointerPollBusy) {
    macPointerPollBusy = true
    try {
      const pos = await invoke<{
        x: number
        y: number
        screenX: number
        screenY: number
      } | null>('get_overlay_pointer_position')
      if (pos && active.value && !penetrationMode.value) {
        lastPointerX = pos.x
        lastPointerY = pos.y
        lastScreenX = pos.screenX
        lastScreenY = pos.screenY
        pointerScreenKnown = true
        mousePos.value = { x: pos.x, y: pos.y }
        if (!toolbarPanelDragging.value) {
          try {
            toolbarPanelHovered.value = await invoke<boolean>('is_pointer_over_toolbar_panel')
          } catch {
            // keep previous hover state
          }
        }
        if (!toolbarPanelHovered.value && !toolbarPanelDragging.value) {
          updateCursorEl(pos.x, pos.y)
        }
      }
    } catch {
      // ignore transient IPC failures
    } finally {
      macPointerPollBusy = false
    }
  }
  if (active.value && !penetrationMode.value) {
    scheduleMacPointerPollFrame()
  }
}

function startMacPointerPoll() {
  if (!isMacOS()) return
  scheduleMacPointerPollFrame()
}

let pointerScreenRafId: number | null = null
function scheduleEmitPointerScreenForToolbar() {
  if (pointerScreenRafId !== null) return
  pointerScreenRafId = requestAnimationFrame(() => {
    pointerScreenRafId = null
    emitPointerScreenForToolbar()
  })
}

async function seedPointerPosition() {
  try {
    const pos = await invoke<{
      x: number
      y: number
      screenX: number
      screenY: number
    } | null>('get_overlay_pointer_position')
    if (!pos) return
    lastPointerX = pos.x
    lastPointerY = pos.y
    lastScreenX = pos.screenX
    lastScreenY = pos.screenY
    pointerScreenKnown = true
    mousePos.value = { x: pos.x, y: pos.y }
  } catch (error) {
    console.error('Failed to seed pointer position:', error)
  }
}

function onGlobalPointerUp(e: PointerEvent) {
  if (capturedPointerId === null || e.pointerId !== capturedPointerId) return
  onPointerUp(e)
}

function onGlobalPointerMove(e: PointerEvent) {
  lastPointerX = e.clientX
  lastPointerY = e.clientY
  lastScreenX = e.screenX
  lastScreenY = e.screenY
  pointerScreenKnown = true
  mousePos.value = { x: e.clientX, y: e.clientY }
  // Cross-window: leaving the toolbar webview may not fire pointerleave; clear stale
  // hover so the custom pen cursor is not suppressed while drawing on the overlay.
  if (!isMacOS() && active.value && !penetrationMode.value) {
    toolbarPanelHovered.value = false
  }
  if (isMacOS()) return
  if (sessionActive.value && !penetrationMode.value) {
    scheduleEmitPointerScreenForToolbar()
  }
  if (active.value && !penetrationMode.value && !toolbarPanelHovered.value && !toolbarPanelDragging.value) {
    updateCursorEl(e.clientX, e.clientY)
  }
}

watch(
  () => [active.value, penetrationMode.value] as const,
  ([isDrawing, isPenetrating]) => {
    if (!isMacOS()) return
    if (isDrawing && !isPenetrating) {
      startMacPointerPoll()
    } else {
      stopMacPointerPoll()
    }
  },
  { immediate: true },
)

watch(
  sessionActive,
  (isLive) => {
    if (isLive) {
      window.addEventListener('pointermove', onGlobalPointerMove, { passive: true })
      window.addEventListener('pointerup', onGlobalPointerUp)
      window.addEventListener('pointercancel', onGlobalPointerUp)
    } else {
      window.removeEventListener('pointermove', onGlobalPointerMove)
      window.removeEventListener('pointerup', onGlobalPointerUp)
      window.removeEventListener('pointercancel', onGlobalPointerUp)
    }
  },
  { immediate: true },
)

// Cap total canvas bitmap pixels to keep drawImage / clearRect fast on
// high-resolution displays with low scale factors (e.g. 4K @ 150% → 2560×1440
// CSS viewport, 8.3M bitmap pixels). The budget is set so that typical laptop
// displays (e.g. 2880×1800 @ 200%) are unaffected.
const MAX_CANVAS_PIXELS = 6_000_000

function getEffectiveDpr(): number {
  const rawDpr = window.devicePixelRatio || 1
  const cssW = window.innerWidth
  const cssH = window.innerHeight
  const rawPixels = cssW * rawDpr * cssH * rawDpr
  if (rawPixels <= MAX_CANVAS_PIXELS) return rawDpr
  return Math.max(1, Math.sqrt(MAX_CANVAS_PIXELS / (cssW * cssH)))
}

function resizeCanvas() {
  const historyCanvas = historyCanvasRef.value
  const previewCanvas = previewCanvasRef.value
  if (!historyCanvas || !previewCanvas) return

  const dpr = getEffectiveDpr()
  for (const canvas of [historyCanvas, previewCanvas]) {
    canvas.width = Math.round(window.innerWidth * dpr)
    canvas.height = Math.round(window.innerHeight * dpr)
    canvas.style.width = window.innerWidth + 'px'
    canvas.style.height = window.innerHeight + 'px'
  }

  redrawAll()
}

/** False while overlay canvas is catching up after a monitor move / DPI change. */
const overlayLayoutReady = ref(true)
let overlayResizeGeneration = 0
let overlayResizeInFlight: Promise<void> | null = null

/** Wait for Win32/WebView2 to finish DPI relayout after a monitor move. */
function afterLayoutFrames(frameCount = 2): Promise<void> {
  return new Promise((resolve) => {
    const step = (remaining: number) => {
      if (remaining <= 0) {
        resolve()
        return
      }
      requestAnimationFrame(() => step(remaining - 1))
    }
    step(frameCount)
  })
}

async function scheduleOverlayResize(): Promise<void> {
  if (overlayResizeInFlight) return overlayResizeInFlight

  const generation = ++overlayResizeGeneration
  overlayLayoutReady.value = false

  overlayResizeInFlight = (async () => {
    try {
      // WebView2 applies per-monitor DPI asynchronously; extra frames on Windows avoid
      // drawing with a canvas sized for the previous monitor on first activation.
      await afterLayoutFrames(isMacOS() ? 2 : 4)
      if (generation !== overlayResizeGeneration) return
      resizeCanvas()

      if (!isMacOS()) {
        await afterLayoutFrames(2)
        if (generation !== overlayResizeGeneration) return
        resizeCanvas()
      }

      watchDpr()
    } finally {
      if (generation === overlayResizeGeneration) {
        overlayLayoutReady.value = true
      }
      overlayResizeInFlight = null
    }
  })()

  return overlayResizeInFlight
}

let toolBeforeModifier: string | null = null
let resizeTimer: ReturnType<typeof setTimeout> | null = null
let dprMediaQuery: MediaQueryList | null = null

function debouncedResize() {
  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = setTimeout(resizeCanvas, 100)
}

function watchDpr() {
  dprMediaQuery?.removeEventListener('change', onDprChange)
  dprMediaQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
  dprMediaQuery.addEventListener('change', onDprChange)
}

function onDprChange() {
  debouncedResize()
  watchDpr()
}

function commitCurrentTextBox(cancel = false) {
  if (textBoxRef.value && textBoxPos.value) {
    if (cancel && editingOriginalAction.value) {
      // Cancel edit: restore the original text action
      const a = editingOriginalAction.value
      addTextAction(a.text!, a.points[0].x, a.points[0].y, 0, a.fontSize!, a.color, normalizeTextOutline(a.textOutline))
    } else if (!cancel) {
      const text = textBoxRef.value.getText()
      const actualFs = textBoxRef.value.getFontSize()
      if (text.trim()) {
        addTextAction(
          text,
          textBoxPos.value.x,
          textBoxPos.value.y,
          0,
          actualFs,
          activeTextBoxColor.value,
          activeTextBoxOutline.value,
        )
      }
    }
    textBoxPos.value = null
    editingOriginalAction.value = null
    resetTextRmbDoubleClick()
  }
}

function applyDragModeFromConfig(general?: AppConfig['general']) {
  dragMode.value = resolveDragMode(general)
}

function canStartElementDrag(e: PointerEvent): boolean {
  if (currentTool.value === 'eraser') return false
  return canStartElementDragGate({
    dragMode: dragMode.value,
    hasHoveredElement: !!hoveredActionInfo.value,
    modifierDown: modDown(e),
  })
}

function onDoubleClick(e: MouseEvent) {
  if (e.button !== 0) return
  if (penetrationMode.value || showQuickColors.value) return

  const pos = { x: e.clientX, y: e.clientY }
  const clickedActionInfo = findActionAt(pos)

  if (clickedActionInfo && clickedActionInfo.action.tool === 'text') {
    hideToolbarPopupForCanvasInteraction()
    if (textBoxPos.value) {
      commitCurrentTextBox()
    }

    const { action, index } = clickedActionInfo
    editingOriginalAction.value = action
    removeAction(index)

    activeTextBoxColor.value = action.color
    activeTextBoxFontSize.value = action.fontSize ?? 24
    activeTextBoxInitialText.value = action.text ?? ''
    activeTextBoxOutline.value = normalizeTextOutline(action.textOutline)
    textOutline.value = normalizeTextOutline(action.textOutline)

    currentTool.value = 'text'

    nextTick(() => {
      textBoxPos.value = { x: action.points[0].x, y: action.points[0].y }
    })
  } else if (currentTool.value === 'text') {
    // In text mode, double-click on empty area to create new text
    hideToolbarPopupForCanvasInteraction()
    if (textBoxPos.value) {
      commitCurrentTextBox()
    }
    activeTextBoxColor.value = currentColor.value
    activeTextBoxFontSize.value = textFontSize.value
    activeTextBoxInitialText.value = ''
    activeTextBoxOutline.value = normalizeTextOutline(textOutline.value)
    nextTick(() => {
      textBoxPos.value = pos
    })
  }
}

async function ensureToolbarAboveOverlay() {
  try {
    await invoke('raise_toolbar')
  } catch (error) {
    console.error('Failed to raise toolbar above overlay:', error)
  }
}

function capturePointer(e: PointerEvent) {
  previewCanvasRef.value?.setPointerCapture(e.pointerId)
  capturedPointerId = e.pointerId
}

function releaseCapturedPointer() {
  if (capturedPointerId === null || !previewCanvasRef.value) return
  try {
    previewCanvasRef.value.releasePointerCapture(capturedPointerId)
  } catch {
    // pointer already released
  }
  capturedPointerId = null
}

function resetPointerGestureState() {
  pointerDownClient = null
  pointerMovedSinceDown = false
}

function finishActivePointerInteraction() {
  if (hoverRafId !== null) {
    cancelAnimationFrame(hoverRafId)
    hoverRafId = null
  }
  releaseCapturedPointer()
  if (isDragging) {
    isDragging = false
    isMoving.value = false
    endDrag()
  } else if (isDrawing.value) {
    endDraw()
    if (toolBeforeModifier !== null) {
      currentTool.value = toolBeforeModifier as Tool
      toolBeforeModifier = null
    }
  }
  hoveredActionInfo.value = null
  pointerModDown.value = false
  markPointerInteractionEnded()
  resetPointerGestureState()
}

async function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  if (penetrationMode.value || !active.value || showQuickColors.value) return

  pointerDownClient = { x: e.clientX, y: e.clientY }
  pointerMovedSinceDown = false
  invalidateCopyModifierForPointerInteraction()

  if (!overlayLayoutReady.value) {
    await scheduleOverlayResize()
  }

  lastPointerX = e.clientX
  lastPointerY = e.clientY

  if (textBoxPos.value) {
    hideToolbarPopupForCanvasInteraction()
    commitCurrentTextBox()
    return
  }

  // Capture immediately so move/up events are not lost while awaiting IPC (raise_toolbar).
  const willInteract =
    canStartElementDrag(e) || (currentTool.value !== 'text' && currentTool.value !== 'stamp' && !penetrationMode.value)
  if (willInteract) {
    capturePointer(e)
  }

  await ensureToolbarAboveOverlay()

  // Drag when over an element; optional: require Ctrl/Command (scheme A — modifier on element wins over rect draw)
  if (canStartElementDrag(e)) {
    hideToolbarPopupForCanvasInteraction()
    isDragging = true
    dragStartX = e.clientX
    dragStartY = e.clientY
    isMoving.value = true
    beginDrag(hoveredActionInfo.value!.action)
    return
  }

  // In text mode, single-click is a no-op (text creation is handled by double-click)
  if (currentTool.value === 'text') {
    return
  }

  // Stamp: single click places the next number/letter badge
  if (currentTool.value === 'stamp') {
    hideToolbarPopupForCanvasInteraction()
    placeStampAt(e.clientX, e.clientY)
    return
  }

  hideToolbarPopupForCanvasInteraction()

  if (modDown(e) && e.shiftKey) {
    toolBeforeModifier = currentTool.value
    currentTool.value = 'arrow'
  } else if (modDown(e)) {
    toolBeforeModifier = currentTool.value
    currentTool.value = 'rect'
  } else if (e.shiftKey) {
    toolBeforeModifier = currentTool.value
    currentTool.value = 'ellipse'
  } else if (e.altKey) {
    toolBeforeModifier = currentTool.value
    currentTool.value = 'line'
  }

  capturePointer(e)
  startDraw({ x: e.clientX, y: e.clientY })
}

function onPointerMove(e: PointerEvent) {
  lastPointerX = e.clientX
  lastPointerY = e.clientY
  if (pointerDownClient) {
    const dx = e.clientX - pointerDownClient.x
    const dy = e.clientY - pointerDownClient.y
    if (dx * dx + dy * dy > CONTEXT_MENU_DRAG_THRESHOLD_PX * CONTEXT_MENU_DRAG_THRESHOLD_PX) {
      pointerMovedSinceDown = true
    }
  }
  lastScreenX = e.screenX
  lastScreenY = e.screenY
  pointerScreenKnown = true
  pointerModDown.value = modDown(e)
  if (!isMacOS() && !toolbarPanelHovered.value) {
    updateCursorEl(e.clientX, e.clientY)
  }

  if (isDragging) {
    updateDragOffset(e.clientX - dragStartX, e.clientY - dragStartY)
    return
  }

  if (!isDrawing.value) {
    mousePos.value.x = e.clientX
    mousePos.value.y = e.clientY

    if (
      active.value &&
      !penetrationMode.value &&
      !showQuickColors.value &&
      !textBoxPos.value &&
      isDragEnabled(dragMode.value)
    ) {
      if (hoverRafId === null) {
        hoverRafId = requestAnimationFrame(() => {
          hoverRafId = null
          if (
            active.value &&
            !penetrationMode.value &&
            !showQuickColors.value &&
            !textBoxPos.value &&
            isDragEnabled(dragMode.value)
          ) {
            hoveredActionInfo.value = findActionAt(mousePos.value)
          }
        })
      }
    } else {
      hoveredActionInfo.value = null
    }
    return
  }

  const isPerfect = snapLineModifierDown(e)

  const coalesced = e.getCoalescedEvents?.()
  if (coalesced && coalesced.length > 0) {
    drawBatch(coalesced, isPerfect)
  } else {
    draw({ x: e.clientX, y: e.clientY }, isPerfect)
  }
}

function onPointerUp(e: PointerEvent) {
  if (capturedPointerId !== null && e.pointerId !== capturedPointerId) return
  // Text-tool / commit-textbox clicks invalidate the copy modifier on pointerdown but
  // never capture — still clear gesture state so Ctrl+C works after the press.
  if (capturedPointerId === null && !isDrawing.value && !isDragging) {
    markPointerInteractionEnded()
    resetPointerGestureState()
    return
  }
  const wasDrawing = isDrawing.value
  releaseCapturedPointer()

  if (isDragging) {
    isDragging = false
    isMoving.value = false
    endDrag()
    markPointerInteractionEnded()
    resetPointerGestureState()
    return
  }

  endDraw()
  if (wasDrawing) {
    logDiagnostic('pointer', 'stroke end', {
      pointerType: e.pointerType,
      button: e.button,
      pressure: e.pressure,
      pointerId: e.pointerId,
    })
  }
  if (toolBeforeModifier !== null) {
    currentTool.value = toolBeforeModifier as Tool
    toolBeforeModifier = null
  }
  markPointerInteractionEnded()
  resetPointerGestureState()
}

function abortActivePointerInteraction() {
  if (hoverRafId !== null) {
    cancelAnimationFrame(hoverRafId)
    hoverRafId = null
  }
  releaseCapturedPointer()
  if (isDragging) {
    isDragging = false
    isMoving.value = false
    endDrag()
  }
  if (isDrawing.value) {
    endDraw()
  }
  toolBeforeModifier = null
  hoveredActionInfo.value = null
  pointerModDown.value = false
  markPointerInteractionEnded()
  resetPointerGestureState()
}

function onTextCommit() {
  commitCurrentTextBox(false)
}

function onTextCancel() {
  commitCurrentTextBox(true)
}

function showStampTip() {
  const kind = getStampKind()
  showTip(t(kind === 'number' ? 'tools.stampNumber' : 'tools.stampLetter'))
}

function cycleStampKind() {
  cycleStampKindState()
  showStampTip()
}

function resetStampCounter() {
  const label = resetActiveStampCounter()
  showTip(t('tools.stampReset', { label }))
  logActionEvent('stamp counter reset', { kind: getStampKind(), next: label })
}

function placeStampAt(x: number, y: number) {
  const label = takeStampLabel()
  addStampAction(label, x, y, stampFontSizeFromWidth(lineWidth.value), currentColor.value)
  logActionEvent('stamp placed', { kind: getStampKind(), label })
}

const onKeyDown = createKeyDownHandler(
  {
    active,
    showToolbarPopup,
    toolbarPinned,
    showQuickColors,
    quickColorsPos,
    textBoxPos,
    currentTool,
    whiteboardMode,
    isDrawing,
    lastPointerX: () => lastPointerX,
    lastPointerY: () => lastPointerY,
    mousePos,
  },
  {
    cycleColor,
    showToolTip,
    showStampTip,
    cycleStampKind,
    resetStampCounter,
    undo,
    redo,
    togglePenetrationMode,
    enterWhiteboardMode,
    exitWhiteboardMode,
    copyScreen: () => {
      void copyScreen('keyboard')
    },
    copyWhiteboard: () => {
      void copyWhiteboard('keyboard')
    },
    toggleToolbarPopupVisible,
    commitCurrentTextBox,
    exitDrawing: () => {
      exitDrawing('keyboard')
    },
  },
)

async function togglePenetrationMode() {
  if (whiteboardMode.value) return
  await invoke('toggle_penetration_mode')
}

// Custom cursor element ref — position updated directly in pointermove for performance
const cursorEl = ref<HTMLDivElement | null>(null)

function getCursorHotspot(): { x: number; y: number } {
  const tool = currentTool.value
  // SVG viewBox is 0 0 1024 1024. Pen tip is at approximately (388, 846).
  // Mapped to 32x32 cursor size: x = 388/1024*32 ≈ 12, y = 846/1024*32 ≈ 26
  if (tool === 'pen') return { x: 12, y: 26 }
  if (tool === 'highlighter') return { x: 5, y: 27 } // tip at ~(150, 850) in 1024x1024 space
  if (tool === 'eraser') {
    const d = Math.min(80, eraserLineWidth(lineWidth.value))
    return { x: d / 2, y: d / 2 }
  }
  return { x: 14, y: 14 }
}

function updateCursorEl(x: number, y: number) {
  if (!cursorEl.value) return
  const { x: hx, y: hy } = getCursorHotspot()
  cursorEl.value.style.transform = `translate(${x - hx}px, ${y - hy}px)`
}

async function refreshCustomCursorPosition() {
  await nextTick()
  if (!showCustomCursor.value) return
  if (cursorEl.value) {
    updateCursorEl(lastPointerX, lastPointerY)
    return
  }
  requestAnimationFrame(() => updateCursorEl(lastPointerX, lastPointerY))
}

const showDragCursor = computed(
  () =>
    isDragEnabled(dragMode.value) &&
    (isMoving.value ||
      (hoveredActionInfo.value && !isDrawing.value && dragMode.value === 'modifier' && pointerModDown.value)),
)

const wantsCustomCursor = computed(
  () =>
    active.value &&
    customCursorPositionReady.value &&
    !penetrationMode.value &&
    !textBoxPos.value &&
    !hideUiForCapture.value &&
    !showQuickColors.value &&
    !toolbarPanelHovered.value &&
    !toolbarPanelDragging.value &&
    !showDragCursor.value &&
    currentTool.value !== 'text' &&
    currentTool.value !== 'stamp',
)

// Use system cursor as fallback whenever the SVG overlay cursor is suppressed.
const canvasCursor = computed(() => {
  if (penetrationMode.value) return 'default'
  if (showDragCursor.value) return 'move'
  if (currentTool.value === 'text') return 'text'
  if (currentTool.value === 'stamp') return 'crosshair'
  if (showQuickColors.value) return 'default'
  if (wantsCustomCursor.value) return isMacOS() ? MAC_HIDDEN_CURSOR : 'none'
  return 'default'
})

const showCustomCursor = computed(() => wantsCustomCursor.value)

// Fix cursor offset when switching tools/colors via shortcut while pointer is stationary
watch([currentTool, currentColor], () => {
  void refreshCustomCursorPosition()
})

watch(showCustomCursor, (visible, wasVisible) => {
  setMacOverlaySystemCursorHidden(visible)
  if (visible) {
    void (async () => {
      // Re-focus overlay when resuming the custom pen (matches drawing-mode entry).
      if (isMacOS() && !wasVisible) {
        try {
          await getCurrentWindow().setFocus()
        } catch {
          // non-fatal
        }
      }
      await refreshCustomCursorPosition()
    })()
  }
})

/** Let the toolbar receive hover/clicks while the cursor is over the panel (macOS). */
async function syncMacOverlayCursorPassthrough() {
  if (!isMacOS() || !active.value || penetrationMode.value) return
  const passThrough = toolbarPanelHovered.value || toolbarPanelDragging.value
  try {
    await invoke('set_overlay_ignore_cursor_events', { ignore: passThrough })
  } catch {
    // non-fatal
  }
}

watch([toolbarPanelHovered, toolbarPanelDragging, penetrationMode], () => {
  void syncMacOverlayCursorPassthrough()
})

const quickColorsPanelStyle = computed(() => {
  const pw = 280,
    ph = 72
  let left = quickColorsPos.value.x - pw / 2
  let top = quickColorsPos.value.y - ph - 12
  left = Math.max(8, Math.min(left, window.innerWidth - pw - 8))
  if (top < 8) top = quickColorsPos.value.y + 12
  top = Math.max(8, Math.min(top, window.innerHeight - ph - 8))
  return { left: left + 'px', top: top + 'px' }
})

function syncOverlayStateToToolbar() {
  if (!sessionActive.value) return
  emitOverlayState({
    currentTool: currentTool.value,
    currentColor: currentColor.value,
    lineWidth: lineWidth.value,
    textOutline: textOutline.value,
    whiteboardMode: whiteboardMode.value,
    penetrationMode: penetrationMode.value,
    canUndo: canUndo.value,
    canRedo: canRedo.value,
    canClear: canClear.value,
  })
}

async function resumeDrawingFromToolbar() {
  if (penetrationMode.value) {
    await invoke('exit_penetration_mode')
  }
}

function logToolbarAction(action: ToolbarAction) {
  const reason = 'toolbar' as const
  switch (action.type) {
    case 'selectTool':
      logActionEvent('tool selected', { reason, tool: action.tool })
      break
    case 'selectColor':
      logActionEvent('color selected', { reason, color: action.color })
      break
    case 'updateLineWidth':
      logActionEvent('line width changed', { reason, width: action.width })
      break
    case 'updateTextOutline':
      logActionEvent('text outline changed', { reason, textOutline: action.textOutline })
      break
    case 'undo':
      logActionEvent('undo', { reason })
      break
    case 'redo':
      logActionEvent('redo', { reason })
      break
    case 'clearAll':
      logActionEvent('canvas cleared', { reason })
      break
    case 'toggleWhiteboard':
      logActionEvent('whiteboard toggle requested', { reason })
      break
    case 'copy':
      logActionEvent('copy requested', { reason, mode: whiteboardMode.value ? 'whiteboard' : 'screen' })
      break
    case 'togglePenetration':
      logActionEvent('toggle penetration requested', { reason })
      break
    case 'togglePin':
      logActionEvent('toolbar pin toggle requested', { reason })
      break
    case 'exitDrawing':
      logActionEvent('exit drawing requested', { reason })
      break
  }
}

async function handleToolbarAction(action: ToolbarAction) {
  logToolbarAction(action)
  switch (action.type) {
    case 'selectTool':
      await resumeDrawingFromToolbar()
      if (action.tool === 'stamp') {
        if (currentTool.value === 'stamp') {
          cycleStampKind()
        } else {
          currentTool.value = 'stamp'
          showStampTip()
        }
      } else {
        currentTool.value = action.tool
        showToolTip(action.tool)
      }
      break
    case 'selectColor':
      await resumeDrawingFromToolbar()
      currentColor.value = action.color
      showColorTip(action.color)
      break
    case 'updateLineWidth':
      await resumeDrawingFromToolbar()
      lineWidth.value = action.width
      schedulePersistLineWidths()
      break
    case 'updateTextOutline':
      await resumeDrawingFromToolbar()
      textOutline.value = normalizeTextOutline(action.textOutline)
      if (textBoxPos.value) {
        activeTextBoxOutline.value = normalizeTextOutline(action.textOutline)
      }
      break
    case 'undo':
      undo()
      break
    case 'redo':
      redo()
      break
    case 'clearAll':
      if (isDrawing.value || isDragging || capturedPointerId !== null) {
        finishActivePointerInteraction()
      }
      clearAll()
      break
    case 'toggleWhiteboard':
      await toggleWhiteboardFromToolbar()
      break
    case 'copy':
      copyFromToolbar()
      break
    case 'togglePenetration':
      await togglePenetrationMode()
      break
    case 'togglePin':
      await toggleToolbarPin()
      break
    case 'exitDrawing':
      exitDrawing('toolbar')
      break
  }
  syncOverlayStateToToolbar()
}

watch(
  [
    currentTool,
    currentColor,
    lineWidth,
    textOutline,
    whiteboardMode,
    penetrationMode,
    canUndo,
    canRedo,
    canClear,
    sessionActive,
  ],
  () => syncOverlayStateToToolbar(),
)

function syncPointerModFromKey(e: KeyboardEvent) {
  if (e.key === 'Control' || e.key === 'Meta' || modDown(e)) {
    pointerModDown.value = modDown(e)
  }
}

function onKeyUp(e: KeyboardEvent) {
  trackCopyModifierKeyUp(e)
  if (e.key === 'Alt') {
    e.preventDefault()
  }
  if (e.key === 'Control' || e.key === 'Meta') {
    pointerModDown.value = false
  }
}

const unlisteners: UnlistenFn[] = []
let currentTheme: ThemePreference = 'dark'
let stopThemeWatch: (() => void) | null = null

function resolveThemePref(general?: AppConfig['general']): ThemePreference {
  const value = general?.theme
  return value === 'light' || value === 'system' || value === 'dark' ? value : 'dark'
}

onMounted(async () => {
  void scheduleOverlayResize()
  window.addEventListener('resize', debouncedResize)
  window.addEventListener('keydown', syncPointerModFromKey)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  watchDpr()

  const overlayWindow = getCurrentWindow()
  unlisteners.push(
    await overlayWindow.onResized(() => {
      debouncedResize()
    }),
  )
  unlisteners.push(
    await overlayWindow.onScaleChanged(() => {
      watchDpr()
      debouncedResize()
    }),
  )
  unlisteners.push(
    await listen('overlay-geometry-changed', () => {
      overlayLayoutReady.value = false
      void scheduleOverlayResize()
    }),
  )

  // Fetch initial config
  try {
    const cfg = await invoke<AppConfig>('get_config')
    applyDragModeFromConfig(cfg.general)
    applyToolbarFromConfig(cfg.general)
    applyDefaultEntryFromConfig(cfg.general)
    applyEraserModeFromConfig(cfg.general)
    applyLineWidthsFromConfig(cfg.general)
    preserveDrawings.value = cfg.general?.preserveDrawings ?? false
    whiteboardPreserveDrawings.value = cfg.general?.whiteboardPreserveDrawings ?? true
    setAngleSnapStep((cfg.general?.angleSnapStep as 15 | 30 | 45 | undefined) ?? 15)
    currentTheme = resolveThemePref(cfg.general)
    await applyTheme(currentTheme)
    stopThemeWatch = watchSystemTheme(() => currentTheme)
  } catch (error) {
    console.error('Failed to get initial config:', error)
  }

  // Listen to config changes
  unlisteners.push(
    await listen<AppConfig>('config-changed', (event) => {
      applyDragModeFromConfig(event.payload.general)
      applyToolbarFromConfig(event.payload.general)
      applyDefaultEntryFromConfig(event.payload.general)
      applyEraserModeFromConfig(event.payload.general)
      // lineWidths: overlay is the sole writer; skip echo from our own save_general
      preserveDrawings.value = event.payload.general?.preserveDrawings ?? false
      whiteboardPreserveDrawings.value = event.payload.general?.whiteboardPreserveDrawings ?? true
      setAngleSnapStep((event.payload.general?.angleSnapStep as 15 | 30 | 45 | undefined) ?? 15)
      currentTheme = resolveThemePref(event.payload.general)
      void applyTheme(currentTheme)
    }),
  )

  unlisteners.push(
    await listen(OVERLAY_STATE_REQUEST_EVENT, () => {
      syncOverlayStateToToolbar()
    }),
  )

  unlisteners.push(
    await listen<string>('overlay-mode-changed', (event) => {
      const mode = event.payload as OverlaySessionMode
      const previousMode = lastOverlayMode
      lastOverlayMode = mode
      logSessionEvent('overlay mode changed', { from: previousMode, to: mode })
      penetrationMode.value = mode === 'penetration'
      if (mode === 'drawing') {
        customCursorPositionReady.value = false
        overlayLayoutReady.value = false
      } else if (mode === 'hidden') {
        customCursorPositionReady.value = true
      }
      active.value = mode === 'drawing'
      showQuickColors.value = false
      textBoxPos.value = null
      if (mode === 'hidden') {
        flushPersistLineWidths()
        whiteboardMode.value = false
        void syncWhiteboardMode(false)
        toolbarPanelHovered.value = false
        toolbarPanelDragging.value = false
        showToolbarPopup.value = false
        if (!preserveDrawings.value) {
          hardReset()
          logActionEvent('canvas hard reset', { reason: 'exit-drawing' })
        }
      } else if (mode === 'drawing') {
        toolbarPanelHovered.value = false
        toolbarPanelDragging.value = false
        if (!toolbarPinned.value && previousMode === 'hidden') {
          showToolbarPopup.value = false
        }
        if (previousMode === 'hidden') {
          currentTool.value = 'pen'
          applyDefaultEntryOnActivate()
        }
        void (async () => {
          await scheduleOverlayResize()
          await seedPointerPosition()
          customCursorPositionReady.value = true
          await refreshCustomCursorPosition()
          emitPointerScreenForToolbar()
          await syncOpenToolbarPopupWindow()
        })()
      } else if (mode === 'penetration') {
        abortActivePointerInteraction()
        void syncOpenToolbarPopupWindow()
      }
      syncOverlayStateToToolbar()
    }),
  )

  unlisteners.push(
    await listen<ToolbarAction>(TOOLBAR_ACTION_EVENT, (event) => {
      void handleToolbarAction(event.payload)
    }),
  )

  unlisteners.push(
    await listen<boolean>('clear-drawing', (event) => {
      // Finish in-progress stroke/drag so clearAll is not a no-op on an empty history
      // (first stroke still in currentAction) and pointer state is not left stuck.
      if (isDrawing.value || isDragging || capturedPointerId !== null) {
        finishActivePointerInteraction()
      }
      // Global shortcut emits `true` (undoable). Activation without preserve emits unit/`false`.
      if (event.payload === true) {
        clearAll()
        logActionEvent('canvas cleared', { reason: 'clear-drawing-event' })
      } else {
        hardReset()
        logActionEvent('canvas hard reset', { reason: 'clear-drawing-event' })
      }
      syncOverlayStateToToolbar()
    }),
  )

  unlisteners.push(
    await listen('toolbar-window-closed', () => {
      toolbarPanelHovered.value = false
      toolbarPanelDragging.value = false
      showToolbarPopup.value = false
    }),
  )

  unlisteners.push(
    await listen<boolean>(TOOLBAR_PANEL_HOVER_EVENT, (event) => {
      if (isMacOS()) return
      if (!event.payload && toolbarPanelDragging.value) return
      toolbarPanelHovered.value = event.payload
    }),
  )

  unlisteners.push(
    await listen<boolean>(TOOLBAR_DRAGGING_EVENT, (event) => {
      toolbarPanelDragging.value = event.payload
      if (event.payload) {
        toolbarPanelHovered.value = true
      }
    }),
  )

  unlisteners.push(
    await listen(TOOLBAR_POINTER_UP_EVENT, () => {
      if (isDrawing.value || isDragging || capturedPointerId !== null) {
        finishActivePointerInteraction()
      }
    }),
  )

  unlisteners.push(
    await listen<number>(TOOLBAR_PANEL_HEIGHT_EVENT, (event) => {
      rememberToolbarPanelHeight(event.payload)
    }),
  )
})

onUnmounted(() => {
  window.removeEventListener('pointermove', onGlobalPointerMove)
  window.removeEventListener('pointerup', onGlobalPointerUp)
  window.removeEventListener('pointercancel', onGlobalPointerUp)
  window.removeEventListener('resize', debouncedResize)
  stopThemeWatch?.()
  stopThemeWatch = null
  if (resizeTimer) {
    clearTimeout(resizeTimer)
    resizeTimer = null
  }
  flushPersistLineWidths()
  dprMediaQuery?.removeEventListener('change', onDprChange)
  dprMediaQuery = null
  window.removeEventListener('keydown', syncPointerModFromKey)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  if (hoverRafId !== null) {
    cancelAnimationFrame(hoverRafId)
    hoverRafId = null
  }
  if (pointerScreenRafId !== null) {
    cancelAnimationFrame(pointerScreenRafId)
    pointerScreenRafId = null
  }
  stopMacPointerPoll()
  setMacOverlaySystemCursorHidden(false)
  if (isMacOS()) {
    void invoke('set_overlay_ignore_cursor_events', { ignore: false }).catch(() => {})
  }
  unlisteners.forEach((fn) => fn())
  resetCopyModifierState()
  disposeTooltip()
  destroy()
})

let isCopying = false

async function toggleWhiteboardFromToolbar() {
  if (whiteboardMode.value) {
    exitWhiteboardMode()
  } else {
    await enterWhiteboardMode()
  }
}

function copyFromToolbar() {
  if (whiteboardMode.value) {
    void copyWhiteboard('toolbar')
  } else {
    void copyScreen('toolbar')
  }
}

function onPointerLeave(e: PointerEvent) {
  if (isDrawing.value || isDragging) return
  onPointerUp(e)
}

async function copyScreen(reason = 'unknown') {
  if (isCopying) {
    logDiagnostic('copy', 'copyScreen skipped', { reason, cause: 'already-copying' }, 'warn')
    return
  }
  logDiagnostic('copy', 'copyScreen invoked', { reason })
  isCopying = true
  try {
    // Hide overlay-local chrome (cursor tip, quick colors, text box). The independent
    // toolbar window is excluded inside Rust `copy_screen` (hide / display affinity).
    hideUiForCapture.value = true
    showQuickColors.value = false
    disposeTooltip()
    await nextTick()
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 32))),
    )
    await invoke('copy_screen')
    logDiagnostic('copy', 'clipboard tip shown', { type: 'screen', reason })
    showTip(t('overlay.copiedToClipboard'))
  } catch (err) {
    console.error('Copy screen failed:', err)
    logDiagnostic('copy', 'copyScreen failed', { reason, error: String(err) }, 'error')
    showTip(t('overlay.copyFailed'))
  } finally {
    hideUiForCapture.value = false
    isCopying = false
  }
}

async function copyWhiteboard(reason = 'unknown') {
  if (isCopying) {
    logDiagnostic('copy', 'copyWhiteboard skipped', { reason, cause: 'already-copying' }, 'warn')
    return
  }
  const dataUrl = exportAsDataURL('#FFFFFF')
  if (!dataUrl) {
    logDiagnostic('copy', 'copyWhiteboard skipped', { reason, cause: 'empty-canvas' }, 'warn')
    return
  }

  logDiagnostic('copy', 'copyWhiteboard invoked', { reason })
  isCopying = true
  try {
    await invoke('copy_whiteboard', { dataUrl })
    logDiagnostic('copy', 'clipboard tip shown', { type: 'whiteboard', reason })
    showTip(t('overlay.copiedToClipboard'))
  } catch (err) {
    console.error('Copy whiteboard failed:', err)
    logDiagnostic('copy', 'copyWhiteboard failed', { reason, error: String(err) }, 'error')
    showTip(t('overlay.copyFailed'))
  } finally {
    isCopying = false
  }
}

function exitDrawing(reason: 'keyboard' | 'toolbar' | 'unknown' = 'unknown') {
  logActionEvent('exit drawing', { reason })
  commitCurrentTextBox()
  showQuickColors.value = false
  textBoxPos.value = null
  invoke('exit_drawing')
}
</script>

<template>
  <div
    ref="containerRef"
    class="fixed top-0 left-0 w-screen h-screen z-99999"
    :class="[
      active && !penetrationMode ? 'pointer-events-auto' : 'pointer-events-none',
      whiteboardMode ? 'bg-white' : '',
    ]"
    :style="active && !penetrationMode ? { cursor: canvasCursor } : undefined"
  >
    <canvas
      ref="historyCanvasRef"
      class="absolute top-0 left-0 w-full h-full pointer-events-none"
      style="contain: strict"
      :style="whiteboardMode ? { backgroundColor: '#FFFFFF' } : undefined"
    />
    <canvas
      ref="previewCanvasRef"
      class="absolute top-0 left-0 w-full h-full touch-none"
      style="contain: strict"
      :style="{ cursor: canvasCursor }"
      @pointerdown="onPointerDown"
      @dblclick="onDoubleClick"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerLeave"
      @contextmenu.prevent="onContextMenu"
      @wheel="onWheel"
    />

    <!-- Custom cursor element: SVG rendered in DOM, positioned via transform -->
    <div
      v-show="showCustomCursor"
      ref="cursorEl"
      class="fixed top-0 left-0 pointer-events-none select-none drop-shadow-md"
      style="z-index: 100010; will-change: transform"
    >
      <!-- Pen: custom SVG icon -->
      <svg
        v-if="currentTool === 'pen'"
        width="32"
        height="32"
        viewBox="0 0 1024 1024"
        xmlns="http://www.w3.org/2000/svg"
        style="display: block; overflow: visible; filter: drop-shadow(2px 4px 6px rgba(0, 0, 0, 0.3))"
      >
        <g transform="rotate(15 388 846)">
          <path d="M482.9 279.5L357.6 694.1l45.3 152.5 121.9-102L650 330z" fill="#FFDCB3"></path>
          <path d="M490.435 254.311l167.144 50.477L532.37 719.395l-167.145-50.477z" fill="#FECD44"></path>
          <path d="M388.3 797.1l14.6 49.5 39.6-33.1z" fill="#AEABA8"></path>
          <path d="M402.9 846.6l66.2-118.8 23.9-37.4 31.8 54.2z" fill="#CC9D71"></path>
          <!-- Pen tip: bound to currentColor -->
          <path d="M424.4 808.1l-21.5 38.5 39.6-33.1z" :fill="currentColor"></path>
          <path d="M413.4 710.9l-10.5 135.7 66.2-118.8 0.6-53.3-38.6 5.2z" fill="#F0BF92"></path>
          <!-- Pen body stripe: dynamic color for better visibility -->
          <path
            d="M413.4 710.9s-9-15.2-24.4-19.9c-15.4-4.7-31.3 3.1-31.3 3.1l125.2-414.6 55.7 16.8-125.2 414.6z"
            :fill="currentColor"
            opacity="0.6"
          ></path>
          <path
            d="M469.1 727.8s-8.5-15.1-24.4-19.9c-15.9-4.8-31.3 3.1-31.3 3.1l125.2-414.6 55.7 16.8-125.2 414.6z"
            :fill="currentColor"
            opacity="0.8"
          ></path>
          <path
            d="M524.8 744.6s-9.9-15.5-24.4-19.9-31.3 3.1-31.3 3.1l125.2-414.6L650 330 524.8 744.6z"
            :fill="currentColor"
          ></path>
          <path d="M406.3 802.6l-3.4 44 21.5-38.5z" fill="#63585B"></path>
          <!-- Pen cap: follows currentColor -->
          <path
            d="M650 330l-167.1-50.5 12.1-40c13.9-46.2 62.7-72.3 108.8-58.3 46.2 13.9 72.3 62.6 58.3 108.8L650 330z"
            :fill="currentColor"
          ></path>
          <!-- Divider between cap and body: white by default, black when pen color is white -->
          <g
            :fill="currentColor.toUpperCase() === '#FFFFFF' ? '#333333' : '#FFFFFF'"
            :stroke="currentColor.toUpperCase() === '#FFFFFF' ? '#333333' : '#FFFFFF'"
            stroke-width="32"
            stroke-linejoin="round"
          >
            <path d="M481.713 251.694l184.663 55.767-7.603 25.177-184.663-55.767z"></path>
            <path d="M474.075 276.876l7.604-25.177 61.554 18.589-7.603 25.177z"></path>
            <path d="M535.656 295.425l7.603-25.177 61.554 18.59-7.603 25.176z"></path>
          </g>
          <path
            d="M637.3 227.1c7.8 11.9 10.2 24.1 12.2 22.8s2.9-15.7-5-27.6c-7.8-11.9-21.3-16.8-23.3-15.5-1.9 1.3 8.3 8.4 16.1 20.3z"
            fill="#FFFFFF"
          ></path>
          <path d="M533.7 312.5l4.9-16.2-55.7-16.8-7.4 24.2z" fill="#7898E3"></path>
          <path d="M591.8 321.2l2.5-8.1-55.7-16.8-4.9 16.2z" fill="#3463D9"></path>
          <path d="M650 330l-55.7-16.9-2.5 8.1z" fill="#1A46AB"></path>
        </g>
      </svg>

      <!-- Highlighter: custom SVG icon -->
      <svg
        v-else-if="currentTool === 'highlighter'"
        width="32"
        height="32"
        viewBox="0 0 1024 1024"
        xmlns="http://www.w3.org/2000/svg"
        style="display: block; overflow: visible; filter: drop-shadow(1px 2px 3px rgba(0, 0, 0, 0.3))"
      >
        <path
          d="M312.32 829.013333a4.266667 4.266667 0 0 0 4.778667-0.853333l40.106666-40.106667a4.266667 4.266667 0 0 0 0-6.016l-114.602666-114.645333a4.266667 4.266667 0 0 0-6.016 0l-83.2 83.114667a4.266667 4.266667 0 0 0 1.28 6.912l157.653333 71.68v-0.042667z m220.288-382.208a32 32 0 0 0 45.226667 45.226667l162.474666-162.432a32 32 0 0 0-45.226666-45.269333l-162.474667 162.474666z"
          :fill="currentColor"
        ></path>
        <path
          d="M384.426667 748.8a40.533333 40.533333 0 0 0 57.301333 0l77.312-77.269333a10.666667 10.666667 0 0 1 3.114667-2.133334l97.450666-44.714666c8.021333-3.712 15.36-8.789333 21.674667-15.061334l231.893333-231.893333a74.666667 74.666667 0 0 0 0-105.6L752.512 151.466667a74.666667 74.666667 0 0 0-105.6 0L415.018667 383.36a74.666667 74.666667 0 0 0-15.061334 21.674667l-44.672 97.450666a10.666667 10.666667 0 0 1-2.133333 3.114667l-77.354667 77.312a40.533333 40.533333 0 0 0 0 57.301333l108.629334 108.629334v-0.042667z m89.386666-122.538667L413.013333 686.976l-75.434666-75.434667 60.714666-60.714666a74.666667 74.666667 0 0 0 15.061334-21.674667l44.672-97.450667a10.666667 10.666667 0 0 1 2.133333-3.114666l231.893333-231.850667a10.666667 10.666667 0 0 1 15.104 0l120.661334 120.661333a10.666667 10.666667 0 0 1 0 15.104l-231.850667 231.850667a10.666667 10.666667 0 0 1-3.114667 2.133333l-97.450666 44.714667a74.794667 74.794667 0 0 0-21.674667 15.061333z"
          :fill="currentColor"
          opacity="0.8"
        ></path>
      </svg>
      <!-- Eraser: dashed circle + crosshair (dark halo under white for light/dark pages) -->
      <svg
        v-else-if="currentTool === 'eraser'"
        :width="eraserCursorDiameter"
        :height="eraserCursorDiameter"
        xmlns="http://www.w3.org/2000/svg"
        style="display: block; overflow: visible"
      >
        <circle
          :cx="eraserCursorRadius"
          :cy="eraserCursorRadius"
          :r="Math.max(2, eraserCursorRadius - 2)"
          fill="none"
          stroke="black"
          stroke-opacity="0.55"
          stroke-width="3"
          stroke-dasharray="3 2"
        />
        <circle
          :cx="eraserCursorRadius"
          :cy="eraserCursorRadius"
          :r="Math.max(2, eraserCursorRadius - 2)"
          fill="none"
          stroke="white"
          stroke-width="1.5"
          stroke-dasharray="3 2"
        />
        <line
          :x1="eraserCursorRadius"
          :y1="eraserCursorRadius - 4"
          :x2="eraserCursorRadius"
          :y2="eraserCursorRadius + 4"
          stroke="black"
          stroke-opacity="0.55"
          stroke-width="3"
          stroke-linecap="round"
        />
        <line
          :x1="eraserCursorRadius - 4"
          :y1="eraserCursorRadius"
          :x2="eraserCursorRadius + 4"
          :y2="eraserCursorRadius"
          stroke="black"
          stroke-opacity="0.55"
          stroke-width="3"
          stroke-linecap="round"
        />
        <line
          :x1="eraserCursorRadius"
          :y1="eraserCursorRadius - 4"
          :x2="eraserCursorRadius"
          :y2="eraserCursorRadius + 4"
          stroke="white"
          stroke-width="1"
          stroke-linecap="round"
        />
        <line
          :x1="eraserCursorRadius - 4"
          :y1="eraserCursorRadius"
          :x2="eraserCursorRadius + 4"
          :y2="eraserCursorRadius"
          stroke="white"
          stroke-width="1"
          stroke-linecap="round"
        />
      </svg>
      <!-- Arrow/Rectangle/Ellipse/Line: colored crosshair -->
      <svg v-else width="28" height="28" xmlns="http://www.w3.org/2000/svg" style="display: block">
        <line
          x1="14"
          y1="2"
          x2="14"
          y2="10"
          stroke="black"
          stroke-opacity="0.4"
          stroke-width="3"
          stroke-linecap="round"
        />
        <line
          x1="14"
          y1="18"
          x2="14"
          y2="26"
          stroke="black"
          stroke-opacity="0.4"
          stroke-width="3"
          stroke-linecap="round"
        />
        <line
          x1="2"
          y1="14"
          x2="10"
          y2="14"
          stroke="black"
          stroke-opacity="0.4"
          stroke-width="3"
          stroke-linecap="round"
        />
        <line
          x1="18"
          y1="14"
          x2="26"
          y2="14"
          stroke="black"
          stroke-opacity="0.4"
          stroke-width="3"
          stroke-linecap="round"
        />
        <line x1="14" y1="2" x2="14" y2="10" :stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        <line x1="14" y1="18" x2="14" y2="26" :stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        <line x1="2" y1="14" x2="10" y2="14" :stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        <line x1="18" y1="14" x2="26" y2="14" :stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        <circle cx="14" cy="14" r="2.5" fill="black" fill-opacity="0.3" />
        <circle cx="14" cy="14" r="2" :fill="currentColor" />
      </svg>
    </div>

    <TextBox
      v-if="active && textBoxPos && !hideUiForCapture"
      ref="textBoxRef"
      :x="textBoxPos.x"
      :y="textBoxPos.y"
      :color="activeTextBoxColor"
      :font-size="activeTextBoxFontSize"
      :initial-text="activeTextBoxInitialText"
      :text-outline="activeTextBoxOutline"
      @commit="onTextCommit"
      @cancel="onTextCancel"
      @context-menu="onContextMenu"
    />

    <Transition name="tooltip-fade">
      <div
        v-if="active && toolTip && !hideUiForCapture"
        class="fixed bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-2 py-2 px-5 bg-[rgba(28,28,30,0.94)] rounded-[10px] text-white text-[15px] font-sans tracking-[0.5px] pointer-events-none z-100003 whitespace-nowrap shadow-[0_2px_12px_rgba(0,0,0,0.3)]"
      >
        <span
          v-if="toolTipColor"
          class="w-4 h-4 rounded-full color-dot-ring shrink-0"
          :style="{ backgroundColor: toolTipColor }"
        />
        <span
          v-else-if="toolTipWidth"
          class="shrink-0 rounded-full bg-white"
          :style="{ width: '20px', height: Math.max(1.5, toolTipWidth * 1.2) + 'px' }"
        />
        <component v-else-if="toolTipTool" :is="toolIconMap[toolTipTool]" :size="18" color="#fff" />
        <span>{{ toolTip }}</span>
      </div>
    </Transition>

    <!-- Quick Color Palette (right-click) -->
    <Transition name="quick-colors">
      <div
        v-if="active && showQuickColors && !hideUiForCapture"
        class="fixed inset-0 z-100002"
        @mousedown.self="showQuickColors = false"
        @contextmenu.prevent
      >
        <div
          class="overlay-panel-surface overlay-panel overlay-panel--compact absolute p-2.5"
          :style="quickColorsPanelStyle"
          @mousedown.stop
        >
          <div class="grid grid-cols-8 gap-1.5">
            <button
              v-for="color in quickColorList"
              :key="color"
              class="w-7 h-7 p-0 border-none rounded-full cursor-pointer relative flex items-center justify-center transition-transform duration-100"
              :class="currentColor === color ? 'scale-[1.2]' : 'hover:scale-[1.15]'"
              @click="selectQuickColor(color)"
            >
              <span
                class="w-5.5 h-5.5 rounded-full color-swatch-ring color-swatch-ring--compact transition-[border-color] duration-100"
                :class="{ 'color-swatch-ring--active': currentColor === color }"
                :style="{ backgroundColor: color }"
              />
              <span
                v-if="currentColor === color"
                class="absolute text-[10px] font-bold pointer-events-none"
                :class="
                  ['#FFFFFF', '#FFCC02'].includes(color)
                    ? 'text-black/70'
                    : 'text-white [text-shadow:0_0_2px_rgba(0,0,0,0.5)]'
                "
                >✓</span
              >
            </button>
          </div>
          <div class="flex items-center justify-center gap-3 mt-1.5 pt-1.5 ui-divider-h">
            <span class="text-[10px] overlay-text-caption font-sans tracking-wider">{{ t('panel.colorSwitch') }}</span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.tooltip-fade-enter-active {
  transition: opacity 0.15s ease;
}
.tooltip-fade-leave-active {
  transition: opacity 0.4s ease;
}
.tooltip-fade-enter-from,
.tooltip-fade-leave-to {
  opacity: 0;
}

.quick-colors-enter-active {
  transition:
    opacity 0.12s ease,
    transform 0.12s cubic-bezier(0.2, 0, 0.13, 1.5);
}
.quick-colors-leave-active {
  transition:
    opacity 0.1s ease,
    transform 0.1s ease;
}
.quick-colors-enter-from {
  opacity: 0;
  transform: scale(0.9);
}
.quick-colors-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
