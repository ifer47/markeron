import { invoke } from '@tauri-apps/api/core'
import type { AppConfig } from '../types/app'

const STORAGE_KEY = 'markeron-toolbar-position'
/** Legacy standalone window position (physical pixels). */
const WINDOW_STORAGE_KEY_V1 = 'markeron-toolbar-window-position'
/** Standalone window position (logical pixels). */
const WINDOW_STORAGE_KEY_V2 = 'markeron-toolbar-window-position-v2'

export type ToolbarCoordSpace = 'logical' | 'physical'

export interface ToolbarPosition {
  left: number
  top: number
  coordSpace?: ToolbarCoordSpace
}

export interface MonitorLogicalBounds {
  left: number
  top: number
  width: number
  height: number
}

/** Overlay client (CSS) coords → screen logical position for toolbar window placement. */
export function overlayClientToScreenLogical(
  clientX: number,
  clientY: number,
  monitor: MonitorLogicalBounds,
): { x: number; y: number } {
  return {
    x: monitor.left + clientX,
    y: monitor.top + clientY,
  }
}

/** Screen-logical top-left for a space-triggered toolbar popup centered on the pointer. */
export function toolbarPopupScreenPosition(
  clientX: number,
  clientY: number,
  panelWidth: number,
  panelHeight: number,
  monitor: MonitorLogicalBounds | null,
  fallbackViewport?: { width: number; height: number },
): { left: number; top: number } {
  if (monitor) {
    const anchor = overlayClientToScreenLogical(clientX, clientY, monitor)
    const left = anchor.x - panelWidth / 2
    const top = anchor.y - panelHeight / 2
    return clampToolbarWindowPosition(left, top, panelWidth, panelHeight, monitor, 12)
  }
  const vw = fallbackViewport?.width ?? 1920
  const vh = fallbackViewport?.height ?? 1080
  const margin = 12
  return {
    left: Math.max(margin, Math.min(clientX - panelWidth / 2, vw - panelWidth - margin)),
    top: Math.max(margin, Math.min(clientY - panelHeight / 2, vh - panelHeight - margin)),
  }
}

/** Keep a toolbar panel fully inside the overlay monitor (logical coordinates). */
export function clampToolbarWindowPosition(
  left: number,
  top: number,
  panelWidth: number,
  panelHeight: number,
  monitor: MonitorLogicalBounds,
  margin = 8,
): { left: number; top: number } {
  const minLeft = monitor.left + margin
  const minTop = monitor.top + margin
  const maxLeft = Math.max(minLeft, monitor.left + monitor.width - panelWidth - margin)
  const maxTop = Math.max(minTop, monitor.top + monitor.height - panelHeight - margin)
  return {
    left: Math.min(Math.max(left, minLeft), maxLeft),
    top: Math.min(Math.max(top, minTop), maxTop),
  }
}

/**
 * After compact↔expanded height change: grow/shrink upward when the panel sits on (or
 * would cross) the bottom edge; otherwise keep the top fixed so mid-screen panels expand down.
 *
 * `margin` should match the clamp used for placement (space popup uses 12; drag clamp uses 8).
 * Bottom-anchored detection allows a few px slack for float / margin mismatch.
 */
export function adjustToolbarTopForHeightChange(
  top: number,
  oldHeight: number,
  newHeight: number,
  monitor: MonitorLogicalBounds,
  margin = 8,
): number {
  if (oldHeight <= 0 || newHeight <= 0) return top
  const delta = newHeight - oldHeight
  // Ignore sub-pixel / outer-vs-content noise (esp. macOS WKWebView outerSize).
  if (Math.abs(delta) < 48) return top

  const minTop = monitor.top + margin
  const maxBottom = monitor.top + monitor.height - margin
  const oldBottom = top + oldHeight
  const wasBottomAnchored = oldBottom >= maxBottom - 16

  let nextTop = top
  if (delta > 0) {
    if (wasBottomAnchored || top + newHeight > maxBottom) {
      nextTop = oldBottom - newHeight
    }
  } else if (wasBottomAnchored) {
    nextTop = oldBottom - newHeight
  }

  const maxTop = Math.max(minTop, maxBottom - newHeight)
  return Math.min(Math.max(nextTop, minTop), maxTop)
}

function parseStoredPosition(raw: string): ToolbarPosition | null {
  try {
    const parsed = JSON.parse(raw) as ToolbarPosition
    if (typeof parsed.left !== 'number' || typeof parsed.top !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

/** Convert legacy physical screen coords to logical (WebView / Tauri LogicalPosition). */
export function migratePhysicalToLogical(position: ToolbarPosition, scaleFactor: number): ToolbarPosition {
  if (position.coordSpace === 'logical') return position
  const scale = scaleFactor > 0 ? scaleFactor : 1
  return {
    left: position.left / scale,
    top: position.top / scale,
    coordSpace: 'logical',
  }
}

export function loadToolbarPosition(forStandaloneWindow = false): ToolbarPosition | null {
  try {
    if (forStandaloneWindow) {
      const v2Raw = localStorage.getItem(WINDOW_STORAGE_KEY_V2)
      if (v2Raw) {
        const parsed = parseStoredPosition(v2Raw)
        if (parsed) return { ...parsed, coordSpace: parsed.coordSpace ?? 'logical' }
      }

      const v1Raw = localStorage.getItem(WINDOW_STORAGE_KEY_V1)
      if (!v1Raw) return null
      const legacy = parseStoredPosition(v1Raw)
      if (!legacy) return null
      return { ...legacy, coordSpace: legacy.coordSpace ?? 'physical' }
    }

    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return parseStoredPosition(raw)
  } catch {
    return null
  }
}

export function saveToolbarPosition(left: number, top: number, forStandaloneWindow = false): void {
  const payload: ToolbarPosition = forStandaloneWindow ? { left, top, coordSpace: 'logical' } : { left, top }
  try {
    if (forStandaloneWindow) {
      localStorage.setItem(WINDOW_STORAGE_KEY_V2, JSON.stringify(payload))
      localStorage.removeItem(WINDOW_STORAGE_KEY_V1)
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    }
  } catch {
    // ignore quota / private mode
  }
  persistToolbarPosition(payload, forStandaloneWindow)
}

let lastPersistedPopup: string | null = null
let lastPersistedWindow: string | null = null

/** @internal Test-only reset for the persistence dedupe cache. */
export function __resetToolbarPositionPersistCache(): void {
  lastPersistedPopup = null
  lastPersistedWindow = null
}

/**
 * Mirror the position into `config.json`.
 *
 * WebView2's localStorage lives inside the install flavour's data directory, so
 * switching between NSIS / MSIX / portable would lose the toolbar position even
 * when `config.json` survives. Persisting the same value in the config lets the
 * startup migration restore it. Deduplicated to avoid a disk write per pointer move.
 */
function persistToolbarPosition(position: ToolbarPosition, forStandaloneWindow: boolean): void {
  const serialized = JSON.stringify(position)
  const previous = forStandaloneWindow ? lastPersistedWindow : lastPersistedPopup
  if (serialized === previous) return
  if (forStandaloneWindow) {
    lastPersistedWindow = serialized
  } else {
    lastPersistedPopup = serialized
  }
  void invoke('save_toolbar_position', {
    position,
    standalone: forStandaloneWindow,
  }).catch(() => {
    // Retry on the next save if the backend is temporarily unavailable.
    if (forStandaloneWindow) {
      lastPersistedWindow = null
    } else {
      lastPersistedPopup = null
    }
  })
}

function isValidPosition(value: ToolbarPosition | undefined): value is ToolbarPosition {
  return (
    !!value &&
    typeof value.left === 'number' &&
    typeof value.top === 'number' &&
    Number.isFinite(value.left) &&
    Number.isFinite(value.top)
  )
}

/**
 * Seed localStorage from `config.json` before the toolbar mounts.
 *
 * Covers users updating between install flavours (or a fresh WebView data dir):
 * the Rust-side config migration kept their settings, and this keeps the panel
 * exactly where they left it instead of snapping back to the default corner.
 */
export async function migrateToolbarPositionsToLocalStorage(): Promise<void> {
  try {
    const cfg = await invoke<AppConfig>('get_config')
    const ui = cfg.ui
    if (!ui) return

    if (!localStorage.getItem(STORAGE_KEY) && isValidPosition(ui.toolbarPosition)) {
      const pos = ui.toolbarPosition
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ left: pos.left, top: pos.top }))
    }

    if (
      !localStorage.getItem(WINDOW_STORAGE_KEY_V2) &&
      !localStorage.getItem(WINDOW_STORAGE_KEY_V1) &&
      isValidPosition(ui.toolbarWindowPosition)
    ) {
      const pos = ui.toolbarWindowPosition
      localStorage.setItem(
        WINDOW_STORAGE_KEY_V2,
        JSON.stringify({ left: pos.left, top: pos.top, coordSpace: pos.coordSpace ?? 'logical' }),
      )
    }
  } catch {
    // Config unavailable (browser dev / tests) — localStorage remains the source.
  }
}
