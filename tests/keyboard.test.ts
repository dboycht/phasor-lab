/**
 * The symbol keyboard is the main input path (typing `\angle` by hand is the
 * exact pain this app exists to remove), so its tables are worth guarding:
 * every key must insert something, the templates must leave a caret slot, the
 * groups must stay separate, and every function key must be able to explain
 * itself in the hint strip.
 */

import { describe, expect, it } from 'vitest'
import { ALL_KEYS, KEY_GROUPS } from '../src/ui/keyboard'

const CJK = /[\u4e00-\u9fff]/
const LATIN = /[A-Za-z]/

describe('symbol keyboard', () => {
  it('splits into labelled groups, with the functions foldable', () => {
    expect(KEY_GROUPS.map((g) => g.id)).toEqual(['symbols', 'units', 'functions'])
    expect(KEY_GROUPS.map((g) => g.titleKey)).toEqual(['keyboard.symbols', 'keyboard.units', 'keyboard.functions'])
    expect(KEY_GROUPS.filter((g) => g.collapsible).map((g) => g.id)).toEqual(['functions'])
    // every group must carry a heading, or the separation is invisible
    for (const group of KEY_GROUPS) expect(group.keys.length).toBeGreaterThan(4)
  })

  it('covers the symbols the four input forms need', () => {
    const inserts = ALL_KEYS.map((k) => k.insert)
    for (const required of ['\\angle', '\\degree', 'j', '\\arg(', '\\abs(', '\\conj(', '\\polar(', '\\rms(', '\\peak(']) {
      expect(inserts.some((s) => s.startsWith(required)), `missing key starting with ${required}`).toBe(true)
    }
  })

  it('offers the parenthesis key with the caret inside', () => {
    const paren = ALL_KEYS.find((k) => k.label.includes('(') && k.insert.startsWith('\\left('))
    expect(paren, 'no parenthesis key').toBeDefined()
    expect(paren?.insert).toBe('\\left(#?\\right)')
  })

  it('offers the extra functions that were asked for', () => {
    const inserts = ALL_KEYS.map((k) => k.insert)
    for (const required of [
      '\\ln(', '\\log(', '\\log2(', '\\exp(', 'e^{', '10^{',
      '\\asin(', '\\acos(', '\\atan(', '\\atan2(',
      '^{', '\\sqrt[', '\\floor(', '\\ceil(', '\\round(',
      '\\pf(', '\\todeg(', '\\torad(', '\\freq(',
    ]) {
      expect(inserts.some((s) => s.startsWith(required)), `missing key starting with ${required}`).toBe(true)
    }
    // "add a few more functions" should stay a decision, not a drift: this is
    // the count the hint strip has to describe
    const functions = KEY_GROUPS.find((g) => g.id === 'functions')
    expect(functions?.keys.length).toBeGreaterThanOrEqual(28)
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

  it('every key can explain itself in the hint strip', () => {
    // the hint line shows title + desc + example; a key without them would
    // silently show nothing on hover
    for (const key of KEY_GROUPS.flatMap((g) => g.keys)) {
      expect(key.title, `${key.label} has no title`).toBeTruthy()
      expect(key.desc, `${key.label} has no description`).toBeTruthy()
      expect(key.example, `${key.label} has no example`).toBeTruthy()
      // the explanation is bilingual like the rest of the UI
      expect(CJK.test(key.desc ?? ''), `${key.label} desc is not bilingual`).toBe(true)
      expect(LATIN.test(key.desc ?? ''), `${key.label} desc is not bilingual`).toBe(true)
    }
  })

  it('keeps the ten unit labels the diagrams show', () => {
    const units = ALL_KEYS.filter((k) => k.insert.startsWith('\\text{')).map((k) => k.insert)
    expect(units).toEqual([
      '\\text{V}', '\\text{A}', '\\text{W}', '\\text{Hz}', '\\text{\u03a9}',
      '\\text{mA}', '\\text{kV}', '\\text{k\u03a9}', '\\text{\u00b5F}', '\\text{mH}',
    ])
  })

  it('never puts a LaTeX command inside a unit label', () => {
    // MathLive's text mode does not accept \Omega or \mu, so `\text{k\Omega}`
    // is shown as "k\Omega" in the input box: unit labels use the literal
    // characters instead (the parser reads them the same way).
    for (const key of KEY_GROUPS.find((g) => g.id === 'units')?.keys ?? []) {
      const inner = /^\\text\{(.*)\}$/.exec(key.insert)?.[1] ?? ''
      expect(inner.includes('\\'), `${key.insert} contains a command inside \text{}`).toBe(false)
    }
  })
})
