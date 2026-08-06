export type EraserMode = 'stroke' | 'object'

export const ERASER_MODE_OPTIONS: EraserMode[] = ['stroke', 'object']

export function resolveEraserMode(general?: { eraserMode?: EraserMode }): EraserMode {
  return general?.eraserMode ?? 'stroke'
}

/** Toggle stroke ↔ object (session shortcut: press 7 again while eraser is selected). */
export function nextEraserMode(mode: EraserMode): EraserMode {
  return mode === 'stroke' ? 'object' : 'stroke'
}
