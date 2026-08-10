import { useEffect, useRef } from 'react'
import { band, once, profile, tally, throttle, settled, track, viewport } from './analytics.ts'
import type { ShotResult, TrebuchetParams } from './treb/types.ts'
import type { UnitSystem } from './format.ts'

/**
 * React's view of the measurement sink.
 *
 * `analytics.ts` has no React in it, the same way `treb/` has none — so this is
 * the module that watches app state and turns changes in it into events, and it
 * sits beside `useSimulation.ts` for the same reason that one exists.
 *
 * Everything discrete is tracked at its own handler, where the *intent* is
 * known: a button press knows it was a button press, and an effect watching the
 * state it changed can only ever guess. What is left for this file is the two
 * things no handler can see — the shape of a whole visit, and the value a
 * parameter settled on after a drag that fired sixty times on the way there.
 */

/** How long a drag has to stop for before its final value is the one reported. */
const SETTLE_MS = 900
/** A tab switch every few seconds should not be a summary every few seconds. */
const SUMMARY_MS = 60_000
/**
 * More changed keys than this at once is a machine being *loaded*, not edited —
 * a preset, a saved build, a frontier candidate. Those have their own event
 * carrying what was loaded, and reporting them as thirty simultaneous edits
 * would drown the parameter anyone actually dragged.
 */
const LOAD_THRESHOLD = 4

interface Input {
  result: ShotResult | null
  /** The solver itself stopped. Not the same fact as a machine that won't throw. */
  error: string | null
  params: TrebuchetParams
  presetId: string | null
  units: UnitSystem
  dark: boolean
  notes: boolean
}

export function useAnalytics({ result, error, params, presetId, units, dark, notes }: Input): void {
  // The visit summary fires from a listener that outlives every render, so what
  // it reports has to be readable from somewhere that is current at the moment
  // the tab goes away rather than closed over at mount.
  const live = useRef({ presetId, params, units, dark, notes })
  useEffect(() => {
    live.current = { presetId, params, units, dark, notes }
  })

  // Stamped in the boot effect below rather than at the initialiser: `Date.now`
  // during render is impure, the React Compiler's lint rules are enforced here,
  // and a value that changes on a re-render is exactly what those rules exist to
  // stop. Effects run before any visibility change can, so it is never read as 0.
  const started = useRef(0)
  const bestRange = useRef(0)
  const edits = useRef(0)

  // --- the session's own shape ---------------------------------------------
  useEffect(() => {
    profile({
      units,
      theme: dark ? 'dark' : 'light',
      viewport: viewport(),
      notes,
    })
    // Deliberately re-set rather than set once: someone who switches to imperial
    // in their first minute should be counted as an imperial reader for the rest
    // of the visit, and a user property is last-write-wins by design.
  }, [units, dark, notes])

  // Mount only, and everything it reports is read through the ref rather than
  // closed over: this is the boot fact, and re-firing it whenever the theme
  // changed would make "sessions" and "app_ready" stop agreeing.
  useEffect(() => {
    started.current = Date.now()
    const at = live.current
    // `once` and not `track`: StrictMode mounts, unmounts and remounts in
    // development, and a boot fact that arrives twice makes every ratio computed
    // against it wrong by a factor of two in exactly the environment where it is
    // being read to check the wiring.
    once('boot', 'app_ready', {
      preset: at.presetId ?? 'custom',
      machine_type: at.params.type,
      units: at.units,
      theme: at.dark ? 'dark' : 'light',
      notes: at.notes,
      // `presetId` is seeded from the URL at boot, so a link is the only way the
      // first machine is anything but the first preset — which makes this the
      // one honest measure of whether sharing is used at all.
      from_link: new URL(window.location.href).searchParams.has('m'),
      viewport: viewport(),
      reduced_motion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    })
  }, [])

  // --- the visit summary ----------------------------------------------------
  useEffect(() => {
    // `visibilitychange` and not `beforeunload`: the latter is not fired at all
    // when a phone browser is backgrounded and then killed, which is how most
    // sessions on this app actually end.
    const send = () => {
      if (document.visibilityState !== 'hidden') return
      const counts = tally()
      throttle('summary', SUMMARY_MS, 'visit_summary', {
        seconds: Math.round((Date.now() - started.current) / 1000),
        shots: counts.shot_solved ?? 0,
        edits: edits.current,
        sweeps: counts.sweep_run ?? 0,
        searches: counts.frontier_searched ?? 0,
        machines: counts.machine_loaded ?? 0,
        best_range: bestRange.current,
        preset: live.current.presetId ?? 'custom',
        machine_type: live.current.params.type,
      })
    }
    document.addEventListener('visibilitychange', send)
    return () => document.removeEventListener('visibilitychange', send)
  }, [])

  // --- what the machine did -------------------------------------------------
  useEffect(() => {
    if (error) track('solver_failed', { where: 'shot', reason: error })
  }, [error])

  useEffect(() => {
    if (!result) return
    if (!result.ok) {
      // Coalesced like the successful case: dragging a slider through a band of
      // impossible geometry is one fact about the machine, not forty.
      settled('rejected', SETTLE_MS, 'machine_rejected', () => ({
        machine_type: live.current.params.type,
        reason: result.errors[0] ?? 'unknown',
      }))
      return
    }
    if (result.range > bestRange.current) bestRange.current = result.range
    settled('shot', SETTLE_MS, 'shot_solved', () => ({
      machine_type: params.type,
      preset: presetId ?? 'custom',
      range_m: result.range,
      range_band: band(result.range),
      efficiency_pct: result.efficiency * 100,
      release_speed: result.release.speed,
      // Newtons are what the solver holds and kilonewtons are what anybody says
      // out loud; a report in newtons is four digits of noise on every row.
      axle_load_kn: result.peaks.axleLoad / 1000,
      flight_s: result.flightTime,
    }))
    for (const warning of result.warnings) {
      // Keyed on the text so two different warnings in one settle both survive;
      // the same one repeated through a drag collapses to one row.
      settled(`warn:${warning}`, SETTLE_MS, 'shot_warning', () => ({ warning }))
    }
  }, [result, params.type, presetId])

  // --- which numbers get changed, and what they settle on -------------------
  const previous = useRef(params)
  const pending = useRef<Record<string, number>>({})
  useEffect(() => {
    const before = previous.current
    previous.current = params
    if (params === before) return

    const changed = (Object.keys(params) as (keyof TrebuchetParams)[]).filter(
      // `type` is a different act with a different event — the reader chose a
      // topology, they did not nudge a number.
      (key) => key !== 'type' && params[key] !== before[key],
    )
    if (changed.length === 0 || changed.length > LOAD_THRESHOLD) return

    for (const key of changed) {
      edits.current += 1
      pending.current[key] = (pending.current[key] ?? 0) + 1
      settled(`param:${key}`, SETTLE_MS, 'param_changed', () => {
        const value = previous.current[key]
        const count = pending.current[key] ?? 1
        delete pending.current[key]
        return {
          param: key,
          // A dimension is a number worth averaging; a mode or a switch is a
          // word worth counting. Each row carries whichever it has.
          value:
            typeof value === 'number' ? value : typeof value === 'boolean' ? +value : undefined,
          value_text: typeof value === 'number' ? undefined : String(value),
          machine_type: previous.current.type,
          edits: count,
        }
      })
    }
  }, [params])
}
