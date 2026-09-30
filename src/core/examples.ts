/**
 * Ready-made examples.
 *
 * These are ordinary input lines, exactly what a user would type, so they double
 * as a smoke test for the whole pipeline (`tests/examples.test.ts` evaluates all
 * of them and checks the headline numbers).
 *
 * They are written with an explicit `\degree` wherever an angle is meant, so
 * they give the same answer in degree and radian mode.
 */

import type { StringKey } from '../i18n'

export interface Example {
  id: string
  /** i18n key of the label shown in the picker */
  labelKey: StringKey
  /** one input line per entry, submitted in order */
  lines: string[]
  /**
   * Turn the sum polygon on when this example loads. Only meaningful for the
   * ones whose whole point is a phasor sum (KVL/KCL).
   */
  showSum?: boolean
}

export const EXAMPLES: Example[] = [
  {
    id: 'series-rlc',
    labelKey: 'example.rlc',
    lines: [
      'U=220\\angle 0\\degree\\text{V}',
      'R=30\\text{\\Omega}',
      'X_L=40\\text{\\Omega}',
      'Z=R+jX_L',
      'I=U/Z',
    ],
  },
  {
    id: 'power',
    labelKey: 'example.power',
    lines: [
      'U=220\\angle 0\\degree\\text{V}',
      'I=5\\angle -36.87\\degree\\text{A}',
      'S=U\\cdot\\conj(I)',
      'P=\\Re(S)',
      'Q=\\Im(S)',
      '\\lambda=\\cos(\\arg(U)-\\arg(I))',
    ],
  },
  {
    id: 'three-phase',
    labelKey: 'example.threePhase',
    lines: [
      'U_A=220\\angle 0\\degree\\text{V}',
      'U_B=220\\angle -120\\degree\\text{V}',
      'U_C=220\\angle 120\\degree\\text{V}',
      'U_AB=U_A-U_B',
    ],
  },
  {
    id: 'parallel',
    labelKey: 'example.parallel',
    lines: [
      'R=30\\text{\\Omega}',
      'X_C=40\\text{\\Omega}',
      'Z_1=R',
      'Z_2=-jX_C',
      'Z=Z_1\\cdot Z_2/(Z_1+Z_2)',
    ],
  },
  {
    // KVL around a series loop: the source equals the phasor sum of the drops.
    // U_R points right, U_L up and U_C down, so the chain visibly closes on U.
    id: 'kvl',
    labelKey: 'example.kvl',
    showSum: true,
    lines: [
      'U_R=60\\angle 0\\degree\\text{V}',
      'U_L=80\\angle 90\\degree\\text{V}',
      'U_C=40\\angle -90\\degree\\text{V}',
      'U=U_R+U_L+U_C',
    ],
  },
]
