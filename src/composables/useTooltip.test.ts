import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { computed } from 'vue'
import { useTooltip } from './useTooltip'
import type { Tool } from './drawingTypes'

function createTooltip() {
  const toolLabelMap = computed<Record<Tool, string>>(() => ({
    pen: 'Pen',
    highlighter: 'Highlighter',
    arrow: 'Arrow',
    rect: 'Rectangle',
    ellipse: 'Ellipse',
    line: 'Line',
    eraser: 'Eraser',
    text: 'Text',
  }))

  const colorNameMap = computed<Record<string, string>>(() => ({
    '#FF3B30': 'Red',
    '#007AFF': 'Blue',
    '#000000': 'Black',
  }))

  const t = (key: string) => key

  return useTooltip({ toolLabelMap, colorNameMap, t })
}

describe('useTooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with empty state', () => {
    const { state } = createTooltip()
    expect(state.text.value).toBe('')
    expect(state.tool.value).toBeNull()
    expect(state.color.value).toBeNull()
    expect(state.width.value).toBeNull()
    expect(state.visible.value).toBe(false)
  })

  describe('showTool', () => {
    it('displays tool name', () => {
      const { state, showTool } = createTooltip()
      showTool('pen')
      expect(state.text.value).toBe('Pen')
      expect(state.tool.value).toBe('pen')
      expect(state.color.value).toBeNull()
      expect(state.visible.value).toBe(true)
    })

    it('auto-hides after 1200ms', () => {
      const { state, showTool } = createTooltip()
      showTool('arrow')
      expect(state.visible.value).toBe(true)

      vi.advanceTimersByTime(1199)
      expect(state.visible.value).toBe(true)

      vi.advanceTimersByTime(1)
      expect(state.visible.value).toBe(false)
      expect(state.text.value).toBe('')
    })

    it('resets timer on consecutive calls', () => {
      const { state, showTool } = createTooltip()
      showTool('pen')
      vi.advanceTimersByTime(1000)
      showTool('arrow')

      vi.advanceTimersByTime(1000)
      expect(state.visible.value).toBe(true)
      expect(state.text.value).toBe('Arrow')

      vi.advanceTimersByTime(200)
      expect(state.visible.value).toBe(false)
    })
  })

  describe('showColor', () => {
    it('displays color name from map', () => {
      const { state, showColor } = createTooltip()
      showColor('#FF3B30')
      expect(state.text.value).toBe('Red')
      expect(state.color.value).toBe('#FF3B30')
      expect(state.tool.value).toBeNull()
    })

    it('falls back to hex code for unmapped colors', () => {
      const { state, showColor } = createTooltip()
      showColor('#ABCDEF')
      expect(state.text.value).toBe('#ABCDEF')
    })

    it('case-insensitive color lookup', () => {
      const { state, showColor } = createTooltip()
      showColor('#ff3b30')
      expect(state.text.value).toBe('Red')
    })
  })

  describe('showWidth', () => {
    it('displays width with custom label', () => {
      const { state, showWidth } = createTooltip()
      showWidth(3, 'Thin')
      expect(state.text.value).toBe('Thin')
      expect(state.width.value).toBe(3)
    })

    it('falls back to px display when no translation', () => {
      const { state, showWidth } = createTooltip()
      showWidth(5)
      expect(state.text.value).toBe('5px')
      expect(state.width.value).toBe(5)
    })
  })

  describe('showMessage', () => {
    it('displays arbitrary message', () => {
      const { state, showMessage } = createTooltip()
      showMessage('Copied!')
      expect(state.text.value).toBe('Copied!')
      expect(state.tool.value).toBeNull()
      expect(state.color.value).toBeNull()
      expect(state.width.value).toBeNull()
    })

    it('auto-hides after 1500ms', () => {
      const { state, showMessage } = createTooltip()
      showMessage('Done')

      vi.advanceTimersByTime(1499)
      expect(state.visible.value).toBe(true)

      vi.advanceTimersByTime(1)
      expect(state.visible.value).toBe(false)
    })
  })

  describe('dispose', () => {
    it('clears pending timers', () => {
      const { state, showTool, dispose } = createTooltip()
      showTool('pen')
      dispose()

      vi.advanceTimersByTime(5000)
      // Timer was cleared, so text should remain (not auto-cleared)
      expect(state.text.value).toBe('Pen')
    })
  })
})
