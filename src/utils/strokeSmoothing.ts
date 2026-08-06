export type StrokeSmoothing = 'off' | 'standard' | 'strong'

export const STROKE_SMOOTHING_OPTIONS: StrokeSmoothing[] = ['off', 'standard', 'strong']

export const DEFAULT_STROKE_SMOOTHING: StrokeSmoothing = 'standard'

export function resolveStrokeSmoothing(general?: { strokeSmoothing?: StrokeSmoothing }): StrokeSmoothing {
  const value = general?.strokeSmoothing
  return value === 'off' || value === 'standard' || value === 'strong' ? value : DEFAULT_STROKE_SMOOTHING
}
