import { describe, expect, it } from 'vitest'
import { resolveWhiteboardBackground, whiteboardBackgroundColor } from './whiteboardBackground'

describe('whiteboardBackground', () => {
  it('defaults to white', () => {
    expect(resolveWhiteboardBackground()).toBe('white')
  })

  it('reads explicit whiteboardBackground', () => {
    expect(resolveWhiteboardBackground({ whiteboardBackground: 'black' })).toBe('black')
    expect(resolveWhiteboardBackground({ whiteboardBackground: 'white' })).toBe('white')
  })

  it('maps backgrounds to solid colors', () => {
    expect(whiteboardBackgroundColor('white')).toBe('#FFFFFF')
    expect(whiteboardBackgroundColor('black')).toBe('#000000')
  })
})
