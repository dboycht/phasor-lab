/**
 * The electrical-engineering symbol keyboard.
 *
 * Each key inserts LaTeX at the caret. `#?` is MathLive's placeholder marker,
 * so the caret lands where the user has to type next.
 */

import { t } from '../i18n'
import { renderLatex } from './latexRender'

export interface KeyDef {
  /** LaTeX shown on the button */
  label: string
  /** LaTeX inserted into the mathfield */
  insert: string
  /** tooltip */
  title?: string
}

const PRIMARY: KeyDef[] = [
  { label: '\\angle', insert: '\\angle ', title: '∠  相角 / phase angle' },
  { label: '\\degree', insert: '\\degree', title: '°  度 / degrees' },
  { label: 'j', insert: 'j', title: 'j  虚数单位 / imaginary unit' },
  { label: '\\pi', insert: '\\pi', title: 'π' },
  { label: '\\omega', insert: '\\omega', title: 'ω  角频率 / angular frequency' },
  { label: '\\varphi', insert: '\\varphi', title: 'φ  初相位 / phase' },
  { label: '\\theta', insert: '\\theta', title: 'θ' },
  { label: '|\\;|', insert: '\\left|#?\\right|', title: '模 / modulus' },
  { label: '\\overline{Z}', insert: '\\overline{#?}', title: '共轭 / conjugate' },
  { label: '\\dot{U}', insert: '\\dot{#?}', title: '相量记号 / phasor dot' },
  { label: '\\frac{a}{b}', insert: '\\frac{#?}{#?}', title: '分式 / fraction' },
  { label: '\\sqrt{\\;}', insert: '\\sqrt{#?}', title: '根号 / square root' },
]

const FUNCTIONS: KeyDef[] = [
  { label: '\\arg(\\;)', insert: '\\arg(#?)', title: '辐角 / argument' },
  { label: '\\abs(\\;)', insert: '\\abs(#?)', title: '模 / magnitude' },
  { label: '\\conj(\\;)', insert: '\\conj(#?)', title: '共轭 / conjugate' },
  { label: '\\Re(\\;)', insert: '\\Re(#?)', title: '实部 / real part' },
  { label: '\\Im(\\;)', insert: '\\Im(#?)', title: '虚部 / imaginary part' },
  { label: '\\polar(\\;,\\;)', insert: '\\polar(#?, #?)', title: '由模和辐角构造相量' },
  { label: '\\rms(\\;)', insert: '\\rms(#?)', title: '有效值 / RMS' },
  { label: '\\peak(\\;)', insert: '\\peak(#?)', title: '振幅 / amplitude' },
  { label: '\\om(\\;)', insert: '\\om(#?)', title: 'ω = 2πf' },
  { label: '\\sin(\\;)', insert: '\\sin(#?)', title: 'sin' },
  { label: '\\cos(\\;)', insert: '\\cos(#?)', title: 'cos' },
  { label: '\\tan(\\;)', insert: '\\tan(#?)', title: 'tan' },
]

const UNITS: KeyDef[] = [
  { label: '\\text{V}', insert: '\\text{V}', title: '伏 / volt' },
  { label: '\\text{A}', insert: '\\text{A}', title: '安 / ampere' },
  { label: '\\text{W}', insert: '\\text{W}', title: '瓦 / watt' },
  { label: '\\text{Hz}', insert: '\\text{Hz}', title: '赫 / hertz' },
  { label: '\\Omega', insert: '\\text{\\Omega}', title: '欧 / ohm' },
  { label: '\\text{mA}', insert: '\\text{mA}', title: '毫安 / milliampere' },
  { label: '\\text{kV}', insert: '\\text{kV}', title: '千伏 / kilovolt' },
  { label: '\\text{k\\Omega}', insert: '\\text{k\\Omega}', title: '千欧 / kilo-ohm' },
  { label: '\\text{\\mu F}', insert: '\\text{\\mu F}', title: '微法 / microfarad' },
  { label: '\\text{mH}', insert: '\\text{mH}', title: '毫亨 / millihenry' },
]

export function buildKeyboard(host: HTMLElement, onInsert: (key: KeyDef) => void): void {
  host.replaceChildren()

  const addKeys = (keys: KeyDef[]): void => {
    for (const key of keys) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'wide'
      button.title = key.title ?? key.label
      button.dataset.insert = key.insert
      button.innerHTML = renderLatex(key.label)
      button.addEventListener('click', (e) => {
        e.preventDefault()
        onInsert(key)
      })
      host.append(button)
    }
  }

  const divider = (): void => {
    const d = document.createElement('span')
    d.className = 'keyboard-divider'
    host.append(d)
  }

  addKeys(PRIMARY)
  divider()
  addKeys(UNITS)

  const more = document.createElement('button')
  more.type = 'button'
  more.className = 'wide'
  more.id = 'keyboard-more'
  more.textContent = `${t('keyboard.more')} ▾`

  const extra = document.createElement('span')
  extra.className = 'keyboard-extra'
  extra.hidden = true
  extra.style.display = 'contents'

  more.addEventListener('click', (e) => {
    e.preventDefault()
    extra.hidden = !extra.hidden
    more.textContent = extra.hidden ? `${t('keyboard.more')} ▾` : `${t('keyboard.more')} ▴`
  })

  divider()
  host.append(more)

  const keys: KeyDef[] = FUNCTIONS
  for (const key of keys) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'wide'
    button.title = key.title ?? key.label
    button.innerHTML = renderLatex(key.label)
    button.addEventListener('click', (e) => {
      e.preventDefault()
      onInsert(key)
    })
    extra.append(button)
  }
  host.append(extra)
}
