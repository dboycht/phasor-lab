/**
 * Number and phasor formatting. Pure string functions - no DOM, no i18n.
 * All four classic representations of a phasor live here.
 */

import type { Cx, AngleUnit } from './types'
import { isComplexLike } from './scope'

/** Format one real number with a significant-digit budget. */
export function formatNumber(x: number, precision = 6): string {
  if (Number.isNaN(x)) return 'NaN'
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf'
  if (x === 0) return '0'
  const a = Math.abs(x)
  if (a >= 1e12 || a < 1e-6) {
    const parts = x.toExponential(Math.max(0, precision - 1)).split('e')
    const mant = trimZeros(parts[0] as string)
    const exp = (parts[1] as string).replace(/^\+/, '')
    return `${mant}e${exp}`
  }
  return trimZeros(Number(x.toPrecision(precision)).toString())
}

function trimZeros(s: string): string {
  if (!s.includes('.')) return s
  return s.replace(/0+$/, '').replace(/\.$/, '')
}

/** Round a value the same way `formatNumber` displays it (used for zero tests). */
export function roundNumber(x: number, precision = 6): number {
  if (!Number.isFinite(x) || x === 0) return x
  const a = Math.abs(x)
  if (a >= 1e12 || a < 1e-6) return x
  return Number(x.toPrecision(precision))
}

/** magnitude |z| */
export function magnitudeOf(z: Cx): number {
  return Math.hypot(z.re, z.im)
}

/** argument / phase angle, in the requested unit */
export function argumentOf(z: Cx, angleUnit: AngleUnit): number {
  const rad = Math.atan2(z.im, z.re)
  return angleUnit === 'deg' ? (rad * 180) / Math.PI : rad
}

/** effective (RMS) <-> amplitude, for the convention switch */
export function toEffective(z: Cx): Cx {
  return { re: z.re * Math.SQRT1_2, im: z.im * Math.SQRT1_2 }
}
export function toAmplitude(z: Cx): Cx {
  return { re: z.re * Math.SQRT2, im: z.im * Math.SQRT2 }
}

/** Normalise whatever mathjs returned into a plain complex number. */
export function toCx(v: unknown): Cx {
  if (typeof v === 'number') return { re: v, im: 0 }
  if (isComplexLike(v)) return { re: v.re, im: v.im }
  throw new Error('result is not a number')
}

interface FormOptions {
  angleUnit: AngleUnit
  precision: number
  unit?: string
}

function angleSuffix(angleUnit: AngleUnit): string {
  return angleUnit === 'deg' ? '°' : ' rad'
}

/** Rectangular form: `3 + 4j`, `-4j`, `5`, ... */
export function formatRect(z: Cx, precision = 6): string {
  const reZero = roundNumber(z.re, precision) === 0
  const imZero = roundNumber(z.im, precision) === 0
  if (imZero) return formatNumber(z.re, precision)
  const imAbs = formatNumber(Math.abs(z.im), precision)
  const imPart = imAbs === '1' ? 'j' : `${imAbs}j`
  if (reZero) return z.im < 0 ? `-${imPart}` : imPart
  return `${formatNumber(z.re, precision)} ${z.im < 0 ? '-' : '+'} ${imPart}`
}

/** Polar (the electrical engineering form): `220V ∠ 30°` */
export function formatPolar(z: Cx, opts: FormOptions): string {
  const r = formatNumber(magnitudeOf(z), opts.precision)
  const theta = formatNumber(argumentOf(z, opts.angleUnit), opts.precision)
  return `${r}${opts.unit ?? ''} ∠ ${theta}${angleSuffix(opts.angleUnit)}`
}

/** Exponential form: `220V·e^(j30°)` */
export function formatExponential(z: Cx, opts: FormOptions): string {
  const r = formatNumber(magnitudeOf(z), opts.precision)
  const theta = argumentOf(z, opts.angleUnit)
  const shown = formatNumber(Math.abs(theta), opts.precision)
  const sign = theta < 0 ? '-' : ''
  return `${r}${opts.unit ?? ''}·e^(${sign}j${shown}${angleSuffix(opts.angleUnit)})`
}

/** Trigonometric form: `220V(cos30° + j sin30°)` */
export function formatTrig(z: Cx, opts: FormOptions): string {
  const r = formatNumber(magnitudeOf(z), opts.precision)
  const theta = argumentOf(z, opts.angleUnit)
  const shown = formatNumber(Math.abs(theta), opts.precision)
  const sign = theta < 0 ? '-' : '+'
  const s = angleSuffix(opts.angleUnit)
  return `${r}${opts.unit ?? ''}(cos${shown}${s} ${sign} j sin${shown}${s})`
}

/** `{re, im}` -> the LaTeX the mathfield can render back. */
export function cxToLatex(z: Cx, precision = 6): string {
  return formatRect(z, precision)
}
