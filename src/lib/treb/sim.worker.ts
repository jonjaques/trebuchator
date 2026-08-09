/// <reference lib="webworker" />
import { simulateShot } from './simulate.ts'
import { autoTune, bestReleaseAngle, sweepAt, sweepValues, type SweepPoint } from './optimize.ts'
import type { SimRequest, SimResponse } from './simulator.ts'
import type { ShotResult } from './types.ts'

/**
 * The solver runs here, not on the UI thread.
 *
 * A full shot is 20-45 ms and a 40-point sweep is over half a second. Both are
 * far too long to sit between a slider's mousemove events, and the symptom
 * would be the worst possible one for this app: the drag feels broken exactly
 * when someone is trying to feel out how a parameter behaves.
 *
 * The request and response shapes come from `simulator.ts` — this file is one
 * side of that wire, `workerSimulator.ts` is the other, and neither restates
 * the operations.
 */

/**
 * Frames are only ever used to draw and to scrub, so ~360 of them is plenty for
 * a stroke under two seconds. The solver still integrates and picks its release
 * at full resolution — this thins the payload, not the physics.
 */
const MAX_FRAMES = 360

function thin(result: ShotResult): ShotResult {
  if (!result.ok || result.frames.length <= MAX_FRAMES) return result
  const stride = Math.ceil(result.frames.length / MAX_FRAMES)
  const frames = result.frames.filter((_, i) => i % stride === 0)
  const last = result.frames[result.frames.length - 1]
  if (frames[frames.length - 1] !== last) frames.push(last)
  return { ...result, frames }
}

self.onmessage = (event: MessageEvent<SimRequest>) => {
  const req = event.data
  const post = (msg: SimResponse) => self.postMessage(msg)
  try {
    switch (req.kind) {
      case 'shot':
        post({ id: req.id, kind: 'shot', result: thin(simulateShot(...req.args)), done: true })
        break

      case 'tunePin':
        post({ id: req.id, kind: 'tunePin', result: bestReleaseAngle(...req.args), done: true })
        break

      case 'autotune':
        post({ id: req.id, kind: 'autotune', result: autoTune(...req.args), done: true })
        break

      case 'sweep': {
        // Streamed in chunks so the chart draws itself left to right instead of
        // blocking on the full sweep and appearing all at once half a second
        // later. The grid comes from the sweep module rather than being
        // re-derived here, so a chunk is always a slice of the same values the
        // unchunked call would have fired.
        const [params, key, min, max, steps, mode] = req.args
        const values = sweepValues(min, max, steps)
        const chunk = 5
        const all: SweepPoint[] = []
        for (let i = 0; i < values.length; i += chunk) {
          all.push(...sweepAt(params, key, values.slice(i, i + chunk), mode))
          post({
            id: req.id,
            kind: 'sweep',
            result: all.slice(),
            done: i + chunk >= values.length,
          })
        }
        if (values.length === 0) post({ id: req.id, kind: 'sweep', result: [], done: true })
        break
      }
    }
  } catch (err) {
    post({ id: req.id, kind: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
