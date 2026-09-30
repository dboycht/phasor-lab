/**
 * Canvas renderer for the phasor diagram. Drawing only - no state, no events.
 */

import type { Cx } from '../core/types'
import { arcPoints, gridLines, normalizedAngle, worldToScreen, type View, type Viewport } from './geometry'

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

export function draw(ctx: CanvasRenderingContext2D, st: DrawState): void {
  const { viewport } = st
  ctx.save()
  ctx.clearRect(0, 0, viewport.width, viewport.height)
  ctx.fillStyle = COLORS.background
  ctx.fillRect(0, 0, viewport.width, viewport.height)

  if (st.showGrid) drawGrid(ctx, st)
  drawAxes(ctx, st)

  const visible = st.items.filter((i) => i.visible && i.value)
  if (st.showSum && visible.length > 1) drawSumPolygon(ctx, st, visible)

  for (const item of visible) drawPhasor(ctx, st, item)

  if (st.selectedId !== undefined) {
    const sel = visible.find((i) => i.id === st.selectedId)
    if (sel && sel.value) drawSelection(ctx, st, sel)
  }
  ctx.restore()
}

function drawGrid(ctx: CanvasRenderingContext2D, st: DrawState): void {
  const g = gridLines(st.view, st.viewport)
  ctx.save()
  ctx.lineWidth = 1
  for (const line of g.vertical) {
    ctx.strokeStyle = line.major ? COLORS.gridMajor : COLORS.grid
    line1(ctx, Math.round(line.pos) + 0.5, 0, Math.round(line.pos) + 0.5, st.viewport.height)
  }
  for (const line of g.horizontal) {
    ctx.strokeStyle = line.major ? COLORS.gridMajor : COLORS.grid
    line1(ctx, 0, Math.round(line.pos) + 0.5, st.viewport.width, Math.round(line.pos) + 0.5)
  }
  // tick labels along the two axes
  ctx.fillStyle = COLORS.tick
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const axisY = clamp(st.view.oy, 12, st.viewport.height - 18)
  for (const line of g.vertical) {
    if (line.major) continue
    ctx.fillText(st.formatTick(line.value), line.pos, axisY + 3)
  }
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  const axisX = clamp(st.view.ox, 26, st.viewport.width - 6)
  for (const line of g.horizontal) {
    if (line.major) continue
    ctx.fillText(st.formatTick(line.value), axisX - 5, line.pos)
  }
  ctx.restore()
}

function drawAxes(ctx: CanvasRenderingContext2D, st: DrawState): void {
  const { view, viewport } = st
  ctx.save()
  ctx.strokeStyle = COLORS.axis
  ctx.lineWidth = 1.25
  const y = Math.round(clamp(view.oy, 0, viewport.height)) + 0.5
  const x = Math.round(clamp(view.ox, 0, viewport.width)) + 0.5
  if (view.oy >= 0 && view.oy <= viewport.height) line1(ctx, 0, y, viewport.width, y)
  if (view.ox >= 0 && view.ox <= viewport.width) line1(ctx, x, 0, x, viewport.height)
  ctx.restore()
}

function drawPhasor(ctx: CanvasRenderingContext2D, st: DrawState, item: DrawItem): void {
  const tip = worldToScreen(st.view, item.value as Cx)
  const origin = worldToScreen(st.view, { re: 0, im: 0 })
  const selected = item.id === st.selectedId

  ctx.save()
  ctx.strokeStyle = item.color
  ctx.fillStyle = item.color
  ctx.lineWidth = selected ? 3 : 2
  ctx.lineCap = 'round'

  const dx = tip.x - origin.x
  const dy = tip.y - origin.y
  const len = Math.hypot(dx, dy)
  if (len < 0.5) {
    // a phasor of zero is just a dot
    ctx.beginPath()
    ctx.arc(origin.x, origin.y, 3.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    return
  }

  const head = Math.min(12, Math.max(7, len * 0.22))
  const ux = dx / len
  const uy = dy / len
  const baseX = tip.x - ux * head
  const baseY = tip.y - uy * head

  line1(ctx, origin.x, origin.y, baseX, baseY)

  ctx.beginPath()
  ctx.moveTo(tip.x, tip.y)
  ctx.lineTo(baseX - uy * head * 0.34, baseY + ux * head * 0.34)
  ctx.lineTo(baseX + uy * head * 0.34, baseY - ux * head * 0.34)
  ctx.closePath()
  ctx.fill()

  if (selected) {
    ctx.globalAlpha = 0.9
    ctx.beginPath()
    ctx.arc(tip.x, tip.y, 4.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  if (st.showLabels) {
    ctx.font = `${selected ? 'bold ' : ''}12px ui-sans-serif, system-ui, sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const pad = 7
    const anchorX = tip.x + ux * pad + 2
    const anchorY = tip.y - uy * pad - 2
    const metrics = ctx.measureText(item.label)
    const boxW = metrics.width + 6
    const boxH = 15
    const left = ux >= 0 ? anchorX : anchorX - boxW
    ctx.globalAlpha = 0.82
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(left - 2, anchorY - boxH / 2, boxW, boxH)
    ctx.globalAlpha = 1
    ctx.fillStyle = item.color
    ctx.fillText(item.label, left + 1, anchorY)
  }
  ctx.restore()
}

function drawSelection(ctx: CanvasRenderingContext2D, st: DrawState, item: DrawItem): void {
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

  ctx.save()
  ctx.strokeStyle = item.color
  ctx.globalAlpha = 0.75
  ctx.lineWidth = 1.5
  ctx.setLineDash([4, 3])
  ctx.beginPath()
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.stroke()
  ctx.setLineDash([])

  const text = st.angleLabel?.(item, st.degrees)
  if (text) {
    const mid = pts[Math.floor(pts.length / 2)] as { x: number; y: number }
    const outward = { x: (mid.x - origin.x) / arcR, y: (mid.y - origin.y) / arcR }
    ctx.globalAlpha = 1
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
    ctx.fillStyle = item.color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const tx = mid.x + outward.x * 16
    const ty = mid.y + outward.y * 12
    const w = ctx.measureText(text).width
    ctx.globalAlpha = 0.85
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(tx - w / 2 - 3, ty - 8, w + 6, 16)
    ctx.globalAlpha = 1
    ctx.fillStyle = item.color
    ctx.fillText(text, tx, ty)
  }
  ctx.restore()
}

function drawSumPolygon(ctx: CanvasRenderingContext2D, st: DrawState, items: DrawItem[]): void {
  ctx.save()
  ctx.strokeStyle = COLORS.sum
  ctx.fillStyle = COLORS.sum
  ctx.lineWidth = 1.5
  ctx.setLineDash([6, 4])
  ctx.beginPath()
  let acc: Cx = { re: 0, im: 0 }
  const origin = worldToScreen(st.view, acc)
  ctx.moveTo(origin.x, origin.y)
  for (const item of items) {
    const v = item.value as Cx
    acc = { re: acc.re + v.re, im: acc.im + v.im }
    const p = worldToScreen(st.view, acc)
    ctx.lineTo(p.x, p.y)
  }
  ctx.stroke()
  ctx.setLineDash([])

  // the resultant
  const start = worldToScreen(st.view, { re: 0, im: 0 })
  const end = worldToScreen(st.view, acc)
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(end.x, end.y)
  ctx.stroke()

  if (st.showLabels && st.sumLabel) {
    ctx.font = 'bold 12px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(st.sumLabel, end.x + 8, end.y - 8)
  }
  ctx.restore()
}

// ------------------------------------------------------------------ helpers

function line1(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
  ctx.stroke()
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}
