import type { Component } from 'vue'
import { Pen, Highlighter, ArrowUpRight, Square, Circle, Minus, Eraser, Type } from '@lucide/vue'
import type { Tool } from '../composables/useDrawing'

export interface ToolDef {
  id: Tool
  icon: Component
  key: string
}

export const TOOL_DEFS: ToolDef[] = [
  { id: 'pen', icon: Pen, key: '1' },
  { id: 'highlighter', icon: Highlighter, key: '2' },
  { id: 'arrow', icon: ArrowUpRight, key: '3' },
  { id: 'rect', icon: Square, key: '4' },
  { id: 'ellipse', icon: Circle, key: '5' },
  { id: 'line', icon: Minus, key: '6' },
  { id: 'eraser', icon: Eraser, key: '7' },
  { id: 'text', icon: Type, key: 'T' },
]

export const TOOL_ICON_MAP: Record<Tool, Component> = Object.fromEntries(
  TOOL_DEFS.map((d) => [d.id, d.icon]),
) as Record<Tool, Component>

export const WIDTH_PRESETS: number[] = [1, 2, 3, 5, 8]
