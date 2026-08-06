import { resolveStrokeSmoothing, type StrokeSmoothing } from '../utils/strokeSmoothing'

export type { StrokeSmoothing }
export { resolveStrokeSmoothing, STROKE_SMOOTHING_OPTIONS, DEFAULT_STROKE_SMOOTHING } from '../utils/strokeSmoothing'

/** Module-level ink smoothing; overlay updates from config. */
let activeStrokeSmoothing: StrokeSmoothing = 'standard'

export function getStrokeSmoothing(): StrokeSmoothing {
  return activeStrokeSmoothing
}

export function setStrokeSmoothing(level: StrokeSmoothing) {
  activeStrokeSmoothing = resolveStrokeSmoothing({ strokeSmoothing: level })
}
