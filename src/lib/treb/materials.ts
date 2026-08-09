import type { TrebuchetParams } from './types.ts'

/**
 * Real construction matter, as data.
 *
 * The parameter model runs on masses and coefficients, which is right for the
 * solver and wrong for a builder standing next to a pile of actual stuff. These
 * tables let the panel answer the questions people really have — "how big a box
 * of sand is 60 kg?", "what does a granite ball this size weigh?", "what is a
 * greased timber axle worth in friction?" — by deriving the parameter from the
 * material instead of asking for the number cold.
 *
 * Densities are handbook mid-range values in kg/m³; bulk (poured/stacked)
 * densities for fills, solid densities for shot. Friction coefficients are the
 * kinetic, lubricated-as-stated values the presets already use.
 */
export interface Material {
  id: string
  name: string
  /** kg/m³ */
  density: number
}

export const CW_FILLS: Material[] = [
  { id: 'sand', name: 'Dry sand', density: 1600 },
  { id: 'earth', name: 'Rammed earth', density: 1900 },
  { id: 'stone', name: 'Stone rubble', density: 2200 },
  { id: 'concrete', name: 'Concrete block', density: 2400 },
  // Loose plate and offcuts stack with air in between; solid billet is 7850.
  { id: 'steel', name: 'Steel scrap', density: 5200 },
  { id: 'lead', name: 'Lead', density: 11340 },
]

export const PROJECTILE_MATERIALS: Material[] = [
  { id: 'pumpkin', name: 'Pumpkin', density: 700 },
  { id: 'oak', name: 'Oak ball', density: 750 },
  { id: 'ice', name: 'Ice ball', density: 917 },
  { id: 'water', name: 'Water balloon', density: 1000 },
  { id: 'limestone', name: 'Limestone', density: 2500 },
  { id: 'granite', name: 'Granite', density: 2700 },
  { id: 'iron', name: 'Cast iron', density: 7200 },
  { id: 'lead', name: 'Lead', density: 11340 },
]

export interface Bearing {
  id: string
  name: string
  /** Coulomb friction coefficient. */
  mu: number
}

export const BEARINGS: Bearing[] = [
  { id: 'roller', name: 'Roller bearing', mu: 0.02 },
  { id: 'bronze', name: 'Greased bronze bushing', mu: 0.1 },
  { id: 'iron', name: 'Iron on iron, greased', mu: 0.16 },
  { id: 'timber', name: 'Greased timber', mu: 0.25 },
  { id: 'dry', name: 'Dry timber', mu: 0.4 },
]

/** Side of the cube that holds `mass` of a fill at `density`. */
export function boxSizeFor(mass: number, density: number): number {
  return Math.cbrt(mass / Math.max(density, 1))
}

/** Mass of a solid sphere of `diameter` at `density`. */
export function projectileMassFor(diameter: number, density: number): number {
  return density * (Math.PI / 6) * diameter ** 3
}

/** The params a bearing choice sets — both axles; they are built alike. */
export function bearingPatch(b: Bearing): Partial<TrebuchetParams> {
  return { pivotFriction: b.mu, hingeFriction: b.mu }
}
