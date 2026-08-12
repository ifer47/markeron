import type { Tool } from '../composables/drawingTypes'
import { usesCrosshairCursor } from './crosshairCursor'

export type ToolbarSelectToolEffect =
  | { type: 'ignore' }
  | { type: 'cycleStampKind' }
  | { type: 'cyclePenCursor' }
  | { type: 'cycleEraserMode' }
  | { type: 'cycleCrosshairCursor' }
  | { type: 'select'; tool: Tool; tip: 'pen' | 'eraser' | 'crosshair' | 'stamp' | 'default' }

/**
 * Toolbar `selectTool` outcome: first click selects; re-click cycles mode/cursor
 * (pen cursor, eraser mode, crosshair cursor, stamp kind). Stroke locks tools.
 */
export function resolveToolbarSelectTool(opts: {
  isDrawing: boolean
  currentTool: Tool
  nextTool: Tool
}): ToolbarSelectToolEffect {
  if (opts.isDrawing) return { type: 'ignore' }

  const { currentTool, nextTool } = opts

  if (nextTool === 'stamp') {
    return currentTool === 'stamp' ? { type: 'cycleStampKind' } : { type: 'select', tool: 'stamp', tip: 'stamp' }
  }
  if (nextTool === 'pen') {
    return currentTool === 'pen' ? { type: 'cyclePenCursor' } : { type: 'select', tool: 'pen', tip: 'pen' }
  }
  if (nextTool === 'eraser') {
    return currentTool === 'eraser' ? { type: 'cycleEraserMode' } : { type: 'select', tool: 'eraser', tip: 'eraser' }
  }
  if (usesCrosshairCursor(nextTool)) {
    return currentTool === nextTool
      ? { type: 'cycleCrosshairCursor' }
      : { type: 'select', tool: nextTool, tip: 'crosshair' }
  }
  return { type: 'select', tool: nextTool, tip: 'default' }
}
