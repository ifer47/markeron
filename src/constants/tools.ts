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

/**
 * Seven stroke-width presets in CSS pixels: geometric steps (×√2) between the same 1.15–9.2
 * bounds, so each step is a similar perceived change instead of a linear jump.
 */
export const WIDTH_PRESETS: number[] = [1.15, 1.63, 2.3, 3.25, 4.6, 6.5, 9.2]

/** Persisted line widths are hundredths of a CSS pixel (115 = 1.15px). */
export const WIDTH_PRESET_STORAGE: number[] = [115, 163, 230, 325, 460, 650, 920]
export const WIDTH_STORAGE_SCALE = 100

/** Stable i18n label keys for the seven width presets (no decimal path segments). */
export const WIDTH_LABEL_KEYS = ['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl'] as const

/** Index of the middle preset — the default line width for every width group. */
const MIDDLE_PRESET_INDEX = Math.floor(WIDTH_PRESETS.length / 2)

/** Default line width for every width group (middle preset). */
export const DEFAULT_LINE_WIDTH = WIDTH_PRESETS[MIDDLE_PRESET_INDEX]

/** i18n label key for a width preset index; out-of-range indexes read as the middle preset. */
export function widthPresetLabelKey(index: number): string {
  return WIDTH_LABEL_KEYS[index] ?? WIDTH_LABEL_KEYS[MIDDLE_PRESET_INDEX]
}

/**
 * Closest preset to a CSS-pixel width.
 *
 * Widths picked before the ladder changed (e.g. the old 3.45 / 5.75) are snapped instead of
 * being reset, so an upgrade never silently changes the user's stroke width.
 */
function nearestWidthPreset(pixels: number): number {
  let best = WIDTH_PRESETS[0]
  for (const preset of WIDTH_PRESETS) {
    if (Math.abs(preset - pixels) < Math.abs(best - pixels)) best = preset
  }
  return best
}

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
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return DEFAULT_LINE_WIDTH
  // Persisted values are hundredths of a pixel; older builds stored 1/2/3/5/8 px directly.
  const pixels = value < WIDTH_STORAGE_SCALE ? value : value / WIDTH_STORAGE_SCALE
  return nearestWidthPreset(pixels)
}

/** Convert in-memory CSS-pixel widths to the persisted hundredths-of-a-pixel form. */
export function toStoredLineWidths(widths: ToolLineWidths): ToolLineWidths {
  const store = (value: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return WIDTH_PRESET_STORAGE[MIDDLE_PRESET_INDEX]
    }
    return WIDTH_PRESET_STORAGE[WIDTH_PRESETS.indexOf(nearestWidthPreset(value))]
  }
  return {
    stroke: store(widths.stroke),
    highlighter: store(widths.highlighter),
    eraser: store(widths.eraser),
    text: store(widths.text),
  }
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
