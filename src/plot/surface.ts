/**
 * Drawing surface: the tiny 2D subset the phasor renderer needs, with two
 * back ends - a canvas one that must stay pixel-identical to the old direct
 * `ctx` code, and a DOM-free SVG one used for vector export and tests.
 *
 * The renderer only ever talks to this interface, so the canvas picture and the
 * SVG file cannot drift apart: there is exactly one copy of the drawing logic.
 */

export interface TextOptions {
  size: number
  color: string
  align?: 'left' | 'center' | 'right'
  baseline?: 'top' | 'middle' | 'bottom'
  bold?: boolean
  alpha?: number
}

/** Width of `text` in pixels at this size/weight. */
export type Measure = (text: string, size: number, bold: boolean) => number

export interface Surface {
  readonly width: number
  readonly height: number
  save(): void
  restore(): void
  clear(color: string): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  closePath(): void
  arc(cx: number, cy: number, r: number, alpha?: number): void
  stroke(color: string, width: number, dash?: number[], alpha?: number): void
  fill(color: string, alpha?: number): void
  fillRect(x: number, y: number, w: number, h: number, color: string, alpha?: number): void
  text(value: string, x: number, y: number, opts: TextOptions): void
  measure(value: string, size: number, bold?: boolean): number
}

/**
 * The one font stack the whole app draws with: tick numbers, phasor labels and
 * the sum label are set in the same LaTeX face the formulas are rendered in, so
 * the diagram's notation matches the algebra view. Canvas and SVG share this
 * single constant, which is why an exported file cannot drift from the screen.
 *
 * (KaTeX ships no CJK glyphs, but the diagram draws no Chinese, so that never
 * comes up here. An SVG opened on a machine without KaTeX falls back to Times.)
 */
export const FONT_STACK = "KaTeX_Main, KaTeX_Math, 'Times New Roman', Times, serif"

/**
 * Cap style used for every stroke. The old canvas code set `lineCap = 'round'`
 * once per phasor and never reset it, so round caps are the way the picture
 * has always looked; putting them in the surfaces keeps canvas and SVG equal
 * without widening the `stroke()` signature.
 */
const LINE_CAP = 'round'

// ---------------------------------------------------------------- canvas

/**
 * Canvas back end. It stores no state of its own: every call maps straight to
 * the context and every option mirrors the context property the old code set,
 * which is what keeps the pixels identical.
 */
export function canvasSurface(ctx: CanvasRenderingContext2D, width: number, height: number): Surface {
  // globalAlpha is always written, never left as found: the old renderer always
  // reset it to 1 straight after using it, and an alpha that leaked into the
  // next shape would be a visible regression
  const applyAlpha = (alpha: number | undefined): void => {
    ctx.globalAlpha = alpha ?? 1
  }
  const font = (size: number, bold: boolean): string => `${bold ? 'bold ' : ''}${size}px ${FONT_STACK}`
  // the old renderer stroked with round caps; set it once so plain line1()
  // calls keep the exact same look
  ctx.lineCap = LINE_CAP

  return {
    width,
    height,
    save: () => ctx.save(),
    restore: () => ctx.restore(),
    clear: (color) => {
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = color
      ctx.fillRect(0, 0, width, height)
    },
    beginPath: () => ctx.beginPath(),
    moveTo: (x, y) => ctx.moveTo(x, y),
    lineTo: (x, y) => ctx.lineTo(x, y),
    closePath: () => ctx.closePath(),
    arc: (cx, cy, r, alpha) => {
      // only ever a full circle here, so the canvas can take it directly
      applyAlpha(alpha)
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
    },
    stroke: (color, lineWidth, dash, alpha) => {
      ctx.strokeStyle = color
      ctx.lineWidth = lineWidth
      ctx.setLineDash(dash ?? [])
      applyAlpha(alpha)
      ctx.stroke()
      // like globalAlpha, the dash is a state the caller set explicitly, so it
      // is reset here to keep the next stroke identical to the old code
      ctx.setLineDash([])
    },
    fill: (color, alpha) => {
      applyAlpha(alpha)
      ctx.fillStyle = color
      ctx.fill()
    },
    fillRect: (x, y, w, h, color, alpha) => {
      applyAlpha(alpha)
      ctx.fillStyle = color
      ctx.fillRect(x, y, w, h)
    },
    text: (value, x, y, opts) => {
      applyAlpha(opts.alpha)
      ctx.font = font(opts.size, opts.bold === true)
      ctx.textAlign = opts.align ?? 'left'
      ctx.textBaseline = opts.baseline ?? 'top'
      ctx.fillStyle = opts.color
      ctx.fillText(value, x, y)
    },
    measure: (value, size, bold = false) => {
      ctx.font = font(size, bold)
      return ctx.measureText(value).width
    },
  }
}

// ------------------------------------------------------------------- svg

/** Mutable drawing defaults a save()/restore() pair has to put back. */
interface SvgState {
  /** fill colour, used by arc() which has no colour argument of its own */
  fill: string
  stroke: string
  strokeWidth: number
  dash: number[]
  alpha: number
}

const TEXT_ANCHOR: Record<'left' | 'center' | 'right', string> = {
  left: 'start',
  center: 'middle',
  right: 'end',
}

/**
 * Vertical placement is done with `dy` in `em` (not `dominant-baseline`): these
 * offsets reproduce the canvas `textBaseline` boxes ('top' puts the em box top
 * at y, 'middle' centres it, 'bottom' puts its bottom at y), and `dominant-
 * baseline` is implemented inconsistently across SVG renderers.
 */
const BASELINE_DY: Record<'top' | 'middle' | 'bottom', number> = {
  top: -0.32,
  middle: 0.09,
  bottom: 0.35,
}

/**
 * SVG back end. Elements are collected in draw order; `toSvg()` just joins them
 * inside the root element, and there is nothing a save()/restore() pair can do
 * that would leave unbalanced XML: they only move the style defaults and reset
 * the path under construction, never the element list.
 */
export function svgSurface(width: number, height: number, measure?: Measure): Surface & { toSvg(): string } {
  const elements: string[] = []
  const defaultMeasure: Measure = (value, size, bold) => 0.6 * size * value.length * (bold ? 1.05 : 1)
  const measureText = measure ?? defaultMeasure
  /** the path under construction: coordinates that share one stroke()/fill() */
  let path: string[] = []
  let state: SvgState = { fill: '#000000', stroke: '#000000', strokeWidth: 1, dash: [], alpha: 1 }
  const stack: SvgState[] = []

  /** 1-2 decimals keeps the file small and the unit tests stable. */
  const n = (v: number): string => {
    const r = Number.isFinite(v) ? v : 0
    return String(Math.round(r * 100) / 100)
  }

  const attr = (name: string, value: string | number | undefined): string =>
    value === undefined ? '' : ` ${name}="${value}"`

  /**
   * An explicit alpha wins; otherwise the shape is opaque. This mirrors the
   * canvas surface, which writes globalAlpha on every call and resets it to 1
   * once the alpha-taking shape is done.
   */
  const alphaAttr = (alpha: number | undefined): string => {
    const a = alpha ?? 1
    return a < 1 ? attr('opacity', n(a)) : ''
  }

  const xml = (v: string): string =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const point = (s: string): string => s.replace(/[MLZ]/g, '').trim()
  const takePath = (): string => {
    const d = path.join(' ')
    path = []
    return d
  }

  return {
    width,
    height,
    save: () => {
      stack.push({ ...state, dash: [...state.dash] })
      // the path is not part of the saved state any more than it is on canvas,
      // but it must not leak out of the pair: the renderer always opens a path
      // after restoring, and a stale prefix would corrupt the next element
      path = []
    },
    restore: () => {
      const prev = stack.pop()
      if (prev) state = prev
      // the path is not part of the saved state any more than it is on canvas,
      // and it must not leak out of the pair: the renderer always opens a path
      // after restoring, and a stale prefix would corrupt the next element
      path = []
    },
    clear: (color) => {
      elements.push(`<rect x="0" y="0" width="${n(width)}" height="${n(height)}" fill="${color}"/>`)
    },
    beginPath: () => {
      path = []
    },
    moveTo: (x, y) => {
      path.push(`M ${n(x)} ${n(y)}`)
    },
    lineTo: (x, y) => {
      path.push(`L ${n(x)} ${n(y)}`)
    },
    closePath: () => {
      path.push('Z')
    },
    arc: (cx, cy, r, alpha) => {
      // the renderer only ever arcs a full circle to fill a dot, so it is a
      // plain filled circle rather than a path; the colour is the fill colour
      // in force (the old canvas code set fillStyle just before the arc)
      elements.push(
        `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${state.fill}"${alphaAttr(alpha)}/>`,
      )
    },
    stroke: (color, lineWidth, dash, alpha) => {
      // mirror the canvas properties, so restore() has something real to put back
      state.stroke = color
      state.strokeWidth = lineWidth
      state.dash = dash && dash.length > 0 ? [...dash] : []
      state.alpha = alpha ?? 1
      const d = takePath()
      if (!d) return
      const common = `fill="none" stroke="${color}" stroke-width="${n(lineWidth)}"` +
        ` stroke-linecap="${LINE_CAP}" stroke-linejoin="${LINE_CAP}"` +
        (state.dash.length > 0 ? ` stroke-dasharray="${state.dash.join(' ')}"` : '')
      // a lone `M x y` has no length and paints nothing; the canvas leaves it
      // invisible too, so it is dropped rather than emitted as an empty line
      if (d.includes('L')) {
        elements.push(`<polyline points="${point(d)}" ${common}${alphaAttr(alpha)}/>`)
      }
    },
    fill: (color, alpha) => {
      state.fill = color
      state.alpha = alpha ?? 1
      const d = takePath()
      if (!d) return
      // anything the renderer fills is a closed polygon or a full circle
      elements.push(`<polygon points="${point(d)}" fill="${color}"${alphaAttr(alpha)}/>`)
    },
    fillRect: (x, y, w, h, color, alpha) => {
      state.fill = color
      state.alpha = alpha ?? 1
      elements.push(
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${color}"${alphaAttr(alpha)}/>`,
      )
    },
    text: (value, x, y, opts) => {
      if (value.length === 0) return
      const anchor = TEXT_ANCHOR[opts.align ?? 'left']
      const dy = BASELINE_DY[opts.baseline ?? 'top']
      const weight = opts.bold === true ? ' font-weight="bold"' : ''
      const attrs =
        ` x="${n(x)}" y="${n(y)}" dy="${n(dy)}em"` +
        ` font-family="${FONT_STACK}" font-size="${n(opts.size)}"${weight}` +
        ` fill="${opts.color}" text-anchor="${anchor}"`
      elements.push(`<text${attrs}${alphaAttr(opts.alpha)}>${xml(value)}</text>`)
    },
    measure: (value, size, bold = false) => measureText(value, size, bold),
    toSvg: () =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}"` +
      ` viewBox="0 0 ${n(width)} ${n(height)}">\n${elements.join('\n')}\n</svg>`,
  }
}
