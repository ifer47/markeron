import type { DrawAction, Point } from './drawingTypes'
import { CURVED_INK_STYLE, curvedInkPoints, isCurvedLinearAction, sampleQuadratic } from './drawingGeometry'
import { isDashableTool, isNonSolidDashStyle, shapeDashPattern } from '../constants/tools'
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
import { buildSweptPath, dotRadius, nodesFromSmoothedPoints, pruneNodes, SWEPT_STYLE } from '../constants/sweptStylus'

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
export function buildInkPath(points: Point[], size: number, pointerType?: string | null): Path2D {
  const nodes = nodesFromSmoothedPoints(points, size, SWEPT_STYLE, pointerType)
  return buildSweptPath(nodes, pruneNodes(nodes, SWEPT_STYLE))
}

function buildCurvedInkPath(action: DrawAction): Path2D {
  const nodes = nodesFromSmoothedPoints(curvedInkPoints(action), action.lineWidth, CURVED_INK_STYLE, action.pointerType)
  // Keep every sample: the 3° freehand pruning tolerance would flatten a smooth
  // quadratic into a visibly polygonal ribbon.
  return buildSweptPath(nodes)
}

export function drawLine(ctx: CanvasRenderingContext2D, start: Point, end: Point) {
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(end.x, end.y)
  ctx.stroke()
}

/** Bent line: native quadratic stroke so dashes, caps, and joins follow the curve. */
export function drawCurvedLine(ctx: CanvasRenderingContext2D, points: Point[]) {
  const p0 = points[0]
  const c = points[1]
  const p1 = points[points.length - 1]
  ctx.beginPath()
  ctx.moveTo(p0.x, p0.y)
  ctx.quadraticCurveTo(c.x, c.y, p1.x, p1.y)
  ctx.stroke()
}

export function drawArrow(ctx: CanvasRenderingContext2D, start: Point, end: Point, dashed = false) {
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

  // Filled shafts ignore setLineDash — stroke a dashed shaft and keep a solid head.
  if (dashed) {
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(baseX, baseY)
    ctx.stroke()

    ctx.save()
    ctx.setLineDash([])
    ctx.fillStyle = ctx.strokeStyle
    ctx.beginPath()
    ctx.moveTo(baseX + nx * headHalfW, baseY + ny * headHalfW)
    ctx.lineTo(end.x, end.y)
    ctx.lineTo(baseX - nx * headHalfW, baseY - ny * headHalfW)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
    return
  }

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

/**
 * Bent arrow: a tapered ribbon along the quadratic curve plus a triangular head
 * whose base is perpendicular to the end tangent. Mirrors `drawArrow` so a
 * straight (two-point) arrow and a bent (three-point) one share one visual style.
 */
export function drawCurvedArrow(ctx: CanvasRenderingContext2D, points: Point[], dashed = false) {
  const p0 = points[0]
  const c = points[1]
  const p1 = points[points.length - 1]

  const chordLen = Math.hypot(c.x - p0.x, c.y - p0.y) + Math.hypot(p1.x - c.x, p1.y - c.y)
  if (chordLen < 2) return

  // Dense enough that the ribbon reads as a curve, capped so long arrows stay cheap.
  const segments = Math.max(16, Math.min(64, Math.ceil(chordLen / 4)))
  const samples = sampleQuadratic(p0, c, p1, segments)
  const cumulative: number[] = [0]
  for (let i = 1; i < samples.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y))
  }
  const total = cumulative[cumulative.length - 1]
  if (total < 2) return

  const w = ctx.lineWidth
  const headLen = Math.max(18, w * 5)
  const headHalfW = Math.max(8, w * 2.5)
  const tailHalfW = Math.max(0.5, w * 0.15)
  const shaftHalfW = Math.max(1.5, w * 0.7)

  const actualHeadLen = Math.min(headLen, total * 0.45)
  const baseDist = total - actualHeadLen

  // Ribbon stops at the head base; interpolate that cross-section exactly between samples.
  let seg = 0
  while (seg < samples.length - 2 && cumulative[seg + 1] < baseDist) seg++
  const segLen = cumulative[seg + 1] - cumulative[seg]
  const segFrac = segLen > 1e-9 ? (baseDist - cumulative[seg]) / segLen : 0
  const basePoint = {
    x: samples[seg].x + (samples[seg + 1].x - samples[seg].x) * segFrac,
    y: samples[seg].y + (samples[seg + 1].y - samples[seg].y) * segFrac,
  }

  const ribbon = samples.slice(0, seg + 1)
  ribbon.push(basePoint)

  const left: Point[] = []
  const right: Point[] = []
  for (let i = 0; i < ribbon.length; i++) {
    const prev = ribbon[Math.max(0, i - 1)]
    const next = ribbon[Math.min(ribbon.length - 1, i + 1)]
    let tx = next.x - prev.x
    let ty = next.y - prev.y
    const tl = Math.hypot(tx, ty) || 1
    tx /= tl
    ty /= tl
    const nx = -ty
    const ny = tx
    const t = baseDist > 1e-9 ? Math.min(1, cumulative[Math.min(i, seg)] / baseDist) : 1
    const half = tailHalfW + (shaftHalfW - tailHalfW) * t
    left.push({ x: ribbon[i].x + nx * half, y: ribbon[i].y + ny * half })
    right.push({ x: ribbon[i].x - nx * half, y: ribbon[i].y - ny * half })
  }

  // Head base normal follows the end tangent so a curved head does not skew.
  // Degenerate curve (control at the tip): fall back to the chord direction.
  let htx = p1.x - c.x
  let hty = p1.y - c.y
  if (Math.hypot(htx, hty) < 1e-9) {
    htx = p1.x - p0.x
    hty = p1.y - p0.y
  }
  const htl = Math.hypot(htx, hty) || 1
  htx /= htl
  hty /= htl
  const hnx = -hty
  const hny = htx
  // Shift the head base 1px back along the tangent so the ribbon joins it without a seam.
  const headBase = { x: basePoint.x - htx, y: basePoint.y - hty }
  const headLeft = { x: headBase.x + hnx * headHalfW, y: headBase.y + hny * headHalfW }
  const headRight = { x: headBase.x - hnx * headHalfW, y: headBase.y - hny * headHalfW }

  // Filled shafts ignore setLineDash — stroke a dashed shaft and keep a solid head.
  if (dashed) {
    ctx.beginPath()
    ctx.moveTo(ribbon[0].x, ribbon[0].y)
    for (let i = 1; i < ribbon.length; i++) ctx.lineTo(ribbon[i].x, ribbon[i].y)
    ctx.stroke()

    ctx.save()
    ctx.setLineDash([])
    ctx.fillStyle = ctx.strokeStyle
    ctx.beginPath()
    ctx.moveTo(headLeft.x, headLeft.y)
    ctx.lineTo(p1.x, p1.y)
    ctx.lineTo(headRight.x, headRight.y)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
    return
  }

  ctx.save()
  ctx.fillStyle = ctx.strokeStyle
  ctx.beginPath()
  ctx.moveTo(left[0].x, left[0].y)
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y)
  ctx.lineTo(headLeft.x, headLeft.y)
  ctx.lineTo(p1.x, p1.y)
  ctx.lineTo(headRight.x, headRight.y)
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

export function drawRect(ctx: CanvasRenderingContext2D, start: Point, end: Point) {
  ctx.beginPath()
  ctx.rect(start.x, start.y, end.x - start.x, end.y - start.y)
  ctx.stroke()
}

/** True when the axis-aligned ellipse from diagonal corners is effectively a circle. */
export function isAxisAlignedCircle(start: Point, end: Point): boolean {
  const rx = Math.abs(end.x - start.x) / 2
  const ry = Math.abs(end.y - start.y) / 2
  const r = Math.max(rx, ry)
  if (r < 2) return false
  return Math.abs(rx - ry) <= Math.max(1, r * 0.02)
}

/** Dot at circle center (for math teaching). Uses current stroke/fill styles. */
export function drawCircleCenter(ctx: CanvasRenderingContext2D, cx: number, cy: number, lineWidth: number) {
  const dotR = Math.max(1.75, lineWidth * 0.45)

  ctx.save()
  ctx.setLineDash([])
  ctx.fillStyle = typeof ctx.strokeStyle === 'string' ? ctx.strokeStyle : '#000'
  ctx.beginPath()
  ctx.arc(cx, cy, dotR, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export function drawEllipse(
  ctx: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  options?: { lineWidth?: number; showCenter?: boolean },
) {
  const cx = (start.x + end.x) / 2
  const cy = (start.y + end.y) / 2
  const rx = Math.abs(end.x - start.x) / 2
  const ry = Math.abs(end.y - start.y) / 2

  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  ctx.stroke()

  const showCenter = options?.showCenter !== false && isAxisAlignedCircle(start, end)
  if (showCenter) {
    drawCircleCenter(ctx, cx, cy, options?.lineWidth ?? ctx.lineWidth)
  }
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
  if (isNonSolidDashStyle(action.dashStyle) && isDashableTool(action.tool)) {
    ctx.setLineDash(shapeDashPattern(action.lineWidth, action.dashStyle))
  }

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
    // Solid ink taps use the same pressure-aware radius as a swept stroke, so a
    // tap and a short stroke no longer disagree. Dashed pen strokes are uniform
    // (`drawFreehand`), and other tools (eraser included) keep their radius.
    const pressureDot =
      action.tool === 'highlighter' || (action.tool === 'pen' && !isNonSolidDashStyle(action.dashStyle))
    const dotR = pressureDot
      ? dotRadius(pts[0], action.lineWidth, SWEPT_STYLE, action.pointerType)
      : action.lineWidth / 2
    ctx.beginPath()
    ctx.arc(pts[0].x, pts[0].y, dotR, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    return
  }

  switch (action.tool) {
    case 'pen':
    case 'highlighter': {
      const curvedInk = isCurvedLinearAction(action)
      // Non-solid pen: stroke the centerline (ink fill ignores setLineDash).
      if (action.tool === 'pen' && isNonSolidDashStyle(action.dashStyle)) {
        if (curvedInk) drawCurvedLine(ctx, pts)
        else drawFreehand(ctx, pts)
        break
      }
      let path = pathCache?.get(action)
      if (!path) {
        path = curvedInk ? buildCurvedInkPath(action) : buildInkPath(pts, action.lineWidth, action.pointerType)
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
      if (isCurvedLinearAction(action)) {
        drawCurvedLine(ctx, pts)
      } else {
        drawLine(ctx, pts[0], pts[1])
      }
      break
    case 'arrow':
      if (isCurvedLinearAction(action)) {
        drawCurvedArrow(ctx, pts, isNonSolidDashStyle(action.dashStyle))
      } else {
        drawArrow(ctx, pts[0], pts[1], isNonSolidDashStyle(action.dashStyle))
      }
      break
    case 'rect':
    case 'ellipse': {
      const rot = action.rotation
      if (typeof rot === 'number' && Number.isFinite(rot) && rot !== 0) {
        const cx = (pts[0].x + pts[1].x) / 2
        const cy = (pts[0].y + pts[1].y) / 2
        ctx.translate(cx, cy)
        ctx.rotate(rot)
        ctx.translate(-cx, -cy)
      }
      if (action.tool === 'rect') drawRect(ctx, pts[0], pts[1])
      else drawEllipse(ctx, pts[0], pts[1], { lineWidth: action.lineWidth })
      break
    }
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
  uniform = false,
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
    // Writing mode keeps the whole stroke at full width until the shared fade-out.
    sizeMapping: uniform ? () => 1 : (c) => laserSizeFromMapping(c, now),
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
  // `LaserPointer` emits the offset outline as a polyline, and its own corner
  // detection bails out on tight turns (>75°, or >37.5° when moving fast), so
  // those vertices read as corners. Curve through each point to the midpoint of
  // the next segment: the silhouette stays put, but every vertex becomes a
  // quadratic arc — including the sharp turns the library leaves alone.
  for (let i = 1; i < outline.length - 1; i++) {
    const midX = (outline[i][0] + outline[i + 1][0]) / 2
    const midY = (outline[i][1] + outline[i + 1][1]) / 2
    ctx.quadraticCurveTo(outline[i][0], outline[i][1], midX, midY)
  }
  const last = outline[outline.length - 1]
  ctx.lineTo(last[0], last[1])
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}
