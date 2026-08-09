import { describe, expect, it } from 'vitest'
import { clampT, isDone, isFlying, phaseAt, strokeT, type ShotTimeline } from './timeline.ts'

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

  it('freezes the machine at release', () => {
    // Frames stop at release, so anything looking the machine up during the
    // flight has to ask for the last pose rather than run off the end.
    expect(strokeT(tl, 0.3)).toBe(0.3)
    expect(strokeT(tl, 0.6)).toBe(0.6)
    expect(strokeT(tl, 2.5)).toBe(0.6)
  })
})
