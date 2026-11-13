import { describe, expect, it } from 'vitest'
import { noteStableViewportSample } from './overlayViewport'

describe('noteStableViewportSample', () => {
  const base = { neededStable: 3, staleKey: '1440x900@1' as string | null, allowStaleAfterSamples: 3 }

  it('rejects the previous monitor layout during the grace window', () => {
    let state = { last: '', stable: 0 }
    for (let i = 0; i < 3; i++) {
      const next = noteStableViewportSample('1440x900@1', state, { ...base, sampleIndex: i })
      expect(next.accepted).toBe(false)
      state = { last: next.last, stable: next.stable }
    }
  })

  it('accepts a new monitor layout once it holds steady', () => {
    let state = { last: '', stable: 0 }
    // One stale sample, then neededStable+1 samples of the new layout.
    const keys = ['1440x900@1', '2560x1440@1', '2560x1440@1', '2560x1440@1', '2560x1440@1']
    let accepted = false
    keys.forEach((key, sampleIndex) => {
      const next = noteStableViewportSample(key, state, { ...base, sampleIndex })
      accepted = next.accepted
      state = { last: next.last, stable: next.stable }
    })
    expect(accepted).toBe(true)
    expect(state.last).toBe('2560x1440@1')
  })

  it('allows same-monitor reactivation after the grace window', () => {
    let state = { last: '', stable: 0 }
    let accepted = false
    // 3 rejected + neededStable identical samples after grace ends
    for (let i = 0; i < 6; i++) {
      const next = noteStableViewportSample('1440x900@1', state, { ...base, sampleIndex: i })
      accepted = next.accepted
      state = { last: next.last, stable: next.stable }
    }
    expect(accepted).toBe(true)
  })
})
