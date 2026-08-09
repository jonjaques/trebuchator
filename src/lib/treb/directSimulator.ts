import { simulateShot } from './simulate.ts'
import { autoTune, bestReleaseAngle, sweepAt, sweepValues } from './optimize.ts'
import type { Simulator } from './simulator.ts'

/**
 * The `Simulator` adapter that runs the solver right here.
 *
 * The second adapter is what makes the seam real rather than hypothetical: it
 * lets a test exercise the actual physics through the same interface the app
 * uses, with no worker, no `postMessage` and no bundler URL resolution — none
 * of which exist under vitest's node environment.
 *
 * Do not import this from the app. It pulls the whole solver core into whatever
 * bundle it lands in, which is exactly what the worker chunk is for.
 */
export function directSimulator(): Simulator {
  return {
    async shot(params) {
      return simulateShot(params)
    },

    async tunePin(params) {
      return bestReleaseAngle(params)
    },

    async autotune(params, keys) {
      return autoTune(params, keys)
    },

    sweep(params, key, min, max, steps, mode, onUpdate) {
      let cancelled = false
      // Deferred even though the work is synchronous. A cancelled request must
      // never deliver an update, and that is only worth asserting if this
      // adapter can get it wrong the same way the worker one can.
      queueMicrotask(() => {
        if (cancelled) return
        try {
          const points = sweepAt(params, key, sweepValues(min, max, steps), mode)
          onUpdate({ kind: 'points', points, done: true })
        } catch (err) {
          onUpdate({
            kind: 'error',
            message: err instanceof Error ? err.message : String(err),
          })
        }
      })
      return () => {
        cancelled = true
      }
    },
  }
}
