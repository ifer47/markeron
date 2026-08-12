import { describe, expect, it } from 'vitest'
import { resolveToolbarSelectTool } from './toolbarSelectTool'
import type { Tool } from '../composables/drawingTypes'

describe('resolveToolbarSelectTool', () => {
  it('ignores tool changes while a stroke is active', () => {
    expect(resolveToolbarSelectTool({ isDrawing: true, currentTool: 'pen', nextTool: 'rect' })).toEqual({
      type: 'ignore',
    })
    expect(resolveToolbarSelectTool({ isDrawing: true, currentTool: 'pen', nextTool: 'pen' })).toEqual({
      type: 'ignore',
    })
  })

  describe('pen cursor cycle (toolbar re-click)', () => {
    it('selects pen with pen tip when switching from another tool', () => {
      expect(resolveToolbarSelectTool({ isDrawing: false, currentTool: 'highlighter', nextTool: 'pen' })).toEqual({
        type: 'select',
        tool: 'pen',
        tip: 'pen',
      })
    })

    it('cycles pen cursor when pen is already selected', () => {
      expect(resolveToolbarSelectTool({ isDrawing: false, currentTool: 'pen', nextTool: 'pen' })).toEqual({
        type: 'cyclePenCursor',
      })
    })
  })

  describe('eraser mode cycle (toolbar re-click)', () => {
    it('selects eraser with eraser tip when switching from another tool', () => {
      expect(resolveToolbarSelectTool({ isDrawing: false, currentTool: 'pen', nextTool: 'eraser' })).toEqual({
        type: 'select',
        tool: 'eraser',
        tip: 'eraser',
      })
    })

    it('cycles eraser mode when eraser is already selected', () => {
      expect(resolveToolbarSelectTool({ isDrawing: false, currentTool: 'eraser', nextTool: 'eraser' })).toEqual({
        type: 'cycleEraserMode',
      })
    })
  })

  describe('crosshair cursor cycle (toolbar re-click)', () => {
    const crosshairTools: Tool[] = ['arrow', 'rect', 'ellipse', 'line', 'laser']

    it.each(crosshairTools)('selects %s with crosshair tip from another tool', (tool) => {
      expect(resolveToolbarSelectTool({ isDrawing: false, currentTool: 'pen', nextTool: tool })).toEqual({
        type: 'select',
        tool,
        tip: 'crosshair',
      })
    })

    it.each(crosshairTools)('cycles crosshair cursor when %s is already selected', (tool) => {
      expect(resolveToolbarSelectTool({ isDrawing: false, currentTool: tool, nextTool: tool })).toEqual({
        type: 'cycleCrosshairCursor',
      })
    })

    it('does not cycle when switching between different crosshair tools', () => {
      expect(resolveToolbarSelectTool({ isDrawing: false, currentTool: 'arrow', nextTool: 'rect' })).toEqual({
        type: 'select',
        tool: 'rect',
        tip: 'crosshair',
      })
    })
  })

  describe('stamp', () => {
    it('selects stamp on first click', () => {
      expect(resolveToolbarSelectTool({ isDrawing: false, currentTool: 'pen', nextTool: 'stamp' })).toEqual({
        type: 'select',
        tool: 'stamp',
        tip: 'stamp',
      })
    })

    it('cycles stamp kind on re-click', () => {
      expect(resolveToolbarSelectTool({ isDrawing: false, currentTool: 'stamp', nextTool: 'stamp' })).toEqual({
        type: 'cycleStampKind',
      })
    })
  })

  it('selects highlighter with default tip (no cycle)', () => {
    expect(
      resolveToolbarSelectTool({
        isDrawing: false,
        currentTool: 'highlighter',
        nextTool: 'highlighter',
      }),
    ).toEqual({ type: 'select', tool: 'highlighter', tip: 'default' })
    expect(resolveToolbarSelectTool({ isDrawing: false, currentTool: 'pen', nextTool: 'highlighter' })).toEqual({
      type: 'select',
      tool: 'highlighter',
      tip: 'default',
    })
  })
})
