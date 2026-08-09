/**
 * Display units.
 *
 * The solver is SI throughout and never sees a foot. Conversion happens here,
 * at the edge, in both directions: `toDisplay` on the way out to a field,
 * `fromDisplay` on the way back in. Anything that skips this pair is a bug
 * waiting for someone to throw a 300 kg stone four furlongs.
 */

export type UnitSystem = 'metric' | 'imperial'

export type Dimension =
  | 'length'
  | 'mass'
  | 'speed'
  | 'energy'
  | 'force'
  | 'moment'
  | 'angle'
  | 'time'
  | 'density'
  | 'none'

const FACTOR: Record<Dimension, number> = {
  length: 3.280839895, // m -> ft
  mass: 2.204622622, // kg -> lb
  speed: 2.236936292, // m/s -> mph
  energy: 0.7375621493, // J -> ft.lbf
  force: 0.2248089431, // N -> lbf
  moment: 0.7375621493, // N.m -> lbf.ft
  angle: 1,
  time: 1,
  density: 0.06242796, // kg/m3 -> lb/ft3
  none: 1,
}

const SYMBOL: Record<Dimension, [metric: string, imperial: string]> = {
  length: ['m', 'ft'],
  mass: ['kg', 'lb'],
  speed: ['m/s', 'mph'],
  energy: ['J', 'ft·lbf'],
  force: ['N', 'lbf'],
  moment: ['N·m', 'lbf·ft'],
  angle: ['°', '°'],
  time: ['s', 's'],
  density: ['kg/m³', 'lb/ft³'],
  none: ['', ''],
}

export function unitSymbol(dim: Dimension, system: UnitSystem): string {
  return SYMBOL[dim][system === 'metric' ? 0 : 1]
}

export function toDisplay(value: number, dim: Dimension, system: UnitSystem): number {
  return system === 'metric' ? value : value * FACTOR[dim]
}

export function fromDisplay(value: number, dim: Dimension, system: UnitSystem): number {
  return system === 'metric' ? value : value / FACTOR[dim]
}

/**
 * Significant-figure-ish formatting that keeps columns from jittering. Big
 * numbers lose their decimals, small ones keep them, and nothing ever renders
 * as "1.2999999999999998".
 */
export function num(value: number, digits?: number): string {
  if (!Number.isFinite(value)) return '—'
  if (digits != null) return value.toFixed(digits)
  const a = Math.abs(value)
  if (a === 0) return '0'
  if (a >= 10000) return Math.round(value).toLocaleString('en-US')
  if (a >= 1000) return value.toFixed(0)
  if (a >= 100) return value.toFixed(1)
  if (a >= 10) return value.toFixed(2)
  if (a >= 1) return value.toFixed(2)
  if (a >= 0.01) return value.toFixed(3)
  return value.toPrecision(2)
}

/** Convert then format, for read-only readouts. */
export function show(
  value: number,
  dim: Dimension,
  system: UnitSystem,
  digits?: number,
): string {
  return num(toDisplay(value, dim, system), digits)
}

/** Large forces and energies read better with an SI-ish magnitude prefix. */
export function scaled(
  value: number,
  dim: Dimension,
  system: UnitSystem,
): { text: string; unit: string } {
  const v = toDisplay(value, dim, system)
  const u = unitSymbol(dim, system)
  const a = Math.abs(v)
  if (a >= 1e6) return { text: num(v / 1e6, 2), unit: `M${u}` }
  if (a >= 1e3) return { text: num(v / 1e3, 2), unit: `k${u}` }
  return { text: num(v), unit: u }
}

/** Metres per second is meaningless to most people; add a familiar echo. */
export function speedAside(ms: number, system: UnitSystem): string {
  return system === 'metric'
    ? `${num(ms * 3.6, 0)} km/h`
    : `${num(ms * 2.236936292, 0)} mph`
}
