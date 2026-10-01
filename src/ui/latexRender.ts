/**
 * Thin wrapper around MathLive's static LaTeX renderer.
 *
 * The browser bundle exports `convertLatexToMarkup`, but its type declarations
 * only ship for the SSR entry point, hence the single cast here.
 */

import * as MathLive from 'mathlive'

type MarkupFn = (latex: string, options?: Record<string, unknown>) => string

const convertLatexToMarkup = (MathLive as unknown as { convertLatexToMarkup?: MarkupFn }).convertLatexToMarkup

/**
 * Command names MathLive does not know, mapped to spellings it renders.
 *
 * MathLive renders an unknown control sequence as its own source text, so a
 * button labelled `\abs(x)` looked like code (14 keys were showing their LaTeX
 * before this table existed, and so were the examples in the hint strip).
 *
 * This is the display layer only: the input box and the parser still see the
 * real names, which is why the mapping lives here and not in the converter.
 */
const RENDER_ALIASES: Record<string, string> = {
  '\\abs': '\\mathrm{abs}',
  '\\conj': '\\mathrm{conj}',
  '\\polar': '\\mathrm{polar}',
  '\\rms': '\\mathrm{rms}',
  '\\peak': '\\mathrm{peak}',
  '\\om': '\\mathrm{om}',
  '\\freq': '\\mathrm{freq}',
  '\\pf': '\\mathrm{pf}',
  '\\todeg': '\\mathrm{toDeg}',
  '\\torad': '\\mathrm{toRad}',
  '\\asin': '\\arcsin',
  '\\acos': '\\arccos',
  '\\atan2': '\\mathrm{atan2}',
  '\\atan': '\\arctan',
  '\\floor': '\\mathrm{floor}',
  '\\ceil': '\\mathrm{ceil}',
  '\\round': '\\mathrm{round}',
  '\\log2': '\\log_2',
}

/** Replace display-only command names; anything else is left untouched. */
export function displayLatex(latex: string): string {
  return latex.replace(/\\[A-Za-z]+\d*/g, (name) => RENDER_ALIASES[name] ?? name)
}

/** Render LaTeX to static HTML (no mathfield, no keyboard). */
export function renderLatex(latex: string): string {
  if (!convertLatexToMarkup) return escapeHtml(latex)
  try {
    return convertLatexToMarkup(displayLatex(latex), { defaultMode: 'math' })
  } catch {
    return escapeHtml(latex)
  }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
