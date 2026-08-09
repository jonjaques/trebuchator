import { useEffect, useState } from 'react'
import type { SimRequest, SimResponse } from './treb/sim.worker.ts'
import type { TunableKey, SweepPoint } from './treb/optimize.ts'
import type { ShotResult, TrebuchetParams } from './treb/types.ts'

/**
 * Thin promise/stream wrapper around the solver worker.
 *
 * Requests carry an id and stale replies are dropped, because a fast drag will
 * queue several shots and only the newest one is worth drawing. Sweeps are the
 * exception: they stream partial results under one id, so they use a callback
 * rather than a promise.
 */
/**
 * Omit over a union has to distribute, or TypeScript collapses `SimRequest` to
 * the keys every variant shares and every payload field becomes an error.
 */
type RequestBody<T> = T extends unknown ? Omit<T, 'id'> : never

class SimClient {
  private worker: Worker
  private nextId = 1
  private pending = new Map<number, (msg: SimResponse) => void>()
  private streams = new Map<number, (msg: SimResponse) => void>()
  private shotJob: { params: TrebuchetParams; onResult: (r: ShotResult) => void } | null = null
  private shotRunning = false

  constructor() {
    this.worker = new Worker(new URL('./treb/sim.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e: MessageEvent<SimResponse>) => {
      const msg = e.data
      const stream = this.streams.get(msg.id)
      if (stream) {
        stream(msg)
        return
      }
      const resolve = this.pending.get(msg.id)
      if (resolve) {
        this.pending.delete(msg.id)
        resolve(msg)
      }
    }
  }

  private send(req: RequestBody<SimRequest>): Promise<SimResponse> {
    const id = this.nextId++
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.worker.postMessage({ ...req, id } as SimRequest)
    })
  }

  async shot(params: TrebuchetParams): Promise<ShotResult | null> {
    const msg = await this.send({ kind: 'shot', params })
    return msg.kind === 'shot' ? msg.result : null
  }

  /**
   * Shot request that coalesces against itself.
   *
   * A slider drag fires far faster than the solver runs, and queueing every
   * intermediate state would leave the drawing seconds behind the handle. Only
   * the newest request survives, and a result whose request has already been
   * superseded is dropped rather than drawn.
   */
  requestShot(params: TrebuchetParams, onResult: (r: ShotResult) => void) {
    this.shotJob = { params, onResult }
    void this.pumpShots()
  }

  private async pumpShots() {
    if (this.shotRunning) return
    this.shotRunning = true
    try {
      while (this.shotJob) {
        const job = this.shotJob
        this.shotJob = null
        const result = await this.shot(job.params)
        if (result && !this.shotJob) job.onResult(result)
      }
    } finally {
      this.shotRunning = false
    }
  }

  async tunePin(params: TrebuchetParams): Promise<number | null> {
    const msg = await this.send({ kind: 'tunePin', params })
    return msg.kind === 'tunePin' ? msg.angle : null
  }

  async optimize(params: TrebuchetParams, key: TunableKey) {
    const msg = await this.send({ kind: 'optimize', params, key })
    return msg.kind === 'optimize' ? msg : null
  }

  async autotune(params: TrebuchetParams, keys: TunableKey[]) {
    const msg = await this.send({ kind: 'autotune', params, keys })
    return msg.kind === 'autotune' ? msg.params : null
  }

  sweep(
    params: TrebuchetParams,
    key: TunableKey,
    min: number,
    max: number,
    steps: number,
    onPoints: (points: SweepPoint[], done: boolean) => void,
  ): () => void {
    const id = this.nextId++
    this.streams.set(id, (msg) => {
      if (msg.kind !== 'sweep') return
      onPoints(msg.points, msg.done)
      if (msg.done) this.streams.delete(id)
    })
    this.worker.postMessage({ kind: 'sweep', params, key, min, max, steps, id } as SimRequest)
    return () => this.streams.delete(id)
  }

  dispose() {
    this.worker.terminate()
  }
}

/**
 * One solver worker for the lifetime of the page.
 *
 * Deliberately a module singleton rather than a per-mount instance. StrictMode
 * mounts, unmounts and remounts in development, and a worker created per mount
 * would either be torn down under the remount or leaked by it. The solver is
 * stateless between requests, so sharing one is free.
 */
let singleton: SimClient | null = null

export function useSimClient(): SimClient {
  const [client] = useState(() => {
    singleton ??= new SimClient()
    return singleton
  })
  return client
}

/**
 * Run a shot whenever the parameters change.
 *
 * `busy` is derived from whether the held result was computed for the current
 * parameters rather than tracked as its own flag, which keeps the effect free
 * of synchronous state updates and makes "stale" impossible to get wrong.
 */
export function useShot(client: SimClient, params: TrebuchetParams) {
  const [state, setState] = useState<{ params: TrebuchetParams; result: ShotResult } | null>(null)

  useEffect(() => {
    let live = true
    client.requestShot(params, (result) => {
      if (live) setState({ params, result })
    })
    return () => {
      live = false
    }
  }, [client, params])

  return {
    result: state?.result ?? null,
    busy: !state || state.params !== params,
  }
}

export type { SimClient }
