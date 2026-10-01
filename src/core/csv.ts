/**
 * CSV import / export for the algebra objects.
 *
 * This is the Excel bridge, so it is deliberately dumb and self-describing:
 * a file the app wrote can be read back by the app, and a file a human typed
 * (`U1,220\angle 30`, a bare column of numbers) works too.
 *
 * Two rules shape everything here:
 *   1. the file is DATA, not a screenshot - numbers are written with enough
 *      digits to survive a round trip, never with the display precision;
 *   2. one bad line must never kill an import - it is reported per row.
 *
 * The returned string carries no BOM: `objectsToCsv` hands text to the caller,
 * which adds the BOM when it writes a file for Excel (Excel needs it to read
 * UTF-8, and a BOM inside the API result would break the round trip).
 */

import type { AngleUnit, Cx, PhasorConvention, PhasorObject } from './types'
import { argumentOf, magnitudeOf } from './format'
import { LatexError, parseStatement } from './latex'

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Column labels. They are bilingual on purpose: the file stays readable for a
 * user in either language AND `csvToStatements` can find the name/expression
 * columns in a file this module wrote (it looks for the same keywords).
 *
 * `备注 note` is our own addition: an object that failed to evaluate still
 * exports its expression, and the error text has to live somewhere - a note
 * column loses nothing and, being last and unrecognised, is ignored on import.
 */
const HEADERS = [
  '名称 name',
  '表达式 expression',
  '代数形式 rect',
  '极坐标 polar',
  '模 |Z|',
  '辐角 arg',
  '单位 unit',
  '备注 note',
] as const

const PRECISION = 12

/**
 * Full-precision number for a data file: the first string that reads back as the
 * very same double (so rect/polar stay lossless), trying the shorter spellings
 * first so ordinary values stay readable (`220`, not `220.000000000000` or
 * `219.99999999999997`).
 */
function fullNumber(x: number): string {
  if (Number.isNaN(x)) return 'NaN'
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf'
  if (x === 0) return '0'
  for (const digits of [PRECISION, 15, 17]) {
    const s = cleanNumber(x.toPrecision(digits))
    if (Number(s) === x) return s
  }
  return cleanNumber(x.toPrecision(17))
}

/**
 * `toPrecision` pads with zeros (`3` -> `3.00000000000`) and may answer in
 * exponential notation (`1.000000000000e-7`). Both are a problem: the padding
 * makes every column noisy, and the LaTeX lexer reads `e-7` as a *variable* e
 * times -7, so such a number must be spelled out as a decimal string.
 */
function cleanNumber(s: string): string {
  if (/e/i.test(s)) return String(Number(s))
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

/** `3 + 4j` / `220V ∠ 30°`, at full data precision. Mirrors `format.ts`. */
function rectText(z: Cx): string {
  const reZero = Number(fullNumber(z.re)) === 0
  const imZero = Number(fullNumber(z.im)) === 0
  if (imZero) return fullNumber(z.re)
  const imAbs = fullNumber(Math.abs(z.im))
  const imPart = imAbs === '1' ? 'j' : `${imAbs}j`
  if (reZero) return z.im < 0 ? `-${imPart}` : imPart
  return `${fullNumber(z.re)} ${z.im < 0 ? '-' : '+'} ${imPart}`
}

function polarText(z: Cx, angleUnit: AngleUnit, unit?: string): string {
  const suffix = angleUnit === 'deg' ? '°' : ' rad'
  return `${fullNumber(magnitudeOf(z))}${unit ?? ''} ∠ ${fullNumber(argumentOf(z, angleUnit))}${suffix}`
}

/** One CSV row per object, for handing to Excel. */
export function objectsToCsv(
  objects: PhasorObject[],
  opts: { angleUnit: AngleUnit; convention: PhasorConvention },
): string {
  // `convention` does not change what we write: the object's value is already
  // stored in the current convention (the scale factor is applied on evaluate),
  // and the expression is the user's own text. The parameter stays in the
  // signature so the caller can pass its settings straight through.
  const angleUnit = opts.angleUnit

  const rows: string[][] = [[...HEADERS]]
  for (const o of objects) {
    const v = o.value
    rows.push([
      o.name,
      o.body,
      v ? rectText(v) : '',
      v ? polarText(v, angleUnit, o.unit) : '',
      v ? fullNumber(magnitudeOf(v)) : '',
      v ? fullNumber(argumentOf(v, angleUnit)) : '',
      o.unit ?? '',
      o.error ?? '',
    ])
  }
  return rows.map((cells) => cells.map(quoteField).join(',')).join('\n')
}

/** RFC 4180: quote only when needed, and double the quotes inside. */
function quoteField(value: string): string {
  if (!/[",\n\r]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface CsvRow {
  /** name from the file, already normalised the same way the app normalises names */
  name?: string
  /** the statement to hand to the session, e.g. `U1=220\angle 30\degree\text{V}` or `220\angle 30` */
  latex: string
  /** false when the expression does not parse; `problem` then says why, in English, short */
  ok: boolean
  problem?: string
}

export interface CsvParseResult {
  rows: CsvRow[]
  /** lines that were blank, comments, or a header row */
  skipped: number
}

const NAME_HEADER = /name|名称/i
const EXPRESSION_HEADER = /expression|latex|表达式/i
const UNIT_HEADER = /unit|单位/i

/**
 * The shape of a variable name the app itself produces: letters (latin or
 * greek, so `\omega_1` survives) with an optional `_` subscript. `U_{1}` is
 * folded to `U_1` first, exactly as the LaTeX lexer does.
 *
 * A column that does not look like this is not treated as a name - a user who
 * put a comment in the first column gets the expression on its own, which is
 * the useful reading.
 */
const NAME_PATTERN = /^[A-Za-z\u0391-\u03c9]+_?\d*$/

/** Accepts the app's own export, `name,expression`, or a single column of expressions. */
export function csvToStatements(text: string, angleUnit: AngleUnit): CsvParseResult {
  const lines = stripBom(text).split(/\r\n|\n|\r/)
  const rows: CsvRow[] = []
  let skipped = 0
  let nameCol: number | undefined
  let exprCol: number | undefined
  let unitCol: number | undefined

  for (const line of lines) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      skipped += 1
      continue
    }

    const fields = splitCsvLine(line)

    // A header is only looked for at the very start of the file, and only by
    // keyword: one that names a name or an expression column. A hand-made file
    // has no header at all, so nothing else is guessed - guessing would eat a
    // first line that really is data.
    if (rows.length === 0 && nameCol === undefined && exprCol === undefined) {
      const nameAt = fields.findIndex((f) => NAME_HEADER.test(f))
      const exprAt = fields.findIndex((f) => EXPRESSION_HEADER.test(f))
      if (exprAt >= 0 || nameAt >= 0) {
        nameCol = nameAt >= 0 ? nameAt : undefined
        exprCol = exprAt >= 0 ? exprAt : undefined
        unitCol = fields.findIndex((f) => UNIT_HEADER.test(f))
        if (unitCol < 0) unitCol = undefined
        skipped += 1
        continue
      }
    }

    rows.push(rowStatement(fields, angleUnit, nameCol, exprCol, unitCol))
  }

  return { rows, skipped }
}

/** Build one row from its fields, resolving the columns when there is no header. */
function rowStatement(
  fields: string[],
  angleUnit: AngleUnit,
  nameCol?: number,
  exprCol?: number,
  unitCol?: number,
): CsvRow {
  let name: string | undefined
  let expression: string

  if (nameCol !== undefined || exprCol !== undefined) {
    name = usableName(fieldAt(fields, nameCol) ?? '')
    expression = (fieldAt(fields, exprCol) ?? fieldAt(fields, fields.length - 1) ?? '').trim()
  } else if (fields.length === 1) {
    // single column: the expression is the only thing on the line
    expression = (fields[0] ?? '').trim()
  } else {
    // No header. `name,expression` is itself a valid expression in LaTeX (the
    // lexer reads the comma as a separator and higher levels reject it, but
    // `ohms law,190.5` still parses as a product), so the pair is only taken
    // apart when the first field really looks like a name AND the second field
    // parses; otherwise the whole line is the expression. That way the app's
    // own export round-trips and a commented first column does not eat the
    // expression, while a bare `220,190.5` is left as one (broken) expression
    // instead of inventing a name out of a number.
    const whole = fields.join(',').trim()
    const candidate = usableName(fields[0] ?? '')
    const rest = (fieldAt(fields, 1) ?? '').trim()
    if (candidate !== undefined && rest !== '' && validate(rest, angleUnit).ok) {
      name = candidate
      expression = rest
    } else if (fields.length === 2 && rest !== '' && validate(rest, angleUnit).ok) {
      // a numeric first column is not a name; keep the expression, drop the rest
      expression = rest
    } else {
      expression = whole
    }
  }

  // The unit label is display-only (it changes no value), but an export that
  // comes back without "V" would look different from what the user sent, so the
  // unit column is folded back into the statement. It is written verbatim:
  // literal characters only, exactly like the app's own unit keys.
  const unit = (fieldAt(fields, unitCol) ?? '').trim()
  if (unit !== '' && !expression.includes('\\text{')) {
    expression = `${expression}\\text{${unit}}`
  }

  const check = validate(expression, angleUnit)
  const out: CsvRow = {
    latex: statementOf(name, expression),
    ok: check.ok,
  }
  if (name !== undefined) out.name = name
  if (check.ok) return out
  out.problem = check.problem ?? 'does not parse'
  return out
}

/** `name=expression` when the name is usable, otherwise just the expression. */
function statementOf(name: string | undefined, expression: string): string {
  return name === undefined ? expression : `${name}=${expression}`
}

/**
 * Does this text parse as one statement? An empty field does not, and an
 * evaluable-but-undefined name (`I=U/Z` before `U` exists) still does: that is
 * the session's job to resolve, not the file's.
 */
function validate(expression: string, angleUnit: AngleUnit): { ok: boolean; problem?: string } {
  if (expression.trim() === '') return { ok: false, problem: 'empty expression' }
  try {
    for (const part of splitOnSemicolon(expression)) parseStatement(part, angleUnit)
  } catch (e) {
    return { ok: false, problem: problemOf(e) }
  }
  // A bare number is a perfectly good expression: `190.5`.
  return { ok: true }
}

/**
 * `parseStatement` reads one statement; a cell holding several (`U=1; I=2`)
 * must not be rejected just because of the separator.
 */
function splitOnSemicolon(text: string): string[] {
  const parts = text.split(';').map((p) => p.trim()).filter((p) => p !== '')
  return parts.length > 0 ? parts : [text]
}

/** Short English reason, e.g. `unknown command \foo`. */
function problemOf(e: unknown): string {
  if (e instanceof LatexError) {
    if (e.code === 'unknown-command') return `unknown command ${e.detail}`
    return `${e.code.replace(/-/g, ' ')}: ${e.detail}`
  }
  return e instanceof Error ? e.message : String(e)
}

/** A field value, or undefined when the column does not exist. */
function fieldAt(fields: string[], index: number | undefined): string | undefined {
  if (index === undefined || index < 0 || index >= fields.length) return undefined
  return fields[index]
}

/** The app's normalised form of a name, or undefined when it is not one. */
function usableName(raw: string): string | undefined {
  const name = raw.trim().replace(/^([A-Za-z\u0391-\u03c9]+)_\{([A-Za-z0-9]+)\}$/, '$1_$2')
  return NAME_PATTERN.test(name) ? name : undefined
}

/** Minimal RFC 4180 reader for one line; commas and quotes only, no newlines. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else { quoted = false }
      } else cur += c
    } else if (c === '"') {
      quoted = true
    } else if (c === ',') {
      fields.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  fields.push(cur)
  return fields
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}
