export type WhiteboardBackground = 'white' | 'black'

export const WHITEBOARD_BACKGROUND_OPTIONS: WhiteboardBackground[] = ['white', 'black']

const WHITEBOARD_BACKGROUND_COLORS: Record<WhiteboardBackground, string> = {
  white: '#FFFFFF',
  black: '#000000',
}

export function resolveWhiteboardBackground(general?: {
  whiteboardBackground?: WhiteboardBackground
}): WhiteboardBackground {
  return general?.whiteboardBackground === 'black' ? 'black' : 'white'
}

export function whiteboardBackgroundColor(background: WhiteboardBackground): string {
  return WHITEBOARD_BACKGROUND_COLORS[background]
}
