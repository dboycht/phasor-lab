/**
 * The algebra view: the object list and the result card.
 * Pure rendering - every interaction is reported through callbacks.
 */

import { t, translateEvalError } from '../i18n'
import {
  argumentOf,
  formatExponential,
  formatNumber,
  formatPolar,
  formatRect,
  formatTrig,
  magnitudeOf,
} from '../core/format'
import { objectLatex, type Session } from '../core/session'
import type { Cx, PhasorObject } from '../core/types'
import { escapeHtml, renderLatex } from './latexRender'

export interface AlgebraCallbacks {
  onSelect: (id: number | undefined) => void
  onToggleVisible: (id: number) => void
  onDelete: (id: number) => void
}

export function renderObjectList(
  host: HTMLElement,
  session: Session,
  selectedId: number | undefined,
  cb: AlgebraCallbacks,
): void {
  host.replaceChildren()

  if (session.objects.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty-hint'
    empty.innerHTML = `<strong>${escapeHtml(t('view.empty'))}</strong>${escapeHtml(t('view.emptyHint'))}`
    host.append(empty)
    return
  }

  for (const o of session.objects) {
    host.append(buildRow(o, session, selectedId === o.id, cb))
  }
}

function buildRow(o: PhasorObject, session: Session, selected: boolean, cb: AlgebraCallbacks): HTMLElement {
  const row = document.createElement('div')
  row.className = 'object-row' + (selected ? ' selected' : '') + (o.error ? ' error' : '')
  row.dataset.id = String(o.id)

  const swatch = document.createElement('span')
  swatch.className = 'swatch'
  swatch.style.background = o.color

  const main = document.createElement('div')
  main.className = 'object-main'

  const name = document.createElement('div')
  name.className = 'object-name'
  name.innerHTML = renderLatex(objectLatex(o))
  main.append(name)

  const value = document.createElement('div')
  value.className = 'object-value' + (o.value ? '' : ' err')
  if (o.value) {
    value.textContent = formatRect(o.value, session.settings.precision) + (o.unit ? ` ${o.unit}` : '')
    if (o.scale !== 1) {
      value.textContent += `   ·   ${t('settings.scaled', { k: formatNumber(o.scale, 4) })}`
    }
  } else {
    value.textContent = `${t('object.error')}: ${translateEvalError(o.error ?? '')}`
  }
  main.append(value)

  const actions = document.createElement('div')
  actions.className = 'object-actions'

  const eye = document.createElement('button')
  eye.type = 'button'
  eye.title = o.visible ? t('object.hide') : t('object.show')
  eye.textContent = o.visible ? '👁' : '🚫'
  eye.addEventListener('click', (e) => { e.stopPropagation(); cb.onToggleVisible(o.id) })

  const del = document.createElement('button')
  del.type = 'button'
  del.className = 'danger'
  del.title = t('object.delete')
  del.textContent = '✕'
  del.addEventListener('click', (e) => { e.stopPropagation(); cb.onDelete(o.id) })

  actions.append(eye, del)
  row.append(swatch, main, actions)
  row.addEventListener('click', () => cb.onSelect(o.id))
  return row
}

/** The detail card for the selected object (or the last un-assigned result). */
export function renderResultCard(host: HTMLElement, session: Session, selectedId: number | undefined): void {
  const { angleUnit, precision, convention } = session.settings
  const selected = selectedId !== undefined ? session.objects.find((o) => o.id === selectedId) : undefined
  const transient = session.transient
  const value: Cx | null = selected ? selected.value : transient ? transient.value : null
  const unit = selected?.unit ?? transient?.unit

  host.replaceChildren()

  const title = document.createElement('h3')
  title.textContent = selected ? `${t('result.selected')} · ${selected.name}` : t('result.title')
  host.append(title)

  if (!value) {
    const p = document.createElement('div')
    p.className = 'object-value'
    p.textContent = selected?.error ? translateEvalError(selected.error) : t('result.none')
    host.append(p)
    return
  }

  const opts = { angleUnit, precision, unit }
  const rows: Array<[string, string, boolean?]> = [
    [t('result.rect'), formatRect(value, precision), true],
    [t('result.polar'), formatPolar(value, opts), false],
    [t('result.exponential'), formatExponential(value, opts), false],
    [t('result.trig'), formatTrig(value, opts), false],
    ['', ''],
    [t('result.magnitude'), formatNumber(magnitudeOf(value), precision)],
    [t('result.argument'), formatAngle(argumentOf(value, angleUnit), angleUnit, precision)],
    [t('result.real'), formatNumber(value.re, precision)],
    [t('result.imag'), formatNumber(value.im, precision)],
    [t('result.conjugate'), formatRect({ re: value.re, im: -value.im }, precision)],
  ]

  if (convention === 'rms') {
    rows.push(
      ['', ''],
      [t('result.effective'), formatPolar(value, opts)],
      [t('result.peak'), formatPolar({ re: value.re * Math.SQRT2, im: value.im * Math.SQRT2 }, opts)],
    )
  } else {
    rows.push(
      ['', ''],
      [t('result.peak'), formatPolar(value, opts)],
      [t('result.effective'), formatPolar({ re: value.re * Math.SQRT1_2, im: value.im * Math.SQRT1_2 }, opts)],
    )
  }

  const dl = document.createElement('dl')
  dl.className = 'result-grid'
  for (const [label, text] of rows) {
    if (label === '' && text === '') {
      const sep = document.createElement('div')
      sep.className = 'result-sep'
      dl.append(sep)
      continue
    }
    const dt = document.createElement('dt')
    dt.textContent = label
    const dd = document.createElement('dd')
    dd.textContent = text
    dl.append(dt, dd)
  }
  host.append(dl)
}

function formatAngle(deg: number, angleUnit: 'deg' | 'rad', precision: number): string {
  return `${formatNumber(deg, precision)}${angleUnit === 'deg' ? '°' : ' rad'}`
}
