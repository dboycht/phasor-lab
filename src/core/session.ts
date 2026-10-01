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
  | { ok: true; transient?: TransientResult; objects: PhasorObject[]; autoNamed?: string[] }
  | { ok: false; error: FieldError }

/**
 * Options for `submit`.
 *
 * `autoName` gives a name to statements the user did not name, so a bare
 * expression becomes a real object (A, B, ... Z, A1, ...) instead of a
 * throw-away result. The core keeps the transient behaviour by default: the UI
 * asks for naming, the tests and the file format do not have to.
 */
export interface SubmitOptions {
  autoName?: boolean
}

/** One saved project: the source of truth is the LaTeX the user typed. */
export interface ProjectObject {
  /** the full source of the object, unit label included */
  latex: string
  scale: number
  visible: boolean
}

export interface Project {
  app: 'phasor-lab'
  /** bump when the shape of this file changes incompatibly */
  version: 1
  settings: Settings
  objects: ProjectObject[]
  /** whatever is in the equation card (optional: older files do not have it) */
  equation?: string
}

export const PROJECT_VERSION = 1

interface Snapshot {
  objects: PhasorObject[]
  order: number
  transient?: TransientResult
  settings: Settings
}

const HISTORY_LIMIT = 120

let nextId = 1

/**
 * The next short name that is still free: A, B, ... Z, then A1, B1, ... Z1,
 * then A2, ... (GeoGebra-style). `taken` must include every name already in use
 * plus the ones handed out earlier in the same input line.
 */
export function nextFreeName(taken: ReadonlySet<string>): string {
  for (let suffix = 0; suffix < 100; suffix++) {
    for (let i = 0; i < 26; i++) {
      const name = String.fromCharCode(65 + i) + (suffix === 0 ? '' : String(suffix))
      if (!taken.has(name)) return name
    }
  }
  return 'X'
}

export class Session {
  readonly math: MathJsInstance
  settings: Settings
  objects: PhasorObject[] = []
  /** the last un-assigned expression, shown in the result card */
  transient?: TransientResult

  private order = 0
  private past: Snapshot[] = []
  private future: Snapshot[] = []

  constructor(settings: Partial<Settings> = {}) {
    this.math = createMath()
    this.settings = { ...DEFAULT_SETTINGS, ...settings }
  }

  // ---------------------------------------------------------------- input

  /** Parse and evaluate one input line (may contain several statements). */
  submit(latex: string, options: SubmitOptions = {}): SubmitResult {
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
    const autoNamed: string[] = []
    const taken = new Set(this.objects.map((o) => o.name))

    for (const st of statements) {
      let value: Cx | null = null
      let evalError: string | undefined
      try {
        value = toCx(this.math.evaluate(st.expr, scope))
      } catch (e) {
        evalError = messageOf(e)
      }

      let name = st.name
      if (!name && options.autoName) {
        // A bare expression becomes a named object; `taken` also covers names
        // handed out earlier in this same line.
        name = nextFreeName(taken)
        taken.add(name)
        autoNamed.push(name)
      }

      if (name) {
        // A definition that does not resolve yet is still recorded: it may be
        // waiting for a variable that is typed on the next line.
        staged.push({
          name,
          latex: name === st.name ? st.latex : `${name}=${st.latex}`,
          body: st.body,
          expr: st.expr,
          value,
          unit: st.unit,
          phasorMarked: st.phasorMarked,
          error: evalError,
        })
        if (value) this.seedScope(scope, name, value)
      } else {
        if (!value) return { ok: false, error: { code: 'eval', detail: evalError ?? 'not-a-number' } }
        transient = { latex: st.latex, expr: st.expr, value, unit: st.unit }
      }
    }

    this.checkpoint()

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
    return {
      ok: true,
      transient: this.transient,
      objects: this.objects,
      autoNamed: autoNamed.length > 0 ? autoNamed : undefined,
    }
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
    if (i < 0) return
    this.checkpoint()
    this.objects.splice(i, 1)
    this.rebuild()
  }

  clear(): void {
    if (this.objects.length === 0 && !this.transient) return
    this.checkpoint()
    this.objects = []
    this.transient = undefined
    this.order = 0
  }

  setVisible(id: number, visible: boolean): void {
    const o = this.objects.find((x) => x.id === id)
    if (!o || o.visible === visible) return
    this.checkpoint()
    o.visible = visible
  }

  toggleVisible(id: number): void {
    const o = this.objects.find((x) => x.id === id)
    if (o) this.setVisible(id, !o.visible)
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
    this.checkpoint()
    const k = to === 'amplitude' ? Math.SQRT2 : Math.SQRT1_2
    for (const o of this.objects) o.scale *= k
    this.settings = { ...this.settings, convention: to }
    this.rebuild()
  }

  updateSettings(patch: Partial<Settings>): void {
    const angleChanged = patch.angleUnit !== undefined && patch.angleUnit !== this.settings.angleUnit
    this.checkpoint()
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

  // --------------------------------------------------------- undo and redo

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  /** Forget the undo history (used after restoring a project at start-up). */
  forgetHistory(): void {
    this.past = []
    this.future = []
  }

  undo(): boolean {
    const previous = this.past.pop()
    if (!previous) return false
    this.future.push(this.snapshot())
    this.apply(previous)
    return true
  }

  redo(): boolean {
    const next = this.future.pop()
    if (!next) return false
    this.past.push(this.snapshot())
    this.apply(next)
    return true
  }

  /** Remember the current state. Called before every mutation. */
  private checkpoint(): void {
    this.past.push(this.snapshot())
    if (this.past.length > HISTORY_LIMIT) this.past.shift()
    this.future = []
  }

  private snapshot(): Snapshot {
    return {
      objects: this.objects.map(cloneObject),
      order: this.order,
      transient: this.transient
        ? { ...this.transient, value: { ...this.transient.value } }
        : undefined,
      settings: { ...this.settings },
    }
  }

  private apply(s: Snapshot): void {
    this.objects = s.objects.map(cloneObject)
    this.order = s.order
    this.transient = s.transient
      ? { ...s.transient, value: { ...s.transient.value } }
      : undefined
    this.settings = { ...s.settings }
    this.rebuild()
  }

  // ------------------------------------------------------- project files

  /** The whole session as a portable, human-readable project. */
  toProject(): Project {
    return {
      app: 'phasor-lab',
      version: PROJECT_VERSION,
      settings: { ...this.settings },
      objects: this.objects.map((o) => ({
        latex: objectLatex(o),
        scale: o.scale,
        visible: o.visible,
      })),
    }
  }

  /**
   * Replace everything with a loaded project.
   *
   * The stored LaTeX is re-parsed from scratch, so a file written by an older
   * version still gets the current semantics (and a broken one is reported
   * instead of silently producing wrong numbers).
   */
  loadProject(project: Project): FieldError | undefined {
    if (!project || project.app !== 'phasor-lab' || !Array.isArray(project.objects)) {
      return { code: 'eval', detail: 'bad-project' }
    }
    const before = this.snapshot()
    const savedPast = this.past
    const savedFuture = this.future

    this.objects = []
    this.transient = undefined
    this.order = 0
    this.settings = { ...DEFAULT_SETTINGS, ...project.settings }

    const scales: number[] = []
    const visibles: boolean[] = []
    let failure: FieldError | undefined
    for (const entry of project.objects) {
      const result = this.submit(String(entry.latex ?? ''))
      if (!result.ok) {
        failure = result.error
        break
      }
      scales.push(typeof entry.scale === 'number' && entry.scale > 0 ? entry.scale : 1)
      visibles.push(entry.visible !== false)
    }

    if (failure) {
      // nothing half-loaded: the previous project stays exactly as it was
      this.apply(before)
      this.past = savedPast
      this.future = savedFuture
      return failure
    }

    this.objects.forEach((o, i) => {
      o.scale = scales[i] ?? 1
      o.visible = visibles[i] ?? true
    })
    // loading is a single user action, so it costs a single undo step
    this.past = [before]
    this.future = []
    this.rebuild()
    return undefined
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

  /**
   * A scope with the current settings helpers plus every object's current value.
   * Used by the equation solver, so a coefficient may be any defined quantity
   * (`3I_1 + U = 10`).
   */
  valueScope(): Record<string, unknown> {
    const scope = buildScope(this.math, this.settings)
    for (const o of this.objects) {
      if (o.value) this.seedScope(scope, o.name, o.value)
    }
    return scope
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

/** Objects are plain data, so a shallow copy plus the value is a real copy. */
function cloneObject(o: PhasorObject): PhasorObject {
  return { ...o, value: o.value ? { ...o.value } : null }
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
