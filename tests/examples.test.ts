/**
 * Every shipped example must actually work - a broken demo is worse than none.
 * The numbers are the textbook ones, so this also pins the physics.
 */

import { describe, expect, it } from 'vitest'

import { EXAMPLES } from '../src/core/examples'
import { Session } from '../src/core/session'
import { magnitudeOf } from '../src/core/format'
import type { AngleUnit, PhasorObject } from '../src/core/types'

const D = Math.PI / 180

function run(id: string, angleUnit: AngleUnit = 'deg'): Map<string, PhasorObject> {
  const example = EXAMPLES.find((e) => e.id === id)
  if (!example) throw new Error(`no example ${id}`)
  const s = new Session({ angleUnit })
  for (const line of example.lines) {
    const r = s.submit(line)
    if (!r.ok) throw new Error(`${id}: ${line} -> ${r.error.code} ${r.error.detail}`)
  }
  const broken = s.objects.filter((o) => !o.value)
  if (broken.length > 0) {
    throw new Error(`${id}: ${broken.map((o) => `${o.name} (${o.error})`).join(', ')} did not evaluate`)
  }
  return new Map(s.objects.map((o) => [o.name, o]))
}

describe('the shipped examples', () => {
  it('all of them evaluate in degree mode', () => {
    for (const example of EXAMPLES) {
      const objects = run(example.id)
      expect(objects.size, example.id).toBe(example.lines.length)
    }
  })

  it('all of them evaluate in radian mode too', () => {
    for (const example of EXAMPLES) {
      const objects = run(example.id, 'rad')
      expect(objects.size, example.id).toBe(example.lines.length)
    }
  })

  it('ids and labels are unique and set', () => {
    const ids = EXAMPLES.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const e of EXAMPLES) {
      expect(e.labelKey.startsWith('example.')).toBe(true)
      expect(e.lines.length).toBeGreaterThan(1)
    }
  })

  it('series RLC: Z = 30 + 40j and I = 220/Z', () => {
    const o = run('series-rlc')
    expect(o.get('Z')!.value!.re).toBeCloseTo(30, 9)
    expect(o.get('Z')!.value!.im).toBeCloseTo(40, 9)
    expect(magnitudeOf(o.get('Z')!.value!)).toBeCloseTo(50, 9)
    expect(o.get('I')!.value!.re).toBeCloseTo(2.64, 9)
    expect(o.get('I')!.value!.im).toBeCloseTo(-3.52, 9)
    expect(o.get('R')!.unit).toBe('\u03a9')
    expect(o.get('Z')!.unit).toBeUndefined()
  })

  it('power: S = 880 + 660j and the power factor is 0.8', () => {
    const o = run('power')
    // I is given as 36.87 degrees, so the textbook numbers are close but rounded
    expect(o.get('S')!.value!.re).toBeCloseTo(220 * 5 * Math.cos(36.87 * D), 6)
    expect(o.get('S')!.value!.im).toBeCloseTo(220 * 5 * Math.sin(36.87 * D), 6)
    expect(o.get('P')!.value!.re).toBeCloseTo(220 * 5 * Math.cos(36.87 * D), 6)
    expect(o.get('Q')!.value!.im).toBeCloseTo(0, 9)
    expect(o.get('Q')!.value!.re).toBeCloseTo(220 * 5 * Math.sin(36.87 * D), 6)
    // \lambda is one Greek symbol (kept as the word "lambda"), not l*a*m*b*d*a
    expect(o.has('lambda')).toBe(true)
    expect(o.get('lambda')!.value!.re).toBeCloseTo(0.8, 5)
  })

  it('three-phase: the line voltage is sqrt(3) times the phase voltage, at 30 deg', () => {
    const o = run('three-phase')
    const uab = o.get('U_AB')!.value!
    expect(uab.re).toBeCloseTo(330, 6)
    expect(uab.im).toBeCloseTo(220 * Math.sqrt(3) / 2, 6)
    expect(magnitudeOf(uab)).toBeCloseTo(220 * Math.sqrt(3), 6)
  })

  it('parallel branches: Z = 30 * (-40j) / (30 - 40j)', () => {
    const o = run('parallel')
    expect(o.get('Z')!.value!.re).toBeCloseTo(19.2, 9)
    expect(o.get('Z')!.value!.im).toBeCloseTo(-14.4, 9)
    expect(magnitudeOf(o.get('Z')!.value!)).toBeCloseTo(24, 9)
  })

  it('series loop KVL: the source is the phasor sum of the drops', () => {
    const o = run('kvl')
    // 60 + j80 - j40 = 60 + 40j, i.e. 72.111 at 33.69 degrees
    expect(o.get('U')!.value!.re).toBeCloseTo(60, 9)
    expect(o.get('U')!.value!.im).toBeCloseTo(40, 9)
    expect(magnitudeOf(o.get('U')!.value!)).toBeCloseTo(Math.sqrt(60 * 60 + 40 * 40), 9)
  })

  it('only the sum-shaped examples ask for the sum polygon', () => {
    const withSum = EXAMPLES.filter((e) => e.showSum).map((e) => e.id)
    expect(withSum).toEqual(['kvl'])
  })
})
