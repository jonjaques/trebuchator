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
 * pose, which `frameIndexAt` already does.
 */
export function strokeT(tl: ShotTimeline, t: number): number {
  return clampT(tl, t)
}
