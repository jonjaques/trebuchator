/// <reference lib="webworker" />
import { simulateShot } from './simulate.ts'
import {
  bestReleaseAngle,
  paretoSearch,
  sweepAt,
  sweepValues,
  type SweepPoint,
} from './optimize.ts'
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
 * Frames are only ever used to draw and to scrub, so a few hundred of them is
 * plenty. The solver still integrates and picks its release at full resolution
 * — this thins the payload, not the physics.
 *
 * Stroke and follow-through are thinned separately because they are sampled at
 * wildly different densities: the half-second stroke carries thousands of
 * samples, the follow-through runs at ~120 Hz for seconds. One uniform stride
 * across both would either starve the stroke of its whip detail or chop the
 * follow-through down to a slideshow.
 */
const MAX_STROKE_FRAMES = 360
const MAX_FOLLOW_FRAMES = 240

function thinSlice<T>(slice: T[], max: number): T[] {
  if (slice.length <= max) return slice
  const stride = Math.ceil(slice.length / max)
  const out = slice.filter((_, i) => i % stride === 0)
  const last = slice[slice.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

function thin(result: ShotResult): ShotResult {
  if (!result.ok) return result
  const split = result.frames.findIndex((f) => f.phase === 'follow')
  const stroke = split < 0 ? result.frames : result.frames.slice(0, split)
  const follow = split < 0 ? [] : result.frames.slice(split)
  const frames = [...thinSlice(stroke, MAX_STROKE_FRAMES), ...thinSlice(follow, MAX_FOLLOW_FRAMES)]
  return frames.length === result.frames.length ? result : { ...result, frames }
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

      case 'pareto':
        post({ id: req.id, kind: 'pareto', result: paretoSearch(...req.args), done: true })
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
