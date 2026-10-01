/**
 * The electrical-engineering symbol keyboard.
 *
 * The keys are grouped - symbols, units, functions - and each group carries a
 * heading, because a single undifferentiated run of buttons was hard to scan.
 * The function group can be folded away for people who know the syntax.
 *
 * Each key inserts LaTeX at the caret. `#?` is MathLive's placeholder marker,
 * so the caret lands where the user has to type next.
 *
 * `title` is the short name, `desc` explains it and `example` is a worked use of
 * it; the last two are shown in the hint strip under the keyboard on hover, so
 * a key never has to be guessed at.
 */

import type { StringKey } from '../i18n'
import { t } from '../i18n'
import { renderLatex } from './latexRender'

export interface KeyDef {
  /** LaTeX shown on the button */
  label: string
  /** LaTeX inserted into the mathfield */
  insert: string
  /** short name, shown as the tooltip and first in the hint strip */
  title?: string
  /** one-line explanation for the hint strip */
  desc?: string
  /** a worked example (LaTeX) for the hint strip */
  example?: string
  /**
   * True for keys that open a group MathLive keeps the caret inside. The app
   * moves the caret back out when the next closing character is typed, because
   * otherwise `U` + this key + `1` + `=` would put the "=" inside the subscript.
   */
  autoExit?: boolean
}

const SYMBOLS: KeyDef[] = [
  { label: '\\angle', insert: '\\angle ', title: '∠  相角 / phase angle', desc: '极坐标形式的角，如 220∠30° / the angle in polar form', example: '220\\angle 30\\degree' },
  { label: '\\degree', insert: '\\degree', title: '°  度 / degrees', desc: '显式度数：带上它永远是度，与当前角度单位无关 / always degrees', example: '220\\angle -30\\degree' },
  { label: 'j', insert: 'j', title: 'j  虚数单位 / imaginary unit', desc: '电工写法 j = √−1，等于 1∠90° / the EE imaginary unit', example: 'Z=3+4j' },
  { label: '\\pi', insert: '\\pi', title: 'π', desc: '圆周率 / pi', example: '\\omega=2\\pi f' },
  { label: '\\omega', insert: '\\omega', title: 'ω  角频率 / angular frequency', desc: '弧度每秒，ω = 2πf / radians per second', example: '\\omega=314' },
  { label: '\\varphi', insert: '\\varphi', title: 'φ  初相位 / phase', desc: '相位角（也叫 \u03c6）/ phase angle', example: '\\varphi=30\\degree' },
  { label: '\\theta', insert: '\\theta', title: 'θ', desc: '通用角度符号 / a generic angle', example: '\\theta=45\\degree' },
  { label: '(\\;)', insert: '\\left(#?\\right)', title: '( )  圆括号 / parentheses', desc: '分组，插入后光标在括号内 / groups a sub-expression', example: '(3+4j)\\cdot 2' },
  { label: 'x_{n}', insert: '_{#?}', title: '下标 / subscript', desc: '给前一个字母加下标：U₁、I₂；直接写 U1 也可以 / subscript of the previous letter', example: 'U_1=220\\angle 0\\degree', autoExit: true },
  { label: '|\\;|', insert: '\\left|#?\\right|', title: '| |  模 / modulus', desc: '复数的模（绝对值）/ magnitude of a complex number', example: '|3+4j|=5' },
  { label: '\\overline{Z}', insert: '\\overline{#?}', title: '共轭 / conjugate', desc: '把虚部取反 / flips the sign of the imaginary part', example: '\\overline{3+4j}=3-4j' },
  { label: '\\dot{U}', insert: '\\dot{#?}', title: '相量记号 / phasor dot', desc: '相量记号，只是写法，不改变数值 / phasor notation only', example: '\\dot{U}=220\\angle 30\\degree\\text{V}' },
  { label: '\\frac{a}{b}', insert: '\\frac{#?}{#?}', title: '分式 / fraction', desc: '除法；分母为零会报错 / division', example: '\\frac{1}{2}=0.5' },
  { label: '\\sqrt{\\;}', insert: '\\sqrt{#?}', title: '根号 / square root', desc: '平方根；n 次根用 \\sqrt[n]{x} / square root', example: '\\sqrt{3^2+4^2}=5' },
]

const UNITS: KeyDef[] = [
  { label: '\\text{V}', insert: '\\text{V}', title: '伏 / volt', desc: '电压单位 / voltage', example: 'U=220\\angle 0\\degree\\text{V}' },
  { label: '\\text{A}', insert: '\\text{A}', title: '安 / ampere', desc: '电流单位 / current', example: 'I=5\\angle 0\\degree\\text{A}' },
  { label: '\\text{W}', insert: '\\text{W}', title: '瓦 / watt', desc: '有功功率 / active power', example: 'P=1000\\text{W}' },
  { label: '\\text{Hz}', insert: '\\text{Hz}', title: '赫 / hertz', desc: '频率 / frequency', example: 'f=50\\text{Hz}' },
  // NOTE: the unit labels use the literal Unicode characters instead of
  // \Omega / \mu. MathLive's text mode does not accept those commands, so
  // `\text{k\Omega}` shows up as "k\Omega" inside the input box; the literal
  // characters render everywhere (box, key, example, row) and the parser still
  // reads the group as one unit label.
  { label: '\\Omega', insert: '\\text{\u03a9}', title: '欧 / ohm', desc: '阻抗单位 / impedance', example: 'Z=5\\angle 53\\degree\\text{\u03a9}' },
  { label: '\\text{mA}', insert: '\\text{mA}', title: '毫安 / milliampere', desc: '千分之一安 / one thousandth of an ampere', example: 'I=20\\text{mA}' },
  { label: '\\text{kV}', insert: '\\text{kV}', title: '千伏 / kilovolt', desc: '一千伏 / one thousand volts', example: 'U=10\\text{kV}' },
  { label: '\\text{k\u03a9}', insert: '\\text{k\u03a9}', title: '千欧 / kilo-ohm', desc: '一千欧 / one thousand ohms', example: 'R=2.2\\text{k\u03a9}' },
  { label: '\\text{\u00b5F}', insert: '\\text{\u00b5F}', title: '微法 / microfarad', desc: '电容单位 / capacitance', example: 'C=100\\text{\u00b5F}' },
  { label: '\\text{mH}', insert: '\\text{mH}', title: '毫亨 / millihenry', desc: '电感单位 / inductance', example: 'L=10\\text{mH}' },
]

const FUNCTIONS: KeyDef[] = [
  { label: '\\arg(\\;)', insert: '\\arg(#?)', title: '辐角 / argument', desc: '由实部虚部求相位角，结果按当前角度单位 / phase angle', example: '\\arg(3+4j)=53.13\\degree' },
  { label: '\\abs(\\;)', insert: '\\abs(#?)', title: '模 / magnitude', desc: '复数的模（=| |）/ modulus', example: '\\abs(3+4j)=5' },
  { label: '\\conj(\\;)', insert: '\\conj(#?)', title: '共轭 / conjugate', desc: '虚部取反 / conjugate', example: '\\conj(3+4j)=3-4j' },
  { label: '\\Re(\\;)', insert: '\\Re(#?)', title: '实部 / real part', desc: '取实部 / real part', example: '\\Re(3+4j)=3' },
  { label: '\\Im(\\;)', insert: '\\Im(#?)', title: '虚部 / imaginary part', desc: '取虚部 / imaginary part', example: '\\Im(3+4j)=4' },
  { label: '\\polar(\\;,\\;)', insert: '\\polar(#?, #?)', title: '极坐标构造 / polar form', desc: 'polar(模, 角)，角按当前角度单位 / modulus and angle', example: '\\polar(5,30)' },
  { label: '\\rms(\\;)', insert: '\\rms(#?)', title: '有效值 / RMS', desc: '振幅 → 有效值（÷√2）/ amplitude to RMS', example: '\\rms(311\\angle 0\\degree)=220' },
  { label: '\\peak(\\;)', insert: '\\peak(#?)', title: '振幅 / amplitude', desc: '有效值 → 振幅（×√2）/ RMS to amplitude', example: '\\peak(220\\angle 0\\degree)=311' },
  { label: '\\om(\\;)', insert: '\\om(#?)', title: 'ω = 2πf', desc: '由频率求角频率 / frequency to angular frequency', example: '\\om(50)=314.16' },
  { label: '\\freq(\\;)', insert: '\\freq(#?)', title: 'f = ω/2π', desc: '由角频率求频率 / angular frequency to frequency', example: '\\freq(314.16)=50' },
  { label: '\\pf(\\;)', insert: '\\pf(#?)', title: '功率因数 / power factor', desc: 'cos φ（φ 按当前角度单位）/ cosine of the phase angle', example: '\\pf(53.13\\degree)=0.6' },
  { label: '\\todeg(\\;)', insert: '\\todeg(#?)', title: '弧度 → 度 / radians to degrees', desc: '把弧度值的数值换成度 / numeric conversion', example: '\\todeg(\\pi)=180' },
  { label: '\\torad(\\;)', insert: '\\torad(#?)', title: '度 → 弧度 / degrees to radians', desc: '把度值的数值换成弧度 / numeric conversion', example: '\\torad(180)=3.1416' },
  { label: '\\sin(\\;)', insert: '\\sin(#?)', title: 'sin', desc: '正弦，参数是角 / sine of an angle', example: '\\sin(30\\degree)=0.5' },
  { label: '\\cos(\\;)', insert: '\\cos(#?)', title: 'cos', desc: '余弦，参数是角 / cosine of an angle', example: '\\cos(60\\degree)=0.5' },
  { label: '\\tan(\\;)', insert: '\\tan(#?)', title: 'tan', desc: '正切，参数是角 / tangent of an angle', example: '\\tan(45\\degree)=1' },
  { label: '\\asin(\\;)', insert: '\\asin(#?)', title: '反正弦 / arcsine', desc: '结果是按当前角度单位的角度 / returns an angle in the current unit', example: '\\asin(0.5)=30\\degree' },
  { label: '\\acos(\\;)', insert: '\\acos(#?)', title: '反余弦 / arccosine', desc: '结果是按当前角度单位的角度 / returns an angle', example: '\\acos(0.6)=53.13\\degree' },
  { label: '\\atan(\\;)', insert: '\\atan(#?)', title: '反正切 / arctangent', desc: '结果是按当前角度单位的角度 / returns an angle', example: '\\atan(1)=45\\degree' },
  { label: '\\atan2(\\;,\\;)', insert: '\\atan2(#?, #?)', title: 'atan2(y, x)', desc: '按象限求相位角，结果同当前单位 / quadrant-aware angle', example: '\\atan2(110,190.5)=30\\degree' },
  { label: '\\ln(\\;)', insert: '\\ln(#?)', title: '自然对数 / natural log', desc: '以 e 为底 / base e', example: '\\ln(e)=1' },
  { label: '\\log(\\;)', insert: '\\log(#?)', title: '常用对数 / log base 10', desc: '以 10 为底（电工习惯）/ base 10', example: '\\log(1000)=3' },
  { label: '\\log2(\\;)', insert: '\\log2(#?)', title: '以 2 为底 / log base 2', desc: '倍频程/比特常用 / octaves, bits', example: '\\log2(8)=3' },
  { label: '\\exp(\\;)', insert: '\\exp(#?)', title: '指数 / exponential', desc: 'e 的幂 / e to the power', example: '\\exp(1)=2.7183' },
  { label: 'e^{\\;}', insert: 'e^{#?}', title: 'e^x', desc: 'e 的幂，可写相量 e^{jθ} / power of e', example: 'e^{j30\\degree}' },
  { label: '10^{\\;}', insert: '10^{#?}', title: '10^x', desc: '10 的幂 / power of ten', example: '10^{3}=1000' },
  { label: 'x^{\\;}', insert: '^{#?}', title: '幂 / power', desc: '接在已有表达式后面：x^2 / exponent of what is before it', example: '3^{2}=9' },
  { label: '\\sqrt[n]{\\;}', insert: '\\sqrt[#?]{#?}', title: 'n 次根 / n-th root', desc: '先填次数再填被开方数 / root of the given order', example: '\\sqrt[3]{8}=2' },
  { label: '\\floor(\\;)', insert: '\\floor(#?)', title: '向下取整 / floor', desc: '取不大于它的整数 / round down', example: '\\floor(2.7)=2' },
  { label: '\\ceil(\\;)', insert: '\\ceil(#?)', title: '向上取整 / ceiling', desc: '取不小于它的整数 / round up', example: '\\ceil(2.1)=3' },
  { label: '\\round(\\;)', insert: '\\round(#?)', title: '四舍五入 / round', desc: '取最近整数 / round to nearest', example: '\\round(2.5)=3' },
]

export interface KeyGroup {
  id: string
  titleKey: StringKey
  keys: KeyDef[]
  /** groups that start folded away behind their heading */
  collapsible?: boolean
}

export const KEY_GROUPS: KeyGroup[] = [
  { id: 'symbols', titleKey: 'keyboard.symbols', keys: SYMBOLS },
  { id: 'units', titleKey: 'keyboard.units', keys: UNITS },
  { id: 'functions', titleKey: 'keyboard.functions', keys: FUNCTIONS, collapsible: true },
]

/**
 * Every key the keyboard can show, in the order it shows them. Exported so the
 * unit tests can check the tables themselves (the tooltips are bilingual by
 * convention, and a CJK-only one would be unreadable in the English UI).
 */
export const ALL_KEYS: KeyDef[] = KEY_GROUPS.flatMap((g) => g.keys)

/** Folds the function group away; remembered per session. */
let functionsFolded = false

export function buildKeyboard(
  host: HTMLElement,
  onInsert: (key: KeyDef) => void,
  onHint?: (key: KeyDef | null) => void,
): void {
  host.replaceChildren()

  const makeButton = (key: KeyDef): HTMLButtonElement => {
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
    if (onHint) {
      button.addEventListener('mouseenter', () => onHint(key))
      button.addEventListener('focus', () => onHint(key))
      button.addEventListener('mouseleave', () => onHint(null))
      button.addEventListener('blur', () => onHint(null))
    }
    return button
  }

  for (const group of KEY_GROUPS) {
    const section = document.createElement('div')
    section.className = 'keyboard-group'
    section.id = `keyboard-${group.id}`

    const heading = document.createElement('button')
    heading.type = 'button'
    heading.className = 'keyboard-group-title'
    heading.id = `keyboard-${group.id}-title`
    const label = document.createElement('span')
    label.textContent = t(group.titleKey)
    heading.append(label)

    const keys = document.createElement('div')
    keys.className = 'keyboard-keys'
    for (const key of group.keys) keys.append(makeButton(key))

    if (group.collapsible) {
      const folded = (): boolean => functionsFolded
      const mark = (): void => {
        const open = !folded()
        heading.setAttribute('aria-expanded', String(open))
        label.textContent = `${t(group.titleKey)} ${open ? '\u25be' : '\u25b8'}`
        keys.hidden = !open
      }
      heading.addEventListener('click', (e) => {
        e.preventDefault()
        functionsFolded = !functionsFolded
        mark()
      })
      mark()
    } else {
      heading.disabled = true
    }

    section.append(heading, keys)
    host.append(section)
  }
}
