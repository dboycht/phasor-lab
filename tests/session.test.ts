import { describe, it, expect } from 'vitest'
import { Session, objectLatex } from '../src/core/session'
import {
  argumentOf,
  formatExponential,
  formatNumber,
  formatPolar,
  formatRect,
  formatTrig,
  magnitudeOf,
  toAmplitude,
  toCx,
  toEffective,
} from '../src/core/format'

const near = (a: number, b: number, eps = 1e-9): boolean =>
  Math.abs(a - b) <= eps * Math.max(1, Math.abs(b))

describe('format: numbers', () => {
  it('keeps a sensible number of significant digits', () => {
    expect(formatNumber(190.52558883257648, 6)).toBe('190.526')
    expect(formatNumber(110, 6)).toBe('110')
    expect(formatNumber(1 / 3, 6)).toBe('0.333333')
    expect(formatNumber(0, 6)).toBe('0')
    expect(formatNumber(-0, 6)).toBe('0')
  })

  it('falls back to exponential notation at the extremes', () => {
    expect(formatNumber(2e-3, 6)).toBe('0.002')
    expect(formatNumber(1e-7, 6)).toBe('1e-7')
    expect(formatNumber(1.5e13, 6)).toBe('1.5e13')
  })

  it('handles non-finite values', () => {
    expect(formatNumber(Number.NaN)).toBe('NaN')
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('inf')
  })
})

describe('format: the four phasor forms', () => {
  const z = { re: 190.52558883257648, im: 110 }
  const opts = { angleUnit: 'deg' as const, precision: 6 }

  it('rectangular', () => {
    expect(formatRect(z, 6)).toBe('190.526 + 110j')
    expect(formatRect({ re: 0, im: -4 }, 6)).toBe('-4j')
    expect(formatRect({ re: 0, im: 1 }, 6)).toBe('j')
    expect(formatRect({ re: 5, im: 0 }, 6)).toBe('5')
    expect(formatRect({ re: -3, im: -4 }, 6)).toBe('-3 - 4j')
  })

  it('polar, with a unit label', () => {
    expect(formatPolar(z, { ...opts, unit: 'V' })).toBe('220V ∠ 30°')
  })

  it('exponential', () => {
    expect(formatExponential(z, { ...opts, unit: 'V' })).toBe('220V·e^(j30°)')
  })

  it('trigonometric', () => {
    expect(formatTrig(z, { ...opts, unit: 'V' })).toBe('220V(cos30° + j sin30°)')
  })

  it('shows a negative angle', () => {
    const v = { re: 190.52558883257648, im: -110 }
    expect(formatPolar(v, opts)).toBe('220 ∠ -30°')
    expect(formatTrig(v, opts)).toBe('220(cos30° - j sin30°)')
  })

  it('switches to radians on request', () => {
    const rad = { angleUnit: 'rad' as const, precision: 6 }
    expect(formatPolar(z, rad)).toMatch(/^220 ∠ 0\.523599 rad$/)
  })
})

describe('format: magnitude, argument and conversions', () => {
  it('modulus and argument', () => {
    const z = { re: 3, im: 4 }
    expect(magnitudeOf(z)).toBe(5)
    expect(near(argumentOf(z, 'deg'), 53.13010235415598, 1e-12)).toBe(true)
    expect(near(argumentOf(z, 'rad'), Math.atan2(4, 3), 1e-12)).toBe(true)
  })

  it('rms <-> amplitude round trip', () => {
    const z = { re: 220, im: 0 }
    const amp = toAmplitude(z)
    expect(near(amp.re, 311.1269837220809, 1e-12)).toBe(true)
    const back = toEffective(amp)
    expect(near(back.re, 220, 1e-12)).toBe(true)
  })

  it('normalises what mathjs returns', () => {
    expect(toCx(5)).toEqual({ re: 5, im: 0 })
    expect(toCx({ re: 1, im: 2 })).toEqual({ re: 1, im: 2 })
    expect(() => toCx('nope')).toThrow()
  })
})

describe('session: submitting input', () => {
  it('creates an object from an assignment', () => {
    const s = new Session()
    const r = s.submit('U=220\\angle 30\\degree')
    expect(r.ok).toBe(true)
    expect(s.objects).toHaveLength(1)
    const u = s.objects[0]!
    expect(u.name).toBe('U')
    expect(u.unit).toBeUndefined()
    expect(near(u.value!.re, 190.52558883257648, 1e-12)).toBe(true)
    expect(near(u.value!.im, 110, 1e-12)).toBe(true)
  })

  it('keeps a unit label', () => {
    const s = new Session()
    s.submit('U=220\\angle 0\\degree\\text{V}')
    expect(s.objects[0]!.unit).toBe('V')
  })

  it('returns a transient result for a bare expression', () => {
    const s = new Session()
    const r = s.submit('3+4j')
    expect(r.ok).toBe(true)
    expect(s.transient!.value).toEqual({ re: 3, im: 4 })
    expect(s.objects).toHaveLength(0)
  })

  it('names a bare expression when the UI asks it to', () => {
    const s = new Session()
    const r = s.submit('3+4j', { autoName: true })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.autoNamed).toEqual(['A'])
    expect(s.transient).toBeUndefined()
    expect(s.objects).toHaveLength(1)
    expect(s.objects[0]!.name).toBe('A')
    expect(s.objects[0]!.value).toEqual({ re: 3, im: 4 })
    // the stored source carries the name, so saving and reloading keeps it
    expect(s.objects[0]!.latex).toBe('A=3+4j')
  })

  it('hands out A, B, C ... and continues past Z', () => {
    const s = new Session()
    const names: string[] = []
    for (let i = 0; i < 28; i++) {
      const r = s.submit(`${i + 1}`, { autoName: true })
      if (r.ok) names.push(...(r.autoNamed ?? []))
    }
    expect(names.slice(0, 3)).toEqual(['A', 'B', 'C'])
    expect(names[25]).toBe('Z')
    expect(names[26]).toBe('A1')
    expect(names[27]).toBe('B1')
  })

  it('never reuses a name that is still in use, and frees it when deleted', () => {
    const s = new Session()
    s.submit('A=1')
    const r = s.submit('2+2', { autoName: true })
    expect(r.ok && r.autoNamed).toEqual(['B'])
    const a = s.objects.find((o) => o.name === 'A')!
    s.remove(a.id)
    const again = s.submit('3+3', { autoName: true })
    expect(again.ok && again.autoNamed).toEqual(['A'])
  })

  it('names only the statements that were left unnamed', () => {
    const s = new Session()
    const r = s.submit('U=220\\angle 0\\degree; 5\\angle 90', { autoName: true })
    expect(r.ok && r.autoNamed).toEqual(['A'])
    expect(s.objects.map((o) => o.name)).toEqual(['U', 'A'])
  })

  it('updates an existing object instead of duplicating it', () => {
    const s = new Session()
    s.submit('U=220\\angle 0\\degree')
    s.submit('U=110\\angle 0\\degree')
    expect(s.objects).toHaveLength(1)
    expect(s.objects[0]!.value!.re).toBe(110)
    expect(s.objects[0]!.body).toBe('110\\angle 0\\degree')
  })

  it('gives each object a distinct colour', () => {
    const s = new Session()
    s.submit('A=1;B=2;C=3')
    const colors = s.objects.map((o) => o.color)
    expect(new Set(colors).size).toBe(3)
  })

  it('reports a syntax error without changing the object list', () => {
    const s = new Session()
    s.submit('U=1')
    const r = s.submit('220\\angle')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('missing-right-operand')
    expect(s.objects).toHaveLength(1)
    expect(s.objects[0]!.value!.re).toBe(1)
  })

  it('reports an evaluation error for an unnamed expression', () => {
    const s = new Session()
    const r = s.submit('U/Z')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('eval')
    expect(s.objects).toHaveLength(0)
  })

  it('keeps an unresolvable definition so it can heal later', () => {
    const s = new Session()
    const r = s.submit('I=U/Z')
    expect(r.ok).toBe(true)
    expect(s.objects[0]!.value).toBeNull()
    expect(s.objects[0]!.error).toBeTruthy()
    s.submit('U=10')
    s.submit('Z=2')
    const I = s.objects.find((o) => o.name === 'I')!
    expect(I.value!.re).toBe(5)
    expect(I.error).toBeUndefined()
  })

  it('recomputes dependants when a definition changes', () => {
    const s = new Session()
    s.submit('U=10;Z=2;I=U/Z')
    expect(s.objects.find((o) => o.name === 'I')!.value!.re).toBe(5)
    s.submit('Z=4')
    expect(s.objects.find((o) => o.name === 'I')!.value!.re).toBe(2.5)
  })
})

describe('session: object management', () => {
  it('removes an object and re-evaluates the rest', () => {
    const s = new Session()
    s.submit('U=10;Z=2;I=U/Z')
    const Z = s.objects.find((o) => o.name === 'Z')!
    s.remove(Z.id)
    const I = s.objects.find((o) => o.name === 'I')!
    expect(I.value).toBeNull()
    expect(I.error).toBeTruthy()
  })

  it('toggles visibility', () => {
    const s = new Session()
    s.submit('U=1')
    const id = s.objects[0]!.id
    s.toggleVisible(id)
    expect(s.objects[0]!.visible).toBe(false)
    s.toggleVisible(id)
    expect(s.objects[0]!.visible).toBe(true)
  })

  it('clears everything', () => {
    const s = new Session()
    s.submit('U=1;I=2')
    s.clear()
    expect(s.objects).toHaveLength(0)
    expect(s.transient).toBeUndefined()
  })
})

describe('session: reordering the list', () => {
  const names = (s: Session): string[] => s.objects.map((o) => o.name)

  it('moves an object down, up and back to the front', () => {
    const s = new Session()
    s.submit('A=1;B=2;C=3')
    // insertion points are read against the list as it is now
    s.move(s.objects[0]!.id, 2)
    expect(names(s)).toEqual(['B', 'A', 'C'])
    s.move(s.objects[1]!.id, 0)
    expect(names(s)).toEqual(['A', 'B', 'C'])
    s.move(s.objects[1]!.id, 1)
    expect(names(s)).toEqual(['A', 'B', 'C'])
  })

  it('lands a row under its neighbour, not one place further', () => {
    const s = new Session()
    s.submit('A=1;B=2;C=3')
    // the drag handler passes "insert before the row after this one"
    s.move(s.objects[0]!.id, 2)
    expect(names(s)).toEqual(['B', 'A', 'C'])
    // and dropping at the very end really is the end
    s.move(s.objects[2]!.id, 3)
    expect(names(s)).toEqual(['B', 'A', 'C'])
    s.move(s.objects[0]!.id, 3)
    expect(names(s)).toEqual(['A', 'C', 'B'])
  })

  it('renumbers `order` so the arrangement is the data, not the position', () => {
    const s = new Session()
    s.submit('A=1;B=2;C=3')
    s.move(s.objects[2]!.id, 0)
    expect(names(s)).toEqual(['C', 'A', 'B'])
    expect(s.objects.map((o) => o.order)).toEqual([0, 1, 2])
  })

  it('keeps every colour with its own object', () => {
    const s = new Session()
    s.submit('A=1;B=2;C=3')
    const colours = new Map(s.objects.map((o) => [o.name, o.color]))
    s.move(s.objects[2]!.id, 0)
    for (const o of s.objects) expect(o.color).toBe(colours.get(o.name))
  })

  it('clamps a target outside the list instead of dropping the object', () => {
    const s = new Session()
    s.submit('A=1;B=2')
    const a = s.objects[0]!.id
    s.move(a, 99)
    expect(names(s)).toEqual(['B', 'A'])
    // the same object moves back, clamped to the top
    s.move(a, -5)
    expect(names(s)).toEqual(['A', 'B'])
  })

  it('writes nothing when the position does not change', () => {
    const s = new Session()
    s.submit('A=1;B=2')
    s.forgetHistory()
    expect(s.canUndo).toBe(false)
    expect(s.move(s.objects[0]!.id, 0)).toBe(false)
    expect(s.canUndo).toBe(false)
    expect(s.move(9999, 0)).toBe(false)
    expect(s.canUndo).toBe(false)
    expect(names(s)).toEqual(['A', 'B'])
  })

  it('is one undo step, and survives a project round trip', () => {
    const s = new Session()
    s.submit('A=1;B=2;C=3')
    s.move(s.objects[2]!.id, 0)
    expect(names(s)).toEqual(['C', 'A', 'B'])

    const project = s.toProject()
    const reloaded = new Session()
    expect(reloaded.loadProject(project)).toBeUndefined()
    expect(names(reloaded)).toEqual(['C', 'A', 'B'])

    const single = new Session()
    single.submit('A=1;B=2;C=3')
    single.move(single.objects[2]!.id, 0)
    single.undo()
    expect(names(single)).toEqual(['A', 'B', 'C'])
  })

  it('does not change what the values are', () => {
    const s = new Session()
    s.submit('U=10;Z=2;I=U/Z')
    const before = s.objects.map((o) => `${o.name}:${o.value?.re}`)
    s.move(s.objects[2]!.id, 0)
    expect(s.objects.map((o) => `${o.name}:${o.value?.re}`).sort()).toEqual([...before].sort())
  })
})

describe('session: settings', () => {
  it('reinterprets a bare angle when the unit changes', () => {
    const s = new Session()
    s.submit('U=10\\angle 90')
    expect(near(s.objects[0]!.value!.im, 10, 1e-12)).toBe(true)

    s.updateSettings({ angleUnit: 'rad' })
    expect(near(s.objects[0]!.value!.im, Math.sin(90) * 10, 1e-9)).toBe(true)

    s.updateSettings({ angleUnit: 'deg' })
    expect(near(s.objects[0]!.value!.im, 10, 1e-12)).toBe(true)
  })

  it('keeps an explicit degree sign independent of the unit', () => {
    const s = new Session({ angleUnit: 'rad' })
    s.submit('U=10\\angle 90\\degree')
    expect(near(s.objects[0]!.value!.im, 10, 1e-12)).toBe(true)
  })

  it('converts every object into the other convention without touching the source', () => {
    const s = new Session()
    s.submit('U=220\\angle 0\\degree\\text{V}')
    const U = s.objects[0]!
    expect(U.scale).toBe(1)
    expect(near(U.value!.re, 220, 1e-12)).toBe(true)

    s.convertConvention('amplitude')
    expect(objectLatex(U)).toBe('U=220\\angle 0\\degree\\text{V}')
    expect(U.body).toBe('220\\angle 0\\degree')
    expect(near(U.value!.re, 311.1269837220809, 1e-12)).toBe(true)
    expect(s.settings.convention).toBe('amplitude')

    s.convertConvention('rms')
    expect(near(s.objects[0]!.value!.re, 220, 1e-12)).toBe(true)
    expect(objectLatex(s.objects[0]!)).toBe('U=220\\angle 0\\degree\\text{V}')
  })

  it('starts a value typed after the conversion at factor 1', () => {
    const s = new Session()
    s.submit('U=220\\angle 0\\degree')
    s.convertConvention('amplitude')
    s.submit('I=10\\angle 0\\degree')
    expect(near(s.objects.find((o) => o.name === 'I')!.value!.re, 10, 1e-12)).toBe(true)
  })

  it('feeds the converted value into dependent expressions', () => {
    const s = new Session()
    s.submit('U=100\\angle 0\\degree;R=50;I=U/R')
    expect(near(s.objects.find((o) => o.name === 'I')!.value!.re, 2, 1e-12)).toBe(true)
    s.convertConvention('amplitude')
    expect(near(s.objects.find((o) => o.name === 'I')!.value!.re, 2 * Math.SQRT2, 1e-12)).toBe(true)
  })

  it('a converted object survives an angle-unit switch', () => {
    const s = new Session()
    s.submit('U=10\\angle 90\\degree')
    s.convertConvention('amplitude')
    const before = s.objects[0]!.value!
    s.updateSettings({ angleUnit: 'rad' })
    const after = s.objects[0]!.value!
    expect(near(after.im, before.im, 1e-12)).toBe(true)
  })

  it('applies the precision setting', () => {
    const s = new Session()
    s.submit('U=1/3')
    s.updateSettings({ precision: 3 })
    expect(formatNumber(s.objects[0]!.value!.re, s.settings.precision)).toBe('0.333')
  })
})
