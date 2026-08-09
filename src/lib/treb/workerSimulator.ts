import type {
  SimKind,
  SimOps,
  SimRequest,
  SimResponse,
  Simulator,
  SweepUpdate,
} from './simulator.ts'
import type { SweepMode, SweepPoint, TunableKey } from './optimize.ts'
import type { TrebuchetParams } from './types.ts'

/**
 * The `Simulator` adapter that runs the solver in a Web Worker.
 *
 * This file is the only place in the app that knows the wire exists. It is also
 * the only place that imports the worker, which matters for the bundle: the
 * in-process adapter pulls the whole solver core in with it, and importing both
 * from one module would ship the physics twice.
 *
 * A factory rather than a class, so a client can be composed with `{ ...sim }`
 * without every method losing its `this`.
 */
export function workerSimulator(): Simulator {
  const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })
  const waiting = new Map<number, (msg: SimResponse) => void>()
  let nextId = 1

  worker.onmessage = (event: MessageEvent<SimResponse>) => {
    // A reply whose handler is gone was superseded or cancelled; dropping it is
    // the whole point of the id.
    waiting.get(event.data.id)?.(event.data)
  }

  /**
   * Ids are unique per request, so a reply carrying this id is a reply to this
   * request and its payload is `SimOps[K]['result']`. The cast states that;
   * TypeScript cannot see it through the indexed union.
   */
  function post<K extends SimKind>(
    kind: K,
    args: SimOps[K]['args'],
    onPartial?: (result: SimOps[K]['result']) => void,
  ): { id: number; result: Promise<SimOps[K]['result']> } {
    const id = nextId++
    const result = new Promise<SimOps[K]['result']>((resolve, reject) => {
      waiting.set(id, (msg) => {
        if (msg.kind === 'error') {
          waiting.delete(id)
          reject(new Error(msg.message))
          return
        }
        const payload = msg.result as SimOps[K]['result']
        if (!msg.done) {
          onPartial?.(payload)
          return
        }
        waiting.delete(id)
        resolve(payload)
      })
      worker.postMessage({ id, kind, args } as SimRequest)
    })
    return { id, result }
  }

  return {
    shot(params) {
      return post('shot', [params]).result
    },

    tunePin(params) {
      return post('tunePin', [params]).result
    },

    pareto(params, keys, goal) {
      return post('pareto', [params, keys, goal]).result
    },

    sweep(
      params: TrebuchetParams,
      key: TunableKey,
      min: number,
      max: number,
      steps: number,
      mode: SweepMode,
      onUpdate: (update: SweepUpdate) => void,
    ) {
      const { id, result } = post(
        'sweep',
        [params, key, min, max, steps, mode],
        (points: SweepPoint[]) => onUpdate({ kind: 'points', points, done: false }),
      )
      void result.then(
        (points) => onUpdate({ kind: 'points', points, done: true }),
        (err: unknown) =>
          onUpdate({ kind: 'error', message: err instanceof Error ? err.message : String(err) }),
      )
      // Cancelling drops the handler. The worker has no way to abandon a sweep
      // mid-flight, so this stops the updates rather than the work — which is
      // what a superseded sweep needs, and is one fewer thing writing into
      // state that has already moved on.
      return () => {
        waiting.delete(id)
      }
    },
  }
}
