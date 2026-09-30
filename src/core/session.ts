/**
 * The compute session: the algebra view's model.
 *
 * Objects keep the LaTeX the user typed as their source of truth, so changing
 * the angle unit (or anything else the parser cares about) simply re-parses and
 * re-evaluates everything. Definitions are resolved in dependency order by
 * repeating passes, which means `I = U/Z` may be typed before `U` and `Z`.
 */

import type { MathJsInstance } from 'mathjs'
import { LatexError, parseInput, parseStatement, type LatexErrorCode } from './latex'
import { buildScope, createMath } from './scope'
import { toCx } from './format'
import {
  colorFor,
  DEFAULT_SETTINGS,
  type AngleUnit,
  type Cx,
  type PhasorObject,
  type PhasorConvention,
  type Settings,
} from './types'

export interface FieldError {
  code: LatexErrorCode | 'eval'
  detail: string
  /** 1-based character offset in the input, when known */
  pos?: number
}

export interface TransientResult {
  latex: string
  expr: string
  value: Cx
  unit?: string
}

export type SubmitResult =
  | { ok: true; transient?: TransientResult; objects: PhasorObject[] }
  | { ok: false; error: FieldError }

let nextId = 1

export class Session {
  readonly math: MathJsInstance
  settings: Settings
  objects: PhasorObject[] = []
  /** the last un-assigned expression, shown in the result card */
  transient?: TransientResult

  private order = 0

  constructor(settings: Partial<Settings> = {}) {
    this.math = createMath()
    this.settings = { ...DEFAULT_SETTINGS, ...settings }
  }

  // ---------------------------------------------------------------- input

  /** Parse and evaluate one input line (may contain several statements). */
  submit(latex: string): SubmitResult {
    let statements
    try {
      statements = parseInput(latex, this.settings.angleUnit)
    } catch (e) {
      return { ok: false, error: toFieldError(e) }
    }
    if (statements.length === 0) {
      return { ok: false, error: { code: 'empty', detail: '' } }
    }

    // Evaluate first so a typo does not half-modify the object list.
    const scope = buildScope(this.math, this.settings)
    for (const o of this.objects) {
      if (o.value) this.seedScope(scope, o.name, o.value)
    }

    const staged: Array<{
      name: string
      latex: string
      body: string
      expr: string
      value: Cx | null
      unit?: string
      phasorMarked: boolean
      error?: string
    }> = []
    let transient: TransientResult | undefined

    for (const st of statements) {
      let value: Cx | null = null
      let evalError: string | undefined
      try {
        value = toCx(this.math.evaluate(st.expr, scope))
      } catch (e) {
        evalError = messageOf(e)
      }

      if (st.name) {
        // A definition that does not resolve yet is still recorded: it may be
        // waiting for a variable that is typed on the next line.
        staged.push({
          name: st.name,
          latex: st.latex,
          body: st.body,
          expr: st.expr,
          value,
          unit: st.unit,
          phasorMarked: st.phasorMarked,
          error: evalError,
        })
        if (value) this.seedScope(scope, st.name, value)
      } else {
        if (!value) return { ok: false, error: { code: 'eval', detail: evalError ?? 'not-a-number' } }
        transient = { latex: st.latex, expr: st.expr, value, unit: st.unit }
      }
    }

    for (const s of staged) {
      const existing = this.objects.find((o) => o.name === s.name)
      if (existing) {
        existing.latex = s.latex
        existing.body = s.body
        existing.expr = s.expr
        existing.unit = s.unit
        existing.value = s.value
        existing.error = s.error
        // a freshly typed value is already in the current convention
        existing.scale = 1
        existing.phasorMarked = s.phasorMarked || existing.phasorMarked
        existing.visible = true
      } else {
        this.objects.push({
          id: nextId++,
          name: s.name,
          latex: s.latex,
          body: s.body,
          expr: s.expr,
          value: s.value,
          scale: 1,
          error: s.error,
          unit: s.unit,
          phasorMarked: s.phasorMarked,
          visible: true,
          color: colorFor(this.order),
          order: this.order,
        })
        this.order += 1
      }
    }

    this.transient = transient
    this.rebuild()
    return { ok: true, transient: this.transient, objects: this.objects }
  }

  /** Re-evaluate one object's stored LaTeX (used after an inline edit). */
  reedit(id: number, latex: string): SubmitResult {
    const target = this.objects.find((o) => o.id === id)
    if (!target) return { ok: false, error: { code: 'eval', detail: 'no-such-object' } }
    const result = this.submit(latex)
    if (result.ok) this.transient = undefined
    return result
  }

  // ------------------------------------------------------------- mutations

  remove(id: number): void {
    const i = this.objects.findIndex((o) => o.id === id)
    if (i >= 0) this.objects.splice(i, 1)
    this.rebuild()
  }

  clear(): void {
    this.objects = []
    this.transient = undefined
    this.order = 0
  }

  setVisible(id: number, visible: boolean): void {
    const o = this.objects.find((x) => x.id === id)
    if (o) o.visible = visible
  }

  toggleVisible(id: number): void {
    const o = this.objects.find((x) => x.id === id)
    if (o) o.visible = !o.visible
  }

  /**
   * Rescale every object into the requested convention.
   *
   * The expression the user typed is never rewritten - the factor lives on the
   * object, so the conversion is exact, reversible and visible as a badge.
   * A value typed *after* the conversion starts at factor 1, because it is
   * already written in the new convention.
   */
  convertConvention(to: PhasorConvention): void {
    if (to === this.settings.convention) return
    const k = to === 'amplitude' ? Math.SQRT2 : Math.SQRT1_2
    for (const o of this.objects) o.scale *= k
    this.settings = { ...this.settings, convention: to }
    this.rebuild()
  }

  updateSettings(patch: Partial<Settings>): void {
    const angleChanged = patch.angleUnit !== undefined && patch.angleUnit !== this.settings.angleUnit
    this.settings = { ...this.settings, ...patch }

    if (angleChanged) {
      // the stored LaTeX is the source of truth: re-parse it in the new unit
      for (const o of this.objects) {
        try {
          const st = parseStatement(o.latex, this.settings.angleUnit)
          o.expr = st.expr
          o.unit = st.unit
        } catch (e) {
          o.expr = ''
          o.error = describe(e)
        }
      }
      if (this.transient) {
        try {
          this.transient.expr = parseStatement(this.transient.latex, this.settings.angleUnit).expr
        } catch { /* keep the old expression */ }
      }
    }

    this.rebuild()
  }

  // ------------------------------------------------------------ evaluation

  /** Re-evaluate every object, in as many passes as dependencies require. */
  rebuild(): void {
    const scope = buildScope(this.math, this.settings)

    for (const o of this.objects) {
      o.value = null
      o.error = o.expr === '' ? 'empty' : undefined
    }

    let remaining = this.objects.filter((o) => o.expr !== '')
    let progress = true
    while (progress && remaining.length > 0) {
      progress = false
      const stillFailing: PhasorObject[] = []
      for (const o of remaining) {
        try {
          const value = scaleCx(toCx(this.math.evaluate(o.expr, scope)), o.scale)
          o.value = value
          o.error = undefined
          this.seedScope(scope, o.name, value)
          progress = true
        } catch (e) {
          o.error = messageOf(e)
          stillFailing.push(o)
        }
      }
      remaining = stillFailing
    }

    if (this.transient) {
      try {
        this.transient.value = toCx(this.math.evaluate(this.transient.expr, scope))
      } catch { /* keep the last good value */ }
    }
  }

  /** variables the user can reference but that are not objects */
  private seedScope(scope: Record<string, unknown>, name: string, value: Cx): void {
    scope[name] = this.math.complex(value.re, value.im)
  }

  // ---------------------------------------------------------------- lookup

  byId(id: number): PhasorObject | undefined {
    return this.objects.find((o) => o.id === id)
  }

  get angleUnit(): AngleUnit {
    return this.settings.angleUnit
  }
}

// ------------------------------------------------------------------ helpers

/** The full LaTeX of an object, unit label included - what the edit box shows. */
export function objectLatex(o: PhasorObject): string {
  return o.latex + (o.unit ? `\\text{${o.unit}}` : '')
}

/** Apply the per-object convention factor to a freshly evaluated value. */
function scaleCx(z: Cx, k: number): Cx {
  if (k === 1) return z
  return { re: z.re * k, im: z.im * k }
}

function describe(e: unknown): string {
  if (e instanceof LatexError) return e.code
  return messageOf(e)
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

export function toFieldError(e: unknown): FieldError {
  if (e instanceof LatexError) {
    return { code: e.code, detail: e.detail, pos: e.pos }
  }
  return { code: 'eval', detail: messageOf(e) }
}
