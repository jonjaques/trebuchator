import type { SweepMode, SweepPoint, TunableKey } from './optimize.ts'
import type { ShotResult, TrebuchetParams } from './types.ts'

/**
 * What the app asks for, and where the solver stops being the app's problem.
 *
 * The physics runs off the UI thread, but "off the UI thread" is a deployment
 * decision, not something a caller should have to know. This is the interface
 * either side of that: the browser gets a worker-backed adapter, tests get an
 * in-process one, and nothing above here mentions `postMessage`.
 *
 * Named `Simulator` rather than `Solver` on purpose — `solver.ts` in this same
 * directory is the Lagrangian dynamics solver, and two things called the solver
 * one import apart would be worse than the indirection this removes.
 */
export interface Simulator {
  /** Fire one shot. Rejects if the solver itself failed; a machine that will
   *  not throw comes back as a perfectly ordinary `ok: false` result. */
  shot(params: TrebuchetParams): Promise<ShotResult>
  /** The pin angle an ideal release would have used, or null if it never fired. */
  tunePin(params: TrebuchetParams): Promise<number | null>
  autotune(params: TrebuchetParams, keys: TunableKey[]): Promise<TrebuchetParams>
  /**
   * Sweep one parameter, reporting partial results as they arrive. Returns a
   * cancel function; call it and no further updates are delivered.
   */
  sweep(
    params: TrebuchetParams,
    key: TunableKey,
    min: number,
    max: number,
    steps: number,
    mode: SweepMode,
    onUpdate: (update: SweepUpdate) => void,
  ): () => void
}

/**
 * One callback rather than a result callback plus an optional error callback:
 * a sweep that dies has to reach the reader, and an optional error handler is
 * an error handler nobody passes.
 */
export type SweepUpdate =
  | { kind: 'points'; points: SweepPoint[]; done: boolean }
  | { kind: 'error'; message: string }

/**
 * The operations, declared once.
 *
 * Both wire shapes below are derived from this table, so an operation is one
 * entry here instead of matching edits to a request union, a response union and
 * a client method — which is how the `optimize` operation came to exist on the
 * wire for months without a single caller.
 */
export type SimOps = {
  shot: { args: [TrebuchetParams]; result: ShotResult }
  tunePin: { args: [TrebuchetParams]; result: number | null }
  autotune: { args: [TrebuchetParams, TunableKey[]]; result: TrebuchetParams }
  sweep: {
    args: [TrebuchetParams, TunableKey, number, number, number, SweepMode]
    result: SweepPoint[]
  }
}

export type SimKind = keyof SimOps

export type SimRequest = {
  [K in SimKind]: { id: number; kind: K; args: SimOps[K]['args'] }
}[SimKind]

/**
 * `done` rides on every reply, not just sweeps: it is what lets a client drop
 * a request's handler without knowing which operations stream and which do not.
 */
export type SimResponse =
  | {
      [K in SimKind]: { id: number; kind: K; result: SimOps[K]['result']; done: boolean }
    }[SimKind]
  | { id: number; kind: 'error'; message: string }

export interface ShotHandlers {
  onResult: (result: ShotResult) => void
  onError: (message: string) => void
}

/**
 * Latest-wins shot requests over any `Simulator`.
 *
 * A slider drag fires far faster than the solver runs, and queueing every
 * intermediate state would leave the drawing seconds behind the handle. Only
 * the newest request survives, and a result whose request has already been
 * superseded is dropped rather than drawn.
 *
 * Policy, not transport — it is written against the interface so it can be
 * tested against a stub that resolves when the test says so, rather than
 * against a real worker and a stopwatch.
 */
export function coalesceShots(sim: Simulator) {
  let queued: { params: TrebuchetParams; handlers: ShotHandlers } | null = null
  let running = false

  async function pump() {
    if (running) return
    running = true
    try {
      while (queued) {
        const job = queued
        queued = null
        try {
          const result = await sim.shot(job.params)
          // A newer request landed while this one was in flight, so this answer
          // is already about a machine nobody is looking at.
          if (!queued) job.handlers.onResult(result)
        } catch (err) {
          if (!queued) job.handlers.onError(err instanceof Error ? err.message : String(err))
        }
      }
    } finally {
      running = false
    }
  }

  return {
    request(params: TrebuchetParams, handlers: ShotHandlers) {
      queued = { params, handlers }
      void pump()
    },
  }
}

export type ShotCoalescer = ReturnType<typeof coalesceShots>
