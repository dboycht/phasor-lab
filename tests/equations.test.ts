/**
 * The linear-equation solver.
 *
 * The interesting cases are the ones that must FAIL politely: a quadratic in the
 * unknowns, three unknowns in one equation, a singular system. Each of those has
 * a test, because "silently wrong" is the only outcome worth fearing here.
 */

import { describe, expect, it } from 'vitest'

import { Session } from '../src/core/session'
import { exactComplex, rationalize, rankOf, solveEquations, solveLinear } from '../src/core/equations'
import type { AngleUnit } from '../src/core/types'

function solve(latex: string, session = new Session(), angleUnit: AngleUnit = 'deg') {
  return solveEquations({
    latex,
    angleUnit,
    math: session.math,
    scope: session.valueScope(),
  })
}

/** Solve and assert success, returning the solution. */
function solution(latex: string, session = new Session()) {
  const result = solve(latex, session)
  if (!result.ok) throw new Error(`expected a solution, got ${result.problem} (${result.detail ?? ''})`)
  return result.solution
}

function approx(actual: { re: number; im: number }, re: number, im = 0, digits = 9): void {
  expect(actual.re).toBeCloseTo(re, digits)
  expect(actual.im).toBeCloseTo(im, digits)
}

describe('equations: one unknown', () => {
  it('solves ax + b = 0 with an integer answer', () => {
    const s = solution('2x+6=0')
    expect(s.names).toEqual(['x'])
    approx(s.values[0]!, -3)
    expect(s.exact[0]).toBe('-3')
    expect(s.decimals[0]).toBe('-3')
  })

  it('reports a fraction exactly and as a decimal', () => {
    const s = solution('3x=1')
    approx(s.values[0]!, 1 / 3)
    expect(s.exact[0]).toBe('1/3')
    expect(s.decimals[0]).toBe('0.333333')
  })

  it('keeps a rational that is not a simple fraction of small numbers', () => {
    const s = solution('8x-0.4=0')
    approx(s.values[0]!, 0.05)
    expect(s.exact[0]).toBe('1/20')
  })

  it('handles the unknown on both sides and nested brackets', () => {
    const s = solution('2(x-1)=3(x+2)')
    approx(s.values[0]!, -8)
  })

  it('solves a complex equation', () => {
    // (3+4j)x = 10  ->  x = 10/(3+4j) = 1.2 - 1.6j
    const s = solution('(3+4j)x=10')
    approx(s.values[0]!, 1.2, -1.6)
    expect(s.exact[0]).toBe('6/5 - 8/5j')
  })

  it('accepts a polar right hand side and an angle in degrees', () => {
    const s = solution('x=220\\angle 30\\degree')
    approx(s.values[0]!, 220 * Math.cos(Math.PI / 6), 220 * Math.sin(Math.PI / 6))
  })

  it('verifies the solution by substituting it back', () => {
    const s = solution('2x+6=0')
    expect(s.checks).toHaveLength(1)
    expect(s.checks[0]!.left).toBe('0')
    expect(s.checks[0]!.right).toBe('0')
    expect(s.checks[0]!.residual).toBeLessThan(1e-12)
  })
})

describe('equations: systems', () => {
  it('solves a 2x2 system', () => {
    const s = solution('3x+4y=10; x-y=1')
    expect(s.names).toEqual(['x', 'y'])
    approx(s.values[0]!, 2)
    approx(s.values[1]!, 1)
    expect(s.checks).toHaveLength(2)
    for (const check of s.checks) expect(check.residual).toBeLessThan(1e-12)
  })

  it('solves a 3x3 system', () => {
    // x=1, y=2, z=3 - substituted into all three by hand before writing this
    const s = solution('x+y+z=6; 2x-y+z=3; x+2y-z=2')
    expect(s.names).toEqual(['x', 'y', 'z'])
    approx(s.values[0]!, 1)
    approx(s.values[1]!, 2)
    approx(s.values[2]!, 3)
    expect(s.exact).toEqual(['1', '2', '3'])
  })

  it('keeps a 3x3 answer exact when it is a fraction', () => {
    // the same system with 6 replaced by 7: x = 6/7, y = 17/7, z = 26/7
    // (substituted back into equations 2 and 3 by hand: 21/7 = 3 and 14/7 = 2)
    const s = solution('x+y+z=7; 2x-y+z=3; x+2y-z=2')
    expect(s.exact[0]).toBe('6/7')
    expect(s.exact[1]).toBe('17/7')
    expect(s.exact[2]).toBe('26/7')
    for (const check of s.checks) expect(check.residual).toBeLessThan(1e-12)
  })

  it('solves a complex 2x2 system, the way mesh analysis arrives', () => {
    // (3+4j)I1 + 2I2 = 10 ; 2I1 + (5-1j)I2 = 0
    const s = solution('(3+4j)I1+2I2=10; 2I1+(5-j)I2=0')
    expect(s.names).toEqual(['I_1', 'I_2'])
    // substitute back: both equations must hold
    for (const check of s.checks) expect(check.residual).toBeLessThan(1e-12)
  })

  it('accepts a defined object as a coefficient', () => {
    const session = new Session()
    session.submit('U=10')
    session.submit('Z=3+4j')
    const s = solution('Z*I=U', session)
    expect(s.names).toEqual(['I'])
    approx(s.values[0]!, 1.2, -1.6)
  })

  it('does not treat a defined name as an unknown', () => {
    const session = new Session()
    session.submit('U=10')
    const result = solve('2x=U', session)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.solution.names).toEqual(['x'])
  })
})

describe('equations: the failures that must not be silent', () => {
  it('refuses a quadratic instead of answering something', () => {
    const result = solve('x^2=4')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.problem).toBe('not-linear')
      expect(result.detail).toBe('x^2=4')
    }
  })

  it('refuses a product of two unknowns', () => {
    const result = solve('xy=6; x+y=5')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problem).toBe('not-linear')
  })

  it('asks for as many equations as unknowns', () => {
    const result = solve('2x+3y=6')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.problem).toBe('mismatch')
      expect(result.detail).toContain('2 unknown')
    }
  })

  it('reports a system with no solution', () => {
    const result = solve('x+y=1; x+y=2')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problem).toBe('no-solution')
  })

  it('reports a system with infinitely many solutions', () => {
    const result = solve('x+y=1; 2x+2y=2')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problem).toBe('many-solutions')
  })

  it('needs an equals sign', () => {
    const result = solve('2x+6')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problem).toBe('bad-equation')
  })

  it('needs at least one unknown', () => {
    const result = solve('2=2')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problem).toBe('no-unknowns')
  })

  it('caps the number of unknowns', () => {
    const result = solve('a+b+c+d=1')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.problem).toBe('too-many-unknowns')
      expect(result.detail).toBe('a, b, c, d')
    }
  })

  it('reports a parse error with the offending text', () => {
    const result = solve('2x+\\frac{1}{2}=')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.problem).toBe('parse')
      expect(result.detail).toContain('\\frac')
    }
  })
})

describe('equations: the pieces', () => {
  it('rationalises what is rational and refuses what is not', () => {
    expect(rationalize(0.5)).toEqual({ p: 1, q: 2 })
    expect(rationalize(-2.25)).toEqual({ p: -9, q: 4 })
    expect(rationalize(0)).toEqual({ p: 0, q: 1 })
    expect(rationalize(Math.SQRT2)).toBeUndefined()
    expect(rationalize(1 / 3)).toEqual({ p: 1, q: 3 })
  })

  it('writes an exact complex number readably', () => {
    expect(exactComplex({ re: -3, im: 0 })).toBe('-3')
    expect(exactComplex({ re: 1.2, im: -1.6 })).toBe('6/5 - 8/5j')
    expect(exactComplex({ re: 0, im: 0.5 })).toBe('1/2j')
    expect(exactComplex({ re: 0, im: -1 })).toBe('-j')
    expect(exactComplex({ re: Math.SQRT2, im: 0 })).toBeUndefined()
  })

  it('solves a linear system directly, and reports the degenerate cases', () => {
    const identity = [
      [{ re: 1, im: 0 }, { re: 0, im: 0 }],
      [{ re: 0, im: 0 }, { re: 1, im: 0 }],
    ]
    const solved = solveLinear(identity, [{ re: 2, im: 0 }, { re: -1, im: 0 }])
    expect(solved.kind).toBe('unique')
    if (solved.kind === 'unique') {
      approx(solved.x[0]!, 2)
      approx(solved.x[1]!, -1)
    }
    const singular = [
      [{ re: 1, im: 0 }, { re: 1, im: 0 }],
      [{ re: 2, im: 0 }, { re: 2, im: 0 }],
    ]
    expect(solveLinear(singular, [{ re: 1, im: 0 }, { re: 2, im: 0 }]).kind).toBe('many')
    expect(solveLinear(singular, [{ re: 1, im: 0 }, { re: 3, im: 0 }]).kind).toBe('none')
  })

  it('ranks a matrix by its minors', () => {
    expect(rankOf([[{ re: 1, im: 0 }, { re: 2, im: 0 }]], 1e-9)).toBe(1)
    expect(rankOf([[{ re: 1, im: 0 }, { re: 2, im: 0 }], [{ re: 2, im: 0 }, { re: 4, im: 0 }]], 1e-9)).toBe(1)
    expect(rankOf([[{ re: 1, im: 0 }, { re: 2, im: 0 }], [{ re: 2, im: 0 }, { re: 5, im: 0 }]], 1e-9)).toBe(2)
  })
})
