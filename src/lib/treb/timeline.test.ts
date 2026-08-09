import { describe, expect, it } from 'vitest'
import {
  clampT,
  frameIndexAt,
  isDone,
  isFlying,
  phaseAt,
  sampleTrajectory,
  strokeT,
  type ShotTimeline,
} from './timeline.ts'

const tl: ShotTimeline = { liftoffT: 0.2, releaseT: 0.6, duration: 2.6 }

describe('shot phases', () => {
  it('names each stage of the shot', () => {
    expect(phaseAt(tl, 0)).toBe('ground')
    expect(phaseAt(tl, 0.1)).toBe('ground')
    expect(phaseAt(tl, 0.4)).toBe('swing')
    expect(phaseAt(tl, 1.5)).toBe('flight')
    expect(phaseAt(tl, 2.6)).toBe('landed')
  })

  it('keeps the shot on the trough right up to liftoff', () => {
    expect(phaseAt(tl, 0.199)).toBe('ground')
    expect(phaseAt(tl, 0.2)).toBe('ground')
    expect(phaseAt(tl, 0.201)).toBe('swing')
  })

  it('keeps the shot on the sling right up to release', () => {
    // The boundary belongs to the earlier phase, which is what keeps the
    // release protractor drawn on the frame the pin actually fires.
    expect(phaseAt(tl, 0.6)).toBe('swing')
    expect(phaseAt(tl, 0.601)).toBe('flight')
  })

  it('lands exactly on the reported duration', () => {
    expect(phaseAt(tl, 2.599)).toBe('flight')
    expect(phaseAt(tl, 2.6)).toBe('landed')
    expect(isDone(tl, 2.6)).toBe(true)
    expect(isDone(tl, 2.59)).toBe(false)
  })

  it('absorbs float noise in the cursor at the very end', () => {
    // A playback loop accumulating dt lands a hair under duration; the shot has
    // still landed, and the drawing must not flicker back into flight.
    expect(isDone(tl, 2.6 - 1e-12)).toBe(true)
  })

  it('counts a landed shot as flying — the sling has let go either way', () => {
    expect(isFlying(tl, 0.5)).toBe(false)
    expect(isFlying(tl, 0.6)).toBe(false)
    expect(isFlying(tl, 1)).toBe(true)
    expect(isFlying(tl, 2.6)).toBe(true)
  })
})

describe('cursor arithmetic', () => {
  it('clamps a cursor to the shot', () => {
    expect(clampT(tl, -1)).toBe(0)
    expect(clampT(tl, 1)).toBe(1)
    expect(clampT(tl, 99)).toBe(2.6)
  })

  it('follows the machine through the whole shot', () => {
    // The machine keeps swinging after release — its follow-through is
    // integrated and drawn — so the machine clock is the clamped cursor, not
    // one frozen at release.
    expect(strokeT(tl, 0.3)).toBe(0.3)
    expect(strokeT(tl, 0.6)).toBe(0.6)
    expect(strokeT(tl, 2.5)).toBe(2.5)
    expect(strokeT(tl, 99)).toBe(2.6)
  })
})

describe('reading a shot at a time', () => {
  const frames = [0, 0.1, 0.2, 0.3, 0.4].map((t) => ({ t }))

  it('finds the last frame at or before the cursor', () => {
    expect(frameIndexAt(frames, -1)).toBe(0)
    expect(frameIndexAt(frames, 0.2)).toBe(2)
    expect(frameIndexAt(frames, 0.25)).toBe(2)
    expect(frameIndexAt(frames, 99)).toBe(4)
  })

  const traj = [
    { t: 0, x: 0, y: 10, vx: 1, vy: 0 },
    { t: 1, x: 10, y: 20, vx: 1, vy: 0 },
    { t: 2, x: 30, y: 0, vx: 1, vy: 0 },
  ]

  it('interpolates between flight samples', () => {
    expect(sampleTrajectory(traj, 0.5)).toEqual({ x: 5, y: 15 })
    expect(sampleTrajectory(traj, 1.25)).toEqual({ x: 15, y: 15 })
  })

  it('holds at both ends rather than running off them', () => {
    expect(sampleTrajectory(traj, -5)).toBe(traj[0])
    expect(sampleTrajectory(traj, 0)).toBe(traj[0])
    expect(sampleTrajectory(traj, 99)).toBe(traj[2])
  })

  it('survives two samples sharing a timestamp', () => {
    const flat = [
      { t: 0, x: 0, y: 0, vx: 0, vy: 0 },
      { t: 0, x: 4, y: 4, vx: 0, vy: 0 },
    ]
    const at = sampleTrajectory(flat, 0.5)
    expect(Number.isFinite(at.x)).toBe(true)
    expect(Number.isFinite(at.y)).toBe(true)
  })
})
