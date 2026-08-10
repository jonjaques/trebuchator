/**
 * Usage measurement.
 *
 * One sink, one typed table of events, and nothing above this module knows that
 * Google Analytics is what is on the other end. That is the same seam
 * `simulator.ts` draws around the worker and it is drawn for the same reason:
 * the call sites are spread through every component in the app, so a vendor
 * that leaks past them is a vendor nobody can ever change.
 *
 * **The table is the interface.** An event is one entry in `Events` and its
 * parameters are that entry's type, so a `track()` call naming an event that
 * does not exist — or passing a parameter that does not belong to it — is a
 * build failure. Untyped analytics fails the other way round: the call compiles,
 * the row never appears in a report, and nobody notices for a month because the
 * only symptom is a chart that stays empty.
 *
 * **Nothing here sends anything a person wrote.** Machine names, material names
 * and free text of any kind are the builder's own words. What goes out is their
 * *shape* — how long a name was, which kind of material it described, whether a
 * shared link was followed — and never the text itself. The one string that does
 * travel is a preset id, which is a value from a list in this repository.
 *
 * **Volume is the whole design problem.** A slider drag is sixty parameter
 * changes a second and a solved shot chases every one of them. Sending those is
 * both useless — the interesting value is the one the reader stopped on — and a
 * good way to spend someone's data plan, so the high-frequency events go through
 * `settled` (trailing-edge coalescing, keyed) and the once-per-session facts go
 * through `once`. Only genuinely discrete acts call `track` directly.
 *
 * GA4's own limits shape the rest: event and parameter names are capped at 40
 * characters, a parameter value at 100, and an event carries at most 25 of them.
 * `clean()` enforces the value cap rather than trusting thirty call sites to;
 * the names are short by construction and checked in development.
 *
 * A custom parameter is only collected here — it does not appear in a GA report
 * until it is registered as a custom dimension or metric in the property, and
 * registration is not retroactive. `docs/analytics.md` lists which ones to
 * register and why, and is the file to update when an event is added.
 */

import type { MachineType } from './treb/types.ts'
import type { UnitSystem } from './format.ts'
import type { ParetoGoal, SweepMode, TunableKey } from './treb/optimize.ts'

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
    /**
     * Set by the guarded snippet in `index.html`, and only when the tag was
     * actually loaded. The rule for *whether* to measure lives there, next to
     * the script it gates, so it cannot be stated twice and drift.
     */
    __trebAnalytics?: boolean
  }
}

/** What a parameter may carry. `undefined` is dropped rather than sent. */
type Value = string | number | boolean | undefined

/**
 * Every event this app can send, and what each one carries.
 *
 * Parameter *names* are reused across events on purpose. A property has 50
 * custom dimension slots for its whole lifetime, so `machine_type` meaning the
 * same thing on eleven events costs one of them, and `type_of_machine` on the
 * twelfth costs another for nothing.
 */
interface Events {
  // --- lifecycle -----------------------------------------------------------
  /** Once, on boot, with the shape of the session everything else sits in. */
  app_ready: {
    preset: string
    machine_type: MachineType
    units: UnitSystem
    theme: string
    notes: boolean
    /** Arrived on a `?m=` link — the only measure of whether sharing works. */
    from_link: boolean
    viewport: string
    reduced_motion: boolean
  }
  /** Once, when the tab goes away. The engagement picture, in one row. */
  visit_summary: {
    seconds: number
    shots: number
    edits: number
    sweeps: number
    searches: number
    machines: number
    best_range: number
    preset: string
    machine_type: MachineType
  }
  /** The solver itself threw. Distinct from a machine that will not throw. */
  solver_failed: { where: string; reason: string }

  // --- the machine ---------------------------------------------------------
  machine_loaded: { machine: string; era: string; source: string }
  machine_type_set: { machine_type: MachineType; from: MachineType }
  /**
   * One settled parameter edit. Coalesced — see `settled`.
   *
   * Both forms of the value go out because the rail sets two kinds of thing: a
   * dimension, which is a number worth averaging, and a mode or a switch, which
   * is a word worth counting. Each row carries whichever one it has.
   */
  param_changed: {
    param: string
    value?: number
    value_text?: string
    machine_type: MachineType
    edits: number
  }
  /** Which control the reader reaches for. Throttled per field and control. */
  param_input: { field: string; control: string }
  machine_saved: { name_len: number; count: number }
  machine_deleted: { count: number }
  link_copied: { machine: string; ok: boolean }

  // --- what came out of it -------------------------------------------------
  /** The outcome distribution. Coalesced, so it is one row per settled machine. */
  shot_solved: {
    machine_type: MachineType
    preset: string
    range_m: number
    range_band: string
    efficiency_pct: number
    release_speed: number
    axle_load_kn: number
    flight_s: number
  }
  machine_rejected: { machine_type: MachineType; reason: string }
  shot_warning: { warning: string }
  /**
   * Six feet of granite, thrown. Once per visit — the question about an easter
   * egg is how many readers ever reach it, not how many times they re-solve it.
   *
   * `reduced_motion` rides along because it is the difference between seeing the
   * whole thing and seeing a crater: the fireball and the camera chase are both
   * skipped for a reader who has asked for less motion.
   */
  boulder_thrown: { range_m: number; reduced_motion: boolean }

  // --- tools ---------------------------------------------------------------
  pin_tuned: { angle: number; machine_type: MachineType }
  frontier_searched: { goal: ParetoGoal; count: number; seconds: number }
  /** First hover of a frontier per opening — interest, without the mousemoves. */
  frontier_previewed: { goal: ParetoGoal }
  frontier_applied: { goal: ParetoGoal; gain_pct: number; axle_load_kn: number }
  sweep_run: { param: TunableKey; mode: SweepMode; count: number; seconds: number }
  sweep_key_set: { param: TunableKey }
  sweep_mode_set: { mode: SweepMode }
  sweep_previewed: { param: TunableKey; mode: SweepMode }
  sweep_adopted: { param: TunableKey; mode: SweepMode; via: string; gain_pct: number }
  /** A parameter and a mode with no honest reading. Which pairs get asked for. */
  sweep_blocked: { param: TunableKey; mode: SweepMode }

  // --- looking at it -------------------------------------------------------
  playback: { action: string; via: string }
  speed_set: { speed: number; via: string }
  camera_set: { mode: string; via: string }
  annotation_set: { annotation: string; on: boolean; via: string }
  /** Throttled to one per gesture — a pan is a hundred pointermoves. */
  sheet_gesture: { gesture: string }
  panel_toggled: { panel: string; on: boolean }
  sweep_panel_set: { on: boolean }
  section_toggled: { section: string; on: boolean }
  /** The teaching layer. Which explanations are actually opened. */
  explain_opened: { topic: string }

  // --- the builder's library -----------------------------------------------
  material_picked: { kind: string; custom: boolean }
  material_added: { kind: string }
  material_deleted: { kind: string }
  ghost_saved: { count: number }
  ghost_recalled: Record<string, never>
  ghost_dropped: Record<string, never>

  // --- settings ------------------------------------------------------------
  units_set: { units: UnitSystem }
  theme_set: { theme: string }
}

export type EventName = keyof Events

/**
 * Whether anything is actually sent.
 *
 * Read from the flag the snippet sets rather than re-deriving the rule: a dev
 * server and a `vite preview` both answer on localhost, and their traffic
 * landing in the production property would be indistinguishable from a real
 * reader's after the fact. In development the events are logged instead, which
 * is the only way to see that a new one fires at all before it ships.
 */
const ON = typeof window !== 'undefined' && window.__trebAnalytics === true
/** Vitest runs with `MODE === 'test'`; a suite does not need the commentary. */
const LOG = import.meta.env.DEV && import.meta.env.MODE !== 'test'

/** GA4 caps a parameter value at 100 characters and silently truncates past it. */
const MAX_VALUE = 100

/**
 * Drop the absent, round the numeric, clip the long.
 *
 * Rounding is not cosmetic: an unrounded `range_m` is a float with seventeen
 * digits, and GA4 stores it as a string in some paths. Four decimals is far
 * finer than anything measured here.
 */
function clean(params: Record<string, Value>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue
    if (typeof value === 'number') {
      // A NaN range is a real outcome of a broken machine, but it is not a
      // number GA can hold — it arrives as null and poisons every average
      // computed over the column.
      if (!Number.isFinite(value)) continue
      out[key] = Math.round(value * 1e4) / 1e4
    } else if (typeof value === 'string') {
      out[key] = value.length > MAX_VALUE ? value.slice(0, MAX_VALUE - 1) + '…' : value
    } else {
      out[key] = value
    }
  }
  return out
}

/** How many of each event this visit has sent. Read by the visit summary. */
const counts: Record<string, number> = {}

export function tally(): Readonly<Record<string, number>> {
  return counts
}

/**
 * Send one event.
 *
 * Never throws. An ad blocker removes `gtag` entirely and a tracking-protection
 * mode replaces it with something that throws on call; neither is a reason for
 * the sheet to stop drawing, and a `try` here is cheaper than remembering that
 * at thirty call sites.
 */
export function track<K extends EventName>(name: K, params: Events[K]): void {
  counts[name] = (counts[name] ?? 0) + 1
  const payload = clean(params as Record<string, Value>)
  if (LOG) console.debug('[analytics]', name, payload)
  if (!ON) return
  try {
    window.gtag?.('event', name, payload)
  } catch {
    // Measurement is never worth an exception in a handler that was in the
    // middle of doing something the reader asked for.
  }
}

/** Sent at most once per visit, keyed. For facts, not for actions. */
const seen = new Set<string>()
export function once<K extends EventName>(key: string, name: K, params: Events[K]): void {
  if (seen.has(key)) return
  seen.add(key)
  track(name, params)
}

/**
 * Leading-edge throttle: send now, then ignore the same key for `ms`.
 *
 * For gestures, where the first event of a burst is the one that says what
 * happened and the next two hundred say it again.
 */
const throttled = new Map<string, number>()
export function throttle<K extends EventName>(
  key: string,
  ms: number,
  name: K,
  params: Events[K],
): void {
  const now = Date.now()
  const last = throttled.get(key) ?? 0
  if (now - last < ms) return
  throttled.set(key, now)
  track(name, params)
}

/**
 * Trailing-edge coalesce: send `ms` after the last call on this key.
 *
 * The parameters are a thunk rather than a value because the point is to send
 * the state the reader *settled* on. Taking the value eagerly would capture the
 * first frame of a slider drag and report a number nobody ever looked at.
 */
const settling = new Map<string, number>()
export function settled<K extends EventName>(
  key: string,
  ms: number,
  name: K,
  make: () => Events[K] | null,
): void {
  clearTimeout(settling.get(key))
  settling.set(
    key,
    window.setTimeout(() => {
      settling.delete(key)
      const params = make()
      if (params) track(name, params)
    }, ms),
  )
}

/**
 * Facts about the reader that qualify every event, rather than one of them.
 *
 * User properties are how "do imperial readers get shorter sessions" is
 * answerable at all: as an event parameter, units would only qualify the events
 * that happened to carry it.
 */
export function profile(props: Record<string, Value>): void {
  const payload = clean(props)
  if (LOG) console.debug('[analytics] user_properties', payload)
  if (!ON) return
  try {
    window.gtag?.('set', 'user_properties', payload)
  } catch {
    // As above.
  }
}

// --- shaping helpers --------------------------------------------------------

/**
 * A range in bands rather than as a bare metre figure.
 *
 * Both go out. The number answers "how far do machines throw"; the band is what
 * makes a GA report legible without BigQuery, because the interface will happily
 * offer a breakdown by a metric with four thousand distinct values and it is
 * unreadable every time.
 */
export function band(metres: number): string {
  if (!Number.isFinite(metres)) return 'none'
  const edges = [5, 10, 25, 50, 100, 200, 400, 800]
  for (let i = 0; i < edges.length; i++) {
    if (metres < edges[i]) return i === 0 ? `<${edges[0]}m` : `${edges[i - 1]}–${edges[i]}m`
  }
  return `${edges[edges.length - 1]}m+`
}

/**
 * Which layout the reader is actually in.
 *
 * The app's own breakpoints, not a device guess: at `xl` both rails are docked
 * and every control is on screen at once, below it they are drawers over the
 * sheet, and below `sm` the transport is two rows. Those are three different
 * products and their numbers should not be pooled.
 */
export function viewport(): string {
  if (typeof window === 'undefined') return 'unknown'
  const w = window.innerWidth
  if (w < 640) return 'phone'
  if (w < 1024) return 'tablet'
  if (w < 1280) return 'desktop'
  return 'wide'
}
