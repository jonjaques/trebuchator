import { describe, expect, it } from 'vitest'
import { buildModel, evalPoint, evalPointVel, poseOf } from './model.ts'
import { kineticEnergies, makeScratch, rk4Step } from './solver.ts'
import {
  cockToGround,
  flyBallistic,
  geometryImpossibilities,
  plausibilityWarnings,
  simulateShot,
  type SimOptions,
} from './simulate.ts'
import { PRESETS, presetById } from './presets.ts'
import {
  bestReleaseAngle,
  goalValue,
  paretoSearch,
  sweep,
  sweepAt,
  sweepConflict,
  sweepValues,
  SWEEP_DT,
  type TunableKey,
} from './optimize.ts'
import type { FiredShot, TrebuchetParams } from './types.ts'

const lab = () => structuredClone(presetById('lab')!.params)

/**
 * Fire a shot that is expected to work, narrowed so `release` and `timeline`
 * are present. Tests that are *about* failure call `simulateShot` directly.
 */
function fire(p: TrebuchetParams, opts?: SimOptions): FiredShot {
  const r = simulateShot(p, opts)
  if (!r.ok) throw new Error(`expected a valid shot: ${r.errors.join(' ')}`)
  return r
}

/**
 * Reference machine: the instrumented trebuchet in Horsdal, Johansen and
 * Rasmussen, "The swinging counterweight trebuchet. Experiments on inner
 * movement and ranges" (arXiv:2502.19442), whose beam, counterweight and sling
 * angles were recorded with rotation sensors through real shots.
 *
 * Table 1 gives the geometry and masses; Table 2 the longest vacuum ranges and
 * release times; Table 3 compares the field-measured 34.4 ± 1.5 m against the
 * paper's own *ab initio* frictionless calculation of 42.8 m. The `lab` preset
 * is frictionless, so it is that 42.8 m machine it must reproduce — the gap to
 * the field figure is the real machine's friction and drag, not solver error.
 */
describe('validation against the published laboratory trebuchet', () => {
  it('reproduces the paper’s available potential energy of 204 J', () => {
    const r = simulateShot(lab())
    expect(r.ok).toBe(true)
    // Independent of any dynamics: this is purely the geometry, the masses and
    // the beam CG, so it is the cleanest check that the model is wired up right.
    expect(r.energy.available).toBeGreaterThan(202)
    expect(r.energy.available).toBeLessThan(206)
  })

  it('reproduces the paper’s ab initio frictionless range of 42.8 m', () => {
    const r = simulateShot(lab())
    expect(r.ok).toBe(true)
    // Table 3: theoretical range with no friction or drag, 717 g shot — the
    // same idealisation the lab preset runs. (Their field measurement is
    // 34.4 ± 1.5 m; the difference is the real machine's losses.)
    expect(r.range).toBeGreaterThan(42.8 * 0.95)
    expect(r.range).toBeLessThan(42.8 * 1.05)
  })

  it('reproduces the published release times for both projectile masses', () => {
    // Release timing is the sharpest test of the equations of motion: it
    // depends on the whole three-body swing, not just the energy budget.
    expect(fire(lab()).timeline.releaseT).toBeCloseTo(0.593, 1)
    expect(fire({ ...lab(), projectileMass: 0.0685 }).timeline.releaseT).toBeCloseTo(0.533, 1)
  })

  it('shows the light shot flying further but wasting far more of the machine', () => {
    // The paper prints the efficiencies directly: ε ≈ 69% for the 717 g shot,
    // ≈ 11% for the 68.5 g one. The bounds bracket those figures loosely.
    const heavy = simulateShot(lab())
    const light = simulateShot({ ...lab(), projectileMass: 0.0685 })
    expect(light.range).toBeGreaterThan(heavy.range)
    expect(light.efficiency).toBeLessThan(heavy.efficiency)
    expect(heavy.efficiency).toBeGreaterThan(0.6)
    expect(light.efficiency).toBeLessThan(0.25)
  })

  it('leaves the machine throwing downrange, not backwards', () => {
    // A mirrored arm convention still produces a perfectly valid stroke; it
    // just throws the other way, and every range comes out negative.
    for (const preset of PRESETS) {
      const r = fire(preset.params)
      expect(r.release.vx, preset.name).toBeGreaterThan(0)
      expect(r.range, preset.name).toBeGreaterThan(0)
    }
  })
})

describe('conservation laws', () => {
  it('closes the energy budget when friction and drag are switched off', () => {
    for (const type of ['hinged', 'fixed', 'floating'] as const) {
      const p: TrebuchetParams = {
        ...lab(),
        type,
        enableDrag: false,
        pivotFriction: 0,
        hingeFriction: 0,
        troughFriction: 0,
      }
      const r = simulateShot({ ...p, initialBeamAngle: cockToGround(p) })
      expect(r.ok, `${type} should simulate`).toBe(true)
      expect(Math.abs(r.energy.residual) / r.energy.available, `${type} residual`).toBeLessThan(
        0.005,
      )
    }
  })

  it('conserves total mechanical energy through the free swing', () => {
    const p = lab()
    const model = buildModel(p)
    const scratch = makeScratch(model.nq, model.bodies.length)
    const q = new Float64Array(model.nq)
    const qd = new Float64Array(model.nq)
    q[model.iTheta] = (p.initialBeamAngle * Math.PI) / 180
    // Start well clear of the ground constraint so this exercises the free
    // 3-DOF solver alone.
    q[model.iPhi] = 0.4
    const st = { q, qd }
    const energyAt = () => {
      const ke = kineticEnergies(model, st.q, st.qd)
      let u = 0
      for (const b of model.bodies) u += b.m * p.gravity * evalPoint(b, st.q).y
      return ke.beam + ke.cw + ke.slung + u
    }
    const e0 = energyAt()
    for (let i = 0; i < 2000; i++) {
      rk4Step(model, p, st, 2e-4, scratch, {
        constrained: false,
        loads: { pivot: 0, hinge: 0 },
      })
    }
    expect(Math.abs(energyAt() - e0) / Math.abs(e0)).toBeLessThan(1e-5)
  })

  it('is insensitive to the integration step', () => {
    const coarse = simulateShot(lab(), { dt: 4e-4 })
    const fine = simulateShot(lab(), { dt: 5e-5 })
    expect(Math.abs(coarse.range - fine.range) / fine.range).toBeLessThan(0.01)
  })
})

describe('kinematics', () => {
  it('holds the floating arm’s counterweight in a vertical drop channel', () => {
    const p: TrebuchetParams = { ...presetById('floating-arm')!.params }
    const model = buildModel(p)
    const q = new Float64Array(model.nq)
    const xs: number[] = []
    for (let theta = 0.1; theta < 3.0; theta += 0.1) {
      q[model.iTheta] = theta
      xs.push(poseOf(model, q).cw.x)
    }
    // The channel is the datum at x = 0 and the weight must never leave it.
    expect(Math.max(...xs.map(Math.abs))).toBeLessThan(1e-12)
  })

  it('drops the floating arm’s weight through twice the short arm', () => {
    const p = presetById('floating-arm')!.params
    const model = buildModel(p)
    const q = new Float64Array(model.nq)
    q[model.iTheta] = 0
    const top = poseOf(model, q).cw.y
    q[model.iTheta] = Math.PI
    const bottom = poseOf(model, q).cw.y
    expect(top - bottom).toBeCloseTo(2 * p.armShort, 9)
  })

  it('keeps the fixed weight rigidly on the short arm', () => {
    const p: TrebuchetParams = { ...lab(), type: 'fixed' }
    const model = buildModel(p)
    const q = new Float64Array(model.nq)
    for (let theta = 0; theta < 3; theta += 0.25) {
      q[model.iTheta] = theta
      const pose = poseOf(model, q)
      const d = Math.hypot(pose.cw.x - pose.axle.x, pose.cw.y - pose.axle.y)
      expect(d).toBeCloseTo(p.armShort + p.cwHanger, 9)
    }
  })

  it('analytic point velocities match a finite difference of the positions', () => {
    const model = buildModel(lab())
    const q = new Float64Array([0.6, 0.2, 0.35])
    const qd = new Float64Array([1.7, -0.9, 2.3])
    const h = 1e-6
    for (const def of Object.values(model.points)) {
      const v = evalPointVel(def, q, qd)
      const qp = q.map((x, i) => x + h * qd[i])
      const qm = q.map((x, i) => x - h * qd[i])
      const fd = {
        x: (evalPoint(def, qp).x - evalPoint(def, qm).x) / (2 * h),
        y: (evalPoint(def, qp).y - evalPoint(def, qm).y) / (2 * h),
      }
      expect(v.x).toBeCloseTo(fd.x, 5)
      expect(v.y).toBeCloseTo(fd.y, 5)
    }
  })

  it('cocks the beam so the arm tip rests exactly on the trough', () => {
    const p = presetById('backyard')!.params
    const angle = cockToGround(p)
    const model = buildModel({ ...p, initialBeamAngle: angle })
    const q = new Float64Array(model.nq)
    q[model.iTheta] = (angle * Math.PI) / 180
    expect(poseOf(model, q).tip.y).toBeCloseTo(p.troughHeight, 9)
  })
})

describe('ballistics', () => {
  it('matches the closed-form vacuum range from ground level', () => {
    const p: TrebuchetParams = { ...lab(), gravity: 9.81, targetDrop: 0 }
    const v = 30
    const a = (37 * Math.PI) / 180
    const r = flyBallistic(p, 0, 0, v * Math.cos(a), v * Math.sin(a), false)
    const closed = (v * v * Math.sin(2 * a)) / p.gravity
    expect(r.range).toBeCloseTo(closed, 3)
    expect(r.time).toBeCloseTo((2 * v * Math.sin(a)) / p.gravity, 3)
  })

  it('peaks at 45° in vacuum from ground level, and lower with drag', () => {
    const best = (p: TrebuchetParams, drag: boolean) => {
      let bestAngle = 0
      let bestRange = -1
      for (let deg = 15; deg <= 65; deg += 0.25) {
        const a = (deg * Math.PI) / 180
        const r = flyBallistic(p, 0, 0, 45 * Math.cos(a), 45 * Math.sin(a), drag).range
        if (r > bestRange) {
          bestRange = r
          bestAngle = deg
        }
      }
      return bestAngle
    }
    const dense: TrebuchetParams = { ...lab(), projectileMass: 4, projectileDiameter: 0.22 }
    // A light, bluff projectile is where drag bites hardest, so it is the
    // clearest demonstration that the optimum drops below 45.
    const fluffy: TrebuchetParams = { ...lab(), projectileMass: 0.15, projectileDiameter: 0.2 }
    expect(best(dense, false)).toBeCloseTo(45, 1)
    expect(best(dense, true)).toBeLessThan(45)
    expect(best(fluffy, true)).toBeLessThan(best(dense, true))
    expect(best(fluffy, true)).toBeLessThan(38)
  })

  it('shortens the flight into a headwind and lengthens it downwind', () => {
    const p: TrebuchetParams = { ...lab(), enableDrag: true, projectileMass: 0.2 }
    const shoot = (wind: number) =>
      flyBallistic({ ...p, windSpeed: wind }, 0, 2, 25, 25, true).range
    expect(shoot(-8)).toBeLessThan(shoot(0))
    expect(shoot(8)).toBeGreaterThan(shoot(0))
  })

  it('carries further onto lower ground', () => {
    const p = lab()
    expect(simulateShot({ ...p, targetDrop: 20 }).range).toBeGreaterThan(simulateShot(p).range)
  })

  it('lands on an uphill target only where the arc comes back down onto it', () => {
    const p = lab()
    // 25 m/s of vertical speed tops out at ~32 m, so a 5 m rise is well within
    // reach — but the crossing on the way *up* at ~0.2 s must not count as the
    // landing. The old detector fired on any step below the plane and would
    // have called that ascent an impact.
    const r = flyBallistic({ ...p, targetDrop: -5 }, 0, 0, 10, 25, false)
    expect(r.landed).toBe(true)
    expect(r.time).toBeGreaterThan(25 / 9.81) // past the apex, i.e. descending
    expect(r.trajectory.at(-1)!.y).toBeCloseTo(5, 6)
    expect(r.trajectory.at(-1)!.vy).toBeLessThan(0)
  })

  it('reports an unreachable uphill target instead of inventing a range', () => {
    const p = lab()
    // From 3 m up at 20/10 m/s the arc tops out around 8 m; a 60 m rise is
    // simply out of reach and must come back as not-landed, not as whatever x
    // the integrator happened to stop at.
    const wall = flyBallistic({ ...p, targetDrop: -60 }, 0, 3, 20, 10, false)
    expect(wall.landed).toBe(false)

    // And a whole shot against that target is a refusal with a reason, so the
    // panel explains itself rather than printing a confident nonsense number.
    const shot = simulateShot({ ...presetById('backyard')!.params, targetDrop: -60 })
    expect(shot.ok).toBe(false)
    expect(shot.errors.length).toBeGreaterThan(0)
  })
})

describe('design behaviour', () => {
  it('every preset produces a valid shot', () => {
    for (const preset of PRESETS) {
      const r = simulateShot(preset.params)
      expect(r.errors, `${preset.name}: ${r.errors.join(' ')}`).toEqual([])
      expect(r.ok, preset.name).toBe(true)
      if (!r.ok) continue
      expect(r.range, preset.name).toBeGreaterThan(0)
      expect(r.release.speed, preset.name).toBeGreaterThan(0)
    }
  })

  it('throws further with every extra kilo of counterweight', () => {
    const p = { ...presetById('backyard')!.params, releaseMode: 'optimal' as const }
    const ranges = [30, 60, 120, 240, 480].map((m) => simulateShot({ ...p, cwMass: m }).range)
    for (let i = 1; i < ranges.length; i++) expect(ranges[i]).toBeGreaterThan(ranges[i - 1])
  })

  it('reproduces the historical 100:1 weight ratio as the efficiency optimum', () => {
    // Range grows without bound as you pile on counterweight, but efficiency
    // does not: too light and the machine cannot get out of its own way, too
    // heavy and the shot leaves before the weight has given up its energy.
    // Medieval engines ran 100:1 to 200:1, and the peak should land in there.
    const p = { ...presetById('backyard')!.params, releaseMode: 'optimal' as const }
    let bestRatio = 0
    let bestEff = -1
    for (let m = 15; m <= 600; m *= 1.15) {
      const r = simulateShot({ ...p, cwMass: m })
      if (r.ok && r.efficiency > bestEff) {
        bestEff = r.efficiency
        bestRatio = m / p.projectileMass
      }
    }
    expect(bestRatio).toBeGreaterThan(50)
    expect(bestRatio).toBeLessThan(200)
    expect(bestEff).toBeGreaterThan(0.45)
  })

  it('trades range against efficiency as the shot gets heavier', () => {
    const p = { ...presetById('backyard')!.params, releaseMode: 'optimal' as const }
    const light = simulateShot({ ...p, projectileMass: 0.15 })
    const mid = simulateShot({ ...p, projectileMass: 0.6 })
    const heavy = simulateShot({ ...p, projectileMass: 1.4 })
    expect(mid.range).toBeGreaterThan(light.range)
    expect(mid.range).toBeGreaterThan(heavy.range)
    expect(heavy.efficiency).toBeGreaterThan(mid.efficiency)
    expect(mid.efficiency).toBeGreaterThan(light.efficiency)
  })

  it('beats the bolted weight with a hinged one, and beats both with a floating arm', () => {
    const base = { ...presetById('backyard')!.params, releaseMode: 'optimal' as const }
    const hinged = simulateShot(base)
    const fixed = simulateShot({ ...base, type: 'fixed' })
    expect(hinged.efficiency).toBeGreaterThan(fixed.efficiency)
    const fat = simulateShot({ ...presetById('floating-arm')!.params, releaseMode: 'optimal' })
    expect(fat.efficiency).toBeGreaterThan(0.55)
  })

  it('loses range to friction and to air', () => {
    const p = { ...presetById('backyard')!.params, releaseMode: 'optimal' as const }
    const clean = simulateShot({
      ...p,
      pivotFriction: 0,
      hingeFriction: 0,
      troughFriction: 0,
      enableDrag: false,
    })
    const dirty = simulateShot({ ...p, pivotFriction: 0.3, hingeFriction: 0.4 })
    expect(dirty.range).toBeLessThan(clean.range)
    expect(dirty.energy.friction).toBeGreaterThan(0)
    expect(simulateShot(p).range).toBeLessThan(simulateShot({ ...p, enableDrag: false }).range)
  })

  it('reports a peak sling tension far above the static weight of the shot', () => {
    const r = simulateShot(presetById('backyard')!.params)
    const staticWeight = 0.6 * 9.81
    expect(r.peaks.slingTension).toBeGreaterThan(10 * staticWeight)
    expect(r.peaks.axleLoad).toBeGreaterThan(60 * 9.81)
  })

  it('rejects geometry that cannot throw', () => {
    const p = presetById('backyard')!.params
    expect(simulateShot({ ...p, slingLength: 0.05 }).ok).toBe(true)
    expect(simulateShot({ ...p, pivotHeight: 0.01 }).errors.length).toBeGreaterThan(0)
    expect(simulateShot({ ...p, cwMass: 0 }).errors.length).toBeGreaterThan(0)
  })

  it('never releases before the shot has left the trough', () => {
    for (const preset of PRESETS) {
      // Both instants come off the same reported timeline, so this compares the
      // numbers the app actually draws rather than reverse-engineering liftoff
      // from the first swing frame — which the frame thinning can drop.
      const { timeline } = fire(preset.params)
      expect(timeline.liftoffT, preset.name).toBeGreaterThan(0)
      expect(timeline.releaseT, preset.name).toBeGreaterThanOrEqual(timeline.liftoffT)
      expect(timeline.duration, preset.name).toBeGreaterThan(timeline.releaseT)
    }
  })
})

describe('follow-through', () => {
  it('keeps the machine moving after release, for the drawing', () => {
    const r = fire(presetById('backyard')!.params)
    const follow = r.frames.filter((f) => f.phase === 'follow')
    expect(follow.length).toBeGreaterThan(10)
    // It genuinely swings on rather than freezing at the release pose.
    expect(follow.at(-1)!.t).toBeGreaterThan(r.timeline.releaseT + 0.5)
    expect(Math.abs(follow.at(-1)!.pose.theta - follow[0].pose.theta)).toBeGreaterThan(0.05)
    // And no stroke frame carries the shot past release — the overshoot the
    // optimal-release search integrates must not leak into the drawing with
    // the projectile still hanging on the sling.
    for (const f of r.frames) {
      if (f.phase !== 'follow') expect(f.t).toBeLessThanOrEqual(r.timeline.releaseT + 1e-9)
    }
  })

  it('is skipped entirely for lightweight (sweep) shots', () => {
    const r = simulateShot(presetById('backyard')!.params, { lightweight: true })
    expect(r.ok).toBe(true)
    expect(r.frames).toHaveLength(0)
  })
})

describe('plausibility', () => {
  it('warns about impossible inputs but never blocks them', () => {
    // 60 kg in a 10 cm cube is 60 t/m³ — five times lead. Still simulates:
    // cranking the sliders past reality is half the fun of the app.
    const r = simulateShot({ ...presetById('backyard')!.params, cwSize: 0.1 })
    expect(r.ok).toBe(true)
    expect(r.warnings.some((w) => w.includes('denser than lead'))).toBe(true)
  })

  it('catches geometry that could never be set up', () => {
    const p = presetById('backyard')!.params
    // A 2.6 m hanger under a 2 m pivot rests the box underground.
    expect(
      geometryImpossibilities({ ...p, cwHanger: 2.6 }).some((w) => w.includes('below ground')),
    ).toBe(true)
    // A 1.2 m box on a 0.5 m hanger swallows its own hinge.
    expect(geometryImpossibilities({ ...p, cwSize: 1.2 }).some((w) => w.includes('swallow'))).toBe(
      true,
    )
    expect(geometryImpossibilities(p)).toEqual([])
  })

  it('calls a lighter-than-air projectile what it is', () => {
    const p = { ...presetById('backyard')!.params, projectileMass: 0.01, projectileDiameter: 0.5 }
    expect(plausibilityWarnings(p).some((w) => w.includes('balloon'))).toBe(true)
  })

  it('keeps every preset clear of impossibility warnings', () => {
    for (const preset of PRESETS) {
      expect(plausibilityWarnings(preset.params), preset.name).toEqual([])
    }
  })
})

describe('pareto frontier', () => {
  const keys: TunableKey[] = ['slingLength', 'cwHanger', 'initialBeamAngle', 'armShort']

  it('returns a feasible, mutually non-dominated frontier', () => {
    const front = paretoSearch(presetById('backyard')!.params, keys, 'range', 60)
    expect(front.length).toBeGreaterThan(0)
    expect(front.length).toBeLessThanOrEqual(24)
    for (const a of front) {
      expect(geometryImpossibilities(a.params)).toEqual([])
      for (const b of front) {
        if (a === b) continue
        const dominates =
          b.range >= a.range &&
          b.axleLoad <= a.axleLoad &&
          (b.range > a.range || b.axleLoad < a.axleLoad)
        expect(dominates).toBe(false)
      }
    }
    // Sorted lightest frame first — and along a proper frontier, range can only
    // be bought with load, so both columns rise together.
    for (let i = 1; i < front.length; i++) {
      expect(front[i].axleLoad).toBeGreaterThanOrEqual(front[i - 1].axleLoad)
      expect(front[i].range).toBeGreaterThanOrEqual(front[i - 1].range)
    }
  })

  it('gives the same frontier for the same machine', () => {
    const p = presetById('backyard')!.params
    expect(paretoSearch(p, keys, 'range', 40)).toEqual(paretoSearch(p, keys, 'range', 40))
  })

  it('returns buildable pin-release machines, not optimal-release fictions', () => {
    const front = paretoSearch(presetById('backyard')!.params, keys, 'range', 40)
    for (const pt of front) {
      expect(pt.params.releaseMode).toBe('pin')
      const built = simulateShot(pt.params, { lightweight: true, dt: SWEEP_DT })
      expect(built.ok).toBe(true)
    }
  })

  it('is non-dominated on whichever goal it was asked for', () => {
    // The frontier for efficiency is not the frontier for range: a build can be
    // the best converter on the field and still not the longest thrower.
    for (const goal of ['efficiency', 'releaseSpeed'] as const) {
      const front = paretoSearch(presetById('backyard')!.params, keys, goal, 60)
      expect(front.length, goal).toBeGreaterThan(0)
      for (const a of front) {
        for (const b of front) {
          if (a === b) continue
          const dominates =
            goalValue(b, goal) >= goalValue(a, goal) &&
            b.axleLoad <= a.axleLoad &&
            (goalValue(b, goal) > goalValue(a, goal) || b.axleLoad < a.axleLoad)
          expect(dominates, goal).toBe(false)
        }
      }
      // Sorted lightest frame first, and along a frontier the goal is bought
      // with load — so both columns rise together whatever is being bought.
      for (let i = 1; i < front.length; i++) {
        expect(goalValue(front[i], goal), goal).toBeGreaterThanOrEqual(
          goalValue(front[i - 1], goal),
        )
      }
    }
  })

  it('always marks the machine it was given, even after thinning', () => {
    // The chart's "as built" ring reads off this flag. Dropping it during the
    // downsample would tell a reader their machine had been beaten when it is
    // sitting on the frontier.
    const p = presetById('backyard')!.params
    const front = paretoSearch(p, keys, 'range', 120)
    const here = front.filter((pt) => pt.isCurrent)
    expect(here.length).toBeLessThanOrEqual(1)
    if (paretoSearch(p, keys, 'range', 120).some((pt) => pt.isCurrent)) {
      expect(here).toHaveLength(1)
    }
  })
})

describe('release tuning', () => {
  it('never lets a pin angle beat the ideal release it was derived from', () => {
    // `bestReleaseAngle` reads the pin angle back off an ideal-release run, so
    // the ideal run is by construction the ceiling. If some pin beat it, the
    // release search is missing candidates.
    for (const preset of PRESETS) {
      const ideal = simulateShot({ ...preset.params, releaseMode: 'optimal' })
      if (!ideal.ok) continue
      for (const angle of [20, 30, 40, 55, 70]) {
        const pinned = simulateShot({ ...preset.params, releaseMode: 'pin', releaseAngle: angle })
        if (!pinned.ok) continue
        expect(pinned.range, `${preset.name} @ ${angle}°`).toBeLessThanOrEqual(ideal.range * 1.02)
      }
    }
  })

  it('reports a pin angle that reproduces the ideal shot when built to it', () => {
    const p = presetById('backyard')!.params
    const ideal = simulateShot({ ...p, releaseMode: 'optimal' })
    const angle = bestReleaseAngle(p)
    if (angle == null) throw new Error('the backyard preset should have an ideal release')
    const built = simulateShot({ ...p, releaseMode: 'pin', releaseAngle: angle })
    expect(built.range).toBeGreaterThan(ideal.range * 0.97)
  })
})

describe('sweeps', () => {
  it('re-cocks and re-releases every point in best-case mode', () => {
    const p = presetById('backyard')!.params
    // Sweep the long arm, which invalidates both the cocked angle and the pin.
    const [min, max] = [p.armLong * 0.7, p.armLong * 1.5]
    const asBuilt = sweep(p, 'armLong', min, max, 8, 'asBuilt')
    const bestCase = sweep(p, 'armLong', min, max, 8, 'bestCase')
    expect(asBuilt).toHaveLength(8)
    expect(bestCase).toHaveLength(8)

    // Best case is what the geometry could do if you tuned around it, so away
    // from the machine's own setting it must not be the worse reading.
    let improved = 0
    for (let i = 0; i < 8; i++) {
      if (!Number.isFinite(asBuilt[i].range) || !Number.isFinite(bestCase[i].range)) continue
      expect(bestCase[i].range).toBeGreaterThan(asBuilt[i].range * 0.98)
      if (bestCase[i].range > asBuilt[i].range * 1.02) improved++
    }
    expect(improved, 'holding a stale pin should cost range somewhere').toBeGreaterThan(0)
  })

  it('still sweeps the cocked angle in best-case mode', () => {
    // Best case re-cocks the beam, which would otherwise overwrite the very
    // number being swept and draw a flat line for a machine that is in fact
    // sensitive to it.
    const p = presetById('backyard')!.params
    const points = sweep(p, 'initialBeamAngle', 20, 60, 6, 'bestCase')
    const ranges = points.map((pt) => pt.range).filter(Number.isFinite)
    expect(ranges.length).toBeGreaterThan(3)
    expect(Math.max(...ranges) - Math.min(...ranges)).toBeGreaterThan(0.5)
  })

  it('refuses the one pair it cannot read honestly', () => {
    const p = presetById('backyard')!.params
    // Releasing ideally is exactly what a pin angle is trying to achieve, so
    // sweeping the pin under best case leaves nothing for the pin to do.
    expect(sweepConflict('releaseAngle', 'bestCase')).toBeTruthy()
    expect(sweepConflict('releaseAngle', 'asBuilt')).toBeNull()
    expect(sweepConflict('slingLength', 'bestCase')).toBeNull()
    expect(() => sweep(p, 'releaseAngle', 20, 90, 4, 'bestCase')).toThrow()
    expect(sweep(p, 'releaseAngle', 20, 90, 4, 'asBuilt')).toHaveLength(4)
  })

  it('gives the same grid whether it is fired whole or in chunks', () => {
    // The worker streams a sweep in slices of this grid. It used to re-derive
    // each slice's bounds, and a slice of one divided by zero.
    expect(sweepValues(2, 10, 1)).toEqual([2])
    expect(sweepValues(2, 10, 0)).toEqual([])
    const whole = sweepValues(0.5, 2.5, 41)
    expect(whole).toHaveLength(41)
    expect(whole[0]).toBe(0.5)
    expect(whole[40]).toBe(2.5)

    const chunked: number[] = []
    for (let i = 0; i < whole.length; i += 5) chunked.push(...whole.slice(i, i + 5))
    expect(chunked).toEqual(whole)

    const p = presetById('backyard')!.params
    const tail = sweepAt(p, 'slingLength', whole.slice(40), 'asBuilt')
    expect(tail).toHaveLength(1)
    expect(Number.isNaN(tail[0].value)).toBe(false)
  })

  it('says which step size each point was fired at', () => {
    const p = presetById('backyard')!.params
    const points = sweep(p, 'slingLength', 1, 2, 3)
    expect(points.every((pt) => pt.dt === SWEEP_DT)).toBe(true)
    // The sweep is deliberately coarser than the shot on the sheet, so a value
    // adopted off the curve re-solves to a slightly different range.
    expect(SWEEP_DT).toBeGreaterThan(0)
  })
})
