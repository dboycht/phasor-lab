/**
 * The evaluation scope: mathjs plus the electrical-engineering helpers.
 *
 * Angle model (kept identical to the one in latex.ts):
 *   - generated expressions are in RADIANS, so `polar` takes radians and the
 *     trigonometric functions are the standard mathjs ones;
 *   - angle-valued results (`arg`, `asin`, `acos`, `atan`, `atan2`) are returned
 *     in the CURRENT angle unit, exactly like a pocket calculator in degree mode,
 *     so they compose with bare values written after the angle sign.
 */

import { all, create, type MathJsInstance } from 'mathjs'
import type { Settings } from './types'

/** A plain complex number, as it appears inside the scope. */
export interface CxLike {
  re: number
  im: number
}

/** mathjs values are loosely typed; this keeps the wrappers readable. */
type AnyFn = (...args: unknown[]) => unknown

export function createMath(): MathJsInstance {
  return create(all, {})
}

export function buildScope(math: MathJsInstance, settings: Settings): Record<string, unknown> {
  const isDeg = settings.angleUnit === 'deg'
  const fromRad = (x: number): number => (isDeg ? (x * 180) / Math.PI : x)

  const lib = math as unknown as Record<string, AnyFn>
  const num = (x: unknown): number => Number(x)

  const asComplex = (z: unknown): CxLike => {
    if (typeof z === 'number') return { re: z, im: 0 }
    const c = z as Partial<CxLike> | null
    if (c && typeof c.re === 'number' && typeof c.im === 'number') return { re: c.re, im: c.im }
    throw new Error('not a complex number: ' + String(z))
  }

  return {
    // --- the imaginary unit, written the electrical-engineering way ---
    j: math.complex(0, 1),

    // --- phasor constructor: `polar(r, theta)` with theta in RADIANS ---
    polar: (r: unknown, theta: unknown): CxLike =>
      math.complex({ r: num(r), phi: num(theta) }) as unknown as CxLike,

    // --- modulus / argument ---
    /** magnitude of a phasor (same as the built-in abs, listed for discoverability) */
    magnitude: (z: unknown): number => num(lib.abs?.(z)),
    /** argument / phase angle, returned in the current angle unit */
    arg: (z: unknown): number => fromRad(num(lib.arg?.(z))),
    angle: (z: unknown): number => fromRad(num(lib.arg?.(z))),

    // --- inverse trigonometry: results come back in the current angle unit ---
    asin: (x: unknown) => fromRad(num(lib.asin?.(num(x)))),
    acos: (x: unknown) => fromRad(num(lib.acos?.(num(x)))),
    atan: (x: unknown) => fromRad(num(lib.atan?.(num(x)))),
    atan2: (y: unknown, x: unknown) => fromRad(num(lib.atan2?.(num(y), num(x)))),

    // --- helpers that show up constantly in circuit analysis ---
    /** amplitude -> effective value */
    rms: (z: unknown): CxLike => {
      const c = asComplex(z)
      return { re: c.re * Math.SQRT1_2, im: c.im * Math.SQRT1_2 }
    },
    /** effective value -> amplitude */
    peak: (z: unknown): CxLike => {
      const c = asComplex(z)
      return { re: c.re * Math.SQRT2, im: c.im * Math.SQRT2 }
    },
    /** angular frequency from a frequency in hertz: om(f) = 2*pi*f */
    om: (f: unknown): number => 2 * Math.PI * num(f),
    /** the same relation backwards: freq(w) = w / (2*pi) */
    freq: (w: unknown): number => num(w) / (2 * Math.PI),
    /**
     * Power factor: the cosine of a phase angle given in the current angle unit
     * (the converter turns an explicit `\degree` argument into radians first).
     */
    pf: (x: unknown): number => num(lib.cos?.(num(x))),

    // --- explicit angle conversions, independent of the display unit ---
    /** radians -> degrees */
    todeg: (x: unknown): number => (num(x) * 180) / Math.PI,
    /** degrees -> radians */
    torad: (x: unknown): number => (num(x) * Math.PI) / 180,
  }
}

export function isComplexLike(v: unknown): v is CxLike {
  const c = v as Partial<CxLike> | null
  return !!c && typeof c.re === 'number' && typeof c.im === 'number'
}
