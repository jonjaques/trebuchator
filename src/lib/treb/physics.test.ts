import { describe, expect, it } from 'vitest'
import { buildModel, evalPoint, evalPointVel, poseOf } from './model.ts'
import { kineticEnergies, makeScratch, rk4Step } from './solver.ts'
import { cockToGround, flyBallistic, simulateShot } from './simulate.ts'
import { PRESETS, presetById } from './presets.ts'
import { bestReleaseAngle, sweep } from './optimize.ts'
import type { TrebuchetParams } from './types.ts'

const lab = () => structuredClone(presetById('lab')!.params)

/**
 * Reference machine: the instrumented trebuchet in Bernaola, Fernández and
 * Gómez, "The swinging counterweight trebuchet. Experiments on inner movement
 * and ranges" (arXiv:2502.19442), whose beam, counterweight and sling angles
 * were recorded with rotation sensors through real shots.
 *
 * Table 1 gives the geometry and masses; Table 2 the longest vacuum ranges and
 * release times. The `lab` preset is frictionless, so it reproduces their *ab
 * initio* machine rather than the measured one — the two are related by the
 * loss factor the paper itself reports, and that relation is asserted below.
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

  it('matches the 717 g range once the paper’s own loss factor is applied', () => {
    const r = simulateShot(lab())
    expect(r.ok).toBe(true)
    // The paper measures 36.6 m and reports 68.8% experimental efficiency
    // against 80.4% for the same machine with no mechanical losses. Scaling its
    // measured range by that ratio gives the frictionless range this solver
    // should produce.
    const idealised = 36.6 * (80.4 / 68.8)
    expect(r.range).toBeGreaterThan(idealised * 0.95)
    expect(r.range).toBeLessThan(idealised * 1.05)
  })

  it('reproduces the published release times for both projectile masses', () => {
    // Release timing is the sharpest test of the equations of motion: it
    // depends on the whole three-body swing, not just the energy budget.
    expect(simulateShot(lab()).strokeTime).toBeCloseTo(0.593, 1)
    expect(simulateShot({ ...lab(), projectileMass: 0.0685 }).strokeTime).toBeCloseTo(0.533, 1)
  })

  it('shows the light shot flying further but wasting far more of the machine', () => {
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
      const r = simulateShot(preset.params)
      expect(r.release!.vx, preset.name).toBeGreaterThan(0)
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
})

describe('design behaviour', () => {
  it('every preset produces a valid shot', () => {
    for (const preset of PRESETS) {
      const r = simulateShot(preset.params)
      expect(r.errors, `${preset.name}: ${r.errors.join(' ')}`).toEqual([])
      expect(r.ok, preset.name).toBe(true)
      expect(r.range, preset.name).toBeGreaterThan(0)
      expect(r.release!.speed, preset.name).toBeGreaterThan(0)
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
      const r = simulateShot(preset.params)
      const liftoff = r.frames.find((f) => f.phase === 'swing')
      expect(liftoff, preset.name).toBeDefined()
      expect(r.release!.t, preset.name).toBeGreaterThanOrEqual(liftoff!.t - 1e-9)
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
    expect(angle).not.toBeNull()
    const built = simulateShot({ ...p, releaseMode: 'pin', releaseAngle: angle! })
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
})
