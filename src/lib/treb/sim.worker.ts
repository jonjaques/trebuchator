/// <reference lib="webworker" />
import { simulateShot } from './simulate.ts'
import {
  autoTune,
  bestReleaseAngle,
  optimizeParam,
  sweep,
  type SweepMode,
  type TunableKey,
} from './optimize.ts'
import type { ShotResult, TrebuchetParams } from './types.ts'

/**
 * The solver runs here, not on the UI thread.
 *
 * A full shot is 20-45 ms and a 40-point sweep is over half a second. Both are
 * far too long to sit between a slider's mousemove events, and the symptom
 * would be the worst possible one for this app: the drag feels broken exactly
 * when someone is trying to feel out how a parameter behaves.
 */

export type SimRequest =
  | { id: number; kind: 'shot'; params: TrebuchetParams }
  | {
      id: number
      kind: 'sweep'
      params: TrebuchetParams
      key: TunableKey
      min: number
      max: number
      steps: number
      mode: SweepMode
    }
  | { id: number; kind: 'tunePin'; params: TrebuchetParams }
  | { id: number; kind: 'optimize'; params: TrebuchetParams; key: TunableKey }
  | { id: number; kind: 'autotune'; params: TrebuchetParams; keys: TunableKey[] }

export type SimResponse =
  | { id: number; kind: 'shot'; result: ShotResult }
  | { id: number; kind: 'sweep'; points: ReturnType<typeof sweep>; done: boolean }
  | { id: number; kind: 'tunePin'; angle: number | null }
  | { id: number; kind: 'optimize'; value: number; range: number; improvement: number }
  | { id: number; kind: 'autotune'; params: TrebuchetParams }
  | { id: number; kind: 'error'; message: string }

/**
 * Frames are only ever used to draw and to scrub, so ~360 of them is plenty for
 * a stroke under two seconds. The solver still integrates and picks its release
 * at full resolution — this thins the payload, not the physics.
 */
const MAX_FRAMES = 360

function thin(result: ShotResult): ShotResult {
  if (result.frames.length <= MAX_FRAMES) return result
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
        post({ id: req.id, kind: 'shot', result: thin(simulateShot(req.params)) })
        break

      case 'sweep': {
        // Streamed in chunks so the chart draws itself left to right instead of
        // blocking on the full sweep and appearing all at once half a second later.
        const chunk = 5
        const all: ReturnType<typeof sweep> = []
        for (let i = 0; i < req.steps; i += chunk) {
          const n = Math.min(chunk, req.steps - i)
          const lo = req.min + ((req.max - req.min) * i) / (req.steps - 1)
          const hi = req.min + ((req.max - req.min) * (i + n - 1)) / (req.steps - 1)
          const part = sweep(req.params, req.key, lo, hi, n, req.mode)
          all.push(...part)
          post({ id: req.id, kind: 'sweep', points: all.slice(), done: i + n >= req.steps })
        }
        if (req.steps === 0) post({ id: req.id, kind: 'sweep', points: [], done: true })
        break
      }

      case 'tunePin':
        post({ id: req.id, kind: 'tunePin', angle: bestReleaseAngle(req.params) })
        break

      case 'optimize': {
        const r = optimizeParam(req.params, req.key)
        post({
          id: req.id,
          kind: 'optimize',
          value: r.value,
          range: r.range,
          improvement: r.improvement,
        })
        break
      }

      case 'autotune':
        post({ id: req.id, kind: 'autotune', params: autoTune(req.params, req.keys) })
        break
    }
  } catch (err) {
    post({ id: req.id, kind: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
