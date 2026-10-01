/**
 * User-configurable shortcuts.
 *
 * The table is data, the bindings are a plain record inside `Settings`, and the
 * key handler only ever consults `shortcutIndex`. The interesting behaviour to
 * pin down is the refusal path: a combination that the browser or the app
 * already owns, one without Alt, and one that another action already uses must
 * all be rejected, otherwise a "shortcut" silently does something else.
 */

import { describe, expect, it } from 'vitest'

import {
  checkBinding,
  checkCombo,
  comboFromEvent,
  comboText,
  defaultCombo,
  formatCombo,
  keyName,
  matchShortcut,
  parseCombo,
  resolveShortcuts,
  RESERVED_COMBOS,
  SHORTCUT_ACTIONS,
  shortcutIndex,
} from '../src/core/shortcuts'
import { Session } from '../src/core/session'

/** What a keydown event carries, in the shape the helpers want. */
function press(code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean } = { ctrl: true, alt: true }) {
  return {
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
    metaKey: false,
    code,
  }
}

describe('shortcuts: the table', () => {
  it('has unique ids, unique default combinations and a label for every action', () => {
    const ids = SHORTCUT_ACTIONS.map((a) => a.id)
    const combos = SHORTCUT_ACTIONS.map((a) => a.combo)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(combos).size).toBe(combos.length)
    for (const action of SHORTCUT_ACTIONS) {
      expect(action.label.length, action.id).toBeGreaterThan(0)
      expect(action.insert.length, action.id).toBeGreaterThan(0)
      expect(checkCombo(action.combo).ok, `${action.id} default is not allowed`).toBe(true)
    }
  })

  it('keeps the two the request named, plus the painful LaTeX spellings', () => {
    const byId = new Map(SHORTCUT_ACTIONS.map((a) => [a.id, a]))
    expect(byId.get('root')?.combo).toBe('Ctrl+Alt+KeyR')
    expect(byId.get('angle')?.combo).toBe('Ctrl+Alt+KeyA')
    expect(byId.get('subscript')?.combo).toBe('Ctrl+Alt+KeyS')
    expect(byId.get('subscript')?.autoExit).toBe(true)
    expect(byId.get('conjugate')?.insert.startsWith('\\overline')).toBe(true)
  })

  it('shortcuts that open a group leave the caret inside it', () => {
    // "\frac{" would leave the caret outside the braces, which is worse than
    // typing the command by hand
    for (const action of SHORTCUT_ACTIONS) {
      const withoutSlot = action.insert.replace('#?', '')
      if (/[({[]\s*$/.test(withoutSlot)) {
        expect(action.insert.includes('#?'), `${action.id} opens a group with no slot`).toBe(true)
      }
    }
  })

  it('writes combination names the way users read them', () => {
    expect(comboText('Ctrl+Alt+KeyR')).toBe('Ctrl+Alt+R')
    expect(comboText('Alt+Shift+Digit1')).toBe('Alt+Shift+1')
    expect(comboText('F5')).toBe('F5')
    expect(comboText('Ctrl+Alt+Semicolon')).toBe('Ctrl+Alt+;')
    expect(keyName('Numpad3')).toBe('\u5c0f\u952e\u76d8 3')
  })

  it('parses and re-formats a combination without changing it', () => {
    const combo = parseCombo('Ctrl+Alt+KeyR')
    expect(combo).toEqual({ ctrl: true, alt: true, shift: false, meta: false, code: 'KeyR' })
    expect(formatCombo(combo)).toBe('Ctrl+Alt+KeyR')
    // flag order is canonical, so equal combinations compare equal
    expect(formatCombo(parseCombo('Alt+Ctrl+KeyR'))).toBe('Ctrl+Alt+KeyR')
    expect(() => parseCombo('Ctrl+Alt')).toThrow()
  })

  it('reads a combination out of a keyboard event', () => {
    expect(comboFromEvent(press('KeyR'))).toBe('Ctrl+Alt+KeyR')
    expect(comboFromEvent(press('KeyR', { ctrl: true, alt: false }))).toBe('Ctrl+KeyR')
    expect(comboFromEvent(press('Digit1', { alt: true }))).toBe('Alt+Digit1')
  })
})

describe('shortcuts: what must be refused', () => {
  it('refuses a bare modifier or an unknown code', () => {
    expect(checkCombo('Ctrl+Alt+ControlLeft')).toEqual({ ok: false, problem: 'not-a-key' })
    expect(checkCombo('Ctrl+Alt+ShiftRight')).toEqual({ ok: false, problem: 'not-a-key' })
    expect(checkCombo('')).toEqual({ ok: false, problem: 'not-a-key' })
  })

  it('refuses a combination with no Alt unless it is a function key', () => {
    // Ctrl+R and Ctrl+S belong to the browser
    expect(checkCombo('Ctrl+KeyR')).toEqual({ ok: false, problem: 'needs-modifier' })
    expect(checkCombo('Shift+KeyR')).toEqual({ ok: false, problem: 'needs-modifier' })
    expect(checkCombo('KeyR')).toEqual({ ok: false, problem: 'needs-modifier' })
    expect(checkCombo('F5').ok).toBe(true)
  })

  it('refuses the combinations the app itself owns', () => {
    expect(RESERVED_COMBOS).toContain('Ctrl+KeyZ')
    expect(checkCombo('Ctrl+KeyZ')).toEqual({ ok: false, problem: 'reserved' })
    expect(checkCombo('Ctrl+Shift+KeyZ')).toEqual({ ok: false, problem: 'reserved' })
    expect(checkCombo('Ctrl+KeyY')).toEqual({ ok: false, problem: 'reserved' })
  })

  it('refuses a combination another action already uses, and names it', () => {
    const taken = checkBinding('Ctrl+Alt+KeyR', 'angle', undefined)
    expect(taken.ok).toBe(false)
    expect(taken.problem).toBe('duplicate')
    expect(taken.other).toBe('root')
    // the action may keep its own combination
    expect(checkBinding('Ctrl+Alt+KeyR', 'root', undefined).ok).toBe(true)
  })

  it('lets an action take over a combination that was switched off', () => {
    const bindings = { root: null }
    expect(checkBinding('Ctrl+Alt+KeyR', 'angle', bindings).ok).toBe(true)
  })
})

describe('shortcuts: bindings', () => {
  it('starts from the table defaults when nothing was changed', () => {
    const resolved = resolveShortcuts(undefined)
    expect(resolved).toHaveLength(SHORTCUT_ACTIONS.length)
    for (const shortcut of resolved) {
      expect(shortcut.enabled).toBe(true)
      expect(shortcut.effective).toBe(shortcut.combo)
      expect(shortcut.keyLabel).toBeDefined()
    }
  })

  it('applies a rebound combination and hides a disabled one', () => {
    const resolved = resolveShortcuts({ root: 'Alt+Shift+KeyQ', angle: null })
    const root = resolved.find((s) => s.id === 'root')!
    const angle = resolved.find((s) => s.id === 'angle')!
    expect(root.effective).toBe('Alt+Shift+KeyQ')
    expect(root.keyLabel).toBe('Q')
    expect(angle.enabled).toBe(false)
    expect(angle.keyLabel).toBeUndefined()
  })

  it('indexes only the enabled actions', () => {
    const index = shortcutIndex({ root: null })
    expect(index.has('Ctrl+Alt+KeyR')).toBe(false)
    expect(index.has('Ctrl+Alt+KeyA')).toBe(true)
    expect(index.get('Ctrl+Alt+KeyA')?.id).toBe('angle')
  })

  it('gives a duplicated combination to the first action in table order', () => {
    // only a hand-edited file can get here, but the outcome must not depend on
    // object key order
    const index = shortcutIndex({ angle: 'Ctrl+Alt+KeyR' })
    expect(index.get('Ctrl+Alt+KeyR')?.id).toBe('root')
  })

  it('matches an event against the index, and ignores a longer combination', () => {
    const index = shortcutIndex(undefined)
    expect(matchShortcut(press('KeyR'), index)?.id).toBe('root')
    expect(matchShortcut(press('KeyR', { ctrl: true, alt: true, shift: true }), index)).toBeUndefined()
    expect(matchShortcut(press('KeyR', { ctrl: true }), index)).toBeUndefined()
  })

  it('survives a binding a hand-edited project file got wrong', () => {
    // nonsense is ignored and the default keeps working - never a crash on load,
    // and never a combination the app itself refused (that could steal Ctrl+Z)
    const resolved = resolveShortcuts({ root: 'rubbish', angle: '', brackets: 'Ctrl+KeyZ' })
    expect(resolved.find((s) => s.id === 'root')?.effective).toBe('Ctrl+Alt+KeyR')
    expect(resolved.find((s) => s.id === 'angle')?.effective).toBe('Ctrl+Alt+KeyA')
    expect(resolved.find((s) => s.id === 'brackets')?.effective).toBe('Ctrl+Alt+KeyB')
    const index = shortcutIndex({ root: 'rubbish' })
    expect(index.has('rubbish')).toBe(false)
    expect(index.get('Ctrl+Alt+KeyA')?.id).toBe('angle')
    expect(index.has('Ctrl+KeyZ')).toBe(false)
  })

  it('exposes the default of an action for the reset button', () => {
    expect(defaultCombo('subscript')).toBe('Ctrl+Alt+KeyS')
    expect(defaultCombo('nope')).toBeUndefined()
  })
})

describe('shortcuts: settings integration', () => {
  it('travels with the settings, so it is saved, loaded and undone with them', () => {
    const session = new Session()
    expect(session.settings.shortcuts).toBeUndefined()
    session.updateSettings({ shortcuts: { root: 'Alt+Shift+KeyQ', angle: null } })
    expect(session.settings.shortcuts).toEqual({ root: 'Alt+Shift+KeyQ', angle: null })

    // the project file carries them
    const project = session.toProject()
    expect(project.settings.shortcuts).toEqual({ root: 'Alt+Shift+KeyQ', angle: null })
    const reloaded = new Session()
    expect(reloaded.loadProject(project)).toBeUndefined()
    expect(reloaded.settings.shortcuts).toEqual({ root: 'Alt+Shift+KeyQ', angle: null })

    // and undo puts the previous bindings back
    session.undo()
    expect(session.settings.shortcuts).toBeUndefined()
  })

  it('defaults to no overrides at all', () => {
    const session = new Session()
    expect(resolveShortcuts(session.settings.shortcuts).every((s) => s.enabled)).toBe(true)
  })
})
