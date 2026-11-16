/**
 * Resolve CSS-pixel screen coordinates for standalone toolbar window dragging.
 *
 * Mouse PointerEvents usually expose trustworthy `screenX`/`screenY`. Some pen/touch
 * WebView paths report `(0, 0)` or mirror `clientX`/`clientY` (missing window origin),
 * which makes `screen - grabClient` jump the window to the top-left. Fall back to
 * `windowOrigin + client` in those cases so mouse keep using event screen coords.
 */

export type PointerScreenSample = {
  screenX: number
  screenY: number
  clientX: number
  clientY: number
}

export type CssPoint = { x: number; y: number }

const COORD_EPS = 2

/** Whether `screenX`/`screenY` look like real screen-space pointer coords. */
export function isPointerEventScreenTrusted(sample: PointerScreenSample, windowOriginCss: CssPoint): boolean {
  const reconstructedX = windowOriginCss.x + sample.clientX
  const reconstructedY = windowOriginCss.y + sample.clientY

  // Event screen matches window origin + client → clearly trustworthy.
  if (
    Math.abs(sample.screenX - reconstructedX) <= COORD_EPS &&
    Math.abs(sample.screenY - reconstructedY) <= COORD_EPS
  ) {
    return true
  }

  // Common WebView2 pen failure: screen stuck at 0,0 while the pointer is elsewhere.
  if (sample.screenX === 0 && sample.screenY === 0) {
    return Math.abs(reconstructedX) <= COORD_EPS && Math.abs(reconstructedY) <= COORD_EPS
  }

  // Another failure: screen mirrors client (window origin omitted). Reject when the
  // window is clearly not at the screen origin; otherwise mouse/pen at a 0,0 window
  // would look the same and should stay trusted.
  if (
    Math.abs(sample.screenX - sample.clientX) <= COORD_EPS &&
    Math.abs(sample.screenY - sample.clientY) <= COORD_EPS &&
    (Math.abs(windowOriginCss.x) > COORD_EPS || Math.abs(windowOriginCss.y) > COORD_EPS)
  ) {
    return false
  }

  // Prefer event screen when it disagrees with window.screenX (e.g. macOS WKWebView
  // where window.screenX is unreliable but mouse screen coords are still correct).
  return true
}

/** CSS-pixel screen position of the pointer for window drag math. */
export function resolvePointerScreenCss(sample: PointerScreenSample, windowOriginCss: CssPoint): CssPoint {
  if (isPointerEventScreenTrusted(sample, windowOriginCss)) {
    return { x: sample.screenX, y: sample.screenY }
  }
  return {
    x: windowOriginCss.x + sample.clientX,
    y: windowOriginCss.y + sample.clientY,
  }
}
