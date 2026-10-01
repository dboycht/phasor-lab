import { describe, it, expect } from 'vitest'
import type { MathJsInstance } from 'mathjs'
import { LatexError, parseInput, parseStatement, splitStatements, toExpr } from '../src/core/latex'
import { buildScope, createMath } from '../src/core/scope'
import { DEFAULT_SETTINGS, type AngleUnit } from '../src/core/types'

const math: MathJsInstance = createMath()

const BASE_VARS = {
  omega: 2 * Math.PI * 50,
  C: 1e-6,
  R: 3,
  X: 4,
}

/** evaluate a generated expression exactly the way the app does */
function ev(latex: string, angleUnit: AngleUnit = 'deg'): unknown {
  const settings = { ...DEFAULT_SETTINGS, angleUnit }
  const scope = { ...buildScope(math, settings), ...BASE_VARS }
  return math.evaluate(parseStatement(latex, angleUnit).expr, scope)
}

function cx(v: unknown): { re: number; im: number } {
  if (typeof v === 'number') return { re: v, im: 0 }
  const c = v as { re: number; im: number }
  return { re: c.re, im: c.im }
}

function near(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps * Math.max(1, Math.abs(b))
}

const R30 = 190.52558883257648 // 220*cos30

describe('latex -> expression: code generation', () => {
  it('polar literal with an explicit degree sign', () => {
    expect(parseStatement('220\\angle 30\\degree').expr).toBe('(220 * polar(1, ((30) * pi / 180)))')
  })

  it('polar literal with a bare number uses the angle unit', () => {
    expect(parseStatement('220\\angle -45', 'deg').expr).toBe('(220 * polar(1, (((-45)) * pi / 180)))')
    expect(parseStatement('220\\angle 0.5', 'rad').expr).toBe('(220 * polar(1, 0.5))')
  })

  it('unicode angle and degree signs behave like the commands', () => {
    expect(parseStatement('220\u2220 30\u00b0').expr).toBe('(220 * polar(1, ((30) * pi / 180)))')
  })

  it('a degree sign inside a product is not converted twice', () => {
    expect(parseStatement('220\\angle 2\\cdot 30\\degree').expr).toBe('(220 * polar(1, (2 * ((30) * pi / 180))))')
  })

  it('the angle sign rotates what is on its left', () => {
    // `r\angle theta` is generated as `r * 1\angle theta`: identical for a plain
    // magnitude, and a rotation when the left side is itself a phasor
    expect(parseStatement('A\\angle 30\\degree').expr).toBe('(A * polar(1, ((30) * pi / 180)))')
  })

  it('fraction with an implicit product in the denominator', () => {
    expect(parseStatement('X_C=\\frac{1}{\\omega C}').expr).toBe('(1 / (omega * C))')
  })

  it('a full polar term over a rectangular denominator', () => {
    expect(parseStatement('I=\\frac{220\\angle 0\\degree}{3+4j}').expr)
      .toBe('((220 * polar(1, ((0) * pi / 180))) / (3 + (4 * j)))')
  })

  it('phasor dot is a marker, not a derivative', () => {
    const st = parseStatement('\\dot{U}=220\\angle 30\\degree')
    expect(st.name).toBe('U')
    expect(st.phasorMarked).toBe(true)
    expect(st.expr).toBe('(220 * polar(1, ((30) * pi / 180)))')
  })

  it('subscript identifiers survive', () => {
    expect(parseStatement('U_1 + U_2').expr).toBe('(U_1 + U_2)')
    expect(parseStatement('X_{L}').expr).toBe('X_L')
  })

  it('conjugate via overline', () => {
    expect(parseStatement('\\overline{Z}').expr).toBe('conj(Z)')
  })

  it('modulus via pipes', () => {
    expect(parseStatement('|3+4j|').expr).toBe('abs((3 + (4 * j)))')
  })

  it('implicit multiplication between a number, a greek symbol and a name', () => {
    expect(parseStatement('2\\omega C').expr).toBe('((2 * omega) * C)')
  })

  it('exponential form e^{j\\theta}', () => {
    expect(parseStatement('220e^{j30\\degree}').expr).toBe('(220 * (e ^ (j * ((30) * pi / 180))))')
  })

  it('square root, also without braces', () => {
    expect(parseStatement('\\sqrt{2}').expr).toBe('sqrt(2)')
    expect(parseStatement('\\sqrt2').expr).toBe('sqrt(2)')
  })

  it('trigonometric form r(cos + j sin)', () => {
    expect(parseStatement('5(\\cos 53.13\\degree + j\\sin 53.13\\degree)').expr)
      .toBe('(5 * (cos(((53.13) * pi / 180)) + (j * sin(((53.13) * pi / 180)))))')
  })

  it('a bare trigonometric argument follows the angle unit', () => {
    expect(parseStatement('\\sin 30', 'deg').expr).toBe('sin(((30) * pi / 180))')
    expect(parseStatement('\\sin 30', 'rad').expr).toBe('sin(30)')
  })

  it('angle-valued results are not re-converted on the way in', () => {
    expect(parseStatement('\\arg(3+4j)').expr).toBe('arg((3 + (4 * j)))')
    expect(parseStatement('\\atan(1)').expr).toBe('atan(1)')
  })

  it('functions by command, by word and by operatorname', () => {
    expect(parseStatement('abs(3+4j)').expr).toBe('abs((3 + (4 * j)))')
    expect(parseStatement('\\operatorname{conj}(Z)').expr).toBe('conj(Z)')
    expect(parseStatement('\\Re(Z)').expr).toBe('re(Z)')
  })

  it('\\ln and \\log map to the right mathjs functions', () => {
    expect(parseStatement('\\ln(e)').expr).toBe('log(e)')
    expect(parseStatement('\\log(100)').expr).toBe('log10(100)')
  })

  it('trailing unit label is peeled off and kept', () => {
    const st = parseStatement('220\\angle 30\\degree\\text{V}')
    expect(st.unit).toBe('V')
    expect(st.expr).toBe('(220 * polar(1, ((30) * pi / 180)))')
  })

  it('a frequency unit is also peeled off', () => {
    const st = parseStatement('50\\text{Hz}')
    expect(st.unit).toBe('Hz')
    expect(st.expr).toBe('50')
  })

  it('a latex macro inside the unit label is normalised', () => {
    expect(parseStatement('Z=3+4j\\text{\\Omega}').unit).toBe('\u03a9')
    expect(parseStatement('C=1e-5\\text{\\mu F}').unit).toBe('\u00b5F')
    expect(parseStatement('R=10\\text{k\\Omega}').unit).toBe('k\u03a9')
  })
})

describe('latex -> expression: evaluation', () => {
  it('220 at 30 degrees in rectangular form', () => {
    const v = cx(ev('220\\angle 30\\degree'))
    expect(near(v.re, R30, 1e-12)).toBe(true)
    expect(near(v.im, 110, 1e-12)).toBe(true)
  })

  it('negative angles are not converted twice', () => {
    const v = cx(ev('220\\angle -30\\degree'))
    expect(near(v.re, R30, 1e-12)).toBe(true)
    expect(near(v.im, -110, 1e-12)).toBe(true)
  })

  it('a bare angle follows the mode', () => {
    const d = cx(ev('10\\angle 90', 'deg'))
    expect(near(d.re, 0, 1e-12)).toBe(true)
    expect(near(d.im, 10, 1e-12)).toBe(true)
    const r = cx(ev('10\\angle 0', 'rad'))
    expect(near(r.re, 10, 1e-12)).toBe(true)
  })

  it('a degree sign always means degrees, even in radian mode', () => {
    const v = cx(ev('10\\angle 90\\degree', 'rad'))
    expect(near(v.re, 0, 1e-12)).toBe(true)
    expect(near(v.im, 10, 1e-12)).toBe(true)
  })

  it('exponential form equals the polar form', () => {
    const v = cx(ev('220e^{j30\\degree}'))
    expect(near(v.re, R30, 1e-12)).toBe(true)
    expect(near(v.im, 110, 1e-12)).toBe(true)
  })

  it('trigonometric form equals the polar form', () => {
    const v = cx(ev('5(\\cos 53.13010235415598\\degree + j\\sin 53.13010235415598\\degree)'))
    expect(near(v.re, 3, 1e-9)).toBe(true)
    expect(near(v.im, 4, 1e-9)).toBe(true)
  })

  it('modulus and argument', () => {
    expect(ev('|3+4j|')).toBe(5)
    expect(near(ev('\\arg(3+4j)') as number, 53.13010235415598, 1e-12)).toBe(true)
    expect(near(ev('\\arg(3+4j)', 'rad') as number, Math.atan2(4, 3), 1e-12)).toBe(true)
  })

  it('trigonometry follows the angle unit like a pocket calculator', () => {
    expect(near(ev('\\sin(30)', 'deg') as number, 0.5, 1e-12)).toBe(true)
    expect(near(ev('\\sin(30\\degree)', 'rad') as number, 0.5, 1e-12)).toBe(true)
    expect(near(ev('\\asin(0.5)', 'deg') as number, 30, 1e-12)).toBe(true)
  })

  it('conjugate', () => {
    const v = cx(ev('\\overline{3+4j}'))
    expect(v.re).toBe(3)
    expect(v.im).toBe(-4)
  })

  it('division of phasors (the classic U/Z)', () => {
    const v = cx(ev('\\frac{220\\angle 0\\degree}{3+4j}'))
    expect(near(v.re, 26.4, 1e-12)).toBe(true)
    expect(near(v.im, -35.2, 1e-12)).toBe(true)
  })

  it('rms / peak helpers', () => {
    expect(near(cx(ev('\\rms(220)')).re, 155.56349186104046, 1e-12)).toBe(true)
    const p = cx(ev('\\peak(220\\angle 0\\degree)'))
    expect(near(p.re, 311.1269837220809, 1e-12)).toBe(true)
  })

  it('scientific notation', () => {
    expect(ev('2e-3')).toBe(0.002)
  })

  it('reactance 1/(omega C)', () => {
    expect(near(ev('\\frac{1}{\\omega C}') as number, 3183.098861837907, 1e-9)).toBe(true)
  })

  it('a variable holding an angle composes with the angle sign', () => {
    const settings = { ...DEFAULT_SETTINGS, angleUnit: 'deg' as AngleUnit }
    const scope = { ...buildScope(math, settings) }
    scope.phi = math.evaluate(parseStatement('\\arg(3+4j)', 'deg').expr, scope)
    const v = math.evaluate(parseStatement('10\\angle \\phi', 'deg').expr, scope) as unknown
    const c = cx(v)
    expect(near(c.re, 6, 1e-9)).toBe(true)
    expect(near(c.im, 8, 1e-9)).toBe(true)
  })
})

describe('latex -> expression: statements and errors', () => {
  it('splits on semicolons', () => {
    expect(splitStatements('a=1;b=2')).toEqual(['a=1', 'b=2'])
  })

  it('splits on a latex line break', () => {
    expect(splitStatements('a=1\\\\b=2')).toEqual(['a=1', 'b=2'])
  })

  it('parses several statements at once', () => {
    const list = parseInput('U=220\\angle 0\\degree; I=U/(3+4j)')
    expect(list.map((s) => s.name)).toEqual(['U', 'I'])
  })

  it('reports two adjacent numbers', () => {
    expect(() => parseStatement('2 3')).toThrow(LatexError)
    try { parseStatement('2 3') } catch (e) { expect((e as LatexError).code).toBe('two-numbers') }
  })

  it('reports an unknown command', () => {
    try { parseStatement('\\foo(2)'); expect.unreachable() } catch (e) { expect((e as LatexError).code).toBe('unknown-command') }
  })

  it('reports a missing right operand after the angle sign', () => {
    try { parseStatement('220\\angle'); expect.unreachable() } catch (e) { expect((e as LatexError).code).toBe('missing-right-operand') }
  })

  it('reports a chained angle literal', () => {
    try { parseStatement('1\\angle 2\\angle 3'); expect.unreachable() } catch (e) { expect((e as LatexError).code).toBe('chained-angle') }
  })

  it('reports an unclosed pipe', () => {
    try { parseStatement('|3+4'); expect.unreachable() } catch (e) { expect((e as LatexError).code).toBe('unclosed-pipe') }
  })

  it('reports an unclosed brace', () => {
    try { parseStatement('\\frac{1}{2'); expect.unreachable() } catch (e) { expect((e as LatexError).code).toBe('unclosed-brace') }
  })

  it('rejects a bad assignment', () => {
    try { parseStatement('1+1 = 2'); expect.unreachable() } catch (e) { expect((e as LatexError).code).toBe('bad-assignment') }
  })

  it('reports an empty input', () => {
    try { parseStatement('   '); expect.unreachable() } catch (e) { expect((e as LatexError).code).toBe('empty') }
  })

  it('toExpr is stable for a nested case', () => {
    const st = parseStatement('Z = R + jX')
    expect(toExpr(st.ast)).toBe('(R + (j * X))')
  })
})
