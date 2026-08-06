import type { DrawAction, Point } from './drawingTypes'
import { getActiveTextOutline } from '../constants/textOutline'
import {
  stampContrastColor,
  stampLabelFontSize,
  stampRadius,
  stampRingColor,
  stampShadowParams,
  stampStrokeWidth,
} from '../constants/stamp'
import { LaserPointer } from '@excalidraw/laser-pointer'
import { laserSizeFromMapping, smoothLaserPositions } from '../constants/laser'
import { getInkOutline, outlineToPath2D } from '../constants/penStroke'
import { getStrokeSmoothing } from './strokeSmoothingState'

/** Constant-width freehand (eraser / legacy fallback). */
export function drawFreehand(ctx: CanvasRenderingContext2D, points: Point[]) {
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)

  if (points.length === 2) {
    ctx.lineTo(points[1].x, points[1].y)
  } else {
    for (let i = 1; i < points.length - 1; i++) {
      const midX = (points[i].x + points[i + 1].x) / 2
      const midY = (points[i].y + points[i + 1].y) / 2
      ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY)
    }
    const last = points[points.length - 1]
    ctx.lineTo(last.x, last.y)
  }
  ctx.stroke()
}

/** Ink outline for pen / highlighter (pressure width for pen/touch; uniform for mouse). */
export function buildInkPath(points: Point[], size: number, last: boolean, pointerType?: string | null): Path2D {
  return outlineToPath2D(getInkOutline(points, size, getStrokeSmoothing(), last, pointerType))
}

export function drawInkStroke(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  size: number,
  last: boolean,
  pointerType?: string | null,
) {
  if (points.length === 0) return
  if (points.length === 1) {
    const r = Math.max(0.5, size / 2)
    ctx.beginPath()
    ctx.arc(points[0].x, points[0].y, r, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  ctx.fill(buildInkPath(points, size, last, pointerType))
}

export function drawLine(ctx: CanvasRenderingContext2D, start: Point, end: Point) {
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(end.x, end.y)
  ctx.stroke()
}

export function drawArrow(ctx: CanvasRenderingContext2D, start: Point, end: Point) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 2) return

  const angle = Math.atan2(dy, dx)
  const nx = -Math.sin(angle)
  const ny = Math.cos(angle)

  const w = ctx.lineWidth
  const headLen = Math.max(18, w * 5)
  const headHalfW = Math.max(8, w * 2.5)
  const tailHalfW = Math.max(0.5, w * 0.15)
  const shaftHalfW = Math.max(1.5, w * 0.7)

  const actualHeadLen = Math.min(headLen, len * 0.45)
  const baseFrac = 1 - actualHeadLen / len
  const baseX = start.x + dx * baseFrac
  const baseY = start.y + dy * baseFrac

  ctx.save()
  ctx.fillStyle = ctx.strokeStyle
  ctx.beginPath()
  ctx.moveTo(start.x + nx * tailHalfW, start.y + ny * tailHalfW)
  ctx.lineTo(baseX + nx * shaftHalfW, baseY + ny * shaftHalfW)
  ctx.lineTo(baseX + nx * headHalfW, baseY + ny * headHalfW)
  ctx.lineTo(end.x, end.y)
  ctx.lineTo(baseX - nx * headHalfW, baseY - ny * headHalfW)
  ctx.lineTo(baseX - nx * shaftHalfW, baseY - ny * shaftHalfW)
  ctx.lineTo(start.x - nx * tailHalfW, start.y - ny * tailHalfW)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

export function drawRect(ctx: CanvasRenderingContext2D, start: Point, end: Point) {
  ctx.beginPath()
  ctx.rect(start.x, start.y, end.x - start.x, end.y - start.y)
  ctx.stroke()
}

export function drawEllipse(ctx: CanvasRenderingContext2D, start: Point, end: Point) {
  const cx = (start.x + end.x) / 2
  const cy = (start.y + end.y) / 2
  const rx = Math.abs(end.x - start.x) / 2
  const ry = Math.abs(end.y - start.y) / 2

  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  ctx.stroke()
}

export function drawText(ctx: CanvasRenderingContext2D, action: DrawAction) {
  const fs = action.fontSize ?? 24
  ctx.font = `${fs}px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif`
  ctx.globalAlpha = 1
  ctx.fillStyle = action.color
  ctx.textBaseline = 'alphabetic'
  const outline = getActiveTextOutline(action.textOutline, action.color)
  if (outline) {
    ctx.strokeStyle = outline.color
    ctx.lineWidth = outline.width
    ctx.lineJoin = 'round'
    ctx.miterLimit = 2
  }
  const lines = (action.text ?? '').split('\n')
  const x = action.points[0].x + 2
  const lh = Math.round(fs * 1.3)
  const m = ctx.measureText('Mg')
  let ascent = m.fontBoundingBoxAscent
  let descent = m.fontBoundingBoxDescent
  if (
    ascent === undefined ||
    descent === undefined ||
    !Number.isFinite(ascent) ||
    !Number.isFinite(descent) ||
    (ascent === 0 && descent === 0)
  ) {
    ascent = fs * 0.9
    descent = fs * 0.3
  }
  const baselineOffset = (ascent - descent) / 2
  for (let i = 0; i < lines.length; i++) {
    const lineCenterY = action.points[0].y + i * lh
    const baselineY = lineCenterY + baselineOffset
    if (outline) ctx.strokeText(lines[i], x, baselineY)
    ctx.fillText(lines[i], x, baselineY)
  }
}

export function drawStamp(ctx: CanvasRenderingContext2D, action: DrawAction) {
  const label = action.text ?? ''
  if (!label || action.points.length === 0) return

  const fs = action.fontSize ?? 24
  const { x, y } = action.points[0]
  const outerR = stampRadius(fs, label)
  const ringW = stampStrokeWidth(outerR)
  const innerR = Math.max(1, outerR - ringW)
  const labelFs = stampLabelFontSize(fs, label)
  const shadow = stampShadowParams(outerR)
  const ink = stampContrastColor(action.color)
  const ring = stampRingColor(action.color)

  ctx.globalAlpha = 1

  // Soft contact shadow under the full outer silhouette (tight FastStone blur)
  ctx.save()
  ctx.shadowColor = `rgba(0, 0, 0, ${shadow.alpha})`
  ctx.shadowBlur = shadow.blur
  ctx.shadowOffsetX = shadow.offsetX
  ctx.shadowOffsetY = shadow.offsetY
  ctx.beginPath()
  ctx.arc(x, y, outerR, 0, Math.PI * 2)
  ctx.fillStyle = ring
  ctx.fill()
  ctx.restore()

  // Redraw outer ring disc without shadow so the rim stays crisp
  ctx.beginPath()
  ctx.arc(x, y, outerR, 0, Math.PI * 2)
  ctx.fillStyle = ring
  ctx.fill()

  // Inner fill — inset by ring width for an even white band
  ctx.beginPath()
  ctx.arc(x, y, innerR, 0, Math.PI * 2)
  ctx.fillStyle = action.color
  ctx.fill()

  // Arial Bold, optically centered (no horizontal squash — FastStone digits are round)
  ctx.fillStyle = ink
  ctx.font = `bold ${labelFs}px Arial, Helvetica, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x, y + labelFs * 0.04)
}

/**
 * Draw an action with full style setup (opacity, composite operation, stroke/fill).
 * Handles all tool types including eraser composite mode.
 */
export function drawActionDirect(
  ctx: CanvasRenderingContext2D,
  action: DrawAction,
  pathCache?: WeakMap<DrawAction, Path2D>,
) {
  ctx.save()
  ctx.globalAlpha = action.opacity

  if (action.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.globalAlpha = 1
  } else {
    ctx.globalCompositeOperation = 'source-over'
  }

  ctx.strokeStyle = action.color
  ctx.fillStyle = action.color
  ctx.lineWidth = action.lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (action.tool === 'text') {
    drawText(ctx, action)
    ctx.restore()
    return
  }

  if (action.tool === 'stamp') {
    drawStamp(ctx, action)
    ctx.restore()
    return
  }

  const pts = action.points
  if (pts.length < 2) {
    ctx.beginPath()
    ctx.arc(pts[0].x, pts[0].y, action.lineWidth / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    return
  }

  switch (action.tool) {
    case 'pen':
    case 'highlighter': {
      let path = pathCache?.get(action)
      if (!path) {
        path = buildInkPath(pts, action.lineWidth, true, action.pointerType)
        if (action.bbox) pathCache?.set(action, path)
      }
      ctx.fill(path)
      break
    }
    case 'laser':
    case 'eraser': {
      let path = pathCache?.get(action)
      if (!path && action.bbox) {
        path = new Path2D()
        path.moveTo(pts[0].x, pts[0].y)
        if (pts.length === 2) {
          path.lineTo(pts[1].x, pts[1].y)
        } else {
          for (let k = 1; k < pts.length - 1; k++) {
            const midX = (pts[k].x + pts[k + 1].x) / 2
            const midY = (pts[k].y + pts[k + 1].y) / 2
            path.quadraticCurveTo(pts[k].x, pts[k].y, midX, midY)
          }
          path.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
        }
        pathCache?.set(action, path)
      }
      if (path) {
        ctx.stroke(path)
      } else {
        drawFreehand(ctx, pts)
      }
      break
    }
    case 'line':
      drawLine(ctx, pts[0], pts[1])
      break
    case 'arrow':
      drawArrow(ctx, pts[0], pts[1])
      break
    case 'rect':
      drawRect(ctx, pts[0], pts[1])
      break
    case 'ellipse':
      drawEllipse(ctx, pts[0], pts[1])
      break
  }

  ctx.restore()
}

/**
 * Excalidraw-style laser: filled variable-width outline (not stroked segments).
 * Decay is geometric taper via sizeMapping — edges stay crisp and opaque.
 */
export function drawLaserTrail(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  color: string,
  lineWidth: number,
  now = performance.now(),
  keepHead = false,
) {
  if (points.length === 0) return

  // LaserPointer `size` is radius. Map toolbar presets [1,2,3,5,8] ≈ pen stroke diameter.
  const size = Math.max(0.6, lineWidth / 2)

  const stroke = new LaserPointer({
    size,
    // Built-in streamline would lerp timestamps; we smooth x/y ourselves instead.
    streamline: 0,
    simplify: 0,
    keepHead,
    sizeMapping: (c) => laserSizeFromMapping(c, now),
  })

  const smoothed = smoothLaserPositions(points)
  for (let i = 0; i < smoothed.length; i++) {
    stroke.addPoint(smoothed[i])
  }
  stroke.close()

  const outline = stroke.getStrokeOutline()
  if (outline.length < 2) return

  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  // Hairline only — keep it thin so AA stroke does not inflate the beam.
  ctx.lineWidth = Math.min(0.85, Math.max(0.4, size * 0.3))
  ctx.beginPath()
  ctx.moveTo(outline[0][0], outline[0][1])
  for (let i = 1; i < outline.length; i++) {
    ctx.lineTo(outline[i][0], outline[i][1])
  }
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}
