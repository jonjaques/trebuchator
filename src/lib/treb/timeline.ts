/**
 * Where a shot is at time t.
 *
 * The stroke and the flight are two separate integrations inside the solver but
 * one continuous clock for the reader — the scrubber runs from the cocked pose
 * to the impact without a seam. This module owns that clock, and with it the one
 * tolerance everything compares against.
 *
 * It exists because the question was previously answered at five call sites with
 * three different epsilons (`1e-6` in the drawing, `1e-9` in the playback loop,
 * none in the transport), each recomputing `release.t + flightTime` from parts.
 * The drawing and the transport could therefore disagree about whether a shot
 * had landed, on the last frame, where it is most visible.
 *
 * The two lookups at the bottom are here for the same reason. "Which frame is
 * this?" and "where is the shot?" are the same question as "what time is it?",
 * but they lived in `sheet.ts` — so the module that owned the clock had to
 * describe its own behaviour by pointing at a function in the drawing, and a
 * second reader of the clock would have had to import the drawing to get one.
 */

/** The instants that bound a shot, seconds from the beam being let go. */
export interface ShotTimeline {
  /**
   * Trough normal force passes through zero and the shot is carried by the
   * sling alone. Falls out of the constraint solve rather than a threshold, so
   * it is worth reporting rather than reverse-engineering from the frames.
   */
  liftoffT: number
  /** The sling lets go. Also the end of the mechanical stroke. */
  releaseT: number
  /** Release plus flight — the end of the scrubbable shot. */
  duration: number
}

export type ShotPhase = 'ground' | 'swing' | 'flight' | 'landed'

/**
 * Only has to absorb float noise in the cursor. `duration` is stored rather
 * than re-summed at each call site, so there is no accumulated error to cover.
 */
export const TIME_EPS = 1e-9

/**
 * Boundaries belong to the earlier phase: at exactly `releaseT` the shot is
 * still on the sling, which is what makes the release protractor legible on the
 * frame it fires.
 */
export function phaseAt(tl: ShotTimeline, t: number): ShotPhase {
  if (t >= tl.duration - TIME_EPS) return 'landed'
  if (t > tl.releaseT) return 'flight'
  if (t > tl.liftoffT) return 'swing'
  return 'ground'
}

/** True once the sling has let go, landed included. */
export function isFlying(tl: ShotTimeline, t: number): boolean {
  const phase = phaseAt(tl, t)
  return phase === 'flight' || phase === 'landed'
}

export function isDone(tl: ShotTimeline, t: number): boolean {
  return phaseAt(tl, t) === 'landed'
}

export function clampT(tl: ShotTimeline, t: number): number {
  return Math.min(Math.max(t, 0), tl.duration)
}

/**
 * The instant to look the *machine* up at. The solver integrates the machine
 * past release (with the shot's mass off the sling) so the arm's follow-through
 * animates, so this is simply the clamped cursor. Frames may still end before
 * `duration` — the follow-through is capped — and a lookup then holds the last
 * pose, which `frameIndexAt` below already does.
 */
export function strokeT(tl: ShotTimeline, t: number): number {
  return clampT(tl, t)
}

// --- lookups -----------------------------------------------------------------

/**
 * Both lookups take the bare shape they read rather than `ShotResult['frames']`
 * and `['trajectory']`, for two reasons. `types.ts` imports `ShotTimeline` from
 * this module, so naming those types here would close an import cycle; and
 * neither function looks at anything but the timestamp, so a narrower parameter
 * is the honest one — it also lets a test hand over four numbers instead of
 * casting a stub through `never`.
 */

/** Index of the last frame at or before `t`. Frames are time-ordered. */
export function frameIndexAt(frames: readonly { t: number }[], t: number): number {
  let lo = 0
  let hi = frames.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (frames[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Position along the flight path at `t`, interpolated between samples. */
export function sampleTrajectory(
  traj: readonly { t: number; x: number; y: number }[],
  t: number,
): { x: number; y: number } {
  if (t <= 0) return traj[0]
  for (let i = 1; i < traj.length; i++) {
    if (traj[i].t >= t) {
      const a = traj[i - 1]
      const b = traj[i]
      const k = (t - a.t) / Math.max(1e-9, b.t - a.t)
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
    }
  }
  return traj[traj.length - 1]
}
