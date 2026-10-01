/**
 * The linear-equation solver ("一次方程计算器").
 *
 * Why probing instead of algebra: the equations arrive as *mathjs expressions*
 * (the converter turns `3x+4y=10` into `((3 * x) + (4 * y)) - 10`), so the solver
 * never has to take expressions apart. For an expression that is AFFINE in the
 * unknowns,
 *
 *     f(0)          = the constant term
 *     f(e_j) - f(0) = column j of the coefficient matrix
 *
 * so n+1 evaluations give the exact system A x = -c, for any number of unknowns
 * and with complex coefficients - which is exactly what mesh and nodal analysis
 * need. One more evaluation at a point that is not on a unit axis **proves** the
 * expression really was affine: if the two disagree, the input was not a linear
 * equation and the user is told that instead of being handed a wrong answer.
 *
 * Everything here is pure: no DOM, no i18n, no session. The caller supplies the
 * evaluation scope (which may already hold the user's variables, so a
 * coefficient can be `U`, `Z`, even `220\angle 30\degree`).
 */

import type { MathJsInstance } from 'mathjs'

import { parseStatement, splitStatements, type Node } from './latex'
import { formatNumber, toCx } from './format'
import type { AngleUnit, Cx } from './types'

/** Symbols that are values, never unknowns. */
const CONSTANT_SYMBOLS = new Set(['pi', 'e', 'i', 'j'])

/** At most three unknowns: n+1 probes keep this cheap and the UI readable. */
export const MAX_UNKNOWNS = 3

export type EquationProblem =
  | 'empty'
  | 'bad-equation'
  | 'parse'
  | 'no-unknowns'
  | 'too-many-unknowns'
  | 'mismatch'
  | 'not-linear'
  | 'no-solution'
  | 'many-solutions'

export interface EquationCheck {
  /** the equation exactly as written */
  source: string
  /** left and right hand sides evaluated at the solution */
  left: string
  right: string
  /** |left - right| scaled by the size of the two sides */
  residual: number
}

export interface EquationSolution {
  /** the unknowns, in the order they first appear */
  names: string[]
  values: Cx[]
  /** `p/q` (or `p/q + (r/s)j`) when the answer is a simple rational */
  exact: Array<string | undefined>
  /** one decimal string per unknown */
  decimals: string[]
  /** residual of every equation once the solution is substituted back */
  checks: EquationCheck[]
}

export type SolverResult =
  | { ok: true; solution: EquationSolution }
  | { ok: false; problem: EquationProblem; detail?: string }

export interface SolveOptions {
  latex: string
  angleUnit: AngleUnit
  math: MathJsInstance
  /** evaluation scope: settings helpers plus whatever the user has defined */
  scope: Record<string, unknown>
  /** significant digits used for the decimal form */
  precision?: number
}

// ------------------------------------------------------------------ complex

const add = (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im })
const sub = (a: Cx, b: Cx): Cx => ({ re: a.re - b.re, im: a.im - b.im })
const mul = (a: Cx, b: Cx): Cx => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re })
const abs = (a: Cx): number => Math.hypot(a.re, a.im)

function div(a: Cx, b: Cx): Cx {
  const d = b.re * b.re + b.im * b.im
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }
}

function det2(m: Cx[][]): Cx {
  return sub(mul(m[0]![0]!, m[1]![1]!), mul(m[0]![1]!, m[1]![0]!))
}

function det3(m: Cx[][]): Cx {
  const [a, b, c] = m[0]!
  const [d, e, f] = m[1]!
  const [g, h, i] = m[2]!
  return add(
    sub(mul(a!, det2([[e!, f!], [h!, i!]])), mul(b!, det2([[d!, f!], [g!, i!]]))),
    mul(c!, det2([[d!, e!], [g!, h!]])),
  )
}

/** Determinant for the sizes we allow (1x1 .. 3x3). */
export function determinant(m: Cx[][]): Cx {
  if (m.length === 1) return m[0]![0]!
  if (m.length === 2) return det2(m)
  return det3(m)
}

/** Relative zero test: everything is compared against the largest entry. */
function scaleOf(rows: Cx[][]): number {
  let s = 0
  for (const row of rows) for (const v of row) s = Math.max(s, abs(v))
  return s === 0 ? 1 : s
}

/** Rouché–Capelli rank, by brute force over minors (n, cols <= 4). */
export function rankOf(rows: Cx[][], tol: number): number {
  const n = rows.length
  const cols = rows[0]?.length ?? 0
  const minor = (rs: number[], cs: number[]): Cx[][] => rs.map((r) => cs.map((c) => rows[r]![c]!))
  const choose = (total: number, k: number): number[][] => {
    const out: number[][] = []
    const walk = (start: number, picked: number[]): void => {
      if (picked.length === k) {
        out.push([...picked])
        return
      }
      for (let i = start; i < total; i++) walk(i + 1, [...picked, i])
    }
    walk(0, [])
    return out
  }
  if (n >= 3 && cols >= 3) {
    for (const rs of choose(n, 3)) {
      for (const cs of choose(cols, 3)) {
        if (abs(determinant(minor(rs, cs))) > tol) return 3
      }
    }
  }
  if (n >= 2 && cols >= 2) {
    for (const rs of choose(n, 2)) {
      for (const cs of choose(cols, 2)) {
        if (abs(det2(minor(rs, cs))) > tol) return 2
      }
    }
  }
  for (const row of rows) for (const v of row) if (abs(v) > tol) return 1
  return 0
}

export type LinearOutcome = { kind: 'unique'; x: Cx[] } | { kind: 'none' } | { kind: 'many' }

/** Solve A x = b exactly (n <= 3) by Cramer's rule, with a rank check. */
export function solveLinear(A: Cx[][], b: Cx[]): LinearOutcome {
  const n = A.length
  const tol = scaleOf(A.map((row, i) => [...row, b[i]!])) * 1e-9 + 1e-12
  const d = determinant(A)
  if (abs(d) <= tol) {
    const rows = A.map((row, i) => [...row, b[i]!])
    return rankOf(rows, tol) > rankOf(A, tol) ? { kind: 'none' } : { kind: 'many' }
  }
  const x: Cx[] = []
  for (let j = 0; j < n; j++) {
    const Aj = A.map((row) => [...row])
    for (let i = 0; i < n; i++) Aj[i]![j] = b[i]!
    x.push(div(determinant(Aj), d))
  }
  return { kind: 'unique', x }
}

// -------------------------------------------------------------- exact form

/** Continued-fraction rationalisation; undefined when it is not a simple ratio. */
export function rationalize(x: number, maxDenominator = 100000): { p: number; q: number } | undefined {
  if (!Number.isFinite(x)) return undefined
  const sign = x < 0 ? -1 : 1
  const target = Math.abs(x)
  if (target === 0) return { p: 0, q: 1 }
  let h0 = 0
  let h1 = 1
  let k0 = 1
  let k1 = 0
  let frac = target
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(frac)
    const h2 = a * h1 + h0
    const k2 = a * k1 + k0
    if (k2 > maxDenominator) break
    h0 = h1
    h1 = h2
    k0 = k1
    k1 = k2
    if (Math.abs(h1 / k1 - target) <= 1e-12 * Math.max(1, target)) {
      const p = sign * h1
      return p === 0 ? { p: 0, q: 1 } : { p, q: k1 }
    }
    const rest = frac - a
    if (rest < 1e-15) break
    frac = 1 / rest
  }
  return undefined
}

function fractionText(p: number, q: number): string {
  return q === 1 ? String(p) : `${p}/${q}`
}

/** A rational, human-readable form of a complex number, when there is one. */
export function exactComplex(z: Cx, tolerance = 1e-9): string | undefined {
  const size = Math.max(1, abs(z))
  const reIsZero = Math.abs(z.re) <= tolerance * size
  const imIsZero = Math.abs(z.im) <= tolerance * size
  if (imIsZero) {
    const r = rationalize(z.re)
    return r ? fractionText(r.p, r.q) : undefined
  }
  const im = rationalize(z.im)
  if (!im) return undefined
  const imSign = im.p < 0 ? '-' : '+'
  const imAbs = { p: Math.abs(im.p), q: im.q }
  const imText = imAbs.q === 1 && imAbs.p === 1 ? 'j' : `${fractionText(imAbs.p, imAbs.q)}j`
  if (reIsZero) return im.p < 0 ? `-${imText}` : imText
  const re = rationalize(z.re)
  if (!re) return undefined
  return `${fractionText(re.p, re.q)} ${imSign} ${imText}`
}

// ------------------------------------------------------------------ parsing

interface ParsedEquation {
  source: string
  /** left - right, ready to evaluate */
  expr: string
  lhsExpr: string
  rhsExpr: string
  symbols: string[]
}

/** Split on the first `=` that is not inside braces or parentheses. */
function splitOnEquals(text: string): [string, string] | undefined {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '{' || c === '(' || c === '[') depth++
    else if (c === '}' || c === ')' || c === ']') depth--
    else if (c === '=' && depth === 0) return [text.slice(0, i), text.slice(i + 1)]
  }
  return undefined
}

function collectSymbols(node: Node, into: Set<string>): void {
  switch (node.k) {
    case 'sym': into.add(node.name); return
    case 'num': return
    case 'call': node.args.forEach((a) => collectSymbols(a, into)); return
    case 'neg': case 'pos': case 'deg': case 'conj': case 'abs': collectSymbols(node.a, into); return
    case 'bin': collectSymbols(node.a, into); collectSymbols(node.b, into); return
    case 'polar': collectSymbols(node.r, into); collectSymbols(node.theta, into); return
  }
}

function parseEquation(
  text: string,
  angleUnit: AngleUnit,
): { ok: true; equation: ParsedEquation } | { ok: false; problem: EquationProblem; detail?: string } {
  const split = splitOnEquals(text)
  if (!split) return { ok: false, problem: 'bad-equation', detail: text.trim() }
  try {
    const left = parseStatement(split[0]!, angleUnit)
    const right = parseStatement(split[1]!, angleUnit)
    const symbols = new Set<string>()
    collectSymbols(left.ast, symbols)
    collectSymbols(right.ast, symbols)
    return {
      ok: true,
      equation: {
        source: text.trim(),
        expr: `(${left.expr}) - (${right.expr})`,
        lhsExpr: left.expr,
        rhsExpr: right.expr,
        symbols: [...symbols],
      },
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, problem: 'parse', detail: `${text.trim()} (${detail})` }
  }
}

// ------------------------------------------------------------------- solving

/** Deterministic probe points that are NOT on a unit axis. */
const AFFINITY_PROBE = [{ re: 0.37, im: -0.21 }, { re: -1.13, im: 0.53 }, { re: 0.71, im: 1.19 }]

export function solveEquations(options: SolveOptions): SolverResult {
  const { latex, angleUnit, math, scope, precision = 6 } = options
  const sources = splitStatements(latex).map((s) => s.trim()).filter((s) => s !== '')
  if (sources.length === 0) return { ok: false, problem: 'empty' }

  const parsed: ParsedEquation[] = []
  for (const source of sources) {
    const result = parseEquation(source, angleUnit)
    if (!result.ok) return { ok: false, problem: result.problem, detail: result.detail }
    parsed.push(result.equation)
  }

  // unknowns: symbols that are neither constants nor something already defined
  const defined = new Set(Object.keys(scope))
  const names: string[] = []
  for (const equation of parsed) {
    for (const symbol of equation.symbols) {
      if (CONSTANT_SYMBOLS.has(symbol) || defined.has(symbol)) continue
      if (!names.includes(symbol)) names.push(symbol)
    }
  }
  if (names.length === 0) return { ok: false, problem: 'no-unknowns' }
  if (names.length > MAX_UNKNOWNS) return { ok: false, problem: 'too-many-unknowns', detail: names.join(', ') }
  if (parsed.length !== names.length) {
    return {
      ok: false,
      problem: 'mismatch',
      detail: `${names.length} unknown(s), ${parsed.length} equation(s)`,
    }
  }

  const evaluate = (expr: string, assignments: Cx[]): Cx => {
    const local: Record<string, unknown> = { ...scope }
    names.forEach((name, i) => {
      const v = assignments[i]!
      local[name] = math.complex(v.re, v.im)
    })
    return toCx(math.evaluate(expr, local))
  }

  const n = names.length
  const zero: Cx[] = names.map(() => ({ re: 0, im: 0 }))
  const constant = parsed.map((eq) => evaluate(eq.expr, zero))
  const A: Cx[][] = parsed.map((_, i) => {
    const row: Cx[] = []
    for (let j = 0; j < n; j++) {
      const unit = names.map((__, k) => (k === j ? { re: 1, im: 0 } : { re: 0, im: 0 }))
      row.push(sub(evaluate(parsed[i]!.expr, unit), constant[i]!))
    }
    return row
  })
  const b: Cx[] = constant.map((c) => ({ re: -c.re, im: -c.im }))

  // is it really linear? check f(x) == A x + c somewhere off the unit axes
  const probe = names.map((_, i) => AFFINITY_PROBE[i % AFFINITY_PROBE.length]!)
  for (let i = 0; i < parsed.length; i++) {
    const atProbe = evaluate(parsed[i]!.expr, probe)
    const linear = names.reduce<Cx>((acc, __, j) => add(acc, mul(A[i]![j]!, probe[j]!)), constant[i]!)
    const gap = abs(sub(atProbe, linear))
    const size = Math.max(abs(atProbe), abs(linear), 1)
    if (gap > 1e-9 * size) {
      return { ok: false, problem: 'not-linear', detail: parsed[i]!.source }
    }
  }

  const outcome = solveLinear(A, b)
  if (outcome.kind === 'none') return { ok: false, problem: 'no-solution' }
  if (outcome.kind === 'many') return { ok: false, problem: 'many-solutions' }

  const values = outcome.x
  const showComplex = (v: Cx): string => {
    const imTiny = Math.abs(v.im) <= 1e-12 * Math.max(1, abs(v))
    const re = formatNumber(v.re, precision)
    if (imTiny) return re
    return `${re} ${v.im < 0 ? '-' : '+'} ${formatNumber(Math.abs(v.im), precision)}j`
  }
  const checks: EquationCheck[] = parsed.map((eq) => {
    const left = evaluate(eq.lhsExpr, values)
    const right = evaluate(eq.rhsExpr, values)
    const gap = abs(sub(left, right))
    return {
      source: eq.source,
      left: showComplex(left),
      right: showComplex(right),
      residual: gap / Math.max(1, abs(left), abs(right)),
    }
  })

  return {
    ok: true,
    solution: {
      names,
      values,
      exact: values.map((v) => exactComplex(v)),
      decimals: values.map(showComplex),
      checks,
    },
  }
}
