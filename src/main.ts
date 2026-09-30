/**
 * Application bootstrap: wires the session, the mathfield, the algebra view,
 * the symbol keyboard and the phasor diagram together.
 */

import 'mathlive'
import 'mathlive/fonts.css'
import './styles.css'

import type { MathfieldElement } from 'mathlive'

import { LatexError } from './core/latex'
import { argumentOf, formatNumber, formatRect, magnitudeOf } from './core/format'
import { objectLatex, Session } from './core/session'
import type { AngleUnit, Cx, PhasorConvention, PhasorObject, Settings } from './core/types'
import { getLang, setLang, t, translateEvalError, type Lang, type StringKey } from './i18n'
import { PhasorPanel } from './plot/panel'
import type { DrawItem } from './plot/renderer'
import { renderObjectList, renderResultCard } from './ui/algebra'
import { buildKeyboard, type KeyDef } from './ui/keyboard'
import { escapeHtml } from './ui/latexRender'

// --------------------------------------------------------------- persistence

const SETTINGS_KEY = 'phasor-lab.settings'

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

// ------------------------------------------------------------------ elements

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`missing element #${id}`)
  return el as T
}

const session = new Session(loadSettings())
let selectedId: number | undefined
let statusKey: StringKey = 'status.ready'

const input = $<MathfieldElement>('input')
const inputError = $<HTMLParagraphElement>('input-error')
const objectList = $('object-list')
const resultCard = $('result-card')
const keyboardHost = $('keyboard')
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
  }
  if (ev.key === 'Escape') {
    input.value = ''
    showInputError(undefined)
  }
})
input.addEventListener('input', () => showInputError(undefined))

function insertKey(key: KeyDef): void {
  input.insert(key.insert)
  input.focus()
}

buildKeyboard(keyboardHost, insertKey)

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
  sumLabel: () => t('tool.sum'),
  isDegrees: () => session.settings.angleUnit === 'deg',
})

// ---------------------------------------------------------------------- submit

function submitInput(): void {
  const latex = input.value.trim()
  if (latex === '') {
    showInputError(t('err.empty'))
    return
  }
  const result = session.submit(latex)
  if (!result.ok) {
    showInputError(describeError(result.error))
    return
  }
  showInputError(undefined)
  input.value = ''
  selectedId = session.objects.find((o) => !o.error)?.id ?? session.objects[0]?.id
  if (result.transient) selectedId = undefined
  statusKey = 'status.ok'
  render()
  input.focus()
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
}

/** Dragging an arrow rewrites the object's own expression. */
function commitDrag(id: number, value: Cx): void {
  const o = session.objects.find((x) => x.id === id)
  if (!o) return
  const body = bodyForCommit(o, value)
  const result = session.submit(`${o.name}=${body}${o.unit ? `\\text{${o.unit}}` : ''}`)
  if (!result.ok) showInputError(describeError(result.error))
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
    onToggleVisible: (id) => { session.toggleVisible(id); render() },
    onDelete: (id) => {
      session.remove(id)
      if (selectedId === id) selectedId = session.objects[0]?.id
      render()
    },
  })
  renderResultCard(resultCard, session, selectedId)
  statusEl.textContent = `${t(statusKey)} · ${t('status.drag')}`
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
  $('help-title').textContent = t('help.title')
  $('help-close').textContent = t('help.close')

  const list = $('help-list')
  list.replaceChildren()
  for (const key of ['help.polar', 'help.rect', 'help.exp', 'help.trig', 'help.assign', 'help.multi', 'help.funcs', 'help.units'] as StringKey[]) {
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
  buildKeyboard(keyboardHost, insertKey)
  render()
}

// --------------------------------------------------------------------- wiring

$('btn-clear').addEventListener('click', () => {
  session.clear()
  selectedId = undefined
  render()
  input.focus()
})

$('btn-help').addEventListener('click', () => helpDialog.showModal())
$('help-close').addEventListener('click', () => helpDialog.close())

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
rebuildUI()
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
  version: __APP_VERSION__,
}
