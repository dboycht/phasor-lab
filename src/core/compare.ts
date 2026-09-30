/**
 * Comparing two phasors.
 *
 * This is the whole point of phasors: the *difference* of two arguments is a
 * power factor, and the *ratio* of two phasors is an impedance. Both fall out
 * of one pair of complex operations, so the UI only has to pick two objects.
 *
 * Conventions:
 *   - the phase difference is `arg(A) - arg(B)`, wrapped to (-180, 180] degrees
 *     or (-pi, pi] radians, because a phase difference is only meaningful
 *     modulo a full turn;
 *   - `cosDelta` is always computed in radians internally, so it is exact in
 *     both angle units;
 *   - with A = U and B = I, `ratio` is the impedance and `product` is the
 *     complex power S (A * conj(B)).
 */

import type { AngleUnit, Cx } from './types'
import { magnitudeOf } from './format'

export interface Comparison {
  /** A / B: the impedance when A is a voltage and B is a current */
  ratio: Cx
  /** A * conj(B): the complex power when A is a voltage and B is a current */
  product: Cx
  /** arg(A) - arg(B), wrapped into (-180, 180] degrees or (-pi, pi] radians */
  deltaAngle: number
  /** cos of the phase difference: the power factor for U and I */
  cosDelta: number
}

function wrapRadians(rad: number): number {
  const twoPi = Math.PI * 2
  let x = rad % twoPi
  if (x <= -Math.PI) x += twoPi
  if (x > Math.PI) x -= twoPi
  return x
}

/**
 * Returns `undefined` when B is zero, because neither the ratio nor a phase
 * difference means anything then (arg 0 is not defined).
 */
export function comparePhasors(a: Cx, b: Cx, angleUnit: AngleUnit): Comparison | undefined {
  if (magnitudeOf(b) === 0) return undefined

  const denominator = b.re * b.re + b.im * b.im
  const ratio: Cx = {
    re: (a.re * b.re + a.im * b.im) / denominator,
    im: (a.im * b.re - a.re * b.im) / denominator,
  }
  const product: Cx = {
    re: a.re * b.re + a.im * b.im,
    im: a.im * b.re - a.re * b.im,
  }

  const dRad = wrapRadians(Math.atan2(a.im, a.re) - Math.atan2(b.im, b.re))
  return {
    ratio,
    product,
    deltaAngle: angleUnit === 'deg' ? (dRad * 180) / Math.PI : dRad,
    cosDelta: Math.cos(dRad),
  }
}
