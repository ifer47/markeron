import type { Tool } from '../composables/drawingTypes'

export type CrosshairCursorStyle = 'crosshair' | 'dot'

export const CROSSHAIR_CURSOR_STYLE_OPTIONS: CrosshairCursorStyle[] = ['crosshair', 'dot']

/** Tools that use the crosshair (or compact dot) custom cursor. */
export const CROSSHAIR_CURSOR_TOOLS: readonly Tool[] = ['arrow', 'rect', 'ellipse', 'line', 'laser']

export function usesCrosshairCursor(tool: Tool): boolean {
  return (CROSSHAIR_CURSOR_TOOLS as readonly string[]).includes(tool)
}

export function resolveCrosshairCursorStyle(general?: {
  crosshairCursorStyle?: CrosshairCursorStyle
}): CrosshairCursorStyle {
  return general?.crosshairCursorStyle === 'dot' ? 'dot' : 'crosshair'
}

/** Toggle crosshair ↔ dot (re-press shape/laser key or re-click toolbar). */
export function nextCrosshairCursorStyle(style: CrosshairCursorStyle): CrosshairCursorStyle {
  return style === 'crosshair' ? 'dot' : 'crosshair'
}
