/**
 * Application bootstrap: wires the session, the mathfield, the algebra view,
 * the symbol keyboard and the phasor diagram together.
 */

import 'mathlive'
import 'mathlive/fonts.css'
// The static stylesheet is what lays out the markup `convertLatexToMarkup`
// returns. Without it a fraction renders flat - `\frac{20}{3}` looked like
// "320" in an object row, and the value beside it (20/3) looked wrong.
import 'mathlive/static.css'
import './styles.css'

import type { MathfieldElement } from 'mathlive'

import { LatexError } from './core/latex'
import { solveEquations, type SolverResult } from './core/equations'
import { csvToStatements, objectsToCsv } from './core/csv'
import { EXAMPLES } from './core/examples'
import { argumentOf, formatNumber, formatPolar, formatRect, magnitudeOf } from './core/format'
import { objectLatex, PROJECT_VERSION, Session, type Project } from './core/session'
import {
  actionByInsert,
  checkBinding,
  comboFromEvent,
  comboText,
  defaultCombo,
  isModifierCode,
  resolveShortcuts,
  shortcutIndex,
  type BindingProblem,
  type ResolvedShortcut,
} from './core/shortcuts'
import type { AngleUnit, Cx, PhasorConvention, PhasorObject, Settings } from './core/types'
import { getLang, setLang, t, translateEvalError, type Lang, type StringKey } from './i18n'
import { sumOf } from './plot/geometry'
import { PhasorPanel } from './plot/panel'
import { drawToSvg, type DrawItem } from './plot/renderer'
import { entranceState, renderCompareCard, renderObjectList, renderResultCard, type CompareSelection } from './ui/algebra'
import { buildKeyboard, type KeyDef } from './ui/keyboard'
import { escapeHtml, renderLatex } from './ui/latexRender'

// --------------------------------------------------------------- persistence

const SETTINGS_KEY = 'phasor-lab.settings'
const PROJECT_KEY = 'phasor-lab.project'
const HISTORY_KEY = 'phasor-lab.history'
const HISTORY_LIMIT = 50

function loadSettings(): Partial<Settings> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Partial<Settings>
    const out: Partial<Settings> = {}
    if (parsed.angleUnit === 'deg' || parsed.angleUnit === 'rad') out.angleUnit = parsed.angleUnit
    if (parsed.convention === 'rms' || parsed.convention === 'amplitude') out.convention = parsed.convention
    if (typeof parsed.precision === 'number' && parsed.precision >= 3 && parsed.precision <= 12) out.precision = parsed.precision
    return out
  } catch {
    return {}
  }
}

function saveSettings(s: Settings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

function loadStoredProject(): Project | undefined {
  try {
    const raw = localStorage.getItem(PROJECT_KEY)
    if (!raw) return undefined
    return JSON.parse(raw) as Project
  } catch {
    return undefined
  }
}

function saveProject(): void {
  try {
    const project = session.toProject()
    project.equation = equationInput.value
    localStorage.setItem(PROJECT_KEY, JSON.stringify(project))
  } catch { /* storage full or unavailable: the app still works */ }
}

// ------------------------------------------------------------------- history

function loadInputHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string').slice(-HISTORY_LIMIT)
  } catch {
    return []
  }
}

let inputHistory = loadInputHistory()
/** equals inputHistory.length when the user is not browsing the history */
let historyIndex = inputHistory.length

function rememberInput(latex: string): void {
  if (inputHistory[inputHistory.length - 1] !== latex) {
    inputHistory.push(latex)
    if (inputHistory.length > HISTORY_LIMIT) inputHistory.shift()
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(inputHistory)) } catch { /* ignore */ }
  }
  historyIndex = inputHistory.length
}

// ------------------------------------------------------------------ elements

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`missing element #${id}`)
  return el as T
}

const session = new Session(loadSettings())
let selectedId: number | undefined
let statusKey: StringKey = 'status.ready'
/** extra text after the status word, e.g. the name that was just handed out */
let statusDetail: string | undefined

/** Every status change goes through here so a stale detail cannot linger. */
function setStatus(key: StringKey, detail?: string): void {
  statusKey = key
  statusDetail = detail
}

/** The status line: the state, then whatever is most useful to read next. */
function statusText(): string {
  return `${t(statusKey)} · ${statusDetail ?? t('status.drag')}`
}
/** which two objects the comparison card is looking at */
let compareSelection: CompareSelection = {}

const input = $<MathfieldElement>('input')
const equationInput = $<MathfieldElement>('equation-input')
const equationResult = $('equation-result')
const equationHint = $<HTMLParagraphElement>('equation-hint')
/** which mathfield the symbol keyboard inserts into */
let keyTarget: MathfieldElement = input
const inputError = $<HTMLParagraphElement>('input-error')
const objectList = $('object-list')
const resultCard = $('result-card')
const compareCard = $('compare-card')
const keyboardHost = $('keyboard')
const keyboardHint = $<HTMLParagraphElement>('keyboard-hint')
const topbarControls = $('topbar-controls')
const graphicsTools = $('graphics-tools')
const statusEl = $<HTMLParagraphElement>('status')
const workspace = $('workspace')
const helpDialog = $<HTMLDialogElement>('help-dialog')
const aboutDialog = $<HTMLDialogElement>('about-dialog')

/** Shown in the About dialog; the desktop build links nowhere, so it is text. */
const REPO_URL = 'https://github.com/dboycht/phasor-lab'

// ------------------------------------------------------------------- mathfield

input.mathVirtualKeyboardPolicy = 'manual'
input.smartMode = true
input.smartFence = true
input.defaultMode = 'math'

// the equation card has its own field, with the same input conventions
equationInput.mathVirtualKeyboardPolicy = 'manual'
equationInput.smartMode = true
equationInput.smartFence = true
equationInput.defaultMode = 'math'
equationInput.placeholder = '2x+6=0'

equationInput.addEventListener('keydown', (ev: KeyboardEvent) => {
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault()
    solveNow()
  }
})

// the symbol keyboard types into whichever field was focused last
input.addEventListener('focus', () => { keyTarget = input })
equationInput.addEventListener('focus', () => { keyTarget = equationInput })

input.addEventListener('keydown', (ev: KeyboardEvent) => {
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault()
    submitInput()
    return
  }
  if (ev.key === 'Escape') {
    input.value = ''
    subscriptOpen = false
    historyIndex = inputHistory.length
    showInputError(undefined)
    return
  }
  // ArrowUp recalls earlier input. It only takes over when the field is empty
  // or the user is already browsing, so moving inside an expression still works.
  // The value is applied on the next tick: MathLive processes the same keydown
  // after us and would otherwise overwrite a synchronous assignment.
  const browsing = historyIndex !== inputHistory.length
  if (ev.key === 'ArrowUp' && (input.value.trim() === '' || browsing)) {
    if (inputHistory.length === 0) return
    ev.preventDefault()
    historyIndex = Math.max(0, historyIndex - 1)
    applyToInput(inputHistory[historyIndex] ?? '')
    return
  }
  if (ev.key === 'ArrowDown' && browsing) {
    ev.preventDefault()
    historyIndex = Math.min(inputHistory.length, historyIndex + 1)
    applyToInput(historyIndex === inputHistory.length ? '' : (inputHistory[historyIndex] ?? ''))
  }
})
input.addEventListener('input', () => {
  showInputError(undefined)
  syncInputEmpty()
})
// `value` can also change without an input event (MathLive's own undo, or code
// setting it), so re-sync whenever the field is entered or leaves.
input.addEventListener('focus', syncInputEmpty)
input.addEventListener('change', syncInputEmpty)

/**
 * Keeps the `is-empty` class in step with the field. MathLive tints `\text{...}`
 * runs while focused; since the placeholder ends with `\text{V}`, an empty field
 * would otherwise look as though the last word of the hint were selected.
 */
function syncInputEmpty(): void {
  input.classList.toggle('is-empty', input.value.trim() === '')
  if (input.value.trim() === '') subscriptOpen = false
}

function applyToInput(latex: string): void {
  window.setTimeout(() => {
    if (typeof input.setValue === 'function') input.setValue(latex)
    else input.value = latex
    syncInputEmpty()
    input.focus()
  }, 0)
}

function insertKey(key: KeyDef): void {
  keyTarget.insert(key.insert)
  keyTarget.focus()
  if (key.autoExit) subscriptOpen = true
}

/**
 * MathLive keeps the caret inside a `_{...}` group, so after "U" + the subscript
 * key + "1" the next "=" would land *inside* the subscript (`U_{1=}`). Waiting
 * for a closing character and stepping out of the group first keeps the template
 * usable: "U" + key + "1" + "=" + "4" really is `U_1=4`.
 */
let subscriptOpen = false

/** Capture phase: it must run before MathLive inserts the character itself. */
const escapeSubscript = (ev: KeyboardEvent): void => {
  if (!subscriptOpen) return
  if (!/^[=+\-*/),;]$/.test(ev.key)) return
  subscriptOpen = false
  const field = ev.currentTarget as MathfieldElement
  try {
    field.executeCommand('moveAfterParent')
  } catch {
    /* older MathLive: the user can press ArrowRight themselves */
  }
}
input.addEventListener('keydown', escapeSubscript, true)
equationInput.addEventListener('keydown', escapeSubscript, true)

/**
 * The hint strip under the keyboard: what the key does, and a worked example.
 * Hovering (or tabbing to) a key fills it in; leaving restores the idle prompt.
 */
function showKeyHint(key: KeyDef | null): void {
  if (!key) {
    keyboardHint.textContent = t('keyboard.hintIdle')
    return
  }
  keyboardHint.replaceChildren()
  const name = document.createElement('strong')
  name.textContent = key.title ?? key.label
  keyboardHint.append(name)
  if (key.desc) {
    const desc = document.createElement('span')
    desc.textContent = ` — ${key.desc}`
    keyboardHint.append(desc)
  }
  if (key.example) {
    const example = document.createElement('span')
    example.className = 'keyboard-hint-example'
    example.innerHTML = ` ${t('keyboard.example')} ${renderLatex(key.example)}`
    keyboardHint.append(example)
  }
  const shortcut = shortcutLookup().get(key.insert)
  if (shortcut?.keyLabel) {
    const keys = document.createElement('kbd')
    keys.className = 'keyboard-hint-keys'
    keys.textContent = comboText(shortcut.effective)
    keyboardHint.append(keys)
  }
}

/** Which insertion string answers to which shortcut right now. */
function shortcutLookup(): Map<string, ResolvedShortcut> {
  const byInsert = new Map<string, ResolvedShortcut>()
  for (const shortcut of resolveShortcuts(session.settings.shortcuts)) {
    if (!shortcut.enabled) continue
    const action = actionByInsert(shortcut.insert)
    if (action) byInsert.set(shortcut.insert, shortcut)
  }
  return byInsert
}

function rebuildKeyboard(): void {
  buildKeyboard(keyboardHost, insertKey, showKeyHint, shortcutLookup())
}

rebuildKeyboard()

// -------------------------------------------------------------------- helpers

function currentItems(): DrawItem[] {
  return session.objects.map((o) => ({
    id: o.id,
    value: o.value,
    visible: o.visible,
    color: o.color,
    label: o.name.replace(/_/g, ''),
  }))
}

function panelAngleLabel(item: DrawItem, degrees: boolean): string | undefined {
  if (!item.value) return undefined
  const a = argumentOf(item.value, degrees ? 'deg' : 'rad')
  return `${formatNumber(a, 2)}${degrees ? '°' : ' rad'}`
}

const panel = new PhasorPanel($<HTMLCanvasElement>('canvas'), {
  getItems: currentItems,
  getSelected: () => selectedId,
  onSelect: (id) => {
    selectedId = id
    render()
  },
  onCommit: commitDrag,
  formatTick: (v) => formatNumber(v, 4),
  angleLabel: panelAngleLabel,
  sumLabel: sumLabelText,
  isDegrees: () => session.settings.angleUnit === 'deg',
})

/** The sum polygon is labelled with the value it represents. */
function sumLabelText(): string {
  const values = session.objects.filter((o) => o.visible && o.value).map((o) => o.value as Cx)
  if (values.length < 2) return t('tool.sum')
  const total = sumOf(values)
  const { angleUnit, precision } = session.settings
  return `Σ = ${formatPolar(total, { angleUnit, precision })}`
}

// ---------------------------------------------------------------------- submit

function submitInput(): void {
  const latex = input.value.trim()
  if (latex === '') {
    showInputError(t('err.empty'))
    return
  }
  // A bare expression is given a name instead of becoming a throw-away result,
  // so it lands in the list, gets its own colour in the diagram and can be
  // reused by later expressions (GeoGebra-style: A, B, ... Z, A1, ...).
  const result = session.submit(latex, { autoName: true })
  if (!result.ok) {
    showInputError(describeError(result.error, latex))
    return
  }
  showInputError(undefined)
  input.value = ''
  syncInputEmpty()
  rememberInput(latex)
  selectedId = session.objects.find((o) => !o.error)?.id ?? session.objects[0]?.id
  if (result.transient) selectedId = undefined
  setStatus('status.ok', result.autoNamed?.length ? `${t('status.autoNamed')} ${result.autoNamed.join(', ')}` : undefined)
  persist()
  render()
  input.focus()
}

/** Every mutation ends here: the project survives a refresh or a crash. */
function persist(): void {
  saveSettings(session.settings)
  saveProject()
}

function doUndo(): void {
  if (!session.undo()) return
  selectedId = selectedId !== undefined && session.byId(selectedId) ? selectedId : session.objects[0]?.id
  setStatus('status.ready')
  persist()
  rebuildUI()
}

function doRedo(): void {
  if (!session.redo()) return
  selectedId = session.byId(selectedId ?? -1) ? selectedId : session.objects[0]?.id
  setStatus('status.ready')
  persist()
  rebuildUI()
}

function describeError(error: { code: string; detail: string }, source = ''): string {
  const key = `err.${error.code}` as StringKey
  // For a bad assignment, point at what was actually written on the left (the
  // parser only knows it hit an "=" sign): "found 2x" beats "found =".
  const left = source.includes('=') ? (source.split('=')[0] ?? '').trim() : ''
  const detail =
    error.code === 'bad-assignment' && left !== ''
      ? left
      : error.code === 'eval'
        ? translateEvalError(error.detail)
        : error.detail
  const template = t(key)
  if (template === key && error.code !== 'eval') {
    return `${t('err.eval', { detail })}`
  }
  return template.split('{detail}').join(detail)
}

function showInputError(message: string | undefined): void {
  if (!message) {
    inputError.hidden = true
    inputError.textContent = ''
    return
  }
  inputError.hidden = false
  inputError.textContent = message
  setStatus('status.ready')
}

function flashStatus(key: StringKey): void {
  statusEl.textContent = t(key)
  window.setTimeout(() => {
    statusEl.textContent = statusText()
  }, 2500)
}

/** Copy a result line, with a fallback for browsers that block the async API. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.append(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

function copyResult(text: string): void {
  void copyToClipboard(text).then((ok) => flashStatus(ok ? 'result.copied' : 'result.copyFailed'))
}

// ------------------------------------------------------------------ examples

function buildExamples(): void {
  const select = $<HTMLSelectElement>('examples')
  select.replaceChildren()
  const placeholder = document.createElement('option')
  placeholder.value = ''
  placeholder.textContent = t('example.load')
  select.append(placeholder)
  for (const example of EXAMPLES) {
    const option = document.createElement('option')
    option.value = example.id
    option.textContent = t(example.labelKey)
    select.append(option)
  }
  select.value = ''
}

/** Load an example as a project, so it costs exactly one undo step. */
function loadExample(id: string): void {
  const example = EXAMPLES.find((e) => e.id === id)
  if (!example) return
  const project: Project = {
    app: 'phasor-lab',
    version: PROJECT_VERSION,
    settings: session.settings,
    objects: example.lines.map((latex) => ({ latex, scale: 1, visible: true })),
  }
  const failure = session.loadProject(project)
  if (failure) {
    showInputError(describeError(failure))
    return
  }
  // an example that is *about* a phasor sum turns the sum polygon on with it
  if (example.showSum) panel.showSum = true
  selectedId = session.objects[session.objects.length - 1]?.id
  showInputError(undefined)
  setStatus('status.ok')
  persist()
  rebuildUI()
}

/** Dragging an arrow rewrites the object's own expression. */
function commitDrag(id: number, value: Cx): void {
  const o = session.objects.find((x) => x.id === id)
  if (!o) return
  const body = bodyForCommit(o, value)
  const result = session.submit(`${o.name}=${body}${o.unit ? `\\text{${o.unit}}` : ''}`)
  if (!result.ok) showInputError(describeError(result.error))
  persist()
  render()
}

function bodyForCommit(o: PhasorObject, value: Cx): string {
  const { angleUnit, precision } = session.settings
  const polar = o.body.includes('\\angle')
  if (polar) {
    const r = formatNumber(magnitudeOf(value), precision)
    const theta = formatNumber(argumentOf(value, angleUnit), precision)
    return `${r}\\angle ${theta}${angleUnit === 'deg' ? '\\degree' : ''}`
  }
  return formatRect(value, precision)
}

// ------------------------------------------------------------------- rendering

function render(): void {
  renderObjectList(objectList, session, selectedId, {
    onSelect: (id) => { selectedId = id; render() },
    onToggleVisible: (id) => { session.toggleVisible(id); persist(); render() },
    onDelete: (id) => {
      session.remove(id)
      if (selectedId === id) selectedId = session.objects[0]?.id
      persist()
      render()
    },
    onEdit: (id) => {
      const o = session.byId(id)
      if (!o) return
      // put the object's own source back in the input box and edit it there
      input.value = objectLatex(o)
      syncInputEmpty()
      selectedId = id
      showInputError(undefined)
      render()
      input.focus()
    },
    onMove: (id, toIndex) => {
      if (!session.move(id, toIndex)) return
      selectedId = id
      persist()
      render()
    },
  })
  renderResultCard(resultCard, session, selectedId, copyResult)
  renderCompareCard(compareCard, session, compareSelection, selectedId, (next) => {
    compareSelection = next
    render()
  }, copyResult)
  statusEl.textContent = statusText()
  ;($('btn-undo') as HTMLButtonElement).disabled = !session.canUndo
  ;($('btn-redo') as HTMLButtonElement).disabled = !session.canRedo
  // the export summary names the objects and follows the selection
  updateExportSummary()
  panel.refit()
}

function renderStaticText(): void {
  document.title = `${t('app.title')} · Phasor Lab`
  $('app-title').textContent = t('app.title')
  $('app-subtitle').textContent = t('app.subtitle')
  $('algebra-title').textContent = t('view.algebra')
  $('graphics-title').textContent = t('view.graphics')
  $('btn-clear').textContent = t('input.clear')
  $('btn-help').textContent = '?'
  $('btn-help').title = t('input.help')
  $('btn-undo').title = t('input.undo')
  $('btn-redo').title = t('input.redo')
  $('btn-export').title = t('input.export')
  $('btn-import').title = t('input.import')
  input.placeholder = t('input.placeholder')
  showKeyHint(null)
  $('help-title').textContent = t('help.title')
  $('help-close').textContent = t('help.close')

  const list = $('help-list')
  list.replaceChildren()
  const keys: StringKey[] = [
    'help.polar', 'help.rect', 'help.exp', 'help.trig', 'help.assign', 'help.multi',
    'help.funcs', 'help.units', 'help.labels', 'help.autoName', 'help.subscript', 'help.shortcuts',
    'help.edit', 'help.reorder', 'help.drag', 'help.view', 'help.history', 'help.copy',
    'help.compare', 'help.examples', 'help.files', 'help.undo',
  ]
  for (const key of keys) {
    const li = document.createElement('li')
    if (key === 'help.shortcuts') {
      // the combinations are settings, so the cheat sheet reads them live
      li.innerHTML = `${escapeHtml(t(key))}: <code>${escapeHtml(currentShortcutSummary())}</code>`
      list.append(li)
      continue
    }
    const [label, example] = t(key).split(/[:：]/)
    li.innerHTML = `${escapeHtml(label ?? '')}: <code>${escapeHtml(example ?? '')}</code>`
    list.append(li)
  }

  renderAbout()

  // the equation card
  $('equation-title').textContent = t('equation.title')
  $('btn-solve').textContent = t('equation.solve')
  equationHint.textContent = t('equation.hint')
  previewEquation()
}

/** The shortcut line of the cheat sheet, with the user's bindings applied. */
function currentShortcutSummary(): string {
  return resolveShortcuts(session.settings.shortcuts)
    .map((shortcut) => {
      const name = t(`shortcut.${shortcut.id}` as StringKey)
      return `${name} ${shortcut.enabled ? comboText(shortcut.effective) : t('settings.shortcutOff')}`
    })
    .join(' · ')
}

/** The About dialog: name, version, where the code lives, what it is built on. */
function renderAbout(): void {
  $('about-title').textContent = t('about.title')
  $('about-close').textContent = t('about.close')
  $('btn-about').title = t('about.title')

  const body = $('about-body')
  body.replaceChildren()

  const para = (text: string, cls = ''): HTMLParagraphElement => {
    const p = document.createElement('p')
    if (cls !== '') p.className = cls
    p.textContent = text
    return p
  }
  const row = (label: string, value: string): HTMLParagraphElement => {
    const p = document.createElement('p')
    p.className = 'about-row'
    const strong = document.createElement('strong')
    strong.textContent = label
    const span = document.createElement('span')
    span.className = 'about-mono'
    span.textContent = value
    p.append(strong, span)
    return p
  }

  body.append(para(t('about.tagline'), 'about-tagline'))
  body.append(para(t('about.version', { version: __APP_VERSION__ }), 'about-version'))
  body.append(row(t('about.repo'), REPO_URL))
  body.append(row(t('about.license'), 'MIT'))
  body.append(para(t('about.engine'), 'about-credit'))
  body.append(para(t('about.storage'), 'about-credit'))
}

// ---------------------------------------------------------------- equations

/** Full precision on purpose: 1/3 must survive as a value, not as 0.333333. */
function valueToLatex(v: Cx): string {
  const imTiny = Math.abs(v.im) <= 1e-12 * Math.max(1, Math.abs(v.re))
  if (imTiny) return String(v.re)
  return `${v.re}${v.im < 0 ? '-' : '+'}${Math.abs(v.im)}j`
}

function renderEquationResult(result: SolverResult): void {
  equationResult.replaceChildren()

  if (!result.ok) {
    const problem = document.createElement('p')
    problem.className = 'equation-problem'
    problem.textContent = t(`eq.problem.${result.problem}` as StringKey)
      .split('{detail}')
      .join(result.detail ?? '')
    equationResult.append(problem)
    return
  }

  const { names, exact, decimals, checks } = result.solution
  const answers = document.createElement('ul')
  answers.className = 'equation-answers'
  names.forEach((name, i) => {
    const li = document.createElement('li')
    const label = document.createElement('code')
    label.textContent = `${name} = ${decimals[i]}`
    li.append(label)
    const exactText = exact[i]
    if (exactText !== undefined && exactText !== decimals[i]) {
      const span = document.createElement('span')
      span.className = 'equation-exact'
      span.textContent = `${t('equation.exact')}: ${exactText}`
      li.append(span)
    }
    answers.append(li)
  })
  equationResult.append(answers)

  const verify = document.createElement('div')
  verify.className = 'equation-checks'
  const heading = document.createElement('div')
  heading.className = 'equation-checks-title'
  heading.textContent = t('equation.check')
  verify.append(heading)
  for (const check of checks) {
    const row = document.createElement('div')
    row.className = 'equation-check'
    const source = document.createElement('code')
    source.textContent = check.source
    const substituted = document.createElement('span')
    substituted.textContent = ` → ${check.left} = ${check.right}`
    const mark = document.createElement('span')
    mark.className = 'equation-ok'
    mark.textContent = ` ✓ ${t('equation.residual')} ${formatNumber(check.residual, 2)}`
    row.append(source, substituted, mark)
    verify.append(row)
  }
  equationResult.append(verify)
}

function runSolver(): SolverResult {
  return solveEquations({
    latex: equationInput.value.trim(),
    angleUnit: session.settings.angleUnit,
    math: session.math,
    scope: session.valueScope(),
    precision: session.settings.precision,
  })
}

/** Show what the current equation solves to, without touching the objects. */
function previewEquation(): void {
  if (equationInput.value.trim() === '') {
    equationResult.replaceChildren()
    return
  }
  renderEquationResult(runSolver())
}

/** Solve, show the answer, and keep every unknown as an object (one undo step). */
function solveNow(): void {
  const result = runSolver()
  renderEquationResult(result)
  if (!result.ok) {
    // no render() on this path, so refresh the line explicitly: otherwise it
    // keeps saying "solved x" from the previous, successful run
    setStatus('status.ready')
    statusEl.textContent = statusText()
    return
  }
  const assignments = result.solution.names
    .map((name, i) => `${name}=${valueToLatex(result.solution.values[i]!)}`)
    .join(';')
  const stored = session.submit(assignments)
  if (!stored.ok) {
    showInputError(describeError(stored.error, assignments))
    return
  }
  showInputError(undefined)
  selectedId = session.objects[0]?.id
  setStatus('status.ok', t('equation.solved', { names: result.solution.names.join(', ') }))
  persist()
  render()
}

// ------------------------------------------------------------------- topbar UI

function segmented(
  label: string,
  options: Array<{ value: string; label: string }>,
  current: () => string,
  onPick: (value: string) => void,
): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'control'
  const lab = document.createElement('label')
  lab.textContent = label
  const group = document.createElement('div')
  group.className = 'segmented'
  for (const opt of options) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = opt.label
    b.dataset.value = opt.value
    b.setAttribute('aria-pressed', String(current() === opt.value))
    b.addEventListener('click', () => {
      onPick(opt.value)
      for (const child of Array.from(group.children)) {
        child.setAttribute('aria-pressed', String((child as HTMLElement).dataset.value === opt.value))
      }
    })
    group.append(b)
  }
  wrap.append(lab, group)
  return wrap
}

function buildTopbar(): void {
  topbarControls.replaceChildren()

  topbarControls.append(segmented(
    t('settings.language'),
    [{ value: 'zh', label: '中文' }, { value: 'en', label: 'EN' }],
    () => getLang(),
    (v) => { setLang(v as Lang); rebuildUI() },
  ))

  topbarControls.append(segmented(
    t('settings.angleUnit'),
    [{ value: 'deg', label: t('settings.deg') }, { value: 'rad', label: t('settings.rad') }],
    () => session.settings.angleUnit,
    (v) => updateSettings({ angleUnit: v as AngleUnit }),
  ))

  topbarControls.append(segmented(
    t('settings.convention'),
    [{ value: 'rms', label: t('settings.rms') }, { value: 'amplitude', label: t('settings.amplitude') }],
    () => session.settings.convention,
    (v) => updateSettings({ convention: v as PhasorConvention }),
  ))

  const precisionWrap = document.createElement('div')
  precisionWrap.className = 'control'
  const precisionLabel = document.createElement('label')
  precisionLabel.textContent = t('settings.precision')
  const select = document.createElement('select')
  select.className = 'control-select'
  for (const n of [4, 5, 6, 8, 10]) {
    const opt = document.createElement('option')
    opt.value = String(n)
    opt.textContent = String(n)
    opt.selected = n === session.settings.precision
    select.append(opt)
  }
  select.addEventListener('change', () => updateSettings({ precision: Number(select.value) }))
  precisionWrap.append(precisionLabel, select)
  topbarControls.append(precisionWrap)

  const convert = document.createElement('button')
  convert.type = 'button'
  convert.className = 'btn'
  convert.textContent = t('settings.convertAll')
  convert.title = t('settings.convertAll')
  convert.addEventListener('click', () => {
    session.convertConvention(session.settings.convention === 'rms' ? 'amplitude' : 'rms')
    render()
    rebuildUI()
  })
  topbarControls.append(convert)
}

function updateSettings(patch: Partial<Settings>): void {
  session.updateSettings(patch)
  saveSettings(session.settings)
  render()
  rebuildUI()
}

// ---------------------------------------------------------- graphics toolbar

function toggleButton(label: string, initial: boolean, onChange: (on: boolean) => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'btn ghost'
  b.textContent = label
  b.setAttribute('aria-pressed', String(initial))
  let on = initial
  b.addEventListener('click', () => {
    on = !on
    b.setAttribute('aria-pressed', String(on))
    onChange(on)
  })
  return b
}

function buildGraphicsTools(): void {
  graphicsTools.replaceChildren()

  const fit = document.createElement('button')
  fit.type = 'button'
  fit.className = 'btn ghost'
  fit.textContent = t('tool.fit')
  fit.addEventListener('click', () => panel.fit())

  const zoomIn = document.createElement('button')
  zoomIn.type = 'button'
  zoomIn.className = 'btn ghost'
  zoomIn.textContent = '＋'
  zoomIn.title = t('tool.zoomIn')
  zoomIn.addEventListener('click', () => panel.zoomBy(1.25))

  const zoomOut = document.createElement('button')
  zoomOut.type = 'button'
  zoomOut.className = 'btn ghost'
  zoomOut.textContent = '－'
  zoomOut.title = t('tool.zoomOut')
  zoomOut.addEventListener('click', () => panel.zoomBy(0.8))

  const grid = toggleButton(t('tool.grid'), panel.showGrid, (on) => { panel.showGrid = on; panel.invalidate() })
  const labels = toggleButton(t('tool.labels'), panel.showLabels, (on) => { panel.showLabels = on; panel.invalidate() })
  const snap = toggleButton(t('tool.snap'), panel.snap, (on) => { panel.snap = on })
  const sum = toggleButton(t('tool.sum'), panel.showSum, (on) => { panel.showSum = on; panel.invalidate() })

  const png = document.createElement('button')
  png.type = 'button'
  png.className = 'btn ghost'
  png.textContent = t('tool.png')
  png.title = t('settings.exportPng')
  // one click keeps working as before; the settings dialog offers SVG and size
  png.addEventListener('click', () => exportPng())

  graphicsTools.append(fit, zoomIn, zoomOut, grid, labels, snap, sum, png)
}

function rebuildUI(): void {
  renderStaticText()
  buildTopbar()
  buildGraphicsTools()
  buildExamples()
  rebuildKeyboard()
  renderSettings()
  render()
}

// ------------------------------------------------------------------ settings

/** The action whose new combination the dialog is waiting for, if any. */
let shortcutCapture: string | undefined
/** The last refusal, shown under the offending row. */
let shortcutProblem: { id: string; problem: BindingProblem; other?: string } | undefined

type ExportScope = 'all' | 'selected'

/** Measure SVG text with the real font metrics when a canvas is available. */
const measureCanvas = document.createElement('canvas').getContext('2d')

function measureText(text: string, size: number, bold: boolean): number {
  if (!measureCanvas) return 0.6 * size * text.length
  measureCanvas.font = `${bold ? 'bold ' : ''}${size}px ui-sans-serif, system-ui, sans-serif`
  return measureCanvas.measureText(text).width
}

function download(text: string, fileName: string, type: string): void {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

function exportScope(): ExportScope {
  const checked = document.querySelector<HTMLInputElement>('input[name="export-scope"]:checked')
  return checked?.value === 'selected' ? 'selected' : 'all'
}

/** The objects an export would write, given the chosen scope. */
function scopeObjects(scope: ExportScope = exportScope()): PhasorObject[] {
  if (scope === 'all') return session.objects
  const id = selectedId ?? session.objects[0]?.id
  const selected = id !== undefined ? session.byId(id) : undefined
  return selected ? [selected] : []
}

function scopeFileName(extension: string, prefix: string, objects: PhasorObject[], suffix = ''): string {
  const only = objects.length === 1 && objects[0] ? `-${objects[0].name.replace(/_/g, '')}` : ''
  return `${prefix}${only}-${stamp()}${suffix}.${extension}`
}

function problemText(problem: { problem: BindingProblem; other?: string }): string {
  switch (problem.problem) {
    case 'duplicate':
      return t('settings.shortcutTaken', { other: t(`shortcut.${problem.other}` as StringKey) })
    case 'needs-modifier':
      return t('settings.shortcutNeedsModifier')
    case 'reserved':
      return t('settings.shortcutReserved')
    default:
      return t('settings.shortcutNotAKey')
  }
}

function smallButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'btn'
  button.textContent = label
  button.addEventListener('click', onClick)
  return button
}

function renderShortcutTable(): void {
  const host = $('shortcut-table')
  host.replaceChildren()
  const bindings = session.settings.shortcuts ?? {}
  for (const shortcut of resolveShortcuts(session.settings.shortcuts)) {
    const custom = Object.prototype.hasOwnProperty.call(bindings, shortcut.id)
    const capturing = shortcutCapture === shortcut.id

    const row = document.createElement('div')
    row.className = 'shortcut-row'
    row.dataset.action = shortcut.id
    if (!shortcut.enabled) row.classList.add('is-off')
    if (custom && shortcut.enabled) row.classList.add('is-custom')
    if (capturing) row.classList.add('is-capturing')

    const name = document.createElement('div')
    name.className = 'shortcut-name'
    const badge = document.createElement('span')
    badge.className = 'shortcut-badge'
    badge.textContent = shortcut.keyLabel ?? '\u2014'
    const label = document.createElement('span')
    label.textContent = t(`shortcut.${shortcut.id}` as StringKey)
    name.append(badge, label)

    const combo = document.createElement('span')
    combo.className = 'shortcut-combo'
    if (capturing) combo.textContent = t('settings.pressKeys')
    else if (!shortcut.enabled) combo.textContent = t('settings.shortcutOff')
    else combo.textContent = comboText(shortcut.effective)

    const rebind = smallButton(t('settings.rebind'), () => {
      shortcutCapture = shortcut.id
      shortcutProblem = undefined
      renderShortcutTable()
    })
    const toggle = smallButton(shortcut.enabled ? t('settings.turnOff') : t('settings.turnOn'), () => {
      applyBinding(shortcut.id, shortcut.enabled ? null : (defaultCombo(shortcut.id) ?? null))
    })
    const reset = smallButton(t('settings.resetOne'), () => applyBinding(shortcut.id, defaultCombo(shortcut.id) ?? null))
    reset.disabled = !custom

    row.append(name, combo, rebind, toggle, reset)
    if (shortcutProblem?.id === shortcut.id) {
      const problem = document.createElement('div')
      problem.className = 'shortcut-problem'
      problem.textContent = problemText(shortcutProblem)
      row.append(problem)
    }
    host.append(row)
  }
}

function updateExportSummary(): void {
  const host = $('settings-summary')
  const objects = scopeObjects()
  const nothing = session.objects.length === 0
  if (nothing) host.textContent = t('settings.summaryEmpty')
  else if (objects.length === 0) host.textContent = t('settings.summaryNoneSelected')
  else {
    const names = objects.map((o) => o.name).slice(0, 8).join(', ')
    const detail = objects.length > 8 ? `${names}, …` : names
    host.textContent = t('settings.summary', { count: objects.length, detail })
  }
  const disabled = objects.length === 0
  for (const id of ['settings-export-project', 'settings-export-csv']) {
    $<HTMLButtonElement>(id).disabled = disabled
  }
}

function renderSettings(): void {
  $('settings-title').textContent = t('settings.title')
  $('btn-settings').title = t('settings.title')
  $('settings-shortcuts').textContent = t('settings.shortcuts')
  $('settings-shortcuts-hint').textContent = t('settings.shortcutsHint')
  $('shortcuts-reset').textContent = t('settings.resetAll')
  $('settings-io').textContent = t('settings.io')
  $('settings-scope-title').textContent = t('settings.scopeTitle')
  $('settings-scope-all').textContent = t('settings.scopeAll', { count: session.objects.length })
  $('settings-scope-selected').textContent = t('settings.scopeSelected')
  $('settings-project').textContent = t('settings.project')
  $('settings-export-project').textContent = t('settings.exportProject')
  $('settings-import-project').textContent = t('settings.importProject')
  $('settings-project-hint').textContent = t('settings.projectHint')
  $('settings-csv').textContent = t('settings.csv')
  $('settings-export-csv').textContent = t('settings.exportCsv')
  $('settings-import-csv').textContent = t('settings.importCsv')
  $('settings-csv-hint').textContent = t('settings.csvHint')
  $('settings-image').textContent = t('settings.image')
  $('settings-scale').textContent = t('settings.scale')
  $('settings-transparent-label').textContent = t('settings.transparent')
  $('settings-export-png').textContent = t('settings.exportPng')
  $('settings-export-svg').textContent = t('settings.exportSvg')
  const viewport = panel.currentState().viewport
  $('settings-image-hint').textContent = t('settings.imageHint', {
    width: Math.round(viewport.width),
    height: Math.round(viewport.height),
  })
  renderShortcutTable()
  updateExportSummary()
}

/** Write one binding (or `null` to switch the action off) and keep the UI in step. */
function applyBinding(actionId: string, combo: string | null): void {
  const bindings = { ...(session.settings.shortcuts ?? {}) }
  const fallback = defaultCombo(actionId)
  if (combo === null) bindings[actionId] = null
  else if (fallback !== undefined && combo === fallback) delete bindings[actionId]
  else bindings[actionId] = combo
  session.updateSettings({ shortcuts: bindings })
  shortcutCapture = undefined
  shortcutProblem = undefined
  persist()
  rebuildKeyboard()
  renderSettings()
  setStatus('status.ready')
}

/**
 * Capture phase on the window: while a row is waiting for its combination the
 * mathfields must not see the keystroke, and Escape cancels.
 */
window.addEventListener('keydown', (ev) => {
  if (!shortcutCapture) return
  ev.preventDefault()
  ev.stopPropagation()
  if (ev.key === 'Escape') {
    shortcutCapture = undefined
    shortcutProblem = undefined
    renderShortcutTable()
    return
  }
  if (isModifierCode(ev.code)) return
  const actionId = shortcutCapture
  const combo = comboFromEvent(ev)
  const verdict = checkBinding(combo, actionId, session.settings.shortcuts)
  if (!verdict.ok) {
    shortcutProblem = { id: actionId, problem: verdict.problem as BindingProblem, other: verdict.other }
    renderShortcutTable()
    return
  }
  applyBinding(actionId, combo)
}, true)

// ------------------------------------------------------------ import / export

async function importCsvText(text: string): Promise<void> {
  const { rows } = csvToStatements(text, session.settings.angleUnit)
  const good = rows.filter((row) => row.ok)
  const bad = rows.length - good.length
  if (good.length === 0) {
    showInputError(
      t('settings.importFailed', { detail: bad > 0 ? `${bad} × ${t('settings.shortcutNotAKey')}` : text.slice(0, 40) }),
    )
    return
  }
  const result = session.submit(good.map((row) => row.latex).join(';'))
  if (!result.ok) {
    showInputError(describeError(result.error, good.map((row) => row.latex).join(';')))
    return
  }
  showInputError(undefined)
  selectedId = session.objects[0]?.id
  const detail = bad > 0 ? `${good.length} · ${t('settings.importSkipped', { count: bad })}` : `${good.length}`
  setStatus('status.ok', t('settings.imported', { count: detail }))
  persist()
  render()
}

/** A project dropped on the window (or picked in the settings dialog). */
function importProject(project: Project): void {
  const failure = session.loadProject(project)
  if (failure) {
    showInputError(t('input.loadFailed', { detail: failure.detail }))
    return
  }
  equationInput.value = project.equation ?? ''
  selectedId = session.objects[0]?.id
  showInputError(undefined)
  persist()
  rebuildUI()
  setStatus('status.ok', t('settings.imported', { count: session.objects.length }))
}

/**
 * The project as it would be written, honouring the export scope. The scope is
 * applied by index: a `ProjectObject` carries no name (the name lives in its
 * LaTeX), so filtering by index is the one mapping that cannot drift.
 */
function projectWithScope(scope: ExportScope): Project {
  const project = session.toProject()
  project.equation = equationInput.value
  if (scope === 'selected') {
    const id = selectedId ?? session.objects[0]?.id
    const index = session.objects.findIndex((o) => o.id === id)
    project.objects = index >= 0 ? project.objects.slice(index, index + 1) : []
  }
  return project
}

function exportProject(scope: ExportScope): void {
  const objects = scopeObjects(scope)
  const file = scopeFileName('json', 'phasor-lab', objects)
  download(JSON.stringify(projectWithScope(scope), null, 2), file, 'application/json')
  setStatus('status.ok', t('settings.exported', { name: file }))
}

function exportCsv(scope: ExportScope): void {
  const objects = scopeObjects(scope)
  const text = objectsToCsv(objects, {
    angleUnit: session.settings.angleUnit,
    convention: session.settings.convention,
  })
  const file = scopeFileName('csv', 'phasor-lab', objects)
  // the BOM is what makes Excel open a UTF-8 file by double-click
  download(`\ufeff${text}`, file, 'text/csv;charset=utf-8')
  setStatus('status.ok', t('settings.exported', { name: file }))
}

function exportPng(): void {
  const scale = Number($<HTMLSelectElement>('settings-scale-select').value) || 1
  const transparent = $<HTMLInputElement>('settings-transparent').checked
  const file = scopeFileName('png', 'phasor-diagram', scopeObjects(), scale > 1 ? `@${scale}x` : '')
  const a = document.createElement('a')
  a.href = panel.toPNG({ scale, transparent })
  a.download = file
  a.click()
  setStatus('status.ok', t('settings.exported', { name: file }))
}

function exportSvg(): void {
  const transparent = $<HTMLInputElement>('settings-transparent').checked
  const svg = drawToSvg(panel.currentState(), {
    background: transparent ? null : '#ffffff',
    measure: measureText,
  })
  const file = scopeFileName('svg', 'phasor-diagram', scopeObjects())
  download(svg, file, 'image/svg+xml;charset=utf-8')
  setStatus('status.ok', t('settings.exported', { name: file }))
}

type FileKind = 'project' | 'csv' | 'unknown'

function fileKind(file: File): FileKind {
  const name = file.name.toLowerCase()
  if (name.endsWith('.json')) return 'project'
  if (name.endsWith('.csv') || name.endsWith('.txt')) return 'csv'
  return 'unknown'
}

function firstDroppedFile(ev: DragEvent): File | undefined {
  return ev.dataTransfer?.files?.[0]
}

function hasFiles(ev: DragEvent): boolean {
  return Array.from(ev.dataTransfer?.types ?? []).includes('Files')
}

/** One drag can cross several elements, so the overlay counts enter/leave pairs. */
let dragDepth = 0

function showDropOverlay(file: File | undefined): void {
  const kind = file ? fileKind(file) : 'unknown'
  $('drop-title').textContent =
    file && kind !== 'unknown' ? t('settings.drop', { name: file.name }) : t('settings.dropUnknown')
  $('drop-hint').textContent = t('settings.dropHint')
  $('drop-overlay').hidden = false
}

function hideDropOverlay(): void {
  dragDepth = 0
  $('drop-overlay').hidden = true
}

window.addEventListener('dragenter', (ev) => {
  if (!hasFiles(ev)) return
  ev.preventDefault()
  dragDepth++
  showDropOverlay(firstDroppedFile(ev))
})

window.addEventListener('dragover', (ev) => {
  if (!hasFiles(ev)) return
  // without this the browser navigates to the dropped file
  ev.preventDefault()
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'
})

window.addEventListener('dragleave', (ev) => {
  if (!hasFiles(ev)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) $('drop-overlay').hidden = true
})

window.addEventListener('drop', (ev) => {
  if (!hasFiles(ev)) return
  ev.preventDefault()
  const file = firstDroppedFile(ev)
  hideDropOverlay()
  if (file) void importDroppedFile(file)
})

async function importDroppedFile(file: File): Promise<void> {
  try {
    const kind = fileKind(file)
    if (kind === 'project') {
      importProject(JSON.parse(await file.text()) as Project)
      return
    }
    if (kind === 'csv') {
      await importCsvText(await file.text())
      return
    }
    showInputError(t('settings.dropUnknown'))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    showInputError(t('settings.importFailed', { detail }))
  }
}

// --------------------------------------------------------------------- wiring

$('btn-clear').addEventListener('click', () => {
  session.clear()
  selectedId = undefined
  persist()
  render()
  input.focus()
})

$('btn-undo').addEventListener('click', doUndo)
$('btn-redo').addEventListener('click', doRedo)

$('examples').addEventListener('change', (e) => {
  const select = e.target as HTMLSelectElement
  const id = select.value
  select.value = ''
  if (id) loadExample(id)
})

$('btn-help').addEventListener('click', () => helpDialog.showModal())
$('help-close').addEventListener('click', () => helpDialog.close())
$('btn-about').addEventListener('click', () => aboutDialog.showModal())
$('about-close').addEventListener('click', () => aboutDialog.close())
$('btn-solve').addEventListener('click', () => solveNow())
equationInput.addEventListener('input', () => {
  // keep the preview in step while typing, and remember the text
  previewEquation()
})

// Ctrl+Z / Ctrl+Shift+Z (and Ctrl+Y) work anywhere on the page
window.addEventListener('keydown', (e) => {
  if (!e.ctrlKey && !e.metaKey) return
  const k = e.key.toLowerCase()
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo() }
  else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); doRedo() }
})

// ------------------------------------------------------------ project files

$('btn-export').addEventListener('click', () => exportProject('all'))

const fileInput = $<HTMLInputElement>('file-input')
const csvInput = $<HTMLInputElement>('csv-input')

$('btn-import').addEventListener('click', () => fileInput.click())

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  fileInput.value = ''
  if (!file) return
  void (async () => {
    try {
      importProject(JSON.parse(await file.text()) as Project)
    } catch (e) {
      showInputError(t('input.loadFailed', { detail: e instanceof Error ? e.message : String(e) }))
    }
  })()
})

// ------------------------------------------------------------------ settings

const settingsDialog = $<HTMLDialogElement>('settings-dialog')

$('btn-settings').addEventListener('click', () => {
  shortcutCapture = undefined
  shortcutProblem = undefined
  renderSettings()
  settingsDialog.showModal()
})
$('settings-close').addEventListener('click', () => settingsDialog.close())
settingsDialog.addEventListener('close', () => {
  shortcutCapture = undefined
  shortcutProblem = undefined
})

// back to the table defaults: an empty bindings record means "nothing overridden"
$('shortcuts-reset').addEventListener('click', () => {
  session.updateSettings({ shortcuts: {} })
  shortcutCapture = undefined
  shortcutProblem = undefined
  persist()
  rebuildKeyboard()
  renderSettings()
  setStatus('status.ready')
})

$('settings-export-project').addEventListener('click', () => exportProject(exportScope()))
$('settings-import-project').addEventListener('click', () => fileInput.click())
$('settings-export-csv').addEventListener('click', () => exportCsv(exportScope()))
$('settings-import-csv').addEventListener('click', () => csvInput.click())
$('settings-export-png').addEventListener('click', () => exportPng())
$('settings-export-svg').addEventListener('click', () => exportSvg())

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="export-scope"]')) {
  radio.addEventListener('change', () => updateExportSummary())
}

csvInput.addEventListener('change', () => {
  const file = csvInput.files?.[0]
  csvInput.value = ''
  if (!file) return
  void (async () => {
    try {
      await importCsvText(await file.text())
    } catch (e) {
      showInputError(t('settings.importFailed', { detail: e instanceof Error ? e.message : String(e) }))
    }
  })()
})

// draggable splitter between the two panes
;(() => {
  const splitter = $('splitter')
  let startX = 0
  let startWidth = 0
  let dragging = false

  const onMove = (e: PointerEvent): void => {
    if (!dragging) return
    const dx = e.clientX - startX
    const width = Math.max(280, Math.min(startWidth + dx, window.innerWidth - 320))
    workspace.style.gridTemplateColumns = `${width}px 6px minmax(0, 1fr)`
  }
  const onUp = (e: PointerEvent): void => {
    dragging = false
    splitter.releasePointerCapture(e.pointerId)
    panel.resize()
  }

  splitter.addEventListener('pointerdown', (e) => {
    dragging = true
    startX = e.clientX
    const pane = document.querySelector('.pane-algebra') as HTMLElement | null
    startWidth = pane ? pane.getBoundingClientRect().width : 360
    splitter.setPointerCapture(e.pointerId)
    e.preventDefault()
  })
  splitter.addEventListener('pointermove', onMove)
  splitter.addEventListener('pointerup', onUp)
  splitter.addEventListener('pointercancel', onUp)
})()

const observer = new ResizeObserver(() => panel.resize())
observer.observe($('canvas').parentElement as HTMLElement)

window.addEventListener('resize', () => panel.resize())

// ---------------------------------------------------------------- shortcuts

/**
 * A configured combination inserts its symbol into whichever field was last
 * focused. Capture phase, so the mathfield never sees the keystroke as text.
 * While the settings dialog is capturing a new combination, this stays out of
 * the way (see `shortcutCapture`).
 */
window.addEventListener('keydown', (ev) => {
  if (shortcutCapture) return
  const shortcut = shortcutIndex(session.settings.shortcuts).get(comboFromEvent(ev))
  if (!shortcut) return
  ev.preventDefault()
  insertKey({ label: shortcut.label, insert: shortcut.insert, autoExit: shortcut.autoExit })
}, true)

/**
 * Alt+Arrow moves the selected object up or down - the mouse-free way to do what
 * dragging a row does. It stays out of the way while the settings dialog is
 * capturing a new shortcut.
 */
window.addEventListener('keydown', (ev) => {
  if (shortcutCapture) return
  if (!ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return
  if (ev.code !== 'ArrowUp' && ev.code !== 'ArrowDown') return
  const index = session.objects.findIndex((o) => o.id === selectedId)
  if (index < 0 || selectedId === undefined) return
  ev.preventDefault()
  // `move` takes an insertion point, so moving down has to aim *past* the next
  // row (aiming at it would be a no-op after the row is pulled out)
  const to = index + (ev.code === 'ArrowUp' ? -1 : 2)
  if (!session.move(selectedId, to)) return
  persist()
  render()
}, true)

// ------------------------------------------------------------------ start up

setLang(getLang())

// pick up where the user left off
const stored = loadStoredProject()
if (stored && session.loadProject(stored) === undefined) {
  session.forgetHistory()
  selectedId = session.objects[0]?.id
  equationInput.value = stored.equation ?? ''
  setStatus('input.restored')
}

rebuildUI()
syncInputEmpty()
panel.resize()

// expose a tiny handle for automated UI checks
declare global {
  interface Window {
    __PHASOR_LAB__?: {
      session: Session
      /** type into the mathfield and submit, exactly like a user would */
      type: (latex: string) => boolean
      render: () => void
      panel: PhasorPanel
      latexError: typeof LatexError
      objectLatex: (o: PhasorObject) => string
      /** input history, for automated checks */
      history: () => { items: string[]; index: number }
      version: string
      /** the import/export paths, so a check can read what a download would hold */
      projectJson: (scope: ExportScope) => string
      exportCsvText: (scope: ExportScope) => string
      importCsv: (text: string) => Promise<void>
      importProjectJson: (text: string) => void
      exportSvgText: (transparent?: boolean) => string
      exportPngDataUrl: (opts: { scale?: number; transparent?: boolean }) => string
      /** the combinations the key handler would answer to right now */
      shortcutCombos: () => string[]
      /** test hook: whether a row would animate in */
      entrance: () => { firstRender: boolean; entered: number[] }
    }
  }
}

window.__PHASOR_LAB__ = {
  session,
  type: (latex: string) => {
    input.value = latex
    submitInput()
    return !inputError.hidden
  },
  render,
  panel,
  latexError: LatexError,
  objectLatex,
  history: () => ({ items: [...inputHistory], index: historyIndex }),
  version: __APP_VERSION__,
  projectJson: (scope) => JSON.stringify(projectWithScope(scope), null, 2),
  exportCsvText: (scope) =>
    objectsToCsv(scopeObjects(scope), {
      angleUnit: session.settings.angleUnit,
      convention: session.settings.convention,
    }),
  importCsv: importCsvText,
  importProjectJson: (text) => importProject(JSON.parse(text) as Project),
  exportSvgText: (transparent) =>
    drawToSvg(panel.currentState(), { background: transparent ? null : '#ffffff', measure: measureText }),
  exportPngDataUrl: (opts) => panel.toPNG(opts),
  shortcutCombos: () => [...shortcutIndex(session.settings.shortcuts).keys()],
  entrance: entranceState,
}
