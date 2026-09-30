/**
 * Core shared types for phasor-lab.
 */

/** How angles are shown and how a bare number after the angle sign is interpreted. */
export type AngleUnit = 'deg' | 'rad'

/** Phasor convention: does `220` mean an RMS value or an amplitude (peak) value? */
export type PhasorConvention = 'rms' | 'amplitude'

/** A plain complex number, kept free of any library type so it can be serialised. */
export interface Cx {
  re: number
  im: number
}

export type ShapeKind = 'phasor' | 'scalar'

export interface PhasorObject {
  id: number
  /** variable name, e.g. `U_1` */
  name: string
  /** exactly what the user typed (LaTeX) */
  latex: string
  /** the value part of the input, without the `name =` prefix */
  body: string
  /** mathjs expression we generated from it */
  expr: string
  /** evaluated value, or null while the definition cannot be resolved */
  value: Cx | null
  /**
   * Conversion factor applied to the evaluated value, so that the stored LaTeX
   * never has to be rewritten. 1 for a freshly typed value; the "convert all"
   * action multiplies every existing object by sqrt(2) (or 1/sqrt(2)).
   */
  scale: number
  /** message from the last failed evaluation, if any */
  error?: string
  /** optional unit label taken from a trailing `\text{V}` style group */
  unit?: string
  /** true when the user wrote a phasor dot (`\dot{U}`) */
  phasorMarked: boolean
  visible: boolean
  color: string
  /** monotonic counter used to keep colours stable */
  order: number
}

export interface Settings {
  angleUnit: AngleUnit
  convention: PhasorConvention
  /** significant digits used when formatting numbers */
  precision: number
}

export const DEFAULT_SETTINGS: Settings = {
  angleUnit: 'deg',
  convention: 'rms',
  precision: 6,
}

/** Colour palette for plotted objects (GeoGebra-ish, high contrast on white). */
export const PALETTE = [
  '#2563eb',
  '#dc2626',
  '#059669',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#65a30d',
] as const

export function colorFor(order: number): string {
  return PALETTE[order % PALETTE.length] as string
}
