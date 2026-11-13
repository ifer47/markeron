import type { Tool } from '../composables/drawingTypes'

/** Default: off — keep sticky shape tools unless the user opts in. */
export const DEFAULT_AUTO_REVERT_TO_PEN = false

/** Tools that typically draw once then return to freehand. */
const ONE_SHOT_SHAPE_TOOLS = new Set<Tool>(['arrow', 'rect', 'ellipse', 'line'])

export function resolveAutoRevertToPen(general?: { autoRevertToPen?: boolean }): boolean {
  return general?.autoRevertToPen ?? DEFAULT_AUTO_REVERT_TO_PEN
}

export function isOneShotShapeTool(tool: Tool): boolean {
  return ONE_SHOT_SHAPE_TOOLS.has(tool)
}

/**
 * After a stroke ends: restore a *real* modifier-temp tool first; otherwise
 * optionally switch one-shot shape tools back to pen.
 *
 * Same-tool modifiers (e.g. already on ellipse + Shift for a perfect circle) do
 * not count as a temp switch — auto-revert may still apply.
 *
 * Pass `allowAutoRevert: false` on abort paths so sticky shape tools stay put.
 * Returns the tool to apply, or null when nothing should change.
 */
export function toolAfterShapeStroke(opts: {
  autoRevertToPen: boolean
  toolBeforeModifier: string | null
  currentTool: Tool
  allowAutoRevert?: boolean
}): Tool | null {
  const before = opts.toolBeforeModifier
  if (before !== null && before !== opts.currentTool) {
    return before as Tool
  }
  if (opts.allowAutoRevert !== false && opts.autoRevertToPen && isOneShotShapeTool(opts.currentTool)) {
    return 'pen'
  }
  return null
}
