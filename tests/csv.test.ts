/**
 * CSV import / export.
 *
 * The file format exists so data can go through Excel, which is the strictest
 * test of it: whatever we write must come back as the same numbers, and a file
 * a human typed must load without a manual format lesson.
 */

import { describe, expect, it } from 'vitest'

import { csvToStatements, objectsToCsv } from '../src/core/csv'
import { Session } from '../src/core/session'
import type { PhasorObject } from '../src/core/types'

function seed(): Session {
  const s = new Session()
  s.submit('U=220\\angle 30\\degree\\text{V}')
  s.submit('Z=3+4j')
  return s
}

/** A literal object, for the shapes a session cannot produce. */
function objectWith(over: Partial<PhasorObject> = {}): PhasorObject[] {
  return [{
    id: 1,
    name: 'A',
    latex: 'A=1+2j',
    body: '1+2j',
    expr: '(1 + 2j)',
    value: { re: 1, im: 2 },
    scale: 1,
    phasorMarked: false,
    visible: true,
    color: '#2563eb',
    order: 0,
    ...over,
  }]
}

/** The statements of a file, in order. */
function statementsOf(text: string, angleUnit: 'deg' | 'rad' = 'deg'): string[] {
  const { rows } = csvToStatements(text, angleUnit)
  return rows.map((r) => r.latex)
}

/** Everything a file produced, loaded into a fresh session. */
function sessionFrom(text: string): Session {
  const s = new Session()
  for (const latex of statementsOf(text)) {
    const result = s.submit(latex)
    if (!result.ok) throw new Error(`could not submit ${latex}`)
  }
  return s
}

describe('objectsToCsv', () => {
  it('writes a bilingual header and keeps one row per object, in order', () => {
    const csv = objectsToCsv(seed().objects, { angleUnit: 'deg', convention: 'rms' })
    const lines = csv.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe(
      '名称 name,表达式 expression,代数形式 rect,极坐标 polar,模 |Z|,辐角 arg,单位 unit,备注 note',
    )
    expect(lines[1]?.startsWith('U,220\\angle 30\\degree,')).toBe(true)
    expect(lines[2]?.startsWith('Z,3+4j,')).toBe(true)
    // no BOM: the caller adds it when it writes the file for Excel
    expect(csv.includes('\ufeff')).toBe(false)
  })

  it('carries the unit label, the angle and the modulus', () => {
    const csv = objectsToCsv(seed().objects, { angleUnit: 'deg', convention: 'rms' })
    const fields = (csv.split('\n')[1] ?? '').split(',')
    // the polar column is full data precision, so the 30 degrees that were
    // typed can come back as 29.999999999999993 - the file is data, the display
    // is what rounds
    expect(fields[3]?.startsWith('220V ∠ ')).toBe(true)
    expect(Number.parseFloat((fields[3] ?? '').slice('220V ∠ '.length))).toBeCloseTo(30, 12)
    expect(fields[4]).toBe('220')
    expect(Number.parseFloat(fields[5] ?? '')).toBeCloseTo(30, 12)
    expect(fields[6]).toBe('V')
    expect(csv).toContain('3 + 4j')
    expect(csv).toContain(',5,53.13010235415598')
  })

  it('writes integers without padding and keeps small values readable', () => {
    const csv = objectsToCsv(seed().objects, { angleUnit: 'deg', convention: 'rms' })
    const z = csv.split('\n')[2] ?? ''
    // a true integer must not become `3.00000000000`, and its modulus stays `5`
    expect(z).toContain('5')
    expect(z).toContain(',5,')
    expect(z.includes('3.00000000000')).toBe(false)
  })

  it('writes polar angles in radians when that is the session unit', () => {
    const csv = objectsToCsv(seed().objects, { angleUnit: 'rad', convention: 'rms' })
    const u = csv.split('\n')[1] ?? ''
    expect(u).toContain(' rad')
    // 30 degrees in radians, to full data precision
    expect(u).toMatch(/∠ 0\.5235987755982\d+ rad/)
  })

  it('writes enough digits for a lossless round trip', () => {
    const s = new Session()
    s.submit('A=3.141592653589793+2.718281828459045j')
    const csv = objectsToCsv(s.objects, { angleUnit: 'deg', convention: 'rms' })
    const back = new Session()
    for (const latex of statementsOf(csv)) back.submit(latex)
    const a = back.objects.find((o) => o.name === 'A')?.value
    expect(a?.re).toBeCloseTo(3.141592653589793, 12)
    expect(a?.im).toBeCloseTo(2.718281828459045, 12)
  })

  it('still exports the expression of an object that failed to evaluate', () => {
    const s = new Session()
    s.submit('X=U+1')
    const x = s.objects[0]
    expect(x?.value).toBeNull()
    const line = objectsToCsv(s.objects, { angleUnit: 'deg', convention: 'rms' }).split('\n')[1] ?? ''
    const fields = line.split(',')
    expect(fields[0]).toBe('X')
    expect(fields[1]).toBe('U+1')
    expect(fields[2]).toBe('')
    expect(fields[3]).toBe('')
    expect(fields[4]).toBe('')
    expect(fields[5]).toBe('')
    // the note column carries the evaluation error instead of dropping it
    expect(fields[7]).toBe(x?.error)
    expect(fields[7]).not.toBe('')
  })

  it('quotes a field that contains a comma or a quote', () => {
    const objects = objectWith({ body: '1,000+2j' })
    const objects2 = objectWith({ id: 2, name: 'B', body: 'x"y', value: null, error: 'nope' })
    const csv = objectsToCsv([...objects, ...objects2], { angleUnit: 'deg', convention: 'rms' })
    expect(csv).toContain('"1,000+2j"')
    expect(csv).toContain('"x""y"')

    const parsed = csvToStatements(csv, 'deg')
    expect(parsed.rows[0]?.name).toBe('A')
    // the quotes are doubled inside the field and read back as one quote
    expect(parsed.rows[1]?.latex).toBe('B=x"y')
  })
})

describe('csvToStatements', () => {
  it('round-trips the app own export to the same statements', () => {
    const csv = objectsToCsv(seed().objects, { angleUnit: 'deg', convention: 'rms' })
    // the expression column holds the body; the unit label is folded back in
    // from its own column so the object looks the same after a round trip
    expect(statementsOf(csv)).toEqual(['U=220\\angle 30\\degree\\text{V}', 'Z=3+4j'])
  })

  it('reads a hand-made `name,expression` file', () => {
    const { rows, skipped } = csvToStatements('U1,220\\angle 30', 'deg')
    expect(skipped).toBe(0)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('U1')
    expect(rows[0]?.latex).toBe('U1=220\\angle 30')
    expect(rows[0]?.ok).toBe(true)
  })

  it('reads a single column of bare numbers', () => {
    const { rows } = csvToStatements('190.5\n-3.25\n', 'deg')
    expect(rows.map((r) => r.latex)).toEqual(['190.5', '-3.25'])
    expect(rows.every((r) => r.ok)).toBe(true)
    expect(rows.every((r) => r.name === undefined)).toBe(true)
  })

  it('strips a BOM and accepts CRLF line endings', () => {
    // exactly what a file written by Excel looks like: BOM, CRLF, trailing newline
    const csv = '\ufeff' + '名称 name,表达式 expression\r\nU,220\\angle 30\r\n'
    const { rows, skipped } = csvToStatements(csv, 'deg')
    expect(skipped).toBe(2) // the header plus the empty line after the last CRLF
    expect(rows).toHaveLength(1)
    expect(rows[0]?.latex).toBe('U=220\\angle 30')
    expect(rows[0]?.ok).toBe(true)
  })

  it('skips blank lines and `#` comments', () => {
    const text = ['# a note', 'U=1+2j', '', '   ', '# another', '190.5'].join('\n')
    const { rows, skipped } = csvToStatements(text, 'deg')
    expect(rows.map((r) => r.latex)).toEqual(['U=1+2j', '190.5'])
    expect(skipped).toBe(4)
  })

  it('skips a header row', () => {
    const text = ['expression,unit', '220\\angle 30,V', '190.5,A'].join('\n')
    const { rows, skipped } = csvToStatements(text, 'deg')
    expect(skipped).toBe(1)
    // the values are untouched; the unit column becomes a label on each one
    expect(rows.map((r) => r.latex)).toEqual(['220\\angle 30\\text{V}', '190.5\\text{A}'])
  })

  it('reports a broken expression without throwing', () => {
    const text = ['U,220\\angle 30', '220\\angle', 'V,3+', 'W,\\foo{1}', '190.5'].join('\n')
    let result: ReturnType<typeof csvToStatements> | undefined
    expect(() => {
      result = csvToStatements(text, 'deg')
    }).not.toThrow()
    const rows = result?.rows ?? []
    expect(rows.map((r) => r.ok)).toEqual([true, false, false, false, true])
    expect(rows[1]?.problem).toContain('missing right operand')
    expect(rows[3]?.problem).toContain('unknown command')
    expect(rows[1]?.latex).toBe('220\\angle')
  })

  it('keeps the expression when a third column holds a comment', () => {
    const { rows } = csvToStatements('U1,220\\angle 30,from the exercise sheet', 'deg')
    expect(rows[0]?.name).toBe('U1')
    expect(rows[0]?.latex).toBe('U1=220\\angle 30')
    expect(rows[0]?.ok).toBe(true)
  })

  it('ignores a first column that is not a name', () => {
    const { rows } = csvToStatements('ohms law,190.5', 'deg')
    expect(rows[0]?.latex).toBe('190.5')
    expect(rows[0]?.name).toBeUndefined()
    expect(rows[0]?.ok).toBe(true)
  })

  it('normalises a braced subscript, as the app does', () => {
    const { rows } = csvToStatements('U_{1},220\\angle 30', 'deg')
    expect(rows[0]?.name).toBe('U_1')
    expect(rows[0]?.latex).toBe('U_1=220\\angle 30')
  })

  it('unescapes a quoted field', () => {
    const { rows } = csvToStatements('name,expression\nA,"\\max(3,5)"', 'deg')
    expect(rows[0]?.latex).toBe('A=\\max(3,5)')
    expect(rows[0]?.ok).toBe(true)
  })

  it('returns nothing for an empty file', () => {
    const { rows, skipped } = csvToStatements('', 'deg')
    expect(rows).toEqual([])
    expect(skipped).toBe(1)
  })
})

describe('round trip through a session', () => {
  it('objects -> CSV -> statements -> a new session gives the same values', () => {
    const first = seed()
    const csv = objectsToCsv(first.objects, { angleUnit: 'deg', convention: 'rms' })
    const second = sessionFrom(csv)

    expect(second.objects.map((o) => o.name)).toEqual(['U', 'Z'])
    for (const name of ['U', 'Z']) {
      const before = first.objects.find((o) => o.name === name)?.value
      const after = second.objects.find((o) => o.name === name)?.value
      expect(before).not.toBeNull()
      expect(after).not.toBeNull()
      expect(after?.re).toBeCloseTo(before?.re ?? NaN, 12)
      expect(after?.im).toBeCloseTo(before?.im ?? NaN, 12)
    }
  })

  it('round-trips a dependent object as well', () => {
    const first = new Session()
    first.submit('U=220\\angle 30\\degree\\text{V}')
    first.submit('Z=3+4j')
    first.submit('I=U/Z')
    const csv = objectsToCsv(first.objects, { angleUnit: 'deg', convention: 'rms' })
    const second = sessionFrom(csv)
    const before = first.objects.find((o) => o.name === 'I')?.value
    const after = second.objects.find((o) => o.name === 'I')?.value
    expect(after?.re).toBeCloseTo(before?.re ?? NaN, 12)
    expect(after?.im).toBeCloseTo(before?.im ?? NaN, 12)
  })

  it('the unit label survives the trip in its own column', () => {
    const first = seed()
    const csv = objectsToCsv(first.objects, { angleUnit: 'deg', convention: 'rms' })
    const unit = (csv.split('\n')[1] ?? '').split(',')[6]
    expect(unit).toBe('V')
    const parsed = csvToStatements(csv, 'deg')
    expect(parsed.rows[0]?.name).toBe('U')
  })

  it('and comes back onto the object, not just into the column', () => {
    const first = new Session()
    first.submit('U=220\\angle 30\\degree\\text{V}')
    first.submit('R=10\\text{k\u03a9}')
    const csv = objectsToCsv(first.objects, { angleUnit: 'deg', convention: 'rms' })

    const statements = csvToStatements(csv, 'deg').rows.map((row) => row.latex)
    expect(statements[0]).toContain('\\text{V}')
    expect(statements[1]).toContain('\\text{k\u03a9}')

    const second = sessionFrom(csv)
    expect(second.objects.find((o) => o.name === 'U')?.unit).toBe('V')
    expect(second.objects.find((o) => o.name === 'R')?.unit).toBe('k\u03a9')
    expect(second.objects.find((o) => o.name === 'U')?.value?.re).toBeCloseTo(190.52558883257652, 10)
  })

  it('does not label a row twice, and adds nothing when the unit column is empty', () => {
    const labelled = 'name,expression,unit\nA,220\\angle 30\\degree\\text{A},A\n'
    expect(csvToStatements(labelled, 'deg').rows[0]?.latex).toBe('A=220\\angle 30\\degree\\text{A}')

    const bare = 'name,expression,unit\nA,220\\angle 30\\degree,\n'
    expect(csvToStatements(bare, 'deg').rows[0]?.latex).toBe('A=220\\angle 30\\degree')

    // a hand-made file without a unit column is untouched
    const hand = 'A,220\\angle 30\n'
    expect(csvToStatements(hand, 'deg').rows[0]?.latex).toBe('A=220\\angle 30')
  })
})
