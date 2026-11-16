import type { Tool } from '../composables/drawingTypes'

export type ModifierTempKeys = {
  mod: boolean
  shift: boolean
  alt: boolean
}

/**
 * Resolve the temporary tool for a modifier-held pointerdown, or `null`
 * when the current tool should stay.
 *
 * Priority matches DrawingOverlay: Mod+Shift → arrow, Mod → rect,
 * Shift → ellipse, Alt → line.
 *
 * Alt is only a constrain key while reshaping a *selected* action (corner
 * resize from center / rotate snap) — that path returns before this function
 * runs. So Alt still means "temporary straight line" for every drawing tool,
 * including line/arrow/rect/ellipse; combine with Mod/Shift for square/circle.
 */
export function resolveModifierTempTool(current: Tool, keys: ModifierTempKeys): Tool | null {
  if (keys.mod && keys.shift) return current === 'arrow' ? null : 'arrow'
  if (keys.mod) return current === 'rect' ? null : 'rect'
  if (keys.shift) return current === 'ellipse' ? null : 'ellipse'
  if (keys.alt) return current === 'line' ? null : 'line'
  return null
}
