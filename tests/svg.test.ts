import { describe, it, expect } from 'vitest'
import { draw, drawToSvg, type DrawItem, type DrawState } from '../src/plot/renderer'
import { canvasSurface, svgSurface, FONT_STACK } from '../src/plot/surface'
import { worldToScreen, type View } from '../src/plot/geometry'

const VIEW: View = { ox: 200, oy: 150, scale: 2 }
const VP = { width: 400, height: 300 }

/** The test states are real phasors: a 10+0j item, a 0+10j item and a hidden one. */
const ITEMS: DrawItem[] = [
  { id: 1, value: { re: 10, im: 0 }, visible: true, color: '#2563eb', label: 'U1' },
  { id: 2, value: { re: 0, im: 10 }, visible: true, color: '#dc2626', label: 'U2' },
  { id: 3, value: { re: -5, im: -5 }, visible: false, color: '#059669', label: 'U3' },
]

function state(over: Partial<DrawState> = {}): DrawState {
  return {
    view: VIEW,
    viewport: VP,
    items: ITEMS,
    showGrid: false,
    showLabels: false,
    showSum: false,
    formatTick: (v) => String(v),
    degrees: true,
    ...over,
  }
}

const svg = (over: Partial<DrawState> = {}, opts?: Parameters<typeof drawToSvg>[1]): string =>
  drawToSvg(state(over), opts)

/** `points="a b c d"` -> numbers, so geometry can be asserted without parsing XML. */
function nums(points: string | undefined): number[] {
  return (points ?? '').trim().split(/\s+/).map(Number)
}

// ---------------------------------------------------------------- fake canvas

interface FakeCall {
  fn: string
  args: unknown[]
}

/**
 * Minimal stand-in for CanvasRenderingContext2D. It records every method call
 * and property assignment in order, so the canvas surface can be tested for
 * what it *asks the canvas* to do without a DOM.
 */
function fakeCtx(): { ctx: CanvasRenderingContext2D; calls: FakeCall[] } {
  const calls: FakeCall[] = []
  const record =
    (fn: string) =>
    (...args: unknown[]): void => {
      calls.push({ fn, args })
    }
  const target = {
    clearRect: record('clearRect'),
    fillRect: record('fillRect'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    closePath: record('closePath'),
    arc: record('arc'),
    stroke: record('stroke'),
    fill: record('fill'),
    fillText: record('fillText'),
    setLineDash: record('setLineDash'),
    measureText: (text: string): TextMetrics => ({ width: text.length * 6 }) as TextMetrics,
    save: record('save'),
    restore: record('restore'),
  }
  const ctx = new Proxy(target, {
    get: (t, prop, recv) => {
      if (typeof prop === 'symbol' || prop in t) return Reflect.get(t, prop, recv)
      // any other member is a method we do not model: record the call and move on
      return (...args: unknown[]) => {
        calls.push({ fn: String(prop), args })
      }
    },
    set: (t, prop, value) => {
      if (typeof prop === 'string') calls.push({ fn: `set:${prop}`, args: [value] })
      return Reflect.set(t, prop, value)
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

/** The property values the canvas still holds at the end of the run. */
function lastSet(calls: FakeCall[], prop: string): unknown {
  const hit = [...calls].reverse().find((c) => c.fn === `set:${prop}`)
  return hit?.args[0]
}

function callsOf(calls: FakeCall[], fn: string): FakeCall[] {
  return calls.filter((c) => c.fn === fn)
}

// -------------------------------------------------------------------- tests

describe('svg surface: document shell', () => {
  it('emits a self-contained svg with the requested size and viewBox', () => {
    const out = svg({}, { width: 640, height: 480 })
    expect(out.startsWith('<svg')).toBe(true)
    expect(out.endsWith('</svg>')).toBe(true)
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(out).toContain('width="640"')
    expect(out).toContain('height="480"')
    expect(out).toContain('viewBox="0 0 640 480"')
    // exactly one root element: save()/restore() must not unbalance the XML
    expect(out.match(/<svg/g)).toHaveLength(1)
    expect(out.match(/<\/svg>/g)).toHaveLength(1)
  })

  it('defaults the size to the state viewport', () => {
    expect(svg()).toContain('viewBox="0 0 400 300"')
  })
})

describe('svg surface: phasors', () => {
  it('draws one arrow per visible item, in the item colour', () => {
    const out = svg()
    for (const color of ['#2563eb', '#dc2626']) {
      expect(out).toContain(`stroke="${color}"`)
      expect(out).toContain(`fill="${color}"`)
    }
    expect(out).not.toContain('#059669')
  })

  it('maps every arrow tip onto worldToScreen', () => {
    const out = svg()
    // the arrow head is a filled triangle whose first point is the tip
    const tips: Array<{ x: number; y: number }> = []
    for (const m of out.matchAll(/<polygon points="([^"]+)" fill="#[0-9a-f]{6}"\/>/g)) {
      const [x, y] = nums(m[1])
      tips.push({ x: x as number, y: y as number })
    }
    expect(tips).toHaveLength(2)

    const expected = [ITEMS[0], ITEMS[1]].map((i) => worldToScreen(VIEW, i.value!))
    for (const exp of expected) {
      const hit = tips.find((t) => Math.abs(t.x - exp.x) < 0.02 && Math.abs(t.y - exp.y) < 0.02)
      expect(hit, `no arrow tip near ${exp.x},${exp.y}`).toBeDefined()
    }
  })

  it('draws nothing for an invisible item or a null value', () => {
    const empty: DrawItem[] = [
      { id: 1, value: null, visible: true, color: '#2563eb', label: 'U1' },
      { id: 2, value: { re: 4, im: 0 }, visible: false, color: '#dc2626', label: 'U2' },
    ]
    const out = svg({ items: empty })
    expect(out).not.toContain('<circle')
    expect(out).not.toContain('<polygon')
    expect(out).not.toContain('#2563eb')
    expect(out).not.toContain('#dc2626')
  })
})

describe('svg surface: grid and axes', () => {
  const lines = (over: Partial<DrawState> = {}): number => (svg(over).match(/<polyline/g) ?? []).length

  it('shows grid lines only when showGrid is on', () => {
    const without = lines()
    const withGrid = lines({ showGrid: true })
    expect(withGrid).toBeGreaterThan(without)
    // both axis strokes and both arrows are there either way
    expect(without).toBe(4)
  })

  it('always draws both axes even with the grid off', () => {
    expect(svg({ showGrid: false })).toContain('stroke="#9aa8bd"')
    expect(svg({ showGrid: true })).toContain('stroke="#9aa8bd"')
  })

  it('labels the grid ticks with formatTick and leaves the axis line unlabelled', () => {
    const out = svg({ showGrid: true, formatTick: (v) => `${v}V` })
    const tickText = [...out.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1])
    expect(tickText.length).toBeGreaterThan(2)
    expect(tickText.every((t) => t.endsWith('V'))).toBe(true)
    // the axis line itself (world value 0) is the labelled-already one
    expect(tickText.some((t) => t.startsWith('0'))).toBe(false)
  })
})

describe('svg surface: sum polygon', () => {
  it('draws the head-to-tail polygon and the resultant when showSum is on', () => {
    const out = svg({ showSum: true })
    expect(out).toContain('stroke="#7c3aed"')
    expect(out).toContain('stroke-dasharray="6 4"')
    expect(out).toContain('stroke-width="2.5"')
  })

  it('skips the sum polygon when showSum is off or fewer than two items are visible', () => {
    expect(svg({ showSum: false })).not.toContain('#7c3aed')
    const single = svg({ showSum: true, items: [ITEMS[0]!] })
    expect(single).not.toContain('#7c3aed')
  })
})

describe('svg surface: labels', () => {
  it('draws item and sum labels only when showLabels is on', () => {
    const off = svg({ showLabels: false, showSum: true })
    expect(off).not.toContain('>U1</text>')
    expect(off).not.toContain('>U2</text>')

    const on = svg({ showLabels: true, showSum: true, sumLabel: 'SUM' })
    expect(on).toContain('>U1</text>')
    expect(on).toContain('>U2</text>')
    expect(on).toContain('>SUM</text>')
    expect(on).toContain('font-weight="bold"')
  })

  it('escapes XML special characters in text values', () => {
    const out = svg({ showLabels: true, items: [{ ...ITEMS[0]!, label: 'a & b < c > "d"' }] })
    expect(out).toContain('>a &amp; b &lt; c &gt; &quot;d&quot;</text>')
    expect(out).not.toContain('a & b')
  })
})

describe('svg surface: selection', () => {
  // a 90 deg phasor: the marker arc sweeps a quarter turn and the "short way
  // round" branch is easy to see
  const at90: DrawItem = { id: 2, value: { re: 0, im: 10 }, visible: true, color: '#dc2626', label: 'U2' }

  it('draws the dashed angle arc only for the selected item', () => {
    const none = svg({ items: [at90], selectedId: 1 })
    const sel = svg({ items: [at90], selectedId: 2, angleLabel: () => '90 deg' })
    expect(none).not.toContain('stroke-dasharray="4 3"')
    expect(sel).toContain('stroke-dasharray="4 3"')
    expect(sel).toContain('stroke="#dc2626"')
    expect(sel).toContain('stroke-width="1.5"')
  })

  it('draws the selection marker dot and the angle label only for the selected item', () => {
    const none = svg({ items: [at90], selectedId: 1 })
    const sel = svg({ items: [at90], selectedId: 2, angleLabel: () => '90 deg' })
    // the semi-transparent handle dot sits on the selected tip
    expect(none).not.toContain('<circle cx="200" cy="130"')
    expect(sel).toContain('<circle cx="200" cy="130" r="4.5" fill="#dc2626" opacity="0.9"/>')
    // the label backdrop is the semi-transparent white plate behind the text
    expect(sel).toContain('fill="#ffffff" opacity="0.85"')
    expect(sel).toContain('text-anchor="middle"')
  })

  it('shows the angle label next to the arc only when the caller supplies one', () => {
    const without = svg({ items: [at90], selectedId: 2 })
    const withLabel = svg({ items: [at90], selectedId: 2, angleLabel: () => '45 deg' })
    expect(without).not.toContain('>45 deg</text>')
    expect(withLabel).toContain('>45 deg</text>')

    const hidden = svg({ items: [at90], selectedId: 2, angleLabel: () => undefined })
    expect(hidden).not.toContain('deg</text>')
  })
})

describe('svg surface: background', () => {
  it('paints a background rect by default and none when null is requested', () => {
    expect(svg()).toContain('<rect x="0" y="0" width="400" height="300" fill="#ffffff"/>')
    const transparent = svg({}, { background: null })
    expect(transparent).not.toContain('fill="#ffffff"')
    expect(svg({}, { background: '#f0f0f0' })).toContain('fill="#f0f0f0"')
  })
})

describe('svg surface: save and restore', () => {
  it('restores the drawing defaults around a colour change', () => {
    const s = svgSurface(120, 80)
    s.save()
    s.beginPath()
    s.moveTo(0, 0)
    s.lineTo(5, 5)
    s.stroke('#111111', 3)
    s.restore()
    s.save()
    s.beginPath()
    s.moveTo(0, 0)
    s.lineTo(5, 5)
    s.stroke('#ff0000', 9, [2, 2], 0.5)
    s.restore()
    s.beginPath()
    s.moveTo(1, 1)
    s.lineTo(6, 6)
    s.stroke('#111111', 3)

    const strokes = [...s.toSvg().matchAll(/<polyline [^>]*\/>/g)].map((m) => m[0])
    expect(strokes).toHaveLength(3)
    expect(strokes[1]).toContain('stroke="#ff0000"')
    expect(strokes[1]).toContain('stroke-dasharray="2 2"')
    expect(strokes[1]).toContain('opacity="0.5"')
    // the third stroke has exactly the attributes the first one had, so
    // restore() really put the colour, the width and the dash back
    const attrs = (el: string): string => el.slice(el.indexOf('" ') + 2)
    expect(attrs(strokes[2]!)).toBe(attrs(strokes[0]!))
  })

  it('survives unbalanced calls without leaving broken markup', () => {
    const a = svgSurface(50, 50)
    a.save()
    a.restore()
    a.restore() // an extra restore must be a no-op, not throw
    a.beginPath()
    a.moveTo(10, 10)
    a.lineTo(20, 20)
    a.stroke('#111111', 3)
    const out = a.toSvg()
    expect(out.match(/</g)?.length).toBe(out.match(/>/g)?.length)
  })
})

describe('canvas surface: same geometry as the svg', () => {
  it('strokes the arrow shaft in the item colour', () => {
    const { ctx, calls } = fakeCtx()
    draw(ctx, state())
    const strokes = callsOf(calls, 'stroke').length
    expect(strokes).toBe(4) // two shafts + two arrow heads
    expect(callsOf(calls, 'fill').length).toBe(2)
    expect(lastSet(calls, 'strokeStyle')).toBe('#dc2626') // set but restored by the save stack
    expect(callsOf(calls, 'restore').length).toBe(callsOf(calls, 'save').length)
  })

  it('records the same arrow tips as the svg emits', () => {
    const { ctx, calls } = fakeCtx()
    draw(ctx, state())
    // the arrow head is the triangle the renderer closes with closePath; its
    // opening moveTo is therefore the tip
    const tips: Array<{ x: number; y: number }> = []
    for (let i = 0; i < calls.length; i++) {
      if (calls[i]!.fn !== 'closePath') continue
      const open = [...calls.slice(0, i)].reverse().find((c) => c.fn === 'moveTo')
      const [x, y] = open!.args
      tips.push({ x: x as number, y: y as number })
    }
    expect(tips).toHaveLength(2)

    const expected = [ITEMS[0], ITEMS[1]].map((i) => worldToScreen(VIEW, i.value!))
    for (const exp of expected) {
      expect(tips.some((t) => Math.abs(t.x - exp.x) < 1e-9 && Math.abs(t.y - exp.y) < 1e-9)).toBe(true)
    }

    // the svg puts the same tips in the arrow-head triangles
    const svgTips: Array<{ x: number; y: number }> = []
    for (const m of svg().matchAll(/<polygon points="([^"]+)" fill="#[0-9a-f]{6}"\/>/g)) {
      const [x, y] = nums(m[1])
      svgTips.push({ x: x as number, y: y as number })
    }
    for (const tip of tips) {
      expect(svgTips.some((t) => Math.abs(t.x - tip.x) < 0.02 && Math.abs(t.y - tip.y) < 0.02)).toBe(true)
    }
  })

  it('sets the canvas font before measuring, so widths match the drawn text', () => {
    const { ctx, calls } = fakeCtx()
    const s = canvasSurface(ctx, 400, 300)
    s.measure('U1', 12, false)
    // the stack is imported rather than spelled out: the diagram draws in the
    // same LaTeX face the formulas use, and this test must not pin a stale one
    expect(lastSet(calls, 'font')).toBe(`12px ${FONT_STACK}`)
    calls.length = 0
    s.measure('U1', 12, true)
    expect(lastSet(calls, 'font')).toBe(`bold 12px ${FONT_STACK}`)
  })

  it('uses the same measure hook for the label backdrop width', () => {
    const { ctx, calls } = fakeCtx()
    draw(ctx, state({ showLabels: true }))
    const rects = callsOf(calls, 'fillRect')
    // item 1 is labelled at the tip: box = measured width + 6, height 15
    const box = rects.find((c) => c.args[3] === 15)
    expect(box).toBeDefined()
    expect(box!.args[2]).toBe('U1'.length * 6 + 6)
  })
})
