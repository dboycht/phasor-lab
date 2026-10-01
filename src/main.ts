/**
 * Application bootstrap: wires the session, the mathfield, the algebra view,
 * the symbol keyboard and the phasor diagram together.
 */

import 'mathlive'
import 'mathlive/fonts.css'
import './styles.css'

import type { MathfieldElement } from 'mathlive'

import { LatexError } from './core/latex'
import { EXAMPLES } from './core/examples'
import { argumentOf, formatNumber, formatPolar, formatRect, magnitudeOf } from './core/format'
import { objectLatex, PROJECT_VERSION, Session, type Project } from './core/session'
import type { AngleUnit, Cx, PhasorConvention, PhasorObject, Settings } from './core/types'
import { getLang, setLang, t, translateEvalError, type Lang, type StringKey } from './i18n'
import { sumOf } from './plot/geometry'
import { PhasorPanel } from './plot/panel'
import type { DrawItem } from './plot/renderer'
import { renderCompareCard, renderObjectList, renderResultCard, type CompareSelection } from './ui/algebra'
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
    localStorage.setItem(PROJECT_KEY, JSON.stringify(session.toProject()))
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

// ------------------------------------------------------------------- mathfield

input.mathVirtualKeyboardPolicy = 'manual'
input.smartMode = true
input.smartFence = true
input.defaultMode = 'math'

input.addEventListener('keydown', (ev: KeyboardEvent) => {
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault()
    submitInput()
    return
  }
  if (ev.key === 'Escape') {
    input.value = ''
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
  input.insert(key.insert)
  input.focus()
}

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
}

buildKeyboard(keyboardHost, insertKey, showKeyHint)

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
    showInputError(describeError(result.error))
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

function describeError(error: { code: string; detail: string }): string {
  const key = `err.${error.code}` as StringKey
  const detail = error.code === 'eval' ? translateEvalError(error.detail) : error.detail
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
  })
  renderResultCard(resultCard, session, selectedId, copyResult)
  renderCompareCard(compareCard, session, compareSelection, selectedId, (next) => {
    compareSelection = next
    render()
  }, copyResult)
  statusEl.textContent = statusText()
  ;($('btn-undo') as HTMLButtonElement).disabled = !session.canUndo
  ;($('btn-redo') as HTMLButtonElement).disabled = !session.canRedo
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
    'help.funcs', 'help.units', 'help.labels', 'help.autoName',
    'help.edit', 'help.drag', 'help.view', 'help.history', 'help.copy',
    'help.compare', 'help.examples', 'help.files', 'help.undo',
  ]
  for (const key of keys) {
    const li = document.createElement('li')
    const [label, example] = t(key).split(/[:：]/)
    li.innerHTML = `${escapeHtml(label ?? '')}: <code>${escapeHtml(example ?? '')}</code>`
    list.append(li)
  }
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
  png.addEventListener('click', () => {
    const a = document.createElement('a')
    a.href = panel.toPNG()
    a.download = 'phasor-diagram.png'
    a.click()
  })

  graphicsTools.append(fit, zoomIn, zoomOut, grid, labels, snap, sum, png)
}

function rebuildUI(): void {
  renderStaticText()
  buildTopbar()
  buildGraphicsTools()
  buildExamples()
  buildKeyboard(keyboardHost, insertKey, showKeyHint)
  render()
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

// Ctrl+Z / Ctrl+Shift+Z (and Ctrl+Y) work anywhere on the page
window.addEventListener('keydown', (e) => {
  if (!e.ctrlKey && !e.metaKey) return
  const k = e.key.toLowerCase()
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo() }
  else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); doRedo() }
})

// ------------------------------------------------------------ project files

function projectFileName(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `phasor-lab-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`
}

$('btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(session.toProject(), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = projectFileName()
  a.click()
  URL.revokeObjectURL(url)
})

const fileInput = $<HTMLInputElement>('file-input')

$('btn-import').addEventListener('click', () => fileInput.click())

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  if (!file) return
  void (async () => {
    try {
      const project = JSON.parse(await file.text()) as Project
      const failure = session.loadProject(project)
      if (failure) {
        showInputError(t('input.loadFailed', { detail: failure.detail }))
      } else {
        selectedId = session.objects[0]?.id
        showInputError(undefined)
        persist()
        rebuildUI()
        flashStatus('input.loaded')
      }
    } catch (e) {
      showInputError(t('input.loadFailed', { detail: e instanceof Error ? e.message : String(e) }))
    } finally {
      fileInput.value = ''
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

// ------------------------------------------------------------------ start up

setLang(getLang())

// pick up where the user left off
const stored = loadStoredProject()
if (stored && session.loadProject(stored) === undefined) {
  session.forgetHistory()
  selectedId = session.objects[0]?.id
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
}
