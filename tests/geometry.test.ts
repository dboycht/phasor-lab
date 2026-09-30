import { describe, it, expect } from 'vitest'
import {
  arcPoints,
  dragPhasor,
  fitView,
  gridLines,
  hitTest,
  niceStep,
  normalizedAngle,
  screenToWorld,
  snapAngle,
  sumOf,
  sumPolygon,
  worldToScreen,
  type View,
} from '../src/plot/geometry'

const VP = { width: 400, height: 300 }

describe('geometry: view transform', () => {
  const view: View = { ox: 200, oy: 150, scale: 2 }

  it('maps the origin to the origin', () => {
    expect(worldToScreen(view, { re: 0, im: 0 })).toEqual({ x: 200, y: 150 })
  })

  it('flips the imaginary axis because screen y points down', () => {
    expect(worldToScreen(view, { re: 10, im: 0 })).toEqual({ x: 220, y: 150 })
    expect(worldToScreen(view, { re: 0, im: 10 })).toEqual({ x: 200, y: 130 })
  })

  it('round trips through screenToWorld', () => {
    const p = { re: 3.5, im: -7.25 }
    const s = worldToScreen(view, p)
    const back = screenToWorld(view, s.x, s.y)
    expect(back.re).toBeCloseTo(p.re, 10)
    expect(back.im).toBeCloseTo(p.im, 10)
  })

  it('fits a set of phasors inside the frame', () => {
    const v = fitView([{ re: 220, im: 0 }, { re: 0, im: 110 }], VP)
    for (const p of [{ re: 220, im: 0 }, { re: 0, im: 110 }, { re: 0, im: 0 }]) {
      const s = worldToScreen(v, p)
      expect(s.x).toBeGreaterThanOrEqual(0)
      expect(s.x).toBeLessThanOrEqual(VP.width)
      expect(s.y).toBeGreaterThanOrEqual(0)
      expect(s.y).toBeLessThanOrEqual(VP.height)
    }
  })

  it('keeps the origin visible when the data is far away', () => {
    const v = fitView([{ re: 1000, im: 1000 }], VP)
    const origin = worldToScreen(v, { re: 0, im: 0 })
    expect(origin.x).toBeGreaterThanOrEqual(0)
    expect(origin.x).toBeLessThanOrEqual(VP.width)
    expect(origin.y).toBeGreaterThanOrEqual(0)
    expect(origin.y).toBeLessThanOrEqual(VP.height)
  })

  it('handles an empty data set', () => {
    const v = fitView([], VP)
    expect(Number.isFinite(v.scale)).toBe(true)
    expect(v.scale).toBeGreaterThan(0)
  })
})

describe('geometry: grid', () => {
  it('picks 1-2-5 steps', () => {
    expect(niceStep(10, 10)).toBe(1)
    expect(niceStep(100, 10)).toBe(10)
    expect(niceStep(1000, 10)).toBe(100)
    expect(niceStep(0, 10)).toBe(1)
  })

  it('produces lines that map back to their world value', () => {
    const v = fitView([{ re: 100, im: 50 }], VP)
    const g = gridLines(v, VP)
    expect(g.vertical.length).toBeGreaterThan(2)
    for (const line of g.vertical) {
      const world = screenToWorld(v, line.pos, 0).re
      expect(Math.abs(world - line.value)).toBeLessThan(1e-6)
    }
    for (const line of g.horizontal) {
      const world = screenToWorld(v, 0, line.pos).im
      expect(Math.abs(world - line.value)).toBeLessThan(1e-6)
    }
  })

  it('marks the axis line', () => {
    const v = fitView([{ re: 10, im: 10 }], VP)
    const g = gridLines(v, VP)
    expect(g.vertical.some((l) => l.major)).toBe(true)
    expect(g.horizontal.some((l) => l.major)).toBe(true)
  })
})

describe('geometry: hit testing', () => {
  const view: View = { ox: 200, oy: 150, scale: 2 }
  const items = [
    { id: 1, value: { re: 50, im: 0 }, visible: true },
    { id: 2, value: { re: 0, im: 50 }, visible: true },
    { id: 3, value: { re: -50, im: 0 }, visible: false },
  ]

  it('finds the phasor whose tip is under the pointer', () => {
    const tip = worldToScreen(view, { re: 50, im: 0 })
    expect(hitTest(items, view, tip.x, tip.y)).toBe(1)
  })

  it('ignores hidden phasors', () => {
    const tip = worldToScreen(view, { re: -50, im: 0 })
    expect(hitTest(items, view, tip.x, tip.y)).toBeUndefined()
  })

  it('returns nothing when the pointer is far away', () => {
    expect(hitTest(items, view, 5, 5)).toBeUndefined()
  })

  it('prefers the nearest tip', () => {
    const near = { id: 9, value: { re: 50, im: 0 }, visible: true }
    const tip = worldToScreen(view, { re: 50, im: 0 })
    expect(hitTest([...items, near], view, tip.x, tip.y)).toBe(9)
  })
})

describe('geometry: arcs and polygons', () => {
  it('sweeps an arc counter-clockwise in screen space', () => {
    const pts = arcPoints({ x: 0, y: 0 }, 10, 0, Math.PI / 2)
    expect(pts[0]!.x).toBeCloseTo(10, 10)
    expect(pts[0]!.y).toBeCloseTo(0, 10)
    const last = pts[pts.length - 1]!
    expect(last.x).toBeCloseTo(0, 10)
    expect(last.y).toBeCloseTo(-10, 10)
  })

  it('builds a tip-to-tail polygon that closes on the resultant', () => {
    const poly = sumPolygon([{ re: 3, im: 0 }, { re: 0, im: 4 }])
    expect(poly[0]).toEqual({ x: 0, y: 0 })
    expect(poly[1]).toEqual({ x: 3, y: 0 })
    expect(poly[2]).toEqual({ x: 3, y: 4 })
    expect(poly[3]).toEqual({ x: 0, y: 0 })
  })

  it('sums vectors', () => {
    expect(sumOf([{ re: 1, im: 2 }, { re: 3, im: -4 }])).toEqual({ re: 4, im: -2 })
    expect(sumOf([])).toEqual({ re: 0, im: 0 })
  })
})

describe('geometry: dragging', () => {
  const original = { re: 100, im: 0 }

  it('free drag follows the pointer', () => {
    expect(dragPhasor(original, { re: 10, im: 20 }, 'free')).toEqual({ re: 10, im: 20 })
  })

  it('angle mode keeps the magnitude', () => {
    const v = dragPhasor(original, { re: 30, im: 40 }, 'angle')
    expect(Math.hypot(v.re, v.im)).toBeCloseTo(100, 9)
    expect(Math.atan2(v.im, v.re)).toBeCloseTo(Math.atan2(40, 30), 9)
  })

  it('magnitude mode keeps the angle', () => {
    const v = dragPhasor(original, { re: 30, im: 40 }, 'magnitude')
    expect(Math.hypot(v.re, v.im)).toBeCloseTo(50, 9)
    expect(Math.atan2(v.im, v.re)).toBeCloseTo(0, 9)
  })

  it('snap mode lands on a multiple of 15 degrees', () => {
    const v = dragPhasor(original, { re: 10, im: 10 }, 'snap15')
    const deg = (Math.atan2(v.im, v.re) * 180) / Math.PI
    expect(Math.abs(deg - 45)).toBeLessThan(1e-9)
  })

  it('snaps angles on request', () => {
    expect(snapAngle(0.1, Math.PI / 12)).toBeCloseTo(0, 10)
    expect(snapAngle(0.3, Math.PI / 12)).toBeCloseTo(Math.PI / 12, 10)
  })

  it('normalises angles into [0, 2pi)', () => {
    expect(normalizedAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 10)
    expect(normalizedAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 10)
  })
})
