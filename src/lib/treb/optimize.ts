import { cockToGround, simulateShot } from './simulate.ts'
import type { TrebuchetParams } from './types.ts'

/**
 * Tuning and sensitivity analysis.
 *
 * Everything here runs full simulations — there is no surrogate model and no
 * closed-form shortcut, because the range surface of a trebuchet is genuinely
 * not smooth: change the sling by 5 cm and the release can jump to a different
 * part of the swing. Grid-then-refine is used instead of a pure line search for
 * exactly that reason.
 */

/** Numeric parameters worth sweeping. Booleans and enums are excluded. */
export type TunableKey = Extract<
  {
    [K in keyof TrebuchetParams]: TrebuchetParams[K] extends number ? K : never
  }[keyof TrebuchetParams],
  string
>

export interface TunableSpec {
  key: TunableKey
  label: string
  /** Suggested sweep bounds as a multiple of the current value, or absolute. */
  range: (p: TrebuchetParams) => [number, number]
  unit: 'length' | 'mass' | 'angle' | 'ratio' | 'speed' | 'none'
}

/** Bounds helper: a multiplicative window around the current value. */
function around(value: number, lo: number, hi: number, min = 0): [number, number] {
  return [Math.max(min, value * lo), value * hi]
}

export const TUNABLES: TunableSpec[] = [
  {
    key: 'releaseAngle',
    label: 'Pin angle',
    unit: 'angle',
    range: () => [10, 120],
  },
  {
    key: 'slingLength',
    label: 'Sling length',
    unit: 'length',
    range: (p) => around(p.armLong, 0.35, 1.5, 0.05),
  },
  {
    key: 'cwMass',
    label: 'Counterweight mass',
    unit: 'mass',
    range: (p) => around(p.cwMass, 0.2, 3),
  },
  {
    key: 'projectileMass',
    label: 'Projectile mass',
    unit: 'mass',
    range: (p) => around(p.projectileMass, 0.1, 4),
  },
  {
    key: 'armLong',
    label: 'Long arm',
    unit: 'length',
    range: (p) => around(p.armLong, 0.5, 1.8, 0.1),
  },
  {
    key: 'armShort',
    label: 'Short arm',
    unit: 'length',
    range: (p) => around(p.armShort, 0.4, 2.2, 0.05),
  },
  {
    key: 'cwHanger',
    label: 'Hanger length',
    unit: 'length',
    range: (p) => around(p.armShort, 0.05, 2),
  },
  {
    key: 'pivotHeight',
    label: 'Pivot height',
    unit: 'length',
    range: (p) => around(p.pivotHeight, 0.5, 1.6, 0.2),
  },
  {
    key: 'armMass',
    label: 'Beam mass',
    unit: 'mass',
    range: (p) => around(p.armMass, 0.2, 3),
  },
  {
    key: 'initialBeamAngle',
    label: 'Cocked angle',
    unit: 'angle',
    range: () => [5, 75],
  },
  {
    key: 'windSpeed',
    label: 'Wind',
    unit: 'speed',
    range: () => [-15, 15],
  },
]

export interface SweepPoint {
  value: number
  range: number
  efficiency: number
  releaseSpeed: number
  apex: number
  ok: boolean
  warned: boolean
}

const FAST = { lightweight: true, dt: 4e-4 } as const

function evaluate(p: TrebuchetParams, value: number): SweepPoint {
  const r = simulateShot(p, FAST)
  return {
    value,
    range: r.ok ? r.range : NaN,
    efficiency: r.ok ? r.efficiency : NaN,
    releaseSpeed: r.release?.speed ?? NaN,
    apex: r.ok ? r.apex : NaN,
    ok: r.ok,
    warned: r.warnings.length > 0,
  }
}

/**
 * How a swept point is set up before it is fired.
 *
 * `asBuilt` changes literally one number and leaves the rest of the machine
 * alone. `bestCase` re-cocks the beam so the tip still rests on the trough and
 * releases at the ideal instant.
 *
 * The distinction matters more than it looks. With the pin held, a curve
 * conflates "this dimension is better" with "the pin I happen to have bent
 * suits this dimension" — lengthen the arm and the old pin fires at the wrong
 * moment, so the curve falls off for a reason that has nothing to do with the
 * arm. `bestCase` answers the design question: what is the most this dimension
 * could give me if I set the machine up properly around it?
 */
export type SweepMode = 'asBuilt' | 'bestCase'

function stage(p: TrebuchetParams, mode: SweepMode): TrebuchetParams {
  if (mode === 'asBuilt') return p
  return {
    ...p,
    releaseMode: 'optimal',
    initialBeamAngle: cockToGround(p),
  }
}

/** Sweep one parameter and report range, efficiency and release speed at each step. */
export function sweep(
  p: TrebuchetParams,
  key: TunableKey,
  min: number,
  max: number,
  steps = 40,
  mode: SweepMode = 'asBuilt',
): SweepPoint[] {
  const out: SweepPoint[] = []
  for (let i = 0; i < steps; i++) {
    const value = min + ((max - min) * i) / (steps - 1)
    out.push(evaluate(stage({ ...p, [key]: value }, mode), value))
  }
  return out
}

/**
 * The pin angle that would have released at the best possible instant.
 *
 * Cheap and exact: run the swing once with the release solver in `optimal`
 * mode, and read back the sling-to-arm angle it chose. That angle *is* the
 * spigot to bend, so there is nothing to search over.
 */
export function bestReleaseAngle(p: TrebuchetParams): number | null {
  const r = simulateShot({ ...p, releaseMode: 'optimal' }, { lightweight: true })
  return r.ok && r.release ? r.release.gamma : null
}

export interface OptimizeResult {
  key: TunableKey
  value: number
  range: number
  baseline: number
  improvement: number
}

/**
 * Maximise range over one parameter. Coarse grid to bracket the peak, then
 * golden-section inside the bracket — the grid guards against the range surface
 * having more than one hump, which it does for sling length in particular.
 */
export function optimizeParam(
  p: TrebuchetParams,
  key: TunableKey,
  bounds?: [number, number],
  gridSteps = 18,
): OptimizeResult {
  const spec = TUNABLES.find((t) => t.key === key)
  const [min, max] = bounds ?? spec?.range(p) ?? [p[key] * 0.5, p[key] * 1.5]
  const baseline = simulateShot(p, FAST).range

  const rangeAt = (v: number) => {
    const r = simulateShot({ ...p, [key]: v }, FAST)
    return r.ok ? r.range : -Infinity
  }

  let bestV = p[key]
  let bestR = baseline
  const grid: number[] = []
  for (let i = 0; i < gridSteps; i++) grid.push(min + ((max - min) * i) / (gridSteps - 1))
  const scores = grid.map(rangeAt)
  let bi = 0
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[bi]) bi = i
  if (scores[bi] > bestR) {
    bestR = scores[bi]
    bestV = grid[bi]
  }

  let lo = grid[Math.max(0, bi - 1)]
  let hi = grid[Math.min(grid.length - 1, bi + 1)]
  const phi = (Math.sqrt(5) - 1) / 2
  let c = hi - phi * (hi - lo)
  let d = lo + phi * (hi - lo)
  let fc = rangeAt(c)
  let fd = rangeAt(d)
  for (let i = 0; i < 22 && hi - lo > 1e-4 * Math.max(1, Math.abs(hi)); i++) {
    if (fc > fd) {
      hi = d
      d = c
      fd = fc
      c = hi - phi * (hi - lo)
      fc = rangeAt(c)
    } else {
      lo = c
      c = d
      fc = fd
      d = lo + phi * (hi - lo)
      fd = rangeAt(d)
    }
  }
  const mid = (lo + hi) / 2
  const fm = rangeAt(mid)
  if (fm > bestR) {
    bestR = fm
    bestV = mid
  }

  return { key, value: bestV, range: bestR, baseline, improvement: bestR - baseline }
}

export interface TuneProgress {
  round: number
  key: TunableKey
  range: number
}

/**
 * Coordinate descent over several parameters, re-tuning the pin angle after
 * each move. Geometry changes shift the best release instant, so a pin angle
 * tuned before the change is stale — that re-tune is what keeps each step an
 * honest comparison rather than a handicap on the new geometry.
 */
export function autoTune(
  p: TrebuchetParams,
  keys: TunableKey[],
  rounds = 2,
  onProgress?: (progress: TuneProgress) => void,
): TrebuchetParams {
  let current = { ...p }
  for (let round = 0; round < rounds; round++) {
    for (const key of keys) {
      if (key === 'releaseAngle') continue
      const res = optimizeParam(current, key)
      if (res.improvement > 0) current = { ...current, [key]: res.value }
      const pin = bestReleaseAngle(current)
      if (pin != null) current = { ...current, releaseAngle: pin }
      onProgress?.({ round, key, range: simulateShot(current, FAST).range })
    }
  }
  return current
}
