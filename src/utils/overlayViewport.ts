/**
 * Viewport stability sampling for overlay canvas resize.
 *
 * After cross-monitor activation, WebView2 can keep reporting the previous
 * display's CSS size for several frames. Accepting that as "stable" locks the
 * canvas to the wrong resolution until the next hide/show.
 */
export type ViewportSampleState = {
  last: string
  stable: number
}

export function noteStableViewportSample(
  key: string,
  prev: ViewportSampleState,
  opts: {
    neededStable: number
    /** Previous session layout key — reject as "stable" until it changes or grace samples elapse. */
    staleKey: string | null
    sampleIndex: number
    /** After this many samples, allow settling on staleKey (same-monitor re-activate). */
    allowStaleAfterSamples: number
  },
): ViewportSampleState & { accepted: boolean } {
  const treatAsStale = opts.staleKey != null && key === opts.staleKey && opts.sampleIndex < opts.allowStaleAfterSamples

  if (treatAsStale || !key) {
    return { last: key, stable: 0, accepted: false }
  }

  if (key === prev.last) {
    const stable = prev.stable + 1
    return { last: key, stable, accepted: stable >= opts.neededStable }
  }

  return { last: key, stable: 0, accepted: false }
}
