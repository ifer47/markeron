import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AUTO_REVERT_TO_PEN,
  isOneShotShapeTool,
  resolveAutoRevertToPen,
  toolAfterShapeStroke,
} from './autoRevertToPen'

describe('autoRevertToPen', () => {
  it('defaults to off when missing', () => {
    expect(DEFAULT_AUTO_REVERT_TO_PEN).toBe(false)
    expect(resolveAutoRevertToPen(undefined)).toBe(false)
    expect(resolveAutoRevertToPen({})).toBe(false)
  })

  it('resolves persisted value', () => {
    expect(resolveAutoRevertToPen({ autoRevertToPen: true })).toBe(true)
    expect(resolveAutoRevertToPen({ autoRevertToPen: false })).toBe(false)
  })

  it('marks arrow/rect/ellipse/line as one-shot shapes', () => {
    expect(isOneShotShapeTool('line')).toBe(true)
    expect(isOneShotShapeTool('arrow')).toBe(true)
    expect(isOneShotShapeTool('rect')).toBe(true)
    expect(isOneShotShapeTool('ellipse')).toBe(true)
    expect(isOneShotShapeTool('pen')).toBe(false)
    expect(isOneShotShapeTool('eraser')).toBe(false)
    expect(isOneShotShapeTool('stamp')).toBe(false)
  })

  it('prefers restoring modifier-temporary tool over auto-revert', () => {
    expect(
      toolAfterShapeStroke({
        autoRevertToPen: true,
        toolBeforeModifier: 'highlighter',
        currentTool: 'line',
      }),
    ).toBe('highlighter')
  })

  it('still auto-reverts when modifier is same-tool (e.g. ellipse + Shift)', () => {
    expect(
      toolAfterShapeStroke({
        autoRevertToPen: true,
        toolBeforeModifier: 'ellipse',
        currentTool: 'ellipse',
      }),
    ).toBe('pen')
    expect(
      toolAfterShapeStroke({
        autoRevertToPen: true,
        toolBeforeModifier: 'line',
        currentTool: 'line',
      }),
    ).toBe('pen')
  })

  it('reverts one-shot shapes to pen when enabled', () => {
    expect(
      toolAfterShapeStroke({
        autoRevertToPen: true,
        toolBeforeModifier: null,
        currentTool: 'line',
      }),
    ).toBe('pen')
  })

  it('keeps tool when disabled or not a one-shot shape', () => {
    expect(
      toolAfterShapeStroke({
        autoRevertToPen: false,
        toolBeforeModifier: null,
        currentTool: 'line',
      }),
    ).toBeNull()
    expect(
      toolAfterShapeStroke({
        autoRevertToPen: true,
        toolBeforeModifier: null,
        currentTool: 'pen',
      }),
    ).toBeNull()
  })

  it('abort path restores real temp tools but never auto-reverts', () => {
    expect(
      toolAfterShapeStroke({
        autoRevertToPen: true,
        toolBeforeModifier: 'highlighter',
        currentTool: 'line',
        allowAutoRevert: false,
      }),
    ).toBe('highlighter')
    expect(
      toolAfterShapeStroke({
        autoRevertToPen: true,
        toolBeforeModifier: null,
        currentTool: 'ellipse',
        allowAutoRevert: false,
      }),
    ).toBeNull()
    expect(
      toolAfterShapeStroke({
        autoRevertToPen: true,
        toolBeforeModifier: 'ellipse',
        currentTool: 'ellipse',
        allowAutoRevert: false,
      }),
    ).toBeNull()
  })
})
