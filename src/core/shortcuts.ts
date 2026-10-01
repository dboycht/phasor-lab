/**
 * Shortcut actions and user bindings.
 *
 * An "action" is one symbol the user can insert with the keyboard; a "binding"
 * is the key combination it answers to. Bindings live inside `Settings`, so they
 * are saved with the app, carried in the project file and covered by undo -
 * there is no second place where shortcut state could hide.
 *
 * A combination is stored as one canonical string, e.g. `Ctrl+Alt+KeyR`:
 *   - the flags are written in a fixed order so two equal combinations always
 *     compare equal (the settings table and the duplicate check rely on that);
 *   - `code` is a `KeyboardEvent.code`, not a key, so it survives non-Latin
 *     layouts and input methods.
 *
 * `null` in a binding means "explicitly disabled" and is different from an
 * absent entry, which means "still on the default".
 */

import type { ShortcutBindings } from './types'

export interface ShortcutAction {
  /** stable id used as the key in `Settings.shortcuts` */
  id: string
  /** what it inserts; `#?` marks a placeholder the caret lands in */
  insert: string
  /** short label for the settings table and the key badge */
  label: string
  /** the combination it answers to out of the box */
  combo: string
  /** true when the caret stays inside a group, so `=` should escape it first */
  autoExit?: boolean
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: 'root', insert: '\\sqrt{#?}', label: '\u221a', combo: 'Ctrl+Alt+KeyR' },
  { id: 'angle', insert: '\\angle ', label: '\u2220', combo: 'Ctrl+Alt+KeyA' },
  { id: 'degree', insert: '\\degree', label: '\u00b0', combo: 'Ctrl+Alt+KeyD' },
  { id: 'imaginary', insert: 'j', label: 'j', combo: 'Ctrl+Alt+KeyJ' },
  { id: 'pi', insert: '\\pi', label: '\u03c0', combo: 'Ctrl+Alt+KeyP' },
  { id: 'omega', insert: '\\omega', label: '\u03c9', combo: 'Ctrl+Alt+KeyW' },
  { id: 'fraction', insert: '\\frac{#?}{#?}', label: '\u5206\u6570', combo: 'Ctrl+Alt+KeyF' },
  { id: 'exponential', insert: 'e^{#?}', label: 'e^{x}', combo: 'Ctrl+Alt+KeyE' },
  { id: 'brackets', insert: '\\left(#?\\right)', label: '( )', combo: 'Ctrl+Alt+KeyB' },
  { id: 'subscript', insert: '_{#?}', label: '\u4e0b\u6807', combo: 'Ctrl+Alt+KeyS', autoExit: true },
  { id: 'conjugate', insert: '\\overline{#?}', label: '\u5171\u8f8d', combo: 'Ctrl+Alt+KeyC' },
  { id: 'modulus', insert: '\\abs(#?)', label: '\u6a21', combo: 'Ctrl+Alt+KeyM' },
  { id: 'argument', insert: '\\arg(#?)', label: '\u8f90\u89d2', combo: 'Ctrl+Alt+KeyG' },
  { id: 'unitLabel', insert: '\\text{#?}', label: '\u5355\u4f4d\u6807\u7b7e', combo: 'Ctrl+Alt+KeyT' },
]

const BY_ID = new Map(SHORTCUT_ACTIONS.map((a) => [a.id, a]))

export interface Combo {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  code: string
}

/** `Ctrl+Alt+KeyR` -> the flags and the code. Throws on nonsense input. */
export function parseCombo(combo: string): Combo {
  const parts = combo.split('+').map((p) => p.trim()).filter((p) => p !== '')
  const code = parts.pop()
  if (!code) throw new Error(`not a combination: ${combo}`)
  const flags = new Set(parts.map((p) => p.toLowerCase()))
  for (const flag of flags) {
    if (flag !== 'ctrl' && flag !== 'alt' && flag !== 'shift' && flag !== 'meta') {
      throw new Error(`unknown modifier "${flag}" in ${combo}`)
    }
  }
  // `Ctrl+Alt` alone is not a combination: a bare modifier is never a key
  if (isModifierCode(code)) throw new Error(`${combo} has no key`)
  return {
    ctrl: flags.has('ctrl'),
    alt: flags.has('alt'),
    shift: flags.has('shift'),
    meta: flags.has('meta'),
    code,
  }
}

/** The canonical string for a combination (fixed flag order). */
export function formatCombo(combo: Combo): string {
  const parts: string[] = []
  if (combo.ctrl) parts.push('Ctrl')
  if (combo.alt) parts.push('Alt')
  if (combo.shift) parts.push('Shift')
  if (combo.meta) parts.push('Meta')
  parts.push(combo.code)
  return parts.join('+')
}

/** The combination behind a keyboard event. */
export function comboFromEvent(ev: {
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
  code: string
}): string {
  return formatCombo({ ctrl: ev.ctrlKey, alt: ev.altKey, shift: ev.shiftKey, meta: ev.metaKey, code: ev.code })
}

const NAMED_KEYS: Record<string, string> = {
  Semicolon: ';',
  Equal: '=',
  Minus: '-',
  Slash: '/',
  Backslash: '\\',
  Comma: ',',
  Period: '.',
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Quote: "'",
  Space: '\u7a7a\u683c',
  Backspace: '\u9000\u683c',
  Delete: 'Del',
  Escape: 'Esc',
  Enter: '\u56de\u8f66',
  Tab: 'Tab',
  ArrowUp: '\u2191',
  ArrowDown: '\u2193',
  ArrowLeft: '\u2190',
  ArrowRight: '\u2192',
}

/** `KeyR` -> `R`, `Digit1` -> `1`, `Numpad3` -> `\u5c0f\u952e\u76d8 3`. */
export function keyName(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^Numpad[0-9]$/.test(code)) return `\u5c0f\u952e\u76d8 ${code.slice(6)}`
  if (/^F([1-9]|1[0-2])$/.test(code)) return code
  return NAMED_KEYS[code] ?? code
}

/** `Ctrl+Alt+KeyR` -> `Ctrl+Alt+R`, for the UI. */
export function comboText(combo: string): string {
  let parsed: Combo
  try {
    parsed = parseCombo(combo)
  } catch {
    return combo
  }
  const parts: string[] = []
  if (parsed.ctrl) parts.push('Ctrl')
  if (parsed.alt) parts.push('Alt')
  if (parsed.shift) parts.push('Shift')
  if (parsed.meta) parts.push('Meta')
  parts.push(keyName(parsed.code))
  return parts.join('+')
}

/** A bare modifier is not a key on its own. */
export function isModifierCode(code: string): boolean {
  return /^(Control|Alt|Shift|Meta|CapsLock|NumLock|ScrollLock)(Left|Right)?$/.test(code)
}

/** The app's own fixed shortcuts, which a binding must not steal. */
export const RESERVED_COMBOS = ['Ctrl+KeyZ', 'Ctrl+Shift+KeyZ', 'Ctrl+KeyY', 'Escape']

export type BindingProblem = 'not-a-key' | 'needs-modifier' | 'reserved' | 'duplicate'

export interface BindingCheck {
  ok: boolean
  problem?: BindingProblem
  /** the action that already owns this combination */
  other?: string
}

/**
 * The combination has to contain Alt, or be a function key. Ctrl+letter belongs
 * to the browser (and Ctrl+Z/Y to this app), so allowing it would produce a
 * shortcut that silently does something else.
 */
export function checkCombo(combo: string): BindingCheck {
  let parsed: Combo
  try {
    parsed = parseCombo(combo)
  } catch {
    return { ok: false, problem: 'not-a-key' }
  }
  if (isModifierCode(parsed.code) || parsed.code === '') return { ok: false, problem: 'not-a-key' }
  const canonical = formatCombo(parsed)
  if (RESERVED_COMBOS.includes(canonical)) return { ok: false, problem: 'reserved' }
  const isFunctionKey = /^F([1-9]|1[0-2])$/.test(parsed.code)
  if (!parsed.alt && !isFunctionKey) return { ok: false, problem: 'needs-modifier' }
  return { ok: true }
}

export interface ResolvedShortcut extends ShortcutAction {
  /** false when the user turned this action off */
  enabled: boolean
  /** the combination it answers to right now (the default when unbound) */
  effective: string
  /** the label to show on the key, or undefined when disabled */
  keyLabel?: string
}

/** Apply the user's bindings to the action table. */
export function resolveShortcuts(bindings: ShortcutBindings | undefined): ResolvedShortcut[] {
  return SHORTCUT_ACTIONS.map((action) => {
    const bound = bindings ? bindings[action.id] : undefined
    const disabled = bound === null
    // a combination the app would refuse never reaches the key handler: a
    // hand-edited project file must not be able to steal Ctrl+Z
    const usable = typeof bound === 'string' && bound !== '' && checkCombo(bound).ok
    const effective = usable ? formatCombo(parseCombo(bound as string)) : action.combo
    return {
      ...action,
      enabled: !disabled,
      effective,
      keyLabel: disabled ? undefined : keyName(parseComboSafe(effective).code),
    }
  })
}

function parseComboSafe(combo: string): Combo {
  try {
    return parseCombo(combo)
  } catch {
    return { ctrl: true, alt: true, shift: false, meta: false, code: '' }
  }
}

/**
 * What the key handler needs: every enabled action by its combination.
 * `checkCombo` normally keeps one combination to one action, but a hand-edited
 * project file could still contain a duplicate - the first action in table order
 * wins, so the outcome is predictable instead of "whichever came last".
 */
export function shortcutIndex(bindings: ShortcutBindings | undefined): Map<string, ResolvedShortcut> {
  const index = new Map<string, ResolvedShortcut>()
  for (const shortcut of resolveShortcuts(bindings)) {
    if (!shortcut.enabled) continue
    const parsed = parseComboSafe(shortcut.effective)
    if (parsed.code === '') continue
    const combo = formatCombo(parsed)
    if (index.has(combo)) continue
    index.set(combo, shortcut)
  }
  return index
}

/** True when the event matches an action; the handler uses the map directly. */
export function matchShortcut(
  event: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean; code: string },
  index: Map<string, ResolvedShortcut>,
): ResolvedShortcut | undefined {
  return index.get(comboFromEvent(event))
}

/** Validate a proposed binding for one action against the whole table. */
export function checkBinding(
  combo: string,
  actionId: string,
  bindings: ShortcutBindings | undefined,
): BindingCheck {
  const basic = checkCombo(combo)
  if (!basic.ok) return basic
  const canonical = formatCombo(parseCombo(combo))
  for (const shortcut of resolveShortcuts(bindings)) {
    if (!shortcut.enabled || shortcut.id === actionId) continue
    if (formatCombo(parseComboSafe(shortcut.effective)) === canonical) {
      return { ok: false, problem: 'duplicate', other: shortcut.id }
    }
  }
  return { ok: true }
}

/** Back to the table defaults (used by the settings dialog's reset button). */
export function clearedBindings(): ShortcutBindings {
  return {}
}

/** The action that inserts exactly this string, if any - used for the key badges. */
export function actionByInsert(insert: string): ShortcutAction | undefined {
  return SHORTCUT_ACTIONS.find((a) => a.insert === insert)
}

/** The default combination of an action (for the "reset one" button). */
export function defaultCombo(actionId: string): string | undefined {
  return BY_ID.get(actionId)?.combo
}
