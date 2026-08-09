import { createContext, use } from 'react'
import type { DimensionKey } from '@/components/stage/sheet.ts'

/**
 * Which dimension a control is pointing at.
 *
 * A control and the line it measures are the same fact told twice — "sling
 * length 1.8 m" in the rail, and a dimension between the beam tip and the pouch
 * on the sheet — and until now nothing connected them. A builder reading
 * "hanger length" had to work out which of five measurements on the drawing it
 * referred to, or turn on the whole annotation layer and hunt.
 *
 * A context rather than a prop threaded through every `Field`, for the same
 * reason [[notes]] is one: the rail is a deep tree of sections and rows, and
 * passing a callback down it would touch every intermediate component to serve
 * two leaf types.
 *
 * Defaulted to a no-op so a control rendered without the provider — every test
 * does this — simply reports to nobody rather than throwing.
 */
export const PointAtContext = createContext<(key: DimensionKey | null) => void>(() => {})

export function usePointAt(): (key: DimensionKey | null) => void {
  return use(PointAtContext)
}
