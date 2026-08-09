import { useEffect, useState } from 'react'
import { coalesceShots, type Simulator } from './treb/simulator.ts'
import { workerSimulator } from './treb/workerSimulator.ts'
import type { ShotResult, TrebuchetParams } from './treb/types.ts'

/**
 * React's view of the solver.
 *
 * Everything here is written against the `Simulator` interface, not against the
 * worker: the transport is chosen once, at the singleton below, and the rest of
 * the app never learns which one it got.
 */
export interface SimClient extends Simulator {
  /** Latest-wins shot request. See `coalesceShots`. */
  requestShot: ReturnType<typeof coalesceShots>['request']
  /**
   * A second, independent latest-wins queue for what-if previews. On the main
   * queue a burst of chart hovers would supersede a real parameter change and
   * the shot on the sheet would simply never arrive; two queues let each drop
   * only its own stale work.
   */
  requestPreview: ReturnType<typeof coalesceShots>['request']
}

export function makeClient(simulator: Simulator): SimClient {
  return {
    ...simulator,
    requestShot: coalesceShots(simulator).request,
    requestPreview: coalesceShots(simulator).request,
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
    singleton ??= makeClient(workerSimulator())
    return singleton
  })
  return client
}

/**
 * Run a shot whenever the parameters change.
 *
 * `busy` is derived from whether the held result was computed for the current
 * parameters rather than tracked as its own flag, which keeps the effect free
 * of synchronous state updates and makes "stale" impossible to get wrong. The
 * same trick clears `error`: a newer set of parameters is a fresh attempt, so
 * an error held against older ones simply stops being current.
 */
export function useShot(client: SimClient, params: TrebuchetParams) {
  const [state, setState] = useState<{
    params: TrebuchetParams
    result: ShotResult | null
    error: string | null
  } | null>(null)

  useEffect(() => {
    let live = true
    client.requestShot(params, {
      onResult: (result) => {
        if (live) setState({ params, result, error: null })
      },
      onError: (message) => {
        if (live) setState({ params, result: null, error: message })
      },
    })
    return () => {
      live = false
    }
  }, [client, params])

  const current = state?.params === params ? state : null
  return {
    result: state?.result ?? null,
    error: current?.error ?? null,
    busy: !state || state.params !== params,
  }
}
