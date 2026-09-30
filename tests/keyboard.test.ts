/**
 * The symbol keyboard is the main input path (typing `\angle` by hand is the
 * exact pain this app exists to remove), so its tables are worth guarding:
 * every key must insert something, the templates must leave a caret slot, and
 * no tooltip may be Chinese-only - that would be unreadable in the English UI.
 */

import { describe, expect, it } from 'vitest'
import { ALL_KEYS } from '../src/ui/keyboard'

const CJK = /[\u4e00-\u9fff]/
const LATIN = /[A-Za-z]/

describe('symbol keyboard', () => {
  it('covers the symbols the four input forms need', () => {
    const inserts = ALL_KEYS.map((k) => k.insert)
    for (const required of ['\\angle', '\\degree', 'j', '\\arg(', '\\abs(', '\\conj(', '\\polar(', '\\rms(', '\\peak(']) {
      expect(inserts.some((s) => s.startsWith(required)), `missing key starting with ${required}`).toBe(true)
    }
  })

  it('every key inserts text at the caret', () => {
    for (const key of ALL_KEYS) {
      expect(key.insert.length, `empty insert for ${key.label}`).toBeGreaterThan(0)
      expect(key.label.length, 'empty label').toBeGreaterThan(0)
    }
  })

  it('keys that open a group leave the caret inside it', () => {
    // a key that ends by opening a brace/paren with no #? slot would leave the
    // caret outside the group ("\frac{"), which is worse than typing by hand
    const templateKeys = ALL_KEYS.filter((k) => k.insert.includes('#'))
    expect(templateKeys.length).toBeGreaterThan(8)
    for (const key of ALL_KEYS) {
      const withoutSlot = key.insert.replace('#?', '')
      if (/[({[]\s*$/.test(withoutSlot)) {
        expect(key.insert.includes('#?'), `key ${key.label} opens a group but has no #? slot`).toBe(true)
      }
    }
  })

  it('no tooltip is Chinese-only (the UI switches language at runtime)', () => {
    const cjkOnly = ALL_KEYS.filter((k) => k.title !== undefined && CJK.test(k.title) && !LATIN.test(k.title))
    expect(cjkOnly.map((k) => `${k.label}: ${k.title}`)).toEqual([])
  })

  it('keeps the ten unit labels the diagrams show', () => {
    const units = ALL_KEYS.filter((k) => k.insert.startsWith('\\text{')).map((k) => k.insert)
    expect(units).toEqual([
      '\\text{V}', '\\text{A}', '\\text{W}', '\\text{Hz}', '\\text{\\Omega}',
      '\\text{mA}', '\\text{kV}', '\\text{k\\Omega}', '\\text{\\mu F}', '\\text{mH}',
    ])
  })
})
