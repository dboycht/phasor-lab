/**
 * Renderer for the phasor diagram. Drawing only - no state, no events.
 *
 * Every visual decision lives here once: `draw()` pushes it into a canvas
 * surface and `drawToSvg()` into an SVG surface, so the on-screen picture and
 * the exported vector file cannot drift apart.
 */

import type { Cx } from '../core/types'
import { arcPoints, gridLines, normalizedAngle, worldToScreen, type View, type Viewport } from './geometry'
import { canvasSurface, svgSurface, type Measure, type Surface } from './surface'

export interface DrawItem {
  id: number
  value: Cx | null
  visible: boolean
  color: string
  label: string
}

export interface DrawState {
  view: View
  viewport: Viewport
  items: DrawItem[]
  selectedId?: number
  showGrid: boolean
  showLabels: boolean
  showSum: boolean
  /** decimal separator / digit rendering comes from the caller */
  formatTick: (v: number) => string
  /** arc text, already localised, or undefined to hide it */
  angleLabel?: (item: DrawItem, degrees: boolean) => string | undefined
  degrees: boolean
  sumLabel?: string
}

const COLORS = {
  background: '#ffffff',
  grid: '#e9eef7',
  gridMajor: '#d5deee',
  axis: '#9aa8bd',
  text: '#41506b',
  tick: '#7b8aa3',
  sum: '#7c3aed',
}

/** Alpha of the white plate drawn behind a label, matching the old canvas code. */
const LABEL_BACKDROP_ALPHA = 0.82
/** Alpha of the selection marker dot and of the phase-angle arc. */
const SELECTION_DOT_ALPHA = 0.9
const SELECTION_ARC_ALPHA = 0.75
const ANGLE_LABEL_BACKDROP_ALPHA = 0.85

/**
 * Draw on a canvas. `background: null` leaves the canvas transparent (used by
 * the "transparent PNG" export); omitted means the usual white page.
 */
export function draw(
  ctx: CanvasRenderingContext2D,
  st: DrawState,
  background: string | null | undefined = COLORS.background,
): void {
  const s = canvasSurface(ctx, st.viewport.width, st.viewport.height)
  paint(s, st, background === undefined ? COLORS.background : background)
}

export interface SvgOptions {
  /** defaults to the state viewport */
  width?: number
  height?: number
  /** text metrics; the default is a deterministic estimate */
  measure?: Measure
  /** null = transparent (no background rect); defaults to white like the canvas */
  background?: string | null
}

export function drawToSvg(st: DrawState, opts: SvgOptions = {}): string {
  const width = opts.width ?? st.viewport.width
  const height = opts.height ?? st.viewport.height
  const s = svgSurface(width, height, opts.measure)
  paint(s, st, opts.background === undefined ? COLORS.background : opts.background)
  return s.toSvg()
}

/** The single copy of the drawing logic, shared by every surface back end. */
function paint(s: Surface, st: DrawState, background: string | null): void {
  s.save()
  if (background !== null) s.clear(background)

  if (st.showGrid) drawGrid(s, st)
  drawAxes(s, st)

  const visible = st.items.filter((i) => i.visible && i.value)
  if (st.showSum && visible.length > 1) drawSumPolygon(s, st, visible)

  for (const item of visible) drawPhasor(s, st, item)

  if (st.selectedId !== undefined) {
    const sel = visible.find((i) => i.id === st.selectedId)
    if (sel && sel.value) drawSelection(s, st, sel)
  }
  s.restore()
}

function drawGrid(s: Surface, st: DrawState): void {
  const g = gridLines(st.view, st.viewport)
  s.save()
  const gridColor = (major: boolean): string => (major ? COLORS.gridMajor : COLORS.grid)
  for (const line of g.vertical) {
    const x = Math.round(line.pos) + 0.5
    line1(s, gridColor(line.major), 1, x, 0, x, st.viewport.height)
  }
  for (const line of g.horizontal) {
    const y = Math.round(line.pos) + 0.5
    line1(s, gridColor(line.major), 1, 0, y, st.viewport.width, y)
  }
  // tick labels along the two axes
  const axisY = clamp(st.view.oy, 12, st.viewport.height - 18)
  for (const line of g.vertical) {
    if (line.major) continue
    s.text(st.formatTick(line.value), line.pos, axisY + 3, {
      size: 11,
      color: COLORS.tick,
      align: 'center',
      baseline: 'top',
    })
  }
  const axisX = clamp(st.view.ox, 26, st.viewport.width - 6)
  for (const line of g.horizontal) {
    if (line.major) continue
    s.text(st.formatTick(line.value), axisX - 5, line.pos, {
      size: 11,
      color: COLORS.tick,
      align: 'right',
      baseline: 'middle',
    })
  }
  s.restore()
}

function drawAxes(s: Surface, st: DrawState): void {
  const { view, viewport } = st
  s.save()
  const y = Math.round(clamp(view.oy, 0, viewport.height)) + 0.5
  const x = Math.round(clamp(view.ox, 0, viewport.width)) + 0.5
  if (view.oy >= 0 && view.oy <= viewport.height) line1(s, COLORS.axis, 1.25, 0, y, viewport.width, y)
  if (view.ox >= 0 && view.ox <= viewport.width) line1(s, COLORS.axis, 1.25, x, 0, x, viewport.height)
  s.restore()
}

function drawPhasor(s: Surface, st: DrawState, item: DrawItem): void {
  const tip = worldToScreen(st.view, item.value as Cx)
  const origin = worldToScreen(st.view, { re: 0, im: 0 })
  const selected = item.id === st.selectedId

  s.save()
  const width = selected ? 3 : 2

  const dx = tip.x - origin.x
  const dy = tip.y - origin.y
  const len = Math.hypot(dx, dy)
  if (len < 0.5) {
    // a phasor of zero is just a dot
    s.beginPath()
    s.arc(origin.x, origin.y, 3.5)
    s.fill(item.color)
    s.restore()
    return
  }

  const head = Math.min(12, Math.max(7, len * 0.22))
  const ux = dx / len
  const uy = dy / len
  const baseX = tip.x - ux * head
  const baseY = tip.y - uy * head

  line1(s, item.color, width, origin.x, origin.y, baseX, baseY)

  s.beginPath()
  s.moveTo(tip.x, tip.y)
  s.lineTo(baseX - uy * head * 0.34, baseY + ux * head * 0.34)
  s.lineTo(baseX + uy * head * 0.34, baseY - ux * head * 0.34)
  s.closePath()
  s.fill(item.color)

  if (selected) {
    s.beginPath()
    s.arc(tip.x, tip.y, 4.5, SELECTION_DOT_ALPHA)
    s.fill(item.color)
  }

  if (st.showLabels) {
    const pad = 7
    const anchorX = tip.x + ux * pad + 2
    const anchorY = tip.y - uy * pad - 2
    const boxW = s.measure(item.label, 12, selected) + 6
    const boxH = 15
    const left = ux >= 0 ? anchorX : anchorX - boxW
    s.fillRect(left - 2, anchorY - boxH / 2, boxW, boxH, '#ffffff', LABEL_BACKDROP_ALPHA)
    s.text(item.label, left + 1, anchorY, {
      size: 12,
      color: item.color,
      align: 'left',
      baseline: 'middle',
      bold: selected,
    })
  }
  s.restore()
}

function drawSelection(s: Surface, st: DrawState, item: DrawItem): void {
  const v = item.value as Cx
  const origin = worldToScreen(st.view, { re: 0, im: 0 })
  const tip = worldToScreen(st.view, v)
  const r = Math.hypot(tip.x - origin.x, tip.y - origin.y)
  const arcR = Math.min(Math.max(26, r * 0.32), r * 0.85)
  if (arcR < 8) return

  const end = Math.atan2(v.im, v.re)
  const sweepFrom = 0
  // always sweep the short way round from the +re axis
  const sweepTo = normalizedAngle(end) > Math.PI ? normalizedAngle(end) - Math.PI * 2 : normalizedAngle(end)
  const pts = arcPoints(origin, arcR, sweepFrom, sweepTo)

  s.save()
  s.beginPath()
  pts.forEach((p, i) => (i === 0 ? s.moveTo(p.x, p.y) : s.lineTo(p.x, p.y)))
  s.stroke(item.color, 1.5, [4, 3], SELECTION_ARC_ALPHA)

  const text = st.angleLabel?.(item, st.degrees)
  if (text) {
    const mid = pts[Math.floor(pts.length / 2)] as { x: number; y: number }
    const outward = { x: (mid.x - origin.x) / arcR, y: (mid.y - origin.y) / arcR }
    const tx = mid.x + outward.x * 16
    const ty = mid.y + outward.y * 12
    const w = s.measure(text, 11, false)
    s.fillRect(tx - w / 2 - 3, ty - 8, w + 6, 16, '#ffffff', ANGLE_LABEL_BACKDROP_ALPHA)
    s.text(text, tx, ty, { size: 11, color: item.color, align: 'center', baseline: 'middle' })
  }
  s.restore()
}

function drawSumPolygon(s: Surface, st: DrawState, items: DrawItem[]): void {
  s.save()
  s.beginPath()
  let acc: Cx = { re: 0, im: 0 }
  const origin = worldToScreen(st.view, acc)
  s.moveTo(origin.x, origin.y)
  for (const item of items) {
    const v = item.value as Cx
    acc = { re: acc.re + v.re, im: acc.im + v.im }
    const p = worldToScreen(st.view, acc)
    s.lineTo(p.x, p.y)
  }
  s.stroke(COLORS.sum, 1.5, [6, 4])

  // the resultant
  const start = worldToScreen(st.view, { re: 0, im: 0 })
  const end = worldToScreen(st.view, acc)
  line1(s, COLORS.sum, 2.5, start.x, start.y, end.x, end.y)

  if (st.showLabels && st.sumLabel) {
    s.text(st.sumLabel, end.x + 8, end.y - 8, {
      size: 12,
      color: COLORS.sum,
      align: 'left',
      baseline: 'middle',
      bold: true,
    })
  }
  s.restore()
}

// ------------------------------------------------------------------ helpers

function line1(s: Surface, color: string, width: number, x0: number, y0: number, x1: number, y1: number): void {
  s.beginPath()
  s.moveTo(x0, y0)
  s.lineTo(x1, y1)
  s.stroke(color, width)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}
