/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { emit, listen } from '@tauri-apps/api/event'
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import DrawingOverlay from './DrawingOverlay.vue'
import type { AppConfig } from '../types/app'
import type { Tool } from '../composables/drawingTypes'
import {
  OVERLAY_STATE_EVENT,
  OVERLAY_STATE_REQUEST_EVENT,
  TOOLBAR_ACTION_EVENT,
  type OverlayStateSync,
} from '../composables/overlayBridge'

const native = {
  state: null as OverlayStateSync | null,
  config: {
    shortcuts: {
      toggleDrawing: 'Control+Shift+D',
      clearDrawing: 'Control+Shift+C',
      togglePenetration: 'Control+Shift+P',
    },
    general: {
      preserveDrawings: false,
      whiteboardPreserveDrawings: true,
      defaultEntryMode: 'screen',
    },
  } as AppConfig,
}

let app: App | null = null
let host: HTMLDivElement

async function settle() {
  await vi.advanceTimersByTimeAsync(150)
  await nextTick()
}

async function sendEvent(name: string, payload?: unknown) {
  await emit(name, payload)
  await settle()
}

async function mountOverlay() {
  app = createApp(DrawingOverlay)
  app.mount(host)
  await settle()
  for (const canvas of host.querySelectorAll('canvas')) {
    Object.assign(canvas, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })
  }
  await sendEvent(OVERLAY_STATE_REQUEST_EVENT)
}

async function pointerDown(options: MouseEventInit) {
  const event = new MouseEvent('pointerdown', {
    bubbles: true,
    button: 0,
    buttons: 1,
    clientX: 50,
    clientY: 50,
    ...options,
  })
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: 'mouse' },
    pressure: { value: 0.5 },
  })
  host.querySelectorAll('canvas')[1].dispatchEvent(event)
  await settle()
}

async function pointerUp(options: MouseEventInit) {
  const event = new MouseEvent('pointerup', {
    bubbles: true,
    button: 0,
    buttons: 0,
    clientX: 50,
    clientY: 50,
    ...options,
  })
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: 'mouse' },
    pressure: { value: 0 },
  })
  host.querySelectorAll('canvas')[1].dispatchEvent(event)
  await settle()
}

/** Draw one pen stroke so the canvas reports `canClear`. */
async function drawStroke() {
  await pointerDown({})
  await pointerUp({ clientX: 80, clientY: 80 })
}

beforeEach(async () => {
  vi.useFakeTimers()
  native.state = null
  native.config.general.defaultEntryMode = 'screen'
  native.config.general.preserveDrawings = false
  native.config.general.autoRevertToPen = false
  // Keep the overlay, drawing composable and event bridge real; replace only
  // native IPC and browser APIs unavailable in jsdom.
  mockWindows('overlay')
  mockIPC(
    (command) => {
      if (command === 'get_config') return native.config
      return null
    },
    { shouldMockEvents: true },
  )
  await listen<OverlayStateSync>(OVERLAY_STATE_EVENT, (event) => {
    native.state = event.payload
  })
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return {
      canvas: this,
      save: vi.fn(),
      restore: vi.fn(),
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      rect: vi.fn(),
      arc: vi.fn(),
      quadraticCurveTo: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      setTransform: vi.fn(),
      setLineDash: vi.fn(),
      getLineDash: vi.fn(() => []),
      strokeRect: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      strokeText: vi.fn(),
      measureText: vi.fn(() => ({ width: 50 })),
    } as unknown as CanvasRenderingContext2D
  })
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(async () => {
  app?.unmount()
  app = null
  await settle()
  host.remove()
  clearMocks()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('overlay tool selection across sessions', () => {
  it('starts with the pen on first activation', async () => {
    await mountOverlay()
    await sendEvent('overlay-mode-changed', 'drawing')
    expect(native.state?.currentTool).toBe('pen')
  })

  it.each<Tool>(['highlighter', 'laser', 'arrow', 'rect', 'ellipse', 'line', 'eraser', 'text', 'stamp', 'select'])(
    'keeps %s selected after hiding and reactivating',
    async (tool) => {
      await mountOverlay()
      await sendEvent('overlay-mode-changed', 'drawing')
      await sendEvent(TOOLBAR_ACTION_EVENT, { type: 'selectTool', tool })
      expect(native.state?.currentTool).toBe(tool)

      for (let cycle = 0; cycle < 2; cycle++) {
        await sendEvent('overlay-mode-changed', 'hidden')
        await sendEvent('overlay-mode-changed', 'drawing')
        expect(native.state?.currentTool).toBe(tool)
      }
    },
  )

  it('keeps the selected tool with drawing preservation enabled', async () => {
    native.config.general.preserveDrawings = true
    await mountOverlay()
    await sendEvent('overlay-mode-changed', 'drawing')
    await sendEvent(TOOLBAR_ACTION_EVENT, { type: 'selectTool', tool: 'rect' })
    await sendEvent('overlay-mode-changed', 'hidden')
    await sendEvent('overlay-mode-changed', 'drawing')
    expect(native.state?.currentTool).toBe('rect')
  })

  it('keeps the selected tool when whiteboard is the default entry mode', async () => {
    native.config.general.defaultEntryMode = 'whiteboard'
    await mountOverlay()
    await sendEvent('overlay-mode-changed', 'drawing')
    await sendEvent(TOOLBAR_ACTION_EVENT, { type: 'selectTool', tool: 'rect' })
    await sendEvent('overlay-mode-changed', 'hidden')
    await sendEvent('overlay-mode-changed', 'drawing')
    expect(native.state?.whiteboardMode).toBe(true)
    expect(native.state?.currentTool).toBe('rect')
  })

  it('starts from the pen on each activation when auto-revert to pen is enabled', async () => {
    native.config.general.autoRevertToPen = true
    await mountOverlay()
    await sendEvent('overlay-mode-changed', 'drawing')
    await sendEvent(TOOLBAR_ACTION_EVENT, { type: 'selectTool', tool: 'rect' })
    expect(native.state?.currentTool).toBe('rect')

    for (let cycle = 0; cycle < 2; cycle++) {
      await sendEvent('overlay-mode-changed', 'hidden')
      await sendEvent('overlay-mode-changed', 'drawing')
      expect(native.state?.currentTool).toBe('pen')
    }
  })

  it('starts from the pen on whiteboard entry when auto-revert to pen is enabled', async () => {
    native.config.general.autoRevertToPen = true
    native.config.general.defaultEntryMode = 'whiteboard'
    await mountOverlay()
    await sendEvent('overlay-mode-changed', 'drawing')
    await sendEvent(TOOLBAR_ACTION_EVENT, { type: 'selectTool', tool: 'ellipse' })

    await sendEvent('overlay-mode-changed', 'hidden')
    await sendEvent('overlay-mode-changed', 'drawing')
    expect(native.state?.whiteboardMode).toBe(true)
    expect(native.state?.currentTool).toBe('pen')
  })

  it('keeps the ink on the canvas when ending in preserved mode', async () => {
    native.config.general.preserveDrawings = true
    await mountOverlay()
    await sendEvent('overlay-mode-changed', 'drawing')
    await drawStroke()
    expect(native.state?.canClear).toBe(true)

    await sendEvent('overlay-mode-changed', 'preserved')
    // Preserved mode stops syncing state (click-through, no toolbar); resume to read it back
    // and prove the stroke survived the exit.
    await sendEvent('overlay-mode-changed', 'drawing')
    expect(native.state?.canClear).toBe(true)
  })

  it('clears the canvas on exit when drawings are not preserved', async () => {
    native.config.general.preserveDrawings = false
    await mountOverlay()
    await sendEvent('overlay-mode-changed', 'drawing')
    await drawStroke()
    expect(native.state?.canClear).toBe(true)

    await sendEvent('overlay-mode-changed', 'hidden')
    await sendEvent('overlay-mode-changed', 'drawing')
    expect(native.state?.canClear).toBe(false)
  })

  it('drops the whiteboard background when ending in preserved mode', async () => {
    native.config.general.preserveDrawings = true
    await mountOverlay()
    await sendEvent('overlay-mode-changed', 'drawing')
    await sendEvent(TOOLBAR_ACTION_EVENT, { type: 'toggleWhiteboard' })
    expect(native.state?.whiteboardMode).toBe(true)
    // Opaque board fill would hide the desktop the preserved ink is meant to sit on.
    const container = host.firstElementChild as HTMLElement
    expect(container.style.backgroundColor).not.toBe('')

    await sendEvent('overlay-mode-changed', 'preserved')
    expect(container.style.backgroundColor).toBe('')
  })

  it('starts from the pen when resuming from preserved mode with auto-revert enabled', async () => {
    native.config.general.preserveDrawings = true
    native.config.general.autoRevertToPen = true
    await mountOverlay()
    await sendEvent('overlay-mode-changed', 'drawing')
    await sendEvent(TOOLBAR_ACTION_EVENT, { type: 'selectTool', tool: 'rect' })

    await sendEvent('overlay-mode-changed', 'preserved')
    await sendEvent('overlay-mode-changed', 'drawing')
    expect(native.state?.currentTool).toBe('pen')
  })

  it('keeps the selected tool when returning from penetration mode', async () => {
    native.config.general.autoRevertToPen = true
    await mountOverlay()
    await sendEvent('overlay-mode-changed', 'drawing')
    await sendEvent(TOOLBAR_ACTION_EVENT, { type: 'selectTool', tool: 'highlighter' })

    await sendEvent('overlay-mode-changed', 'penetration')
    await sendEvent('overlay-mode-changed', 'drawing')
    expect(native.state?.currentTool).toBe('highlighter')
  })

  it('still selects the pen when explicitly entering whiteboard mode', async () => {
    await mountOverlay()
    await sendEvent('overlay-mode-changed', 'drawing')
    await sendEvent(TOOLBAR_ACTION_EVENT, { type: 'selectTool', tool: 'rect' })
    await sendEvent(TOOLBAR_ACTION_EVENT, { type: 'toggleWhiteboard' })
    expect(native.state?.whiteboardMode).toBe(true)
    expect(native.state?.currentTool).toBe('pen')
  })

  it('restores the selected tool when hidden during a modifier drawing gesture', async () => {
    await mountOverlay()
    await sendEvent('overlay-mode-changed', 'drawing')
    await sendEvent(TOOLBAR_ACTION_EVENT, { type: 'selectTool', tool: 'highlighter' })
    await pointerDown({ ctrlKey: true })
    expect(native.state?.currentTool).toBe('rect')
    await sendEvent('overlay-mode-changed', 'hidden')
    await sendEvent('overlay-mode-changed', 'drawing')
    expect(native.state?.currentTool).toBe('highlighter')
  })

  it('restores the selected tool when hidden during right-button erasing', async () => {
    await mountOverlay()
    await sendEvent('overlay-mode-changed', 'drawing')
    await sendEvent(TOOLBAR_ACTION_EVENT, { type: 'selectTool', tool: 'highlighter' })
    await pointerDown({ button: 2, buttons: 2 })
    expect(native.state?.currentTool).toBe('eraser')
    await sendEvent('overlay-mode-changed', 'hidden')
    await sendEvent('overlay-mode-changed', 'drawing')
    expect(native.state?.currentTool).toBe('highlighter')
  })
})
