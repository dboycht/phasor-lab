/**
 * LaTeX -> mathjs expression.
 *
 * Why a hand-written converter instead of the compute-engine that ships with MathLive?
 * Measured facts (see DEVELOPMENT.md, section "已知问题"):
 *   1. the engine parses `\dot{U}` as the derivative dU/dt - silently wrong for phasors;
 *   2. it does not know `\angle`, and its LaTeX dictionary cannot be extended at runtime
 *      (the option is accepted and then ignored);
 *   3. its ASCII-math export uses a *space* for implicit multiplication and splits
 *      multi-letter function names into single variables, so it cannot be fed to mathjs.
 * So we own the semantics: a small, closed grammar, fully unit tested in Node.
 *
 * Supported (electrical-engineering oriented subset):
 *   numbers, `=`, `+ - * / ^`, parentheses, `\frac{}{}`, `\sqrt{}`, `|x|`,
 *   `\overline{x}` (conjugate), `\dot{x}` / `\hat{x}` (phasor marker),
 *   `\angle` / U+2220 (polar literal), `\degree` / U+00B0 / `^{\circ}` (degrees),
 *   greek letters, subscripts (`U_1`, `X_{L}`), functions (`\arg`, `abs(`, ...),
 *   implicit multiplication (`2\omega C`), and a trailing `\text{V}` unit label.
 *
 * Angle handling: everything inside the generated expression is in RADIANS.
 * A user-written angle is converted at generation time, using the caller's
 * angle unit for bare numbers after `\angle` and always for an explicit `°`.
 */

import type { AngleUnit } from './types'

export type LatexErrorCode =
  | 'empty'
  | 'unknown-command'
  | 'unexpected-token'
  | 'missing-operand'
  | 'unclosed-brace'
  | 'unclosed-pipe'
  | 'two-numbers'
  | 'chained-angle'
  | 'bad-assignment'
  | 'missing-right-operand'

export class LatexError extends Error {
  readonly code: LatexErrorCode
  readonly detail: string
  readonly pos: number
  constructor(code: LatexErrorCode, detail: string, pos: number) {
    super(`${code}: ${detail} @${pos}`)
    this.name = 'LatexError'
    this.code = code
    this.detail = detail
    this.pos = pos
  }
}

// ---------------------------------------------------------------------------
// LaTeX tables
// ---------------------------------------------------------------------------

const GREEK: Record<string, string> = {
  alpha: 'alpha', beta: 'beta', gamma: 'gamma', delta: 'delta',
  varepsilon: 'epsilon', epsilon: 'epsilon', zeta: 'zeta', eta: 'eta',
  theta: 'theta', vartheta: 'theta', iota: 'iota', kappa: 'kappa',
  lambda: 'lambda', mu: 'mu', nu: 'nu', xi: 'xi',
  pi: 'pi', varpi: 'pi', rho: 'rho', varrho: 'rho',
  sigma: 'sigma', varsigma: 'sigma', tau: 'tau', upsilon: 'upsilon',
  phi: 'phi', varphi: 'phi', chi: 'chi', psi: 'psi', omega: 'omega',
  Gamma: 'Gamma', Delta: 'Delta', Theta: 'Theta', Lambda: 'Lambda',
  Xi: 'Xi', Pi: 'Pi', Sigma: 'Sigma', Upsilon: 'Upsilon',
  Phi: 'Phi', Psi: 'Psi', Omega: 'Omega',
}

/** Greek letters typed or pasted as plain unicode characters. */
const UNICODE_GREEK: Record<string, string> = {
  '\u03b1': 'alpha', '\u03b2': 'beta', '\u03b3': 'gamma', '\u03b4': 'delta',
  '\u03b5': 'epsilon', '\u03b6': 'zeta', '\u03b7': 'eta', '\u03b8': 'theta',
  '\u03b9': 'iota', '\u03ba': 'kappa', '\u03bb': 'lambda', '\u03bc': 'mu',
  '\u03bd': 'nu', '\u03be': 'xi', '\u03c0': 'pi', '\u03c1': 'rho',
  '\u03c3': 'sigma', '\u03c4': 'tau', '\u03c5': 'upsilon', '\u03c6': 'phi',
  '\u03c7': 'chi', '\u03c8': 'psi', '\u03c9': 'omega',
  '\u0393': 'Gamma', '\u0394': 'Delta', '\u0398': 'Theta', '\u039b': 'Lambda',
  '\u039e': 'Xi', '\u03a0': 'Pi', '\u03a3': 'Sigma', '\u03a6': 'Phi',
  '\u03a8': 'Psi', '\u03a9': 'Omega',
}

/** LaTeX control sequences that mean "function call". */
const FUNCTION_COMMANDS: Record<string, string> = {
  arg: 'arg', sin: 'sin', cos: 'cos', tan: 'tan', cot: 'cot', sec: 'sec', csc: 'csc',
  sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', asin: 'asin', acos: 'acos', atan: 'atan',
  arctan: 'atan', arcsin: 'asin', arccos: 'acos',
  exp: 'exp', ln: 'ln', log: 'log', lg: 'lg', log10: 'log10', log2: 'log2',
  max: 'max', min: 'min', atan2: 'atan2',
  Re: 're', Im: 'im', abs: 'abs', conj: 'conj', polar: 'polar',
  rms: 'rms', peak: 'peak', om: 'om',
  pf: 'pf', freq: 'freq', todeg: 'todeg', torad: 'torad',
  floor: 'floor', ceil: 'ceil', round: 'round', sign: 'sign', mod: 'mod',
}

/** Function names recognised when written as plain letters (optionally before `(`). */
const FUNCTION_WORDS = new Set([
  'abs', 'arg', 'angle', 'magnitude', 'conj', 'conjugate', 're', 'real', 'im', 'imag',
  'sqrt', 'exp', 'ln', 'log', 'log10', 'log2', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'sinh', 'cosh', 'tanh', 'asin', 'acos', 'atan', 'atan2', 'max', 'min',
  'round', 'floor', 'ceil', 'sign', 'mod', 'polar', 'rms', 'peak', 'om',
  'pf', 'freq', 'todeg', 'torad',
])

/** our AST function name -> the name mathjs knows. */
const FN_TO_MATHJS: Record<string, string> = {
  abs: 'abs', magnitude: 'abs', arg: 'arg', angle: 'arg', conj: 'conj', conjugate: 'conj',
  re: 're', real: 're', im: 'im', imag: 'im',
  sqrt: 'sqrt', exp: 'exp', ln: 'log', log: 'log10', lg: 'log10', log10: 'log10', log2: 'log2',
  sin: 'sin', cos: 'cos', tan: 'tan', cot: 'cot', sec: 'sec', csc: 'csc',
  sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', asin: 'asin', acos: 'acos', atan: 'atan',
  atan2: 'atan2', max: 'max', min: 'min', round: 'round', floor: 'floor', ceil: 'ceil',
  sign: 'sign', mod: 'mod', polar: 'polar', rms: 'rms', peak: 'peak', om: 'om',
  pf: 'pf', freq: 'freq', todeg: 'todeg', torad: 'torad', nthRoot: 'nthRoot',
}

/** Names that are a single symbol even though they are longer than one letter. */
const WORD_SYMBOLS = new Set([...Object.values(GREEK), 'pi', 'e', 'i', 'j'])

/**
 * Units we recognise by name, used only to tell the UI which kind of quantity a
 * value is (`V` vs `A`). A trailing `\text{...}` group is a display label even
 * when it is not in this list - see `peelUnit`.
 */
export const KNOWN_UNITS = new Set([
  'V', 'A', 'W', 'VA', 'var', 'VAR', 'VAr', 'Hz', 'ohm', 'Ohm', '\u03a9', 'S', 'F', 'H',
  'Wb', 'T', 'J', 'C', 'N', 'm', 's', 'ms', 'us', '\u00b5s', 'ns',
  'kV', 'MV', 'GV', 'mV', 'mA', 'kA', '\u00b5A', 'uA', 'nA',
  'kW', 'MW', 'mW', 'kvar', 'kVA', 'MVA', 'GVA',
  'mH', '\u00b5H', 'uH', 'k\u03a9', 'M\u03a9', 'm\u03a9',
  'mF', '\u00b5F', 'uF', 'nF', 'pF', 'rad', 'deg', 'kWh', 'A\u00b7h',
])

/** Spacing / sizing commands that carry no meaning for us. */
const NOISE_COMMANDS = [
  '\\left', '\\right', '\\bigl', '\\bigr', '\\Bigl', '\\Bigr',
  '\\biggl', '\\biggr', '\\Biggl', '\\Biggr', '\\big', '\\Big', '\\bigg', '\\Bigg',
  '\\displaystyle', '\\textstyle', '\\scriptstyle', '\\limits', '\\nolimits',
  '\\mathstrut', '\\strut', '\\!', '\\,', '\\;', '\\:', '\\ ', '\\quad', '\\qquad',
  '\\thinspace', '\\medspace', '\\thickspace', '\\enspace',
]

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

type TokKind =
  | 'num' | 'sym' | 'func' | 'op' | 'lp' | 'rp' | 'lb' | 'rb'
  | 'angle' | 'deg' | 'comma' | 'pipe' | 'dot' | 'bar' | 'frac' | 'sqrt' | 'assign' | 'eof'

interface Tok {
  kind: TokKind
  text: string
  pos: number
  value?: number
}

const isDigit = (c: string): boolean => c >= '0' && c <= '9'
const isAlpha = (c: string): boolean => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')

function stripNoise(src: string): string {
  let s = src
  for (const cmd of NOISE_COMMANDS) s = s.split(cmd).join(' ')
  return s
}

function lex(src: string): Tok[] {
  const s = stripNoise(src)
  const toks: Tok[] = []
  let i = 0

  while (i < s.length) {
    const c = s[i] as string

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '$') { i++; continue }

    // --- numbers, with optional scientific notation ---
    if (isDigit(c) || (c === '.' && isDigit(s[i + 1] ?? ''))) {
      const start = i
      while (i < s.length && isDigit(s[i] as string)) i++
      if (s[i] === '.') { i++; while (i < s.length && isDigit(s[i] as string)) i++ }
      const e = s[i]
      if ((e === 'e' || e === 'E') &&
        (isDigit(s[i + 1] ?? '') || ((s[i + 1] === '+' || s[i + 1] === '-') && isDigit(s[i + 2] ?? '')))) {
        i++
        if (s[i] === '+' || s[i] === '-') i++
        while (i < s.length && isDigit(s[i] as string)) i++
      }
      const text = s.slice(start, i)
      toks.push({ kind: 'num', text, pos: start, value: Number(text) })
      continue
    }

    // --- control sequences ---
    if (c === '\\') {
      const start = i
      const m = /^\\([A-Za-z]+|.)/.exec(s.slice(i))
      if (!m) throw new LatexError('unexpected-token', '\\', i)
      let name = m[1] as string
      i += m[0].length

      // A known command may carry a digit suffix (`\atan2`, `\log10`), but only
      // when the whole run is known: `\angle30` must stay `\angle` then `30`.
      const dm = /^\\([A-Za-z]+\d+)/.exec(s.slice(start))
      if (dm && (dm[1] as string) in FUNCTION_COMMANDS) {
        name = dm[1] as string
        i = start + dm[0].length
      }

      // The same idea for the subscript spelling people actually type:
      // `\log_2`, `\log_{2}`, `\log_{10}` mean the same as `\log2` / `\log10`.
      const sub = /^\\([A-Za-z]+)_\{?(\d+)\}?/.exec(s.slice(start))
      if (sub && (`${sub[1]}${sub[2]}`) in FUNCTION_COMMANDS) {
        name = `${sub[1]}${sub[2]}`
        i = start + sub[0].length
      }

      switch (name) {
        case 'frac': case 'dfrac': case 'tfrac':
          toks.push({ kind: 'frac', text: name, pos: start }); continue
        case 'sqrt':
          toks.push({ kind: 'sqrt', text: name, pos: start }); continue
        case 'dot': case 'hat': case 'vec': case 'tilde':
          toks.push({ kind: 'dot', text: name, pos: start }); continue
        case 'overline': case 'bar':
          toks.push({ kind: 'bar', text: name, pos: start }); continue
        case 'angle': case 'measuredangle':
          toks.push({ kind: 'angle', text: name, pos: start }); continue
        case 'degree': case 'circ':
          toks.push({ kind: 'deg', text: name, pos: start }); continue
        case 'cdot': case 'times': case 'ast': case 'centerdot':
          toks.push({ kind: 'op', text: '*', pos: start }); continue
        case 'div':
          toks.push({ kind: 'op', text: '/', pos: start }); continue
        case 'vert': case 'lvert': case 'rvert': case 'mid':
          toks.push({ kind: 'pipe', text: '|', pos: start }); continue
        default: break
      }

      if (name === 'operatorname') {
        const gm = /^\{([A-Za-z][A-Za-z0-9_]*)\}/.exec(s.slice(i))
        if (!gm) throw new LatexError('unknown-command', '\\operatorname', start)
        i += gm[0].length
        toks.push({ kind: 'func', text: (gm[1] as string).toLowerCase(), pos: start })
        continue
      }

      if (name === 'text' || name === 'mathrm' || name === 'mathit' || name === 'mathbf' || name === 'mathsf') {
        const gm = /^\{([^{}]*)\}/.exec(s.slice(i))
        if (!gm) throw new LatexError('unknown-command', '\\' + name, start)
        i += gm[0].length
        const inner = (gm[1] as string).trim()
        const idm = /^([A-Za-z][A-Za-z0-9_]*)$/.exec(inner)
        if (idm) toks.push(...lexIdentRun(idm[1] as string, start))
        else toks.push({ kind: 'sym', text: inner, pos: start })
        continue
      }

      if (name in GREEK) { toks.push({ kind: 'sym', text: GREEK[name] as string, pos: start }); continue }
      if (name in FUNCTION_COMMANDS) { toks.push({ kind: 'func', text: FUNCTION_COMMANDS[name] as string, pos: start }); continue }
      throw new LatexError('unknown-command', '\\' + name, start)
    }

    // --- single characters ---
    switch (c) {
      case '(': case '[': toks.push({ kind: 'lp', text: c, pos: i++ }); continue
      case ')': case ']': toks.push({ kind: 'rp', text: c, pos: i++ }); continue
      case '{': toks.push({ kind: 'lb', text: c, pos: i++ }); continue
      case '}': toks.push({ kind: 'rb', text: c, pos: i++ }); continue
      case ',': toks.push({ kind: 'comma', text: c, pos: i++ }); continue
      case '|': toks.push({ kind: 'pipe', text: c, pos: i++ }); continue
      case '+': toks.push({ kind: 'op', text: '+', pos: i++ }); continue
      case '-': case '\u2212': toks.push({ kind: 'op', text: '-', pos: i++ }); continue
      case '*': case '\u00d7': case '\u22c5': case '\u00b7': case '\u2217':
        toks.push({ kind: 'op', text: '*', pos: i++ }); continue
      case '/': case '\u00f7': toks.push({ kind: 'op', text: '/', pos: i++ }); continue
      case '^': toks.push({ kind: 'op', text: '^', pos: i++ }); continue
      case '\u2220': toks.push({ kind: 'angle', text: c, pos: i++ }); continue
      case '\u00b0': toks.push({ kind: 'deg', text: c, pos: i++ }); continue
      case '\u221a': toks.push({ kind: 'sqrt', text: c, pos: i++ }); continue
      case '=': toks.push({ kind: 'assign', text: c, pos: i++ }); continue
      case ';': toks.push({ kind: 'eof', text: ';', pos: i++ }); continue
      default: break
    }

    if (c in UNICODE_GREEK) { toks.push({ kind: 'sym', text: UNICODE_GREEK[c] as string, pos: i++ }); continue }

    if (isAlpha(c)) {
      // letters, optionally followed by an underscore subscript.
      // Digits are deliberately NOT part of the run: `j30` must lex as j * 30.
      const start = i
      const m = /^[A-Za-z]+(?:_(?:\{[A-Za-z0-9]+\}|[A-Za-z0-9]+))?/.exec(s.slice(i))
      const run = m ? (m[0] as string) : c
      i += run.length
      toks.push(...lexIdentRun(run, start))
      continue
    }

    throw new LatexError('unexpected-token', c, i)
  }

  toks.push({ kind: 'eof', text: '', pos: s.length })
  return toks
}

/**
 * Turn a run of letters/digits/underscores into tokens.
 * `U_1` stays one symbol, `abs` becomes a function, `omega` becomes the greek
 * symbol, and a bare `abc` becomes a*b*c - which is what LaTeX really means.
 */
function lexIdentRun(run: string, pos: number): Tok[] {
  // `X_{L}` is the same object as `X_L`
  const norm = run.replace(/^([A-Za-z]+)_\{([A-Za-z0-9]+)\}$/, '$1_$2')
  const lower = norm.toLowerCase()
  if (FUNCTION_WORDS.has(lower)) return [{ kind: 'func', text: lower, pos }]
  if (WORD_SYMBOLS.has(norm)) return [{ kind: 'sym', text: norm, pos }]

  const sub = /^([A-Za-z])_([A-Za-z0-9]+)$/.exec(norm)
  if (sub) return [{ kind: 'sym', text: `${sub[1]}_${sub[2]}`, pos }]
  if (norm.length === 1) return [{ kind: 'sym', text: norm, pos }]

  const out: Tok[] = []
  for (let k = 0; k < norm.length; k++) {
    const ch = norm[k] as string
    if (ch === '_') {
      const prev = out[out.length - 1]
      const rest = norm.slice(k + 1)
      if (prev && /^[A-Za-z0-9]+$/.test(rest)) { prev.text = `${prev.text}_${rest}`; break }
      continue
    }
    out.push({ kind: 'sym', text: ch, pos: pos + k })
  }
  return out
}

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

export type Node =
  | { k: 'num'; v: number }
  | { k: 'sym'; name: string }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'neg'; a: Node }
  | { k: 'pos'; a: Node }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
  | { k: 'polar'; r: Node; theta: Node }
  | { k: 'deg'; a: Node }
  | { k: 'conj'; a: Node }
  | { k: 'abs'; a: Node }

const P_ADD = 5
const P_ANGLE = 7
const P_MUL = 10
const P_UNARY = 15
const P_POW = 20

class Parser {
  private toks: Tok[]
  private i = 0
  /** set to true whenever the input carried a phasor dot */
  sawPhasorDot = false
  /** set to true when any `\angle` literal was used */
  sawAngle = false
  /** how many moduli we are currently inside (decides whether `|` opens or closes) */
  private pipeDepth = 0

  constructor(toks: Tok[]) { this.toks = toks }

  peekToken(offset = 0): Tok {
    return this.toks[Math.min(this.i + offset, this.toks.length - 1)] as Tok
  }
  private next(): Tok { const t = this.peekToken(); this.i++; return t }
  private isOp(text: string, offset = 0): boolean {
    const t = this.peekToken(offset)
    return t.kind === 'op' && t.text === text
  }

  /** Consume a leading `name =` if present; returns the name. */
  takeAssignmentName(): string | undefined {
    // `\dot{U} = ...`, `\dot U = ...` and `U = ...` all assign to U.
    // The braces belong to the LaTeX command, so step over them.
    let k = 0
    let sawDot = false
    if (this.peekToken(0).kind === 'dot') { sawDot = true; k = 1 }

    let nameIndex = k
    let endIndex = k + 1
    if (sawDot
      && this.peekToken(k).kind === 'lb'
      && this.peekToken(k + 1).kind === 'sym'
      && this.peekToken(k + 2).kind === 'rb') {
      nameIndex = k + 1
      endIndex = k + 3
    }

    const nameTok = this.peekToken(nameIndex)
    if (nameTok.kind === 'sym' && this.peekToken(endIndex).kind === 'assign') {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(nameTok.text)) throw new LatexError('bad-assignment', nameTok.text, nameTok.pos)
      if (sawDot) this.sawPhasorDot = true
      this.i += endIndex + 1
      return nameTok.text
    }
    return undefined
  }

  parseExpression(minPrec = 0): Node {
    let left = this.parsePostfix(this.parsePrefix())

    for (;;) {
      const t = this.peekToken()

      // polar literal: `a \angle b`
      if (t.kind === 'angle') {
        if (P_ANGLE < minPrec) break
        this.next()
        this.sawAngle = true
        if (!this.startsOperand(this.peekToken()) && !this.isOp('-') && !this.isOp('+')) {
          throw new LatexError('missing-right-operand', this.peekToken().text || 'end', this.peekToken().pos)
        }
        const theta = this.parseExpression(P_ANGLE + 1)
        if (this.peekToken().kind === 'angle') {
          throw new LatexError('chained-angle', this.peekToken().text, this.peekToken().pos)
        }
        left = { k: 'polar', r: left, theta }
        continue
      }

      // implicit multiplication: an operand directly after another operand
      if (this.startsOperand(t) && P_MUL >= minPrec) {
        // two adjacent number literals (`2 3`) are a mistake, but `j30` means j*30
        if (t.kind === 'num' && left.k === 'num') throw new LatexError('two-numbers', t.text, t.pos)
        const right = this.parseExpression(P_MUL + 1)
        left = { k: 'bin', op: '*', a: left, b: right }
        continue
      }

      if (t.kind !== 'op') break

      const prec =
        t.text === '+' || t.text === '-' ? P_ADD :
          t.text === '*' || t.text === '/' ? P_MUL :
            t.text === '^' ? P_POW : -1
      if (prec < 0 || prec < minPrec) break
      this.next()
      const right = this.parseExpression(t.text === '^' ? prec : prec + 1)
      left = { k: 'bin', op: t.text as '+' | '-' | '*' | '/' | '^', a: left, b: right }
    }
    return left
  }

  /** Postfix operators: the degree sign, with or without `^{\circ}`. */
  private parsePostfix(node: Node): Node {
    let out = node
    for (;;) {
      if (this.isOp('^') && this.peekToken(1).kind === 'lb' && this.peekToken(2).kind === 'deg' && this.peekToken(3).kind === 'rb') {
        this.i += 4
        out = { k: 'deg', a: out }
        continue
      }
      if (this.isOp('^') && this.peekToken(1).kind === 'deg') { this.i += 2; out = { k: 'deg', a: out }; continue }
      if (this.peekToken().kind === 'deg') { this.next(); out = { k: 'deg', a: out }; continue }
      break
    }
    return out
  }

  private startsOperand(t: Tok): boolean {
    if (t.kind === 'pipe') {
      // `|x|` opens a modulus, but inside a modulus a `|` closes it instead
      return this.pipeDepth === 0
    }
    return t.kind === 'num' || t.kind === 'sym' || t.kind === 'func' || t.kind === 'lp'
      || t.kind === 'lb' || t.kind === 'frac' || t.kind === 'sqrt'
      || t.kind === 'dot' || t.kind === 'bar'
  }

  private parsePrefix(): Node {
    const t = this.peekToken()
    if (t.kind === 'op' && (t.text === '-' || t.text === '+')) {
      this.next()
      const a = this.parseExpression(P_UNARY)
      return t.text === '-' ? { k: 'neg', a } : { k: 'pos', a }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): Node {
    const t = this.next()

    switch (t.kind) {
      case 'num': return { k: 'num', v: t.value as number }
      case 'sym': return { k: 'sym', name: t.text }
      case 'dot':
        this.sawPhasorDot = true
        return this.parseBraceOrOperand()
      case 'bar':
        return { k: 'conj', a: this.parseBraceOrOperand() }
      case 'frac':
        return { k: 'bin', op: '/', a: this.parseBraceOrOperand(), b: this.parseBraceOrOperand() }
      case 'sqrt': {
        // \sqrt[3]{x} is the n-th root; plain \sqrt{x} stays the square root
        if (this.peekToken().kind === 'lp') {
          this.next()
          const order = this.parseExpression(0)
          if (this.peekToken().kind !== 'rp') throw new LatexError('unclosed-brace', '[', t.pos)
          this.next()
          return { k: 'call', name: 'nthRoot', args: [this.parseBraceOrOperand(), order] }
        }
        return { k: 'call', name: 'sqrt', args: [this.parseBraceOrOperand()] }
      }
      case 'pipe': {
        this.pipeDepth++
        const inner = this.parseExpression(0)
        this.pipeDepth--
        if (this.peekToken().kind !== 'pipe') throw new LatexError('unclosed-pipe', '|', t.pos)
        this.next()
        return { k: 'abs', a: inner }
      }
      case 'func': {
        const name = t.text
        if (this.peekToken().kind === 'lp' || this.peekToken().kind === 'lb') {
          this.next()
          return { k: 'call', name, args: this.parseArgList() }
        }
        return { k: 'call', name, args: [this.parseExpression(P_POW)] }
      }
      case 'lp': case 'lb': {
        const close = t.kind === 'lp' ? 'rp' : 'rb'
        const inner = this.parseExpression(0)
        const c = this.peekToken()
        if (c.kind !== close) throw new LatexError('unclosed-brace', t.text, t.pos)
        this.next()
        return inner
      }
      default:
        throw new LatexError('missing-operand', t.kind === 'eof' ? 'end of input' : t.text, t.pos)
    }
  }

  private parseArgList(): Node[] {
    const args: Node[] = []
    if (this.peekToken().kind === 'rp' || this.peekToken().kind === 'rb') {
      throw new LatexError('missing-operand', '()', this.peekToken().pos)
    }
    for (;;) {
      args.push(this.parseExpression(0))
      if (this.peekToken().kind === 'comma') { this.next(); continue }
      break
    }
    const c = this.peekToken()
    if (c.kind !== 'rp' && c.kind !== 'rb') throw new LatexError('unclosed-brace', '(', c.pos)
    this.next()
    return args
  }

  /** Read either a braced group or a single operand (used by \frac, \sqrt, \dot, \overline). */
  private parseBraceOrOperand(): Node {
    const t = this.peekToken()
    if (t.kind === 'lb' || t.kind === 'lp') {
      this.next()
      const inner = this.parseExpression(0)
      const want = t.kind === 'lb' ? 'rb' : 'rp'
      const c = this.peekToken()
      if (c.kind !== want) throw new LatexError('unclosed-brace', t.text, c.pos)
      this.next()
      return inner
    }
    return this.parseExpression(P_UNARY)
  }

  atEnd(): boolean { return this.peekToken().kind === 'eof' }
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

function toRadiansExpr(inner: string): string {
  return `((${inner}) * pi / 180)`
}

/** Functions whose first argument is an angle. */
const ANGLE_ARG_FUNCTIONS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'pf'])

/** True when argument `idx` of `name` is an angle position. */
function isAngleArgument(name: string, idx: number): boolean {
  // polar(r, theta): the second argument is the angle
  if (name === 'polar') return idx === 1
  return idx === 0 && ANGLE_ARG_FUNCTIONS.has(name)
}

/**
 * True when the subtree carries an explicit degree marker somewhere.
 * Such an expression is already in radians, so the angle unit must not be
 * applied to it a second time - this is what makes `220\angle -30\degree`,
 * `2\cdot 30\degree` and `e^{j30\degree}` all behave.
 */
function hasDegreeMarker(n: Node): boolean {
  switch (n.k) {
    case 'deg': return true
    case 'neg': case 'pos': case 'abs': case 'conj': return hasDegreeMarker(n.a)
    case 'bin': return hasDegreeMarker(n.a) || hasDegreeMarker(n.b)
    case 'call': return n.args.some(hasDegreeMarker)
    case 'polar': return hasDegreeMarker(n.r) || hasDegreeMarker(n.theta)
    default: return false
  }
}

/**
 * Turn an angle expression into radians.
 * Rule (documented in the UI): a value written with an explicit degree sign is
 * always degrees; otherwise a bare value is read in the current angle unit.
 */
function angleToRadians(n: Node, unit: AngleUnit): string {
  const inner = toExpr(n, unit)
  if (hasDegreeMarker(n)) return inner
  return unit === 'deg' ? toRadiansExpr(inner) : inner
}

/**
 * Render an AST node as a fully parenthesised mathjs expression.
 *
 * Angle model: everything generated here is in RADIANS. Bare numbers in an
 * angle position are converted using `angleUnit`; an explicit degree sign is
 * always converted. Angle-valued results (arg, asin, ...) come back from the
 * scope in the current unit, so they compose with bare values consistently.
 */
export function toExpr(node: Node, angleUnit: AngleUnit = 'deg'): string {
  switch (node.k) {
    case 'num':
      return String(node.v)
    case 'sym':
      return node.name
    case 'neg':
      return `(-${toExpr(node.a, angleUnit)})`
    case 'pos':
      return `(${toExpr(node.a, angleUnit)})`
    case 'bin': {
      const a = toExpr(node.a, angleUnit)
      const b = toExpr(node.b, angleUnit)
      return `(${a} ${node.op} ${b})`
    }
    case 'deg':
      return toRadiansExpr(toExpr(node.a, angleUnit))
    case 'polar':
      return `polar(${toExpr(node.r, angleUnit)}, ${angleToRadians(node.theta, angleUnit)})`
    case 'conj':
      return `conj(${toExpr(node.a, angleUnit)})`
    case 'abs':
      return `abs(${toExpr(node.a, angleUnit)})`
    case 'call': {
      const name = FN_TO_MATHJS[node.name] ?? node.name
      const args = node.args.map((x, idx) =>
        isAngleArgument(name, idx) ? angleToRadians(x, angleUnit) : toExpr(x, angleUnit)
      )
      return `${name}(${args.join(', ')})`
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface Statement {
  /** variable name on the left of `=`, when present */
  name?: string
  /** mathjs-parseable expression (right hand side, or the whole input) */
  expr: string
  /** parsed AST of the value expression */
  ast: Node
  /** unit label from a trailing \text{V} group */
  unit?: string
  /** the user wrote a phasor dot */
  phasorMarked: boolean
  /** true when an explicit `\angle` literal was used */
  sawAngle: boolean
  /** the raw latex of this statement (unit label removed) */
  latex: string
  /** the value part only, without the `name =` prefix (unit label removed) */
  body: string
}

/** LaTeX macros that may appear inside a unit label. */
const UNIT_MACROS: Array<[string, string]> = [
  ['\\Omega', '\u03a9'],
  ['\\omega', '\u03c9'],
  ['\\mu', '\u00b5'],
  ['\\micro', '\u00b5'],
  ['\\ohm', '\u03a9'],
  ['\\cdot', '\u00b7'],
  ['\\,', ''],
  ['\\;', ''],
  ['\\ ', ''],
]

/** `\Omega` -> `Ω`, `k\Omega` -> `kΩ`, `\mu F` -> `µF`. */
function normalizeUnitLabel(raw: string): string {
  let s = raw
  for (const [macro, char] of UNIT_MACROS) s = s.split(macro).join(char)
  return s.replace(/\\/g, '').replace(/\s+/g, '')
}

/**
 * Split a trailing `\text{...}` / `\mathrm{...}` group off as the display label.
 *
 * In LaTeX that group is *text*, not mathematics, so it is always a label: it is
 * never split into single-letter variables and never evaluated. The number keeps
 * working even when the label is not a unit we know (`220\text{kg}`).
 */
function peelUnit(latex: string): { body: string; unit?: string } {
  const m = /\\(?:text|mathrm|mathit|mathbf|mathsf)\{([^{}]*)\}\s*$/.exec(latex)
  if (!m) return { body: latex }
  const label = normalizeUnitLabel((m[1] as string).trim())
  const body = latex.slice(0, m.index)
  if (label === '' || body.trim() === '') return { body: latex }
  return { body, unit: label }
}

/** Split a LaTeX input into statements on top-level `;`, newline or `\\`. */
export function splitStatements(latex: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < latex.length; i++) {
    const c = latex[i] as string
    if (c === '{' || c === '(' || c === '[') depth++
    else if (c === '}' || c === ')' || c === ']') depth = Math.max(0, depth - 1)

    if (depth === 0 && (c === ';' || c === '\n')) { parts.push(cur); cur = ''; continue }
    if (depth === 0 && c === '\\' && latex[i + 1] === '\\') { parts.push(cur); cur = ''; i++; continue }
    cur += c
  }
  parts.push(cur)
  return parts.map((p) => p.trim()).filter((p) => p.length > 0)
}

/** Parse one statement. Throws {@link LatexError}. */
export function parseStatement(latex: string, angleUnit: AngleUnit = 'deg'): Statement {
  const peeled = peelUnit(latex)
  if (peeled.body.trim() === '') throw new LatexError('empty', '', 0)
  const p = new Parser(lex(peeled.body))

  const name = p.takeAssignmentName()
  const bodyStart = p.peekToken().pos
  const ast = p.parseExpression(0)

  if (!p.atEnd()) {
    const t = p.peekToken()
    if (t.kind === 'assign') throw new LatexError('bad-assignment', t.text, t.pos)
    throw new LatexError('unexpected-token', t.text || 'end', t.pos)
  }

  return {
    name,
    expr: toExpr(ast, angleUnit),
    ast,
    unit: peeled.unit,
    phasorMarked: p.sawPhasorDot,
    sawAngle: p.sawAngle,
    latex: peeled.body,
    body: peeled.body.slice(bodyStart).trim(),
  }
}

/** Parse a whole input (possibly several `;`-separated statements). */
export function parseInput(latex: string, angleUnit: AngleUnit = 'deg'): Statement[] {
  const parts = splitStatements(latex)
  if (parts.length === 0) throw new LatexError('empty', '', 0)
  return parts.map((part) => parseStatement(part, angleUnit))
}
