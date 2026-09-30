/**
 * The graphics panel: owns the canvas, the view transform and all pointer
 * interaction (drag to edit, wheel to zoom, drag the background to pan).
 *
 * It never mutates the session directly - it reports committed edits through
 * callbacks, so the algebra view stays the single source of truth.
 */

import type { Cx } from '../core/types'
import {
  dragPhasor,
  fitView,
  hitTest,
  screenToWorld,
  worldToScreen,
  type DragMode,
  type View,
  type Viewport,
} from './geometry'
import { draw, type DrawItem } from './renderer'

export interface PanelCallbacks {
  getItems: () => DrawItem[]
  getSelected: () => number | undefined
  onSelect: (id: number | undefined) => void
  /** called once per finished drag with the new value */
  onCommit: (id: number, value: Cx) => void
  formatTick: (v: number) => string
  angleLabel: (item: DrawItem, degrees: boolean) => string | undefined
  sumLabel: () => string
  isDegrees: () => boolean
}

export class PhasorPanel {
  showGrid = true
  showLabels = true
  showSum = false
  /** when true a plain drag snaps the angle to a multiple of 15 degrees */
  snap = false

  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly cb: PanelCallbacks
  private view: View = { ox: 0, oy: 0, scale: 40 }
  private viewport: Viewport = { width: 0, height: 0 }
  private dirty = true
  private frame = 0
  /** true until the user pans or zooms, so the view keeps auto-fitting */
  private autoFit = true
  private dragging: { id: number; start: Cx; current: Cx; mode: DragMode } | undefined
  private panning: { x: number; y: number; ox: number; oy: number; moved: boolean } | undefined

  constructor(canvas: HTMLCanvasElement, cb: PanelCallbacks) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d context unavailable')
    this.ctx = ctx
    this.cb = cb

    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('dblclick', () => { this.autoFit = true; this.fit(); })
    canvas.addEventListener('pointerleave', () => { canvas.style.cursor = 'default' })
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  /** Match the backing store to the CSS size and the device pixel ratio. */
  resize(): void {
    const rect = this.canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, Math.round(rect.width))
    const h = Math.max(1, Math.round(rect.height))
    this.viewport = { width: w, height: h }
    this.canvas.width = Math.round(w * dpr)
    this.canvas.height = Math.round(h * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (this.autoFit || this.view.scale <= 0) this.fitNow()
    this.invalidate()
  }

  fit(): void {
    this.autoFit = true
    this.fitNow()
    this.invalidate()
  }

  zoomBy(k: number, centerX?: number, centerY?: number): void {
    const cx = centerX ?? this.viewport.width / 2
    const cy = centerY ?? this.viewport.height / 2
    const before = screenToWorld(this.view, cx, cy)
    const scale = clamp(this.view.scale * k, 1e-4, 1e9)
    this.view = { ...this.view, scale }
    const after = screenToWorld(this.view, cx, cy)
    this.view = {
      ...this.view,
      ox: this.view.ox + (after.re - before.re) * scale,
      oy: this.view.oy - (after.im - before.im) * scale,
    }
    this.autoFit = false
    this.invalidate()
  }

  /** Keep the data in frame; used when the object list changes. */
  refit(): void {
    if (this.autoFit) this.fitNow()
    this.invalidate()
  }

  invalidate(): void {
    this.dirty = true
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      if (this.dirty) {
        this.dirty = false
        this.render()
      }
    })
  }

  render(): void {
    const items = this.cb.getItems()
    draw(this.ctx, {
      view: this.view,
      viewport: this.viewport,
      items: this.overridden(items),
      selectedId: this.cb.getSelected(),
      showGrid: this.showGrid,
      showLabels: this.showLabels,
      showSum: this.showSum,
      formatTick: this.cb.formatTick,
      angleLabel: this.cb.angleLabel,
      degrees: this.cb.isDegrees(),
      sumLabel: this.cb.sumLabel(),
    })
  }

  toPNG(): string {
    return this.canvas.toDataURL('image/png')
  }

  get scale(): number {
    return this.view.scale
  }

  // ---------------------------------------------------------------- private

  private fitNow(): void {
    if (this.viewport.width < 2) return
    const values = this.cb.getItems().filter((i) => i.visible && i.value).map((i) => i.value as Cx)
    this.view = fitView(values, this.viewport)
  }

  /** While dragging, draw the in-progress value instead of the stored one. */
  private overridden(items: DrawItem[]): DrawItem[] {
    if (!this.dragging) return items
    const { id, current } = this.dragging
    return items.map((i) => (i.id === id ? { ...i, value: current } : i))
  }

  private localPoint(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.button !== 1) return
    const p = this.localPoint(e)
    const items = this.cb.getItems()
    const id = hitTest(items, this.view, p.x, p.y)
    this.canvas.setPointerCapture(e.pointerId)

    if (id !== undefined) {
      const item = items.find((i) => i.id === id)
      if (!item || !item.value) return
      const mode = dragModeFor(e, this.snap)
      this.dragging = { id, start: item.value, current: item.value, mode }
      this.cb.onSelect(id)
      this.invalidate()
      return
    }
    this.panning = { x: p.x, y: p.y, ox: this.view.ox, oy: this.view.oy, moved: false }
  }

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.localPoint(e)
    if (this.dragging) {
      const world = screenToWorld(this.view, p.x, p.y)
      this.dragging = { ...this.dragging, current: dragPhasor(this.dragging.start, world, this.dragging.mode) }
      this.invalidate()
      return
    }
    if (this.panning) {
      const dx = p.x - this.panning.x
      const dy = p.y - this.panning.y
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this.panning.moved = true
      this.view = { ...this.view, ox: this.panning.ox + dx, oy: this.panning.oy + dy }
      this.autoFit = false
      this.invalidate()
      return
    }
    // hover feedback
    const items = this.cb.getItems()
    const over = hitTest(items, this.view, p.x, p.y) !== undefined
    this.canvas.style.cursor = over ? 'grab' : 'crosshair'
  }

  private onPointerUp = (e: PointerEvent): void => {
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId)

    if (this.dragging) {
      const { id, current, start } = this.dragging
      this.dragging = undefined
      if (Math.abs(current.re - start.re) > 1e-12 || Math.abs(current.im - start.im) > 1e-12) {
        this.cb.onCommit(id, current)
      }
      this.invalidate()
      return
    }
    if (this.panning) {
      const moved = this.panning.moved
      this.panning = undefined
      if (!moved) this.cb.onSelect(undefined)
      this.invalidate()
    }
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    const p = this.localPoint(e as unknown as PointerEvent)
    const k = Math.pow(1.0015, -e.deltaY)
    this.zoomBy(k, p.x, p.y)
  }
}

/** Shift keeps the magnitude, Alt keeps the angle, the snap toggle rounds it. */
function dragModeFor(e: PointerEvent, snap: boolean): DragMode {
  if (e.shiftKey) return 'angle'
  if (e.altKey) return 'magnitude'
  return snap ? 'snap15' : 'free'
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}

export { worldToScreen }
