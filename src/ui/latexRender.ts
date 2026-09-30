/**
 * Thin wrapper around MathLive's static LaTeX renderer.
 *
 * The browser bundle exports `convertLatexToMarkup`, but its type declarations
 * only ship for the SSR entry point, hence the single cast here.
 */

import * as MathLive from 'mathlive'

type MarkupFn = (latex: string, options?: Record<string, unknown>) => string

const convertLatexToMarkup = (MathLive as unknown as { convertLatexToMarkup?: MarkupFn }).convertLatexToMarkup

/** Render LaTeX to static HTML (no mathfield, no keyboard). */
export function renderLatex(latex: string): string {
  if (!convertLatexToMarkup) return escapeHtml(latex)
  try {
    return convertLatexToMarkup(latex, { defaultMode: 'math' })
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
