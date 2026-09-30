/**
 * The documented syntax table, executable.
 *
 * Everything promised in README ("Syntax reference" + "The angle model" + "Names")
 * is exercised here, so a parser regression cannot quietly break a documented form.
 */

import { describe, expect, it } from 'vitest'

import { Session } from '../src/core/session'
import { objectLatex } from '../src/core/session'
import { parseStatement } from '../src/core/latex'
import type { Cx, Settings } from '../src/core/types'

const D = Math.PI / 180

function transient(input: string, settings: Partial<Settings> = {}): Cx {
  const s = new Session(settings)
  const r = s.submit(input)
  if (!r.ok) throw new Error(`expected a value, got ${r.error.code} (${r.error.detail})`)
  if (!r.transient) throw new Error('expected an un-assigned expression')
  return r.transient.value
}

function expectCx(input: string, re: number, im: number, settings: Partial<Settings> = {}): void {
  const v = transient(input, settings)
  expect(v.re, `${input} (real part)`).toBeCloseTo(re, 9)
  expect(v.im, `${input} (imaginary part)`).toBeCloseTo(im, 9)
}

describe('the four input forms', () => {
  const CASES: Array<[string, number, number]> = [
    // polar, in degrees (the default unit)
    ['220\\angle 30\\degree', 220 * Math.cos(30 * D), 220 * Math.sin(30 * D)],
    ['220\\angle 30', 220 * Math.cos(30 * D), 220 * Math.sin(30 * D)],
    ['220\\angle -30\\degree', 220 * Math.cos(30 * D), -220 * Math.sin(30 * D)],
    ['220\\angle 2\\cdot 30\\degree', 220 * Math.cos(60 * D), 220 * Math.sin(60 * D)],
    ['10\\angle 90', 0, 10],
    ['10\\angle 180', -10, 0],
    ['\\polar(220, 30)', 220 * Math.cos(30 * D), 220 * Math.sin(30 * D)],
    // rectangular
    ['3+4j', 3, 4],
    ['3-4j', 3, -4],
    ['-3+4j', -3, 4],
    ['j', 0, 1],
    ['-j', 0, -1],
    ['2j', 0, 2],
    ['3+j4', 3, 4],
    // exponential
    ['220e^{j30\\degree}', 220 * Math.cos(30 * D), 220 * Math.sin(30 * D)],
    ['2e^{j\\pi}', -2, 0],
    ['e^{j\\pi/2}', 0, 1],
    // trigonometric
    ['5(\\cos 53\\degree + j\\sin 53\\degree)', 5 * Math.cos(53 * D), 5 * Math.sin(53 * D)],
    ['5\\cos 53\\degree + 5j\\sin 53\\degree', 5 * Math.cos(53 * D), 5 * Math.sin(53 * D)],
    // the magnitude is a plain expression
    ['\\frac{1}{2}+j\\frac{\\sqrt{3}}{2}', 0.5, Math.sqrt(3) / 2],
    ['\\sqrt{2}\\angle 45\\degree', 1, 1],
  ]

  for (const [input, re, im] of CASES) {
    it(`${input} = ${re.toFixed(3)} ${im >= 0 ? '+' : '-'} ${Math.abs(im).toFixed(3)}j`, () => {
      expectCx(input, re, im)
    })
  }
})

describe('modulus and argument functions', () => {
  it('\\abs and |...| agree', () => {
    expectCx('\\abs(3+4j)', 5, 0)
    expectCx('|3+4j|', 5, 0)
    expectCx('|3+4j|\\angle 90', 0, 5)
  })

  it('\\arg returns degrees while the unit is degrees', () => {
    expectCx('\\arg(3+4j)', Math.atan2(4, 3) / D, 0)
    expectCx('\\arg(-1)', 180, 0)
  })

  it('\\arg returns radians while the unit is radians', () => {
    expectCx('\\arg(3+4j)', Math.atan2(4, 3), 0, { angleUnit: 'rad' })
  })

  it('a computed argument can be fed straight back into a phasor', () => {
    const s = new Session()
    s.submit('Z=3+4j')
    s.submit('U=100\\angle \\arg(Z)')
    const u = s.objects.find((o) => o.name === 'U')
    expect(u?.value?.re).toBeCloseTo(100 * Math.cos(Math.atan2(4, 3)), 9)
    expect(u?.value?.im).toBeCloseTo(100 * Math.sin(Math.atan2(4, 3)), 9)
  })

  it('the same holds in radian mode', () => {
    const s = new Session({ angleUnit: 'rad' })
    s.submit('Z=3+4j')
    s.submit('U=100\\angle \\arg(Z)')
    const u = s.objects.find((o) => o.name === 'U')
    expect(u?.value?.re).toBeCloseTo(100 * Math.cos(Math.atan2(4, 3)), 9)
    expect(u?.value?.im).toBeCloseTo(100 * Math.sin(Math.atan2(4, 3)), 9)
  })

  it('\\conj, \\overline, \\Re and \\Im', () => {
    expectCx('\\conj(3+4j)', 3, -4)
    expectCx('\\overline{3+4j}', 3, -4)
    expectCx('\\Re(3+4j)', 3, 0)
    expectCx('\\Im(3+4j)', 4, 0)
  })

  it('\\rms and \\peak convert between conventions', () => {
    expectCx('\\rms(311)', 311 / Math.SQRT2, 0)
    expectCx('\\peak(220)', 220 * Math.SQRT2, 0)
    expectCx('\\om(50)', 2 * Math.PI * 50, 0)
  })

  it('trigonometry follows the angle unit for bare numbers', () => {
    expectCx('\\sin 30', 0.5, 0)
    expectCx('\\sin 30\\degree', 0.5, 0)
    expectCx('\\cos 60', 0.5, 0)
    expectCx('\\tan 45', 1, 0)
    expectCx('\\sin(\\pi/2)', 1, 0, { angleUnit: 'rad' })
    // in radian mode the bare 90 really is 90 radians
    expectCx('\\sin 90', Math.sin(90), 0, { angleUnit: 'rad' })
  })

  it('pocket-calculator inverse functions return the current unit', () => {
    expectCx('\\asin(0.5)', 30, 0)
    expectCx('\\acos(0.5)', 60, 0)
    expectCx('\\atan(1)', 45, 0)
    expectCx('\\atan2(1, 1)', 45, 0)
    expectCx('\\asin(0.5)', Math.PI / 6, 0, { angleUnit: 'rad' })
  })
})

describe('naming', () => {
  it('a definition is remembered and can be reused', () => {
    const s = new Session()
    s.submit('U=220\\angle 30\\degree')
    s.submit('Z=3+4j')
    s.submit('I=U/Z')
    const i = s.objects.find((o) => o.name === 'I')
    const u = s.objects.find((o) => o.name === 'U')!
    const z = s.objects.find((o) => o.name === 'Z')!
    expect(i?.value?.re).toBeCloseTo((u.value!.re * z.value!.re + u.value!.im * z.value!.im) / 25, 9)
    expect(i?.value?.im).toBeCloseTo((u.value!.im * z.value!.re - u.value!.re * z.value!.im) / 25, 9)
  })

  it('subscripts stay part of the name', () => {
    const s = new Session()
    s.submit('U_1=5')
    s.submit('U_{2}=U_1\\cdot 2')
    expect(s.objects.map((o) => o.name)).toEqual(['U_1', 'U_2'])
    expect(s.objects[1].value?.re).toBeCloseTo(10, 9)
  })

  it('a subscript and its braced form are the same name', () => {
    const s = new Session()
    s.submit('X_L=3')
    s.submit('X_{L}=4')
    expect(s.objects).toHaveLength(1)
    expect(s.objects[0].value?.re).toBeCloseTo(4, 9)
  })

  it('a dotted name is the same symbol as the bare one', () => {
    const s = new Session()
    s.submit('\\dot{U}=220\\angle 0\\degree\\text{V}')
    expect(s.objects[0].name).toBe('U')
    expect(s.objects[0].value?.re).toBeCloseTo(220, 9)
    expect(objectLatex(s.objects[0])).toBe('\\dot{U}=220\\angle 0\\degree\\text{V}')
  })

  it('several statements may be typed at once', () => {
    const s = new Session()
    s.submit('a=1;b=2;c=a+b')
    expect(s.objects.map((o) => o.value?.re)).toEqual([1, 2, 3])
  })

  it('definitions resolve no matter which order they were typed in', () => {
    const s = new Session()
    s.submit('I=U/Z')
    s.submit('U=10')
    s.submit('Z=2')
    const i = s.objects.find((o) => o.name === 'I')
    expect(i?.error).toBeUndefined()
    expect(i?.value?.re).toBeCloseTo(5, 9)
  })

  it('a letter run is a product of single-letter names', () => {
    const s = new Session()
    s.submit('a=2;b=3;c=4')
    s.submit('x=abc')
    expect(s.objects.find((o) => o.name === 'x')?.value?.re).toBeCloseTo(24, 9)
  })

  it('\\omega is one name, not w-times-omega', () => {
    const s = new Session()
    s.submit('R=1;\\omega=314;C=1e-5;X=1/(j\\omega C)')
    const x = s.objects.find((o) => o.name === 'X')
    expect(x?.value?.re).toBeCloseTo(0, 9)
    expect(x?.value?.im).toBeCloseTo(-1 / (314 * 1e-5), 9)
  })
})

describe('unit labels', () => {
  it('a trailing unit is kept as a display label', () => {
    const s = new Session()
    s.submit('U=220\\angle 30\\degree\\text{V}')
    expect(s.objects[0].unit).toBe('V')
    expect(s.objects[0].body).toBe('220\\angle 30\\degree')
  })

  it('LaTeX macros inside the label are normalised', () => {
    expect(parseStatement('Z=3+4j\\text{\\Omega}').unit).toBe('\u03a9')
    expect(parseStatement('C=1e-5\\text{\\mu F}').unit).toBe('\u00b5F')
    expect(parseStatement('R=10\\text{k\\Omega}').unit).toBe('k\u03a9')
    expect(parseStatement('f=50\\text{Hz}').unit).toBe('Hz')
  })

  it('an unrecognised label is still a label, never a product of variables', () => {
    // In LaTeX `\text{...}` is text, so it is peeled as a display label even
    // when it is not a unit we know - the number keeps working.
    const s = new Session()
    s.submit('U=1\\text{banana}')
    expect(s.objects[0].unit).toBe('banana')
    expect(s.objects[0].value?.re).toBeCloseTo(1, 9)
    expect(s.objects[0].body).toBe('1')
  })

  it('\\text{V} written after a phasor is still a label', () => {
    const s = new Session()
    s.submit('U=220\\angle 30\\degree\\text{V}')
    expect(s.objects[0].unit).toBe('V')
    expect(s.objects[0].value?.im).toBeCloseTo(110, 9)
  })
})

describe('the angle unit changes what a bare number means', () => {
  function phasor90(settings: Partial<Settings> = {}): Cx {
    const s = new Session(settings)
    s.submit('P=10\\angle 90')
    return s.objects[0].value!
  }

  it('degree mode reads a bare angle as degrees', () => {
    const v = phasor90()
    expect(v.re).toBeCloseTo(0, 9)
    expect(v.im).toBeCloseTo(10, 9)
  })

  it('radian mode reads the very same input as radians', () => {
    const v = phasor90({ angleUnit: 'rad' })
    expect(v.re).toBeCloseTo(10 * Math.cos(90), 9)
    expect(v.im).toBeCloseTo(10 * Math.sin(90), 9)
  })

  it('switching the setting re-reads stored expressions', () => {
    const s = new Session()
    s.submit('P=10\\angle 90')
    expect(s.objects[0].value?.im).toBeCloseTo(10, 9)
    s.updateSettings({ angleUnit: 'rad' })
    expect(s.objects[0].value?.im).toBeCloseTo(10 * Math.sin(90), 9)
    expect(s.objects[0].latex).toBe('P=10\\angle 90')
  })

  it('an explicit degree sign is immune to the setting', () => {
    const s = new Session({ angleUnit: 'rad' })
    s.submit('P=10\\angle 90\\degree')
    expect(s.objects[0].value?.re).toBeCloseTo(0, 9)
    expect(s.objects[0].value?.im).toBeCloseTo(10, 9)
  })
})

describe('broken input is rejected with a specific reason', () => {
  const FAILURES: Array<[string, string]> = [
    ['', 'empty'],
    ['    ', 'empty'],
    ['1+', 'missing-operand'],
    ['220\\angle', 'missing-right-operand'],
    ['\\frac{1}{2+', 'missing-operand'],
    ['|3+4j', 'unclosed-pipe'],
    ['220\\angle 30\\angle 40', 'chained-angle'],
    ['=5', 'missing-operand'],
    ['1+2=3', 'bad-assignment'],
    ['\\frac{1}{2', 'unclosed-brace'],
    ['1+{2', 'unclosed-brace'],
    ['\\unknowncommand', 'unknown-command'],
    ['3 4', 'two-numbers'],
  ]

  for (const [input, code] of FAILURES) {
    it(`${JSON.stringify(input)} -> ${code}`, () => {
      const r = new Session().submit(input)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe(code)
    })
  }

  it('a name that cannot be evaluated yet is kept, not lost', () => {
    const s = new Session()
    const r = s.submit('I=U/Z')
    expect(r.ok).toBe(true)
    expect(s.objects[0].name).toBe('I')
    expect(s.objects[0].value).toBeNull()
    expect(s.objects[0].error).toBeTruthy()
  })

  it('an un-assigned expression that fails is a real error', () => {
    const s = new Session()
    const r = s.submit('nope+1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('eval')
  })

  it('a failing definition does not remove the ones already stored', () => {
    const s = new Session()
    s.submit('A=1')
    const r = s.submit('B=(')
    expect(r.ok).toBe(false)
    expect(s.objects.map((o) => o.name)).toEqual(['A'])
  })
})

describe('the convention factor', () => {
  it('converting to amplitude multiplies every stored value by sqrt(2)', () => {
    const s = new Session()
    s.submit('U=220\\angle 30\\degree\\text{V}')
    s.convertConvention('amplitude')
    expect(s.settings.convention).toBe('amplitude')
    expect(s.objects[0].value?.re).toBeCloseTo(220 * Math.SQRT2 * Math.cos(30 * D), 9)
    expect(s.objects[0].scale).toBeCloseTo(Math.SQRT2, 12)
    expect(s.objects[0].latex).toBe('U=220\\angle 30\\degree')
  })

  it('converting back restores the original value exactly', () => {
    const s = new Session()
    s.submit('U=220\\angle 30\\degree')
    const before = { ...s.objects[0].value! }
    s.convertConvention('amplitude')
    s.convertConvention('rms')
    expect(s.objects[0].value!.re).toBeCloseTo(before.re, 12)
    expect(s.objects[0].value!.im).toBeCloseTo(before.im, 12)
  })

  it('a value typed after the conversion starts at factor 1', () => {
    const s = new Session()
    s.convertConvention('amplitude')
    s.submit('U=311')
    expect(s.objects[0].scale).toBe(1)
    expect(s.objects[0].value?.re).toBeCloseTo(311, 9)
  })

  it('converting to the convention already in force is a no-op', () => {
    const s = new Session()
    s.submit('U=220')
    s.convertConvention('rms')
    expect(s.objects[0].scale).toBe(1)
  })
})
