/**
 * Pure geometry for the phasor diagram.
 *
 * Everything here works on plain numbers so it can be unit tested without a
 * canvas, and so the same code can drive both the Canvas renderer and the
 * hit-testing / dragging logic.
 *
 * Convention: world coordinates are (re, im) of a complex number; screen
 * coordinates are pixels with y pointing DOWN, so world +im maps to screen -y.
 */

import type { Cx } from '../core/types'

export interface Viewport {
  width: number
  height: number
}

/** Where the origin sits on screen, and how many pixels one unit is worth. */
export interface View {
  /** screen x of the world origin */
  ox: number
  /** screen y of the world origin */
  oy: number
  /** pixels per world unit */
  scale: number
}

export interface Point {
  x: number
  y: number
}

export function worldToScreen(view: View, p: Cx): Point {
  return { x: view.ox + p.re * view.scale, y: view.oy - p.im * view.scale }
}

export function screenToWorld(view: View, x: number, y: number): Cx {
  return { re: (x - view.ox) / view.scale, im: (view.oy - y) / view.scale }
}

/**
 * World span used when there is nothing to fit. Without it an empty diagram
 * collapses to the 1e-9 floor below and the grid reads "2e-10" instead of the
 * 0.5 / 1 / 1.5 a user expects from an empty coordinate frame.
 */
const DEFAULT_SPAN = 2

/**
 * Choose a scale and origin so that every value fits, with the origin kept
 * inside the frame when the data only occupies one quadrant.
 */
export function fitView(values: Cx[], vp: Viewport, padding = 0.15): View {
  const pts: Cx[] = [{ re: 0, im: 0 }, ...values.filter(isFiniteCx)]
  let minRe = Infinity
  let maxRe = -Infinity
  let minIm = Infinity
  let maxIm = -Infinity
  for (const p of pts) {
    minRe = Math.min(minRe, p.re)
    maxRe = Math.max(maxRe, p.re)
    minIm = Math.min(minIm, p.im)
    maxIm = Math.max(maxIm, p.im)
  }
  if (!Number.isFinite(minRe)) return { ox: vp.width / 2, oy: vp.height / 2, scale: 40 }

  // the origin is always in `pts`, so "no data" is not "no points" - it is
  // "no extent"
  const degenerate = Math.max(maxRe - minRe, maxIm - minIm) < 1e-9
  const spanRe = degenerate ? DEFAULT_SPAN : Math.max(maxRe - minRe, 1e-9)
  const spanIm = degenerate ? DEFAULT_SPAN : Math.max(maxIm - minIm, 1e-9)
  const usableW = vp.width * (1 - 2 * padding)
  const usableH = vp.height * (1 - 2 * padding)
  const scale = Math.max(1e-6, Math.min(usableW / spanRe, usableH / spanIm))

  const centerRe = (minRe + maxRe) / 2
  const centerIm = (minIm + maxIm) / 2
  return {
    ox: vp.width / 2 - centerRe * scale,
    oy: vp.height / 2 + centerIm * scale,
    scale,
  }
}

function isFiniteCx(p: Cx): boolean {
  return Number.isFinite(p.re) && Number.isFinite(p.im)
}

/** A "nice" grid step (1, 2, 5 x 10^n) close to the requested world span. */
export function niceStep(span: number, targetTicks = 8): number {
  if (!Number.isFinite(span) || span <= 0) return 1
  const raw = span / Math.max(1, targetTicks)
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const stepChoice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return stepChoice * mag
}

export interface GridLine {
  /** screen coordinate of the line */
  pos: number
  /** world value it corresponds to */
  value: number
  /** true for the axis itself (value 0) */
  major: boolean
}

export function gridLines(view: View, vp: Viewport, targetTicks = 8): { vertical: GridLine[]; horizontal: GridLine[]; step: number } {
  const left = screenToWorld(view, 0, 0).re
  const right = screenToWorld(view, vp.width, 0).re
  const top = screenToWorld(view, 0, 0).im
  const bottom = screenToWorld(view, 0, vp.height).im

  const stepX = niceStep(right - left, targetTicks)
  const stepY = niceStep(top - bottom, targetTicks)

  const vertical: GridLine[] = []
  const startX = Math.ceil(left / stepX) * stepX
  for (let v = startX; v <= right + 1e-9; v += stepX) {
    vertical.push({ pos: worldToScreen(view, { re: v, im: 0 }).x, value: round(v), major: Math.abs(v) < stepX / 2 })
  }
  const horizontal: GridLine[] = []
  const startY = Math.ceil(bottom / stepY) * stepY
  for (let v = startY; v <= top + 1e-9; v += stepY) {
    horizontal.push({ pos: worldToScreen(view, { re: 0, im: v }).y, value: round(v), major: Math.abs(v) < stepY / 2 })
  }
  return { vertical, horizontal, step: Math.min(stepX, stepY) }
}

function round(x: number): number {
  return Number(x.toPrecision(12))
}

// ------------------------------------------------------------------ hit test

export interface Hittable {
  id: number
  value: Cx | null
  visible: boolean
}

/** Returns the id of the visible phasor whose tip is nearest the click. */
export function hitTest(items: Hittable[], view: View, px: number, py: number, radius = 12): number | undefined {
  let best: number | undefined
  let bestDist = radius
  for (const it of items) {
    if (!it.visible || !it.value) continue
    const tip = worldToScreen(view, it.value)
    const d = Math.hypot(tip.x - px, tip.y - py)
    if (d <= bestDist) { bestDist = d; best = it.id }
  }
  return best
}

/** Which phasor should the pointer be editing while hovering? */
export function cursorTip(items: Hittable[], view: View, px: number, py: number, radius = 12): boolean {
  return hitTest(items, view, px, py, radius) !== undefined
}

// ------------------------------------------------------------------- arcs

/**
 * Points along an arc from angle a0 to a1 (radians, CCW positive, screen
 * coordinates). Used for the phase-angle marker.
 */
export function arcPoints(center: Point, radius: number, a0: number, a1: number): Point[] {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 24)) + 1)
  const out: Point[] = []
  for (let i = 0; i <= n; i++) {
    const t = a0 + ((a1 - a0) * i) / n
    out.push({ x: center.x + radius * Math.cos(t), y: center.y - radius * Math.sin(t) })
  }
  return out
}

/** The polyline for the tip-to-tail (KVL / KCL) construction. */
export function sumPolygon(values: Cx[], closed = true): Point[] {
  let acc: Cx = { re: 0, im: 0 }
  const pts: Point[] = [{ x: 0, y: 0 }]
  for (const v of values) {
    acc = { re: acc.re + v.re, im: acc.im + v.im }
    pts.push({ x: acc.re, y: acc.im })
  }
  if (closed && pts.length > 2) pts.push({ x: 0, y: 0 })
  return pts
}

export function sumOf(values: Cx[]): Cx {
  return values.reduce<Cx>((a, v) => ({ re: a.re + v.re, im: a.im + v.im }), { re: 0, im: 0 })
}

// ------------------------------------------------------------------ dragging

export type DragMode = 'free' | 'angle' | 'magnitude' | 'snap15'

/** Turn a drag position into the new phasor value, honouring the drag mode. */
export function dragPhasor(original: Cx, target: Cx, mode: DragMode): Cx {
  const r0 = Math.hypot(original.re, original.im)
  const a0 = Math.atan2(original.im, original.re)
  const r1 = Math.hypot(target.re, target.im)
  switch (mode) {
    case 'angle': {
      const a = r1 < 1e-12 ? a0 : Math.atan2(target.im, target.re)
      return { re: r0 * Math.cos(a), im: r0 * Math.sin(a) }
    }
    case 'magnitude': {
      return { re: r1 * Math.cos(a0), im: r1 * Math.sin(a0) }
    }
    case 'snap15': {
      const a = snapAngle(Math.atan2(target.im, target.re), Math.PI / 12)
      return { re: r1 * Math.cos(a), im: r1 * Math.sin(a) }
    }
    default:
      return { re: target.re, im: target.im }
  }
}

/** Round an angle to the nearest multiple of `step` radians. */
export function snapAngle(angle: number, step: number): number {
  if (step <= 0) return angle
  return Math.round(angle / step) * step
}

/** Angle in [0, 2pi) - what the arc from the +re axis should sweep. */
export function normalizedAngle(angle: number): number {
  const twoPi = Math.PI * 2
  return ((angle % twoPi) + twoPi) % twoPi
}
