import { newId, readJson, writeJson } from '../store.ts'
import { DEFAULT_PARAMS } from './presets.ts'
import { BEARINGS, CW_FILLS, PROJECTILE_MATERIALS, type Bearing, type Material } from './materials.ts'
import type { TrebuchetParams } from './types.ts'

/**
 * What the builder has added: their own machines, and their own matter.
 *
 * `presets.ts` and `materials.ts` are reference data — machines from the record
 * and handbook densities — and they stay read-only so two people quoting a
 * number to each other are quoting the same number. Everything here is the
 * layer on top that belongs to whoever is sitting at the browser.
 *
 * Both lists are read once at boot and written whole on every change. They hold
 * a handful of small objects, and a merge strategy for data only one tab can
 * edit would be machinery guarding nothing.
 */

const MACHINE_KEY = 'trebuchator:machines'
const MATERIAL_KEY = 'trebuchator:materials'

export interface SavedMachine {
  id: string
  name: string
  params: TrebuchetParams
}

/**
 * Custom matter, in the same shapes the built-in tables use so a picker can
 * concatenate the two lists and forget which is which. `kind` is what the entry
 * *sets*, not what it is made of: the counterweight and the projectile want a
 * density, a bearing wants a friction coefficient.
 */
export type CustomMaterial =
  | { id: string; kind: 'fill' | 'shot'; name: string; density: number }
  | { id: string; kind: 'bearing'; name: string; mu: number }

/**
 * Stored params are merged over the defaults rather than trusted whole.
 *
 * A machine saved by an older build is missing every field added since, and a
 * `TrebuchetParams` with a hole in it does not fail at the boundary — it
 * reaches the solver and comes out as `NaN` range, which reads as a physics bug
 * rather than as stale data. Merging costs one spread and makes that
 * unrepresentable.
 */
function reviveParams(raw: unknown): TrebuchetParams | null {
  if (raw == null || typeof raw !== 'object') return null
  const merged = { ...DEFAULT_PARAMS, ...(raw as Partial<TrebuchetParams>) }
  // A stored file can carry any junk in a numeric field; one non-finite number
  // is enough to make every downstream reading meaningless.
  for (const [k, v] of Object.entries(merged)) {
    const def = (DEFAULT_PARAMS as unknown as Record<string, unknown>)[k]
    if (typeof def === 'number' && (typeof v !== 'number' || !Number.isFinite(v))) return null
  }
  return merged
}

export function loadMachines(): SavedMachine[] {
  const raw = readJson<unknown>(MACHINE_KEY, [])
  if (!Array.isArray(raw)) return []
  const out: SavedMachine[] = []
  for (const entry of raw) {
    if (entry == null || typeof entry !== 'object') continue
    const { id, name, params } = entry as Record<string, unknown>
    const revived = reviveParams(params)
    if (typeof id !== 'string' || typeof name !== 'string' || !revived) continue
    out.push({ id, name, params: revived })
  }
  return out
}

export function saveMachines(machines: SavedMachine[]): void {
  writeJson(MACHINE_KEY, machines)
}

export function newMachine(name: string, params: TrebuchetParams): SavedMachine {
  return { id: newId('m'), name, params: { ...params } }
}

export function loadMaterials(): CustomMaterial[] {
  const raw = readJson<unknown>(MATERIAL_KEY, [])
  if (!Array.isArray(raw)) return []
  const out: CustomMaterial[] = []
  for (const entry of raw) {
    if (entry == null || typeof entry !== 'object') continue
    const m = entry as Record<string, unknown>
    if (typeof m.id !== 'string' || typeof m.name !== 'string') continue
    if (m.kind === 'bearing') {
      if (typeof m.mu !== 'number' || !Number.isFinite(m.mu)) continue
      out.push({ id: m.id, kind: 'bearing', name: m.name, mu: m.mu })
    } else if (m.kind === 'fill' || m.kind === 'shot') {
      if (typeof m.density !== 'number' || !Number.isFinite(m.density)) continue
      out.push({ id: m.id, kind: m.kind, name: m.name, density: m.density })
    }
  }
  return out
}

export function saveMaterials(materials: CustomMaterial[]): void {
  writeJson(MATERIAL_KEY, materials)
}

/**
 * The pickers' lists: reference data first, then whatever has been added.
 *
 * Custom entries go last rather than being sorted in, so the handbook values
 * stay where they have always been and a new one is visibly an addition.
 */
// `flatMap` with an inline test rather than `filter().map()`: a boolean
// predicate does not narrow the union, so the mapped callback would still see
// the bearing arm and `density` would not exist on it.
export function fillsWith(custom: CustomMaterial[]): Material[] {
  return [
    ...CW_FILLS,
    ...custom.flatMap((m) => (m.kind === 'fill' ? [{ id: m.id, name: m.name, density: m.density }] : [])),
  ]
}

export function shotMaterialsWith(custom: CustomMaterial[]): Material[] {
  return [
    ...PROJECTILE_MATERIALS,
    ...custom.flatMap((m) => (m.kind === 'shot' ? [{ id: m.id, name: m.name, density: m.density }] : [])),
  ]
}

export function bearingsWith(custom: CustomMaterial[]): Bearing[] {
  return [
    ...BEARINGS,
    ...custom.flatMap((m) => (m.kind === 'bearing' ? [{ id: m.id, name: m.name, mu: m.mu }] : [])),
  ]
}
