export type PenCursorStyle = 'pen' | 'dot'

export const PEN_CURSOR_STYLE_OPTIONS: PenCursorStyle[] = ['pen', 'dot']

export function resolvePenCursorStyle(general?: { penCursorStyle?: PenCursorStyle }): PenCursorStyle {
  return general?.penCursorStyle === 'dot' ? 'dot' : 'pen'
}

/** Toggle pen ↔ dot (session shortcut: press 1 again while pen is selected). */
export function nextPenCursorStyle(style: PenCursorStyle): PenCursorStyle {
  return style === 'pen' ? 'dot' : 'pen'
}
