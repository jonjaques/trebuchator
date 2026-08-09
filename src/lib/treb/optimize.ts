import {
  cockToGround,
  geometryImpossibilities,
  simulateShot,
  validateGeometry,
} from './simulate.ts'
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
  /** Range at this value, or NaN where the machine would not throw at all. */
  range: number
  /** The integration step this point was fired at. See `SWEEP_DT`. */
  dt: number
}

/**
 * Sweeps are fired coarser than the shot on the sheet.
 *
 * Forty points at the readout's own step size doubles a wait that is already
 * over half a second, and a sweep is answering "which way is uphill", not "how
 * far exactly". The cost is real though: adopt a value off this curve and the
 * panel re-solves it at `simulateShot`'s finer default, so the two numbers
 * disagree in the last figure. Every point therefore carries the step it was
 * fired at rather than leaving a caller to assume they match.
 */
export const SWEEP_DT = 4e-4

const FAST = { lightweight: true, dt: SWEEP_DT } as const

function evaluate(p: TrebuchetParams, value: number): SweepPoint {
  const r = simulateShot(p, FAST)
  return { value, range: r.ok ? r.range : NaN, dt: SWEEP_DT }
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

/**
 * Set a machine up for one swept value.
 *
 * The two things `bestCase` does — re-cock, release ideally — both collide with
 * parameters a reader is entitled to sweep, and quietly losing that collision
 * is worse than either fixing it or refusing. Re-cocking would overwrite a
 * swept *cocked angle*, so the swept value wins and only the release is
 * idealised. Releasing ideally makes a swept *pin angle* inert, which has no
 * honest reading at all, so that pair is refused by `sweepConflict` rather than
 * plotted as a flat line the reader has no way to interpret.
 */
function stage(p: TrebuchetParams, mode: SweepMode, key: TunableKey): TrebuchetParams {
  if (mode === 'asBuilt') return p
  return {
    ...p,
    releaseMode: 'optimal',
    initialBeamAngle: key === 'initialBeamAngle' ? p.initialBeamAngle : cockToGround(p),
  }
}

/**
 * Why `mode` cannot sweep `key`, phrased for the reader, or null when it can.
 * Ask before requesting a sweep; `sweepAt` refuses the same pairs.
 */
export function sweepConflict(key: TunableKey, mode: SweepMode): string | null {
  if (mode === 'bestCase' && key === 'releaseAngle')
    return 'Best case already releases at the ideal instant, which is the very thing a pin angle is trying to hit — so there is nothing left for the pin to change. Switch to as built to see how your machine responds to it.'
  return null
}

/**
 * The values a sweep will fire, as data.
 *
 * Exported because the worker streams a sweep in chunks and used to re-derive
 * each chunk's bounds by repeating this interpolation. A chunk of one then
 * divided by `steps - 1 === 0` and produced NaN — latent only because the app
 * happened to ask for a step count that divides by the chunk size.
 */
export function sweepValues(min: number, max: number, steps: number): number[] {
  if (steps <= 0) return []
  if (steps === 1) return [min]
  const out: number[] = []
  for (let i = 0; i < steps; i++) out.push(min + ((max - min) * i) / (steps - 1))
  return out
}

/** Fire an explicit list of values. The streaming path calls this per chunk. */
export function sweepAt(
  p: TrebuchetParams,
  key: TunableKey,
  values: number[],
  mode: SweepMode = 'asBuilt',
): SweepPoint[] {
  const conflict = sweepConflict(key, mode)
  if (conflict) throw new Error(conflict)
  return values.map((value) => evaluate(stage({ ...p, [key]: value }, mode, key), value))
}

/** Sweep one parameter across `steps` evenly spaced values and report range. */
export function sweep(
  p: TrebuchetParams,
  key: TunableKey,
  min: number,
  max: number,
  steps = 40,
  mode: SweepMode = 'asBuilt',
): SweepPoint[] {
  return sweepAt(p, key, sweepValues(min, max, steps), mode)
}

/**
 * The pin angle that would have released at the best possible instant.
 *
 * Cheap and exact: run the swing once with the release solver in `optimal`
 * mode, and read back the sling-to-arm angle it chose. That angle *is* the
 * spigot to bend, so there is nothing to search over.
 *
 * Deliberately not `FAST`: this is one shot rather than forty, and the answer
 * is a number someone bends metal to, so it is fired at the full step.
 */
export function bestReleaseAngle(p: TrebuchetParams): number | null {
  const r = simulateShot({ ...p, releaseMode: 'optimal' }, { lightweight: true })
  return r.ok ? r.release.gamma : null
}

/**
 * What a search is trying to get more of.
 *
 * The thing it is traded *against* is not a choice: it is always peak axle
 * load. Every one of these goals is bought with frame — a machine that throws
 * further, converts better or lets go faster is a machine that hits its own
 * axle harder — so holding the cost axis fixed is what makes the frontier
 * readable as "here is the price". Letting both axes be picked sounds more
 * powerful and mostly produces pairs that do not trade, which collapses the
 * frontier to a single point and teaches nothing.
 */
export type ParetoGoal = 'range' | 'efficiency' | 'releaseSpeed'

export interface GoalSpec {
  goal: ParetoGoal
  label: string
  /** How the chart letters the axis. `ratio` is the 0–1 efficiency fraction. */
  unit: 'length' | 'speed' | 'ratio'
  blurb: string
}

export const GOALS: GoalSpec[] = [
  {
    goal: 'range',
    label: 'Range',
    unit: 'length',
    blurb: 'The furthest shot the frame will stand.',
  },
  {
    goal: 'efficiency',
    label: 'Efficiency',
    unit: 'ratio',
    blurb: 'The most of the counterweight’s energy delivered to the shot.',
  },
  {
    goal: 'releaseSpeed',
    label: 'Release speed',
    unit: 'speed',
    blurb: 'The fastest the sling lets go, whatever the shot then does in air.',
  },
]

/**
 * One build on the frontier.
 *
 * Every metric is carried rather than just the one searched on, so the chart
 * can letter a point with all of them and switching goal does not require the
 * caller to know which field it asked for. `params` is buildable as returned:
 * the release is a concrete pin at the angle the ideal release used, not
 * `releaseMode: 'optimal'`.
 */
export interface ParetoPoint {
  params: TrebuchetParams
  /** Range at the frontier evaluation (SWEEP_DT, ideal release). */
  range: number
  /** Peak main-axle load through the stroke — the frame this build demands. */
  axleLoad: number
  efficiency: number
  /** Speed of the shot at the instant the sling lets go, m/s. */
  releaseSpeed: number
  /**
   * This is the machine the search started from, evaluated as candidate zero.
   * Marking it is what lets the chart answer "is what I have any good?" rather
   * than only "what else is there?" — and a current machine that survives the
   * non-dominated filter is genuinely already on the frontier.
   */
  isCurrent: boolean
}

/** The searched metric of a point. */
export function goalValue(pt: ParetoPoint, goal: ParetoGoal): number {
  return goal === 'range' ? pt.range : goal === 'efficiency' ? pt.efficiency : pt.releaseSpeed
}

/**
 * Deterministic pseudo-random stream. The search must give the same frontier
 * for the same machine — a button that returns different builds on every press
 * reads as a slot machine — and the worker has no seed to thread from outside.
 */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/**
 * Multi-objective search: the Pareto frontier of `goal` against peak axle load.
 *
 * The coordinate-descent auto-tuner this replaces had two faults. It chased
 * range alone, so it happily specified a machine whose extra metres cost a
 * frame nobody would build — and it wandered into geometry that cannot exist
 * (hangers that put the weight box underground at rest). Here every candidate
 * is feasibility-checked before it is fired, both objectives are kept, and the
 * result is the set of non-dominated builds: for each one, more of what you
 * asked for is only available by accepting a heavier-loaded frame. Which trade
 * to take is the builder's call, not the optimizer's.
 *
 * Plain rejection sampling over the tunable ranges, not a genetic algorithm:
 * with four dimensions and a ~10 ms evaluation, a few hundred samples cover
 * the space better than machinery ten times this size.
 *
 * Candidates are scored with an ideal release so no one is handicapped by a
 * stale pin, and the pin angle that release *used* is written back as a
 * concrete `releaseAngle` — the returned params are buildable as-is.
 *
 * A candidate that will not throw is rejected on `ok` alone rather than on
 * `range <= 0`: a shot fired straight up scores no range and is still a real
 * machine, and under the release-speed goal it is one the search should be
 * allowed to keep.
 */
export function paretoSearch(
  p: TrebuchetParams,
  keys: TunableKey[],
  goal: ParetoGoal = 'range',
  samples = 160,
): ParetoPoint[] {
  const rand = lcg(0x7eb0c4e7)
  const specs = keys
    .map((key) => TUNABLES.find((t) => t.key === key))
    .filter((s): s is TunableSpec => s != null)

  const evaluate = (candidate: TrebuchetParams, isCurrent = false): ParetoPoint | null => {
    if (validateGeometry(candidate).length > 0) return null
    if (geometryImpossibilities(candidate).length > 0) return null
    const r = simulateShot({ ...candidate, releaseMode: 'optimal' }, FAST)
    if (!r.ok) return null
    return {
      params: { ...candidate, releaseMode: 'pin', releaseAngle: r.release.gamma },
      range: r.range,
      axleLoad: r.peaks.axleLoad,
      efficiency: r.efficiency,
      releaseSpeed: r.release.speed,
      isCurrent,
    }
  }

  // The current machine is candidate zero, so the frontier always says where
  // the build in hand stands — dominated or already optimal.
  const points: ParetoPoint[] = []
  const current = evaluate(p, true)
  if (current) points.push(current)

  for (let i = 0; i < samples; i++) {
    const candidate = { ...p }
    for (const spec of specs) {
      const [lo, hi] = spec.range(p)
      candidate[spec.key] = lo + rand() * (hi - lo)
    }
    const pt = evaluate(candidate)
    if (pt) points.push(pt)
  }

  // Non-dominated filter: keep a build only if nothing scores at least as well
  // on the goal for at most that axle load (with one of the two strictly
  // better).
  const front = points.filter(
    (a) =>
      !points.some(
        (b) =>
          b !== a &&
          goalValue(b, goal) >= goalValue(a, goal) &&
          b.axleLoad <= a.axleLoad &&
          (goalValue(b, goal) > goalValue(a, goal) || b.axleLoad < a.axleLoad),
      ),
  )
  front.sort((a, b) => a.axleLoad - b.axleLoad)

  // Two dozen points draw as a curve; nine draw as a dotted line with gaps the
  // eye reads as meaning something. The cap is higher than it was because the
  // frontier is now a chart rather than a list of rows to scan.
  const MAX_FRONT = 24
  if (front.length <= MAX_FRONT) return front
  const kept: ParetoPoint[] = []
  for (let i = 0; i < MAX_FRONT; i++) {
    kept.push(front[Math.round((i * (front.length - 1)) / (MAX_FRONT - 1))])
  }
  // Thinning must never drop the machine in hand. If it survived the
  // non-dominated filter it is genuinely on the frontier, and a chart that
  // silently omits its "as built" marker tells the reader the opposite of the
  // truth — that what they have was beaten.
  const asBuilt = front.find((pt) => pt.isCurrent)
  if (asBuilt && !kept.includes(asBuilt)) {
    let nearest = 0
    for (let i = 1; i < kept.length; i++) {
      if (
        Math.abs(kept[i].axleLoad - asBuilt.axleLoad) <
        Math.abs(kept[nearest].axleLoad - asBuilt.axleLoad)
      )
        nearest = i
    }
    kept[nearest] = asBuilt
  }
  return kept
}
