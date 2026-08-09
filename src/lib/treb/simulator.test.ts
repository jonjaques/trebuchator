import { describe, expect, it } from 'vitest'
import { coalesceShots, type Simulator, type SweepUpdate } from './simulator.ts'
import { directSimulator } from './directSimulator.ts'
import { simulateShot } from './simulate.ts'
import { presetById } from './presets.ts'
import type { ShotResult, TrebuchetParams } from './types.ts'

const params = () => structuredClone(presetById('backyard')!.params)

const base = simulateShot(params())
if (!base.ok) throw new Error('the backyard preset should throw')
/** A real result, retagged, so the tests never hand-build a 20-field struct. */
const shotOf = (range: number): ShotResult => ({ ...base, range })

/** Somewhere for pending promises and microtasks to land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * A `Simulator` whose shots finish when the test says so. This is the whole
 * point of the seam: coalescing is timing policy, and asserting it against a
 * real worker would mean asserting against a stopwatch.
 */
function stubSimulator() {
  const inFlight: {
    params: TrebuchetParams
    resolve: (r: ShotResult) => void
    reject: (e: Error) => void
  }[] = []
  const sim: Simulator = {
    shot(p) {
      return new Promise((resolve, reject) => inFlight.push({ params: p, resolve, reject }))
    },
    tunePin: async () => null,
    autotune: async (p) => p,
    sweep: () => () => {},
  }
  return { sim, inFlight }
}

describe('coalescing shot requests', () => {
  it('runs one shot at a time', async () => {
    const { sim, inFlight } = stubSimulator()
    const shots = coalesceShots(sim)
    const noop = { onResult: () => {}, onError: () => {} }

    shots.request(params(), noop)
    shots.request(params(), noop)
    shots.request(params(), noop)
    await settle()

    expect(inFlight).toHaveLength(1)
  })

  it('skips every request a newer one overtook', async () => {
    const { sim, inFlight } = stubSimulator()
    const shots = coalesceShots(sim)
    const seen: number[] = []
    const handlers = { onResult: (r: ShotResult) => seen.push(r.range), onError: () => {} }

    const first = { ...params(), armLong: 1 }
    const middle = { ...params(), armLong: 2 }
    const last = { ...params(), armLong: 3 }

    shots.request(first, handlers)
    await settle()
    shots.request(middle, handlers)
    shots.request(last, handlers)

    inFlight[0].resolve(shotOf(10))
    await settle()

    // The first answer is about a machine nobody is looking at any more, and
    // the middle request never ran at all — that is the point of coalescing.
    expect(seen).toEqual([])
    expect(inFlight).toHaveLength(2)
    expect(inFlight[1].params.armLong).toBe(3)

    inFlight[1].resolve(shotOf(30))
    await settle()
    expect(seen).toEqual([30])
  })

  it('delivers a result when nothing has superseded it', async () => {
    const { sim, inFlight } = stubSimulator()
    const shots = coalesceShots(sim)
    const seen: number[] = []
    shots.request(params(), { onResult: (r) => seen.push(r.range), onError: () => {} })
    await settle()

    inFlight[0].resolve(shotOf(42))
    await settle()
    expect(seen).toEqual([42])
  })

  it('reports a solver failure instead of stalling on it', async () => {
    // The old client turned every failure into `null`, dropped it, and left the
    // UI showing "solving" for the rest of the session.
    const { sim, inFlight } = stubSimulator()
    const shots = coalesceShots(sim)
    const errors: string[] = []
    shots.request(params(), { onResult: () => {}, onError: (m) => errors.push(m) })
    await settle()

    inFlight[0].reject(new Error('matrix is singular'))
    await settle()
    expect(errors).toEqual(['matrix is singular'])
  })

  it('keeps pumping after a failure', async () => {
    const { sim, inFlight } = stubSimulator()
    const shots = coalesceShots(sim)
    const seen: number[] = []
    const handlers = { onResult: (r: ShotResult) => seen.push(r.range), onError: () => {} }

    shots.request(params(), handlers)
    await settle()
    inFlight[0].reject(new Error('boom'))
    await settle()

    shots.request(params(), handlers)
    await settle()
    inFlight[1].resolve(shotOf(7))
    await settle()
    expect(seen).toEqual([7])
  })
})

describe('the in-process adapter', () => {
  it('fires a real shot through the interface', async () => {
    const sim = directSimulator()
    const result = await sim.shot(params())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.range).toBeGreaterThan(0)
    expect(result.timeline.duration).toBeGreaterThan(result.timeline.releaseT)
  })

  it('reports the pin angle an ideal release would have used', async () => {
    const sim = directSimulator()
    expect(await sim.tunePin(params())).toBeGreaterThan(0)
  })

  it('streams a sweep and finishes it', async () => {
    const sim = directSimulator()
    const updates: SweepUpdate[] = []
    sim.sweep(params(), 'slingLength', 1, 2, 4, 'asBuilt', (u) => updates.push(u))
    await settle()

    const last = updates.at(-1)
    expect(last?.kind).toBe('points')
    if (last?.kind !== 'points') return
    expect(last.done).toBe(true)
    expect(last.points).toHaveLength(4)
  })

  it('delivers nothing once a sweep is cancelled', async () => {
    // A superseded sweep that keeps writing is how the chart ended up drawing
    // one set of parameters while the panel showed another.
    const sim = directSimulator()
    const updates: SweepUpdate[] = []
    const cancel = sim.sweep(params(), 'slingLength', 1, 2, 4, 'asBuilt', (u) => updates.push(u))
    cancel()
    await settle()
    expect(updates).toEqual([])
  })

  it('sends a refused sweep back as an error rather than a flat line', async () => {
    const sim = directSimulator()
    const updates: SweepUpdate[] = []
    sim.sweep(params(), 'releaseAngle', 20, 90, 4, 'bestCase', (u) => updates.push(u))
    await settle()
    expect(updates).toHaveLength(1)
    expect(updates[0].kind).toBe('error')
  })
})
