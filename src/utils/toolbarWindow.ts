import { LogicalSize, LogicalPosition } from '@tauri-apps/api/dpi'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import {
  clampToolbarWindowPosition,
  adjustToolbarTopForHeightChange,
  loadToolbarPosition,
  migratePhysicalToLogical,
  saveToolbarPosition,
  type MonitorLogicalBounds,
} from './toolbarPosition'
import { isMacOS } from './platform'
import { emitToolbarPanelHeight } from '../composables/overlayBridge'

/** Cached toolbar window origin for screen-space hit tests (WKWebView `window.screenX` is unreliable on macOS). */
let cachedToolbarScreenOrigin: { x: number; y: number } | null = null

export function getToolbarWindowScreenOrigin(): { x: number; y: number } {
  if (isMacOS() && cachedToolbarScreenOrigin) {
    return cachedToolbarScreenOrigin
  }
  return { x: window.screenX, y: window.screenY }
}

export async function refreshToolbarWindowScreenOrigin(): Promise<{ x: number; y: number }> {
  if (!isMacOS()) {
    cachedToolbarScreenOrigin = { x: window.screenX, y: window.screenY }
    return cachedToolbarScreenOrigin
  }
  const win = getCurrentWindow()
  const [pos, scale] = await Promise.all([win.outerPosition(), win.scaleFactor()])
  const logical = pos.toLogical(scale)
  cachedToolbarScreenOrigin = { x: logical.x, y: logical.y }
  return cachedToolbarScreenOrigin
}

/** Logical width of the toolbar panel (must match ToolToolbar / Rust overlay). */
export const TOOLBAR_PANEL_WIDTH = 320

/**
 * Compact (default) standalone panel height, measured from live DOM (`.overlay-panel-surface`).
 * Expanded ≈452. Do not use a larger guess for clamp — it lifts the panel away from a
 * bottom-edge pointer (see openToolbarPopupAtPointer).
 */
export const TOOLBAR_PANEL_HEIGHT_COMPACT = 234

let cachedToolbarPanelHeight = TOOLBAR_PANEL_HEIGHT_COMPACT
let cachedCssToLogicalRatio = 1

/** Last measured panel height (CSS px) for clamp / space-popup placement. */
export function getToolbarPanelHeight(): number {
  return cachedToolbarPanelHeight
}

export function rememberToolbarPanelHeight(height: number): void {
  if (height > 0) {
    cachedToolbarPanelHeight = Math.ceil(height)
  }
}

/** @internal test helper */
export function resetToolbarPanelHeightCache(): void {
  cachedToolbarPanelHeight = TOOLBAR_PANEL_HEIGHT_COMPACT
  cachedCssToLogicalRatio = 1
}

/**
 * CSS px → Tauri logical px for this webview.
 *
 * WebView2 folds the Windows "Text size" accessibility factor into `devicePixelRatio`,
 * while Tauri's `scaleFactor` is monitor DPI only. Panel sizes / pointer coords measured
 * in CSS px must be multiplied by this before being used as window size or screen position.
 * Values below 1 only occur transiently while WebView2 catches up after a monitor DPI
 * change, so they are treated as 1.
 */
export function cssToLogicalRatio(devicePixelRatio: number, scaleFactor: number): number {
  if (!(devicePixelRatio > 0) || !(scaleFactor > 0)) return 1
  const ratio = devicePixelRatio / scaleFactor
  if (ratio < 1.01) return 1
  return Math.min(ratio, 4)
}

/** Last ratio resolved via {@link resolveCssToLogicalRatio}; for sync hot paths (drag). */
export function getCachedCssToLogicalRatio(): number {
  return cachedCssToLogicalRatio
}

export async function resolveCssToLogicalRatio(): Promise<number> {
  try {
    const scale = await getCurrentWindow().scaleFactor()
    cachedCssToLogicalRatio = cssToLogicalRatio(window.devicePixelRatio || 1, scale)
  } catch {
    // keep last known ratio
  }
  return cachedCssToLogicalRatio
}

export async function fetchOverlayMonitorBounds(): Promise<MonitorLogicalBounds | null> {
  try {
    return await invoke<MonitorLogicalBounds | null>('get_overlay_monitor_logical_bounds')
  } catch {
    return null
  }
}

export async function restoreToolbarWindowPosition(): Promise<void> {
  const saved = loadToolbarPosition(true)
  if (!saved) return
  const win = getCurrentWindow()
  const [scale, ratio] = await Promise.all([win.scaleFactor(), resolveCssToLogicalRatio()])
  const logical = migratePhysicalToLogical(saved, scale)
  const bounds = await fetchOverlayMonitorBounds()
  const panelH = getToolbarPanelHeight() * ratio
  const position = bounds
    ? clampToolbarWindowPosition(logical.left, logical.top, TOOLBAR_PANEL_WIDTH * ratio, panelH, bounds)
    : logical
  await win.setPosition(new LogicalPosition(position.left, position.top))
  if (saved.coordSpace !== 'logical' || position.left !== logical.left || position.top !== logical.top) {
    saveToolbarPosition(position.left, position.top, true)
  }
}

/** Clamp the current always-on toolbar window into the overlay monitor and persist. */
export async function clampToolbarWindowToOverlay(): Promise<void> {
  const win = getCurrentWindow()
  const [pos, scale, ratio] = await Promise.all([win.outerPosition(), win.scaleFactor(), resolveCssToLogicalRatio()])
  const logical = pos.toLogical(scale)
  const bounds = await fetchOverlayMonitorBounds()
  if (!bounds) return
  const panelH = getToolbarPanelHeight() * ratio
  const position = clampToolbarWindowPosition(logical.x, logical.y, TOOLBAR_PANEL_WIDTH * ratio, panelH, bounds)
  if (position.left === logical.x && position.top === logical.y) {
    return
  }
  await win.setPosition(new LogicalPosition(position.left, position.top))
  saveToolbarPosition(position.left, position.top, true)
  if (isMacOS()) {
    await refreshToolbarWindowScreenOrigin()
  }
}

/** Resize the standalone toolbar window to fit a panel measured in CSS px. */
export async function fitToolbarWindow(width: number, height: number): Promise<void> {
  if (width <= 0 || height <= 0) return
  rememberToolbarPanelHeight(height)
  emitToolbarPanelHeight(height)
  const ratio = await resolveCssToLogicalRatio()
  const win = getCurrentWindow()
  await win.setSize(new LogicalSize(Math.ceil(width * ratio), Math.ceil(height * ratio)))
}

/**
 * After a standalone toolbar height change (更多/收起), shift Y so bottom-edge panels
 * grow upward instead of expanding off-screen. Heights are Tauri logical px.
 */
export async function repositionToolbarAfterHeightChange(
  oldHeight: number,
  newHeight: number,
  options?: { persist?: boolean },
): Promise<void> {
  if (oldHeight <= 0 || newHeight <= 0 || Math.abs(newHeight - oldHeight) < 48) return
  const win = getCurrentWindow()
  const [pos, scale] = await Promise.all([win.outerPosition(), win.scaleFactor()])
  const logical = pos.toLogical(scale)
  const bounds = await fetchOverlayMonitorBounds()
  if (!bounds) return
  // Match space-popup edge margin (12) so bottom-anchored detection agrees with placement.
  const nextTop = adjustToolbarTopForHeightChange(logical.y, oldHeight, newHeight, bounds, 12)
  if (Math.abs(nextTop - logical.y) < 0.5) return
  const panelW = TOOLBAR_PANEL_WIDTH * getCachedCssToLogicalRatio()
  const position = clampToolbarWindowPosition(logical.x, nextTop, panelW, newHeight, bounds, 12)
  await win.setPosition(new LogicalPosition(position.left, position.top))
  if (options?.persist) {
    saveToolbarPosition(position.left, position.top, true)
  }
  if (isMacOS()) {
    await refreshToolbarWindowScreenOrigin()
  }
}

/** Measure visible panel height for standalone toolbar window sizing. */
export function measureToolbarPanelHeight(panelEl: HTMLElement): number {
  const surface = panelEl.querySelector('.overlay-panel-surface')
  if (surface instanceof HTMLElement) {
    return Math.ceil(surface.getBoundingClientRect().height)
  }
  return Math.ceil(panelEl.getBoundingClientRect().height)
}
