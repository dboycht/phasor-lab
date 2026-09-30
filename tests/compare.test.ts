import { describe, expect, it } from 'vitest'

import { comparePhasors } from '../src/core/compare'

const D = Math.PI / 180
const polar = (r: number, deg: number) => ({ re: r * Math.cos(deg * D), im: r * Math.sin(deg * D) })

describe('comparePhasors', () => {
  it('gives the impedance for a voltage and a current', () => {
    // U = 220 at 0 deg, I = 2.64 - 3.52j (= 4.4 at -53.13 deg) -> Z = 30 + 40j
    const c = comparePhasors({ re: 220, im: 0 }, { re: 2.64, im: -3.52 }, 'deg')!
    expect(c.ratio.re).toBeCloseTo(30, 9)
    expect(c.ratio.im).toBeCloseTo(40, 9)
    expect(c.deltaAngle).toBeCloseTo(53.13010235, 6)
    expect(c.cosDelta).toBeCloseTo(0.6, 9)
  })

  it('gives the complex power as A * conj(B)', () => {
    const c = comparePhasors({ re: 220, im: 0 }, { re: 2.64, im: -3.52 }, 'deg')!
    expect(c.product.re).toBeCloseTo(580.8, 9)
    expect(c.product.im).toBeCloseTo(774.4, 9)
    // S = P + jQ with the magnitude U * I
    expect(Math.hypot(c.product.re, c.product.im)).toBeCloseTo(220 * 4.4, 9)
    // and the power factor is cos(phase difference)
    expect(c.product.re / Math.hypot(c.product.re, c.product.im)).toBeCloseTo(c.cosDelta, 9)
  })

  it('keeps the angle of the ratio consistent with deltaAngle', () => {
    const c = comparePhasors(polar(100, 70), polar(50, 22), 'deg')!
    expect(Math.atan2(c.ratio.im, c.ratio.re) / D).toBeCloseTo(c.deltaAngle, 6)
  })

  it('wraps a phase difference into (-180, 180]', () => {
    const c = comparePhasors(polar(1, 0), polar(1, 190), 'deg')!
    expect(c.deltaAngle).toBeCloseTo(170, 6)
    const d = comparePhasors(polar(1, 0), polar(1, -190), 'deg')!
    expect(d.deltaAngle).toBeCloseTo(-170, 6)
  })

  it('reports the difference in the requested unit but does not change the cosine', () => {
    const a = polar(1, 30)
    const b = polar(1, -30)
    const deg = comparePhasors(a, b, 'deg')!
    const rad = comparePhasors(a, b, 'rad')!
    expect(deg.deltaAngle).toBeCloseTo(60, 9)
    expect(rad.deltaAngle).toBeCloseTo(60 * D, 9)
    expect(deg.cosDelta).toBeCloseTo(0.5, 9)
    expect(rad.cosDelta).toBeCloseTo(0.5, 9)
  })

  it('divides by a purely imaginary phasor correctly', () => {
    const c = comparePhasors({ re: 1, im: 0 }, { re: 0, im: 1 }, 'deg')!
    expect(c.ratio.re).toBeCloseTo(0, 12)
    expect(c.ratio.im).toBeCloseTo(-1, 12)
    expect(c.deltaAngle).toBeCloseTo(-90, 9)
    expect(c.cosDelta).toBeCloseTo(0, 9)
  })

  it('has no answer when B is zero', () => {
    expect(comparePhasors({ re: 5, im: 5 }, { re: 0, im: 0 }, 'deg')).toBeUndefined()
  })

  it('is symmetric in magnitude but not in sign', () => {
    const a = polar(3, 10)
    const b = polar(7, 80)
    const ab = comparePhasors(a, b, 'deg')!
    const ba = comparePhasors(b, a, 'deg')!
    expect(Math.hypot(ab.ratio.re, ab.ratio.im) * Math.hypot(ba.ratio.re, ba.ratio.im)).toBeCloseTo(1, 9)
    expect(ab.deltaAngle).toBeCloseTo(-ba.deltaAngle, 9)
    expect(Math.hypot(ab.product.re, ab.product.im)).toBeCloseTo(Math.hypot(ba.product.re, ba.product.im), 9)
  })
})
