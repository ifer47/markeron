import type { Component } from 'vue'
import {
  SquareDashedMousePointer,
  Pen,
  Highlighter,
  Crosshair,
  ArrowUpRight,
  Square,
  Circle,
  Minus,
  Eraser,
  Type,
  ListOrdered,
} from '@lucide/vue'
import type { StrokeDashStyle, Tool } from '../composables/drawingTypes'

export type { StrokeDashStyle }

export interface ToolDef {
  id: Tool
  icon: Component
  key: string
}

/** Select lives in the top action row; drawing tools use the grid below. */
export const SELECT_TOOL_DEF: ToolDef = { id: 'select', icon: SquareDashedMousePointer, key: 'V' }

export const TOOL_DEFS: ToolDef[] = [
  SELECT_TOOL_DEF,
  { id: 'pen', icon: Pen, key: '1' },
  { id: 'highlighter', icon: Highlighter, key: '2' },
  { id: 'arrow', icon: ArrowUpRight, key: '3' },
  { id: 'rect', icon: Square, key: '4' },
  { id: 'ellipse', icon: Circle, key: '5' },
  { id: 'line', icon: Minus, key: '6' },
  { id: 'eraser', icon: Eraser, key: '7' },
  { id: 'laser', icon: Crosshair, key: '8' },
  { id: 'text', icon: Type, key: 'T' },
  { id: 'stamp', icon: ListOrdered, key: 'N' },
]

/** Tools shown in the toolbar grid (excludes select). */
export const DRAWING_TOOL_DEFS: ToolDef[] = TOOL_DEFS.filter((d) => d.id !== 'select')

export const TOOL_ICON_MAP: Record<Tool, Component> = Object.fromEntries(
  TOOL_DEFS.map((d) => [d.id, d.icon]),
) as Record<Tool, Component>

export const WIDTH_PRESETS: number[] = [1, 2, 3, 5, 8]

/** Middle preset — default line width for every width group. */
export const DEFAULT_LINE_WIDTH = WIDTH_PRESETS[2]

/** Pen + shapes share one preset; highlighter / eraser / text are separate. */
export type LineWidthGroup = 'stroke' | 'highlighter' | 'eraser' | 'text'

export interface ToolLineWidths {
  stroke: number
  highlighter: number
  eraser: number
  text: number
}

const STROKE_TOOLS = new Set<Tool>(['pen', 'laser', 'arrow', 'rect', 'ellipse', 'line'])

/** Tools that honor the session stroke dash style (D / Shift+D). */
const DASHABLE_TOOLS = new Set<Tool>(['pen', 'line', 'arrow', 'rect', 'ellipse'])

/** Solid → dashed → dotted → solid (D); Shift+D reverses. */
export const STROKE_DASH_STYLES: readonly StrokeDashStyle[] = ['solid', 'dashed', 'dotted']

export function toolLineWidthGroup(tool: Tool): LineWidthGroup {
  if (tool === 'highlighter') return 'highlighter'
  if (tool === 'eraser') return 'eraser'
  if (tool === 'text' || tool === 'stamp') return 'text'
  // select shares stroke group (width UI unused while select is active)
  return 'stroke'
}

export function isStrokeTool(tool: Tool): boolean {
  return STROKE_TOOLS.has(tool)
}

export function isDashableTool(tool: Tool): boolean {
  return DASHABLE_TOOLS.has(tool)
}

export function normalizeStrokeDashStyle(value: unknown): StrokeDashStyle {
  return value === 'dashed' || value === 'dotted' ? value : 'solid'
}

export function isNonSolidDashStyle(style: StrokeDashStyle | undefined | null): style is 'dashed' | 'dotted' {
  return style === 'dashed' || style === 'dotted'
}

/** `direction` +1 = D, -1 = Shift+D. */
export function nextStrokeDashStyle(current: StrokeDashStyle, direction: 1 | -1 = 1): StrokeDashStyle {
  const i = STROKE_DASH_STYLES.indexOf(normalizeStrokeDashStyle(current))
  const len = STROKE_DASH_STYLES.length
  return STROKE_DASH_STYLES[(i + direction + len) % len]
}

/** Canvas `setLineDash` pattern scaled to stroke width. */
export function shapeDashPattern(lineWidth: number, style: 'dashed' | 'dotted' = 'dashed'): number[] {
  const w = Math.max(1, lineWidth)
  if (style === 'dotted') {
    // Near-zero dash + gap with round lineCap ≈ dots.
    return [0.01, Math.max(2, w * 2.2)]
  }
  return [w * 4, w * 3]
}

export function createDefaultLineWidths(): ToolLineWidths {
  const w = DEFAULT_LINE_WIDTH
  return {
    stroke: w,
    highlighter: w,
    eraser: w,
    text: w,
  }
}

export function normalizeLineWidth(value: unknown): number {
  return typeof value === 'number' && WIDTH_PRESETS.includes(value) ? value : DEFAULT_LINE_WIDTH
}

/** Resolve persisted line widths; missing/invalid values fall back to defaults. */
export function resolveLineWidths(partial?: Partial<ToolLineWidths> | null): ToolLineWidths {
  const defaults = createDefaultLineWidths()
  if (!partial) return defaults
  return {
    stroke: normalizeLineWidth(partial.stroke ?? defaults.stroke),
    highlighter: normalizeLineWidth(partial.highlighter ?? defaults.highlighter),
    eraser: normalizeLineWidth(partial.eraser ?? defaults.eraser),
    text: normalizeLineWidth(partial.text ?? defaults.text),
  }
}

/** Highlighter stroke width = lineWidth × scale (default 3 → 21px). */
export const HIGHLIGHTER_WIDTH_SCALE = 7

export function highlighterLineWidth(lineWidth: number): number {
  return lineWidth * HIGHLIGHTER_WIDTH_SCALE
}

/** Eraser stroke width = lineWidth × scale (default 3 → 24px, close to legacy 25px). */
export const ERASER_WIDTH_SCALE = 8

export function eraserLineWidth(lineWidth: number): number {
  return lineWidth * ERASER_WIDTH_SCALE
}
