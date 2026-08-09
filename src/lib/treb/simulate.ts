import { buildModel, evalPoint, evalPointVel, poseOf, slingArmAngle, type MachineModel } from './model.ts'
import {
  bearingLoads,
  dynamics,
  kineticEnergies,
  makeScratch,
  rk4Step,
  type BearingLoads,
  type DynamicsScratch,
} from './solver.ts'
import type {
  EnergyBudget,
  PeakLoads,
  ReleaseState,
  ShotResult,
  SimFrame,
  TrajectoryPoint,
  TrebuchetParams,
} from './types.ts'

const DEG = 180 / Math.PI
const RAD = Math.PI / 180

/** Beam angle that rests the long-arm tip on the trough — the cocked pose. */
export function cockToGround(p: TrebuchetParams): number {
  const drop = p.pivotHeight - p.troughHeight
  const c = Math.min(1, Math.max(-1, drop / Math.max(p.armLong, 1e-6)))
  return Math.acos(c) * DEG
}

export interface SimOptions {
  /** Integration step for the mechanical stroke, seconds. */
  dt?: number
  /** Skip per-frame capture. Sweeps run thousands of shots and only want numbers. */
  lightweight?: boolean
  /** Hard stop for the stroke, seconds. */
  maxTime?: number
}

interface StrokeSample {
  t: number
  q: Float64Array
  qd: Float64Array
  gamma: number
  phase: 'ground' | 'swing'
  lambda: number
  loads: { pivot: number; hinge: number; slingTension: number }
  frictionLoss: number
  dragLoss: number
}

function emptyResult(errors: string[]): ShotResult {
  return {
    ok: false,
    warnings: [],
    errors,
    frames: [],
    release: null,
    timeline: null,
    trajectory: [],
    range: 0,
    carry: 0,
    apex: 0,
    flightTime: 0,
    impactSpeed: 0,
    impactAngle: 0,
    impactEnergy: 0,
    efficiency: 0,
    vacuumRange: 0,
    energy: {
      available: 0,
      projectile: 0,
      beam: 0,
      counterweight: 0,
      sling: 0,
      lift: 0,
      unspent: 0,
      friction: 0,
      drag: 0,
      residual: 0,
    },
    peaks: {
      slingTension: 0,
      slingTensionAt: 0,
      axleLoad: 0,
      axleLoadAt: 0,
      beamMoment: 0,
      beamMomentAt: 0,
      cwAcceleration: 0,
    },
  }
}

/** Geometry checks that make a shot meaningless rather than merely bad. */
export function validateGeometry(p: TrebuchetParams): string[] {
  const errors: string[] = []
  if (p.armLong <= 0 || p.armShort <= 0) errors.push('Both arm lengths must be greater than zero.')
  if (p.armMass <= 0) errors.push('Beam mass must be greater than zero.')
  if (p.cwMass <= 0) errors.push('Counterweight mass must be greater than zero.')
  if (p.projectileMass <= 0) errors.push('Projectile mass must be greater than zero.')
  if (p.slingLength <= 0) errors.push('Sling length must be greater than zero.')
  if (p.pivotHeight <= p.troughHeight)
    errors.push('The pivot must sit above the projectile trough.')

  const theta0 = p.initialBeamAngle * RAD
  const tipY = p.pivotHeight - p.armLong * Math.cos(theta0)
  if (tipY - p.troughHeight > p.slingLength + 1e-9)
    errors.push(
      `Sling is too short to reach the trough from the cocked pose: it needs at least ${(tipY - p.troughHeight).toFixed(2)} m.`,
    )
  // Scale-relative tolerance rather than an exact test. Real machines are
  // specified to a few significant figures, so a cocked pose that puts the tip
  // a fraction of a millimetre "through" the trough is rounding, not a fault.
  const tipTol = Math.max(5e-3, 0.01 * p.armLong)
  if (tipY < p.troughHeight - tipTol)
    errors.push('The cocked beam angle drives the arm tip below the trough.')
  return errors
}

/**
 * Simulate one shot end to end: the constrained ground drag, the free swing,
 * the release, and the ballistic flight.
 */
export function simulateShot(p: TrebuchetParams, opts: SimOptions = {}): ShotResult {
  const errors = validateGeometry(p)
  if (errors.length) return emptyResult(errors)

  const dt = opts.dt ?? 2e-4
  const maxTime = opts.maxTime ?? 6
  const model = buildModel(p)
  const n = model.nq
  const scratch = makeScratch(n, model.bodies.length)
  const warnings: string[] = []

  // --- Cocked pose ----------------------------------------------------------
  const q = new Float64Array(n)
  const qd = new Float64Array(n)
  q[model.iTheta] = p.initialBeamAngle * RAD
  if (model.iPsi >= 0) q[model.iPsi] = 0
  const tip0 = evalPoint(model.points.tip, q)
  const sinPhi = (tip0.y - model.troughY) / p.slingLength
  q[model.iPhi] = Math.asin(Math.min(1, Math.max(-1, sinPhi)))

  const uRef = referencePotential(model, p)
  const uMach0 = machinePotential(model, p, q)
  const available = uRef.cwBeamInitial - uRef.cwBeamFinal

  if (available <= 0)
    return emptyResult([
      'This machine has no energy to give: the counterweight cannot fall far enough to lift the beam.',
    ])

  // --- Stroke ---------------------------------------------------------------
  const samples: StrokeSample[] = []
  const state = { q, qd }
  let loads: BearingLoads = { pivot: 0, hinge: 0 }
  let t = 0
  let constrained = true
  let frictionLoss = 0
  let dragLoss = 0
  let liftoffTime = -1
  const sampleEvery = Math.max(1, Math.round(4e-4 / dt))
  let step = 0
  // Events are timestamped rather than flagged, because the stroke deliberately
  // runs on past the release to give the optimal-release search something to
  // choose from. A beam that stalls or a weight that grounds *after* the sling
  // has let go changed nothing about the shot and must not raise a warning.
  let stalledAt = Infinity
  let cwGroundedAt = Infinity
  let tipFouledAt = Infinity
  let slackSlingAt = Infinity

  // Prime the bearing loads so the very first step is not friction-free.
  {
    const r0 = dynamics(model, p, state.q, state.qd, scratch, { constrained, loads })
    const l0 = bearingLoads(model, p, state.q, state.qd, scratch.qdd, r0.lambda, constrained)
    loads = { pivot: l0.pivot, hinge: l0.hinge }
  }

  while (t < maxTime) {
    const res = rk4Step(model, p, state, dt, scratch, { constrained, loads })
    t += dt
    step++

    // Diagnostics at the new state, which also feed the next step's friction.
    const post = dynamics(model, p, state.q, state.qd, scratch, { constrained, loads })
    const bl = bearingLoads(model, p, state.q, state.qd, scratch.qdd, post.lambda, constrained)
    loads = { pivot: bl.pivot, hinge: bl.hinge }
    frictionLoss += res.frictionPower * dt
    dragLoss += res.dragPower * dt

    if (constrained && post.lambda <= 0) {
      constrained = false
      liftoffTime = t
    }

    const pose = poseOf(model, state.q)
    if (!constrained && pose.projectile.y < model.troughY - 1e-3) tipFouledAt = Math.min(tipFouledAt, t)
    if (pose.cw.y - p.cwSize / 2 < 0) cwGroundedAt = Math.min(cwGroundedAt, t)
    if (!constrained && bl.slingTension < -1) slackSlingAt = Math.min(slackSlingAt, t)

    if (step % sampleEvery === 0 || !constrained) {
      samples.push({
        t,
        q: state.q.slice(),
        qd: state.qd.slice(),
        gamma: slingArmAngle(pose),
        phase: constrained ? 'ground' : 'swing',
        lambda: post.lambda,
        loads: { pivot: bl.pivot, hinge: bl.hinge, slingTension: bl.slingTension },
        frictionLoss,
        dragLoss,
      })
    }

    const theta = state.q[model.iTheta]
    const thetaDot = state.qd[model.iTheta]
    if (theta > Math.PI + 0.7) break
    if (t > 0.05 && thetaDot < 0 && !constrained) {
      stalledAt = Math.min(stalledAt, t)
      break
    }
    if (t > 0.3 && Math.abs(thetaDot) < 1e-3) {
      stalledAt = Math.min(stalledAt, t)
      break
    }
  }

  if (liftoffTime < 0) {
    return emptyResult([
      'The projectile never lifted off the trough. The counterweight is too light, or the sling is too long, for this beam.',
    ])
  }

  const candidates = samples.filter((s) => s.phase === 'swing')
  if (candidates.length === 0) return emptyResult(['The stroke ended before the shot left the ground.'])

  // --- Release --------------------------------------------------------------
  const release = pickRelease(model, p, candidates, warnings)
  if (!release) {
    return emptyResult([
      `The sling never reached a ${p.releaseAngle.toFixed(0)}° pin angle before the beam ran out of travel. Try a larger pin angle or a shorter sling.`,
    ])
  }
  const { sample: relSample, state: rel } = release

  // --- Flight ---------------------------------------------------------------
  const flight = flyBallistic(p, rel.x, rel.y, rel.vx, rel.vy, p.enableDrag)
  if (!flight.landed) {
    // Two ways not to land: an uphill target above the whole arc, or a
    // near-buoyant projectile still drifting when the integrator gave up.
    return emptyResult([
      p.targetDrop < 0
        ? 'The target sits higher than the top of this trajectory, so the shot can never land on it. Bring "drop to target" back toward level, or throw faster.'
        : 'The shot was still airborne after two minutes of flight. This projectile floats more than it flies — give it more mass or less drag.',
    ])
  }
  // Drag only ever lowers the arc, so if the real flight landed the vacuum one
  // does too — but guard it anyway rather than let a phantom range through.
  const vac = p.enableDrag ? flyBallistic(p, rel.x, rel.y, rel.vx, rel.vy, false) : flight

  // --- Energy audit ---------------------------------------------------------
  const ke = kineticEnergies(model, relSample.q, relSample.qd)
  const projShare = model.slungMass > 0 ? p.projectileMass / model.slungMass : 1
  const keProjectile = ke.slung * projShare
  const keSling = ke.slung - keProjectile
  const uMachRel = machinePotential(model, p, relSample.q)
  const cwBeamAtRelease = uMachRel.cw + uMachRel.beam
  const spentCwBeam = uRef.cwBeamInitial - cwBeamAtRelease
  const lift = uMachRel.slung - uMach0.slung

  const energy: EnergyBudget = {
    available,
    projectile: keProjectile,
    beam: ke.beam,
    counterweight: ke.cw,
    sling: keSling,
    lift,
    unspent: available - spentCwBeam,
    friction: relSample.frictionLoss,
    drag: relSample.dragLoss,
    residual: 0,
  }
  energy.residual =
    energy.available -
    (energy.projectile +
      energy.beam +
      energy.counterweight +
      energy.sling +
      energy.lift +
      energy.unspent +
      energy.friction +
      energy.drag)

  // --- Peaks ----------------------------------------------------------------
  const peaks: PeakLoads = {
    slingTension: 0,
    slingTensionAt: 0,
    axleLoad: 0,
    axleLoadAt: 0,
    beamMoment: 0,
    beamMomentAt: 0,
    cwAcceleration: 0,
  }
  for (const s of samples) {
    if (s.t > relSample.t) break
    if (s.loads.slingTension > peaks.slingTension) {
      peaks.slingTension = s.loads.slingTension
      peaks.slingTensionAt = s.t
    }
    if (s.loads.pivot > peaks.axleLoad) {
      peaks.axleLoad = s.loads.pivot
      peaks.axleLoadAt = s.t
    }
    // Bending the beam carries at its root: the sling pulls on the tip at an
    // angle, and only the component across the beam bends it.
    const pose = poseOf(model, s.q)
    const ax = pose.tip.x - pose.axle.x
    const ay = pose.tip.y - pose.axle.y
    const al = Math.hypot(ax, ay) || 1
    const sx = pose.projectile.x - pose.tip.x
    const sy = pose.projectile.y - pose.tip.y
    const sl = Math.hypot(sx, sy) || 1
    const cross = Math.abs((ax / al) * (sy / sl) - (ay / al) * (sx / sl))
    const moment = Math.abs(s.loads.slingTension) * cross * p.armLong
    if (moment > peaks.beamMoment) {
      peaks.beamMoment = moment
      peaks.beamMomentAt = s.t
    }
    const cwAcc = s.loads.hinge / Math.max(p.cwMass, 1e-9) / p.gravity
    if (cwAcc > peaks.cwAcceleration) peaks.cwAcceleration = cwAcc
  }

  // --- Warnings -------------------------------------------------------------
  const before = (when: number) => when <= relSample.t + 1e-9
  if (before(cwGroundedAt))
    warnings.push('The counterweight box reaches the ground before release — raise the pivot or shorten the hanger.')
  if (before(tipFouledAt))
    warnings.push('The projectile dips below the trough after liftoff and would foul the ground.')
  if (before(slackSlingAt))
    warnings.push('Sling tension goes negative: the sling goes slack mid-throw and the shot tumbles.')
  if (before(stalledAt)) warnings.push('The beam stalled or reversed before the sling let go.')
  if (rel.angle < 15 || rel.angle > 70)
    warnings.push(`Launch angle of ${rel.angle.toFixed(0)}° is well away from the ~42° that maximises range.`)
  // An audit that misses in either direction is the same fault, so the check
  // is on the magnitude — a negative residual used to slip through unremarked.
  if (Math.abs(energy.residual) / available > 0.02)
    warnings.push('Energy audit does not close — the integration step may be too coarse for this machine.')
  const ratio = p.cwMass / p.projectileMass
  if (ratio < 25)
    warnings.push(`Counterweight is only ${ratio.toFixed(0)}× the shot. Historical engines ran 100× and up.`)

  const frames: SimFrame[] = opts.lightweight
    ? []
    : samples.map((s) => {
        const pose = poseOf(model, s.q)
        const v = evalPointVel(model.points.projectile, s.q, s.qd)
        const speed = Math.hypot(v.x, v.y)
        return {
          t: s.t,
          pose,
          phase: s.phase,
          gamma: s.gamma,
          slingTension: s.loads.slingTension,
          normalForce: Math.max(0, s.lambda),
          axleLoad: s.loads.pivot,
          beamMoment: 0,
          projectileSpeed: speed,
          keProjectile: 0.5 * p.projectileMass * speed * speed,
        }
      })

  const impactEnergy = 0.5 * p.projectileMass * flight.impactSpeed * flight.impactSpeed

  return {
    ok: true,
    warnings,
    errors: [],
    frames,
    release: rel,
    timeline: {
      liftoffT: liftoffTime,
      releaseT: relSample.t,
      duration: relSample.t + flight.time,
    },
    trajectory: opts.lightweight ? [] : flight.trajectory,
    range: flight.range,
    carry: flight.range - rel.x,
    apex: flight.apex,
    flightTime: flight.time,
    impactSpeed: flight.impactSpeed,
    impactAngle: flight.impactAngle,
    impactEnergy,
    efficiency: keProjectile / available,
    vacuumRange: vac.landed ? vac.range : Number.NaN,
    energy,
    peaks,
  }
}

/** Potential energy of each body group at a pose. */
function machinePotential(model: MachineModel, p: TrebuchetParams, q: ArrayLike<number>) {
  const beam = model.bodies[0].m * p.gravity * evalPoint(model.bodies[0], q).y
  const cw = model.bodies[1].m * p.gravity * evalPoint(model.bodies[1], q).y
  const slung = model.bodies[2].m * p.gravity * evalPoint(model.bodies[2], q).y
  return { beam, cw, slung }
}

/**
 * The energy the machine has to give: what the counterweight gives up over a
 * full stroke, net of what it costs to hoist the beam. The reference pose is
 * the bottom of the stroke — long arm straight up, weight hanging straight
 * down — which is where the counterweight sits lowest on all three topologies.
 */
function referencePotential(model: MachineModel, p: TrebuchetParams) {
  const n = model.nq
  const qi = new Float64Array(n)
  qi[model.iTheta] = p.initialBeamAngle * RAD
  const qf = new Float64Array(n)
  qf[model.iTheta] = Math.PI

  const ui = machinePotential(model, p, qi)
  const uf = machinePotential(model, p, qf)
  return {
    cwBeamInitial: ui.cw + ui.beam,
    cwBeamFinal: uf.cw + uf.beam,
  }
}

function stateAt(
  model: MachineModel,
  s: StrokeSample,
): ReleaseState {
  const pose = poseOf(model, s.q)
  const v = evalPointVel(model.points.projectile, s.q, s.qd)
  const speed = Math.hypot(v.x, v.y)
  return {
    t: s.t,
    x: pose.projectile.x,
    y: pose.projectile.y,
    vx: v.x,
    vy: v.y,
    speed,
    angle: (Math.atan2(v.y, v.x) * 180) / Math.PI,
    gamma: s.gamma,
    beamAngle: pose.theta * DEG,
  }
}

function pickRelease(
  model: MachineModel,
  p: TrebuchetParams,
  candidates: StrokeSample[],
  warnings: string[],
): { sample: StrokeSample; state: ReleaseState } | null {
  if (p.releaseMode === 'pin') {
    // The sling starts well behind the arm and closes on it through the throw,
    // so the pin fires on the first downward crossing of the set angle.
    for (let i = 1; i < candidates.length; i++) {
      const a = candidates[i - 1]
      const b = candidates[i]
      if (a.gamma > p.releaseAngle && b.gamma <= p.releaseAngle) {
        return { sample: b, state: stateAt(model, b) }
      }
    }
    if (candidates[0].gamma <= p.releaseAngle) {
      warnings.push(
        'The sling was already inside the pin angle at liftoff — the shot releases immediately. Increase the pin angle.',
      )
      return { sample: candidates[0], state: stateAt(model, candidates[0]) }
    }
    return null
  }

  // Optimal release: screen every few samples with a cheap flight, then refine
  // around the winner. Not a machine you can build, but it is the ceiling that
  // a tuned pin angle is chasing — and it reports the pin angle to aim at.
  let best = -Infinity
  let bestIdx = -1
  const stride = Math.max(1, Math.floor(candidates.length / 220))
  for (let i = 0; i < candidates.length; i += stride) {
    const st = stateAt(model, candidates[i])
    if (st.vx <= 0) continue
    const fl = flyBallistic(p, st.x, st.y, st.vx, st.vy, p.enableDrag, 4e-3)
    if (fl.landed && fl.range > best) {
      best = fl.range
      bestIdx = i
    }
  }
  if (bestIdx < 0) return null
  const lo = Math.max(0, bestIdx - stride)
  const hi = Math.min(candidates.length - 1, bestIdx + stride)
  for (let i = lo; i <= hi; i++) {
    const st = stateAt(model, candidates[i])
    if (st.vx <= 0) continue
    const fl = flyBallistic(p, st.x, st.y, st.vx, st.vy, p.enableDrag, 1e-3)
    if (fl.landed && fl.range > best) {
      best = fl.range
      bestIdx = i
    }
  }
  return { sample: candidates[bestIdx], state: stateAt(model, candidates[bestIdx]) }
}

export interface FlightResult {
  trajectory: TrajectoryPoint[]
  range: number
  apex: number
  time: number
  impactSpeed: number
  impactAngle: number
  /**
   * False when the flight never comes down onto the target plane — an uphill
   * target higher than the arc's top. `range` is then just where the
   * integration stopped and means nothing.
   */
  landed: boolean
}

/**
 * Ballistic flight with quadratic drag and a steady horizontal wind, run to the
 * target's ground plane. RK4 with a fixed step and a bisected final step, so
 * the reported range does not wobble with the step size.
 */
export function flyBallistic(
  p: TrebuchetParams,
  x0: number,
  y0: number,
  vx0: number,
  vy0: number,
  withDrag: boolean,
  dt = 2e-3,
): FlightResult {
  const groundY = -p.targetDrop
  const area = 0.25 * Math.PI * p.projectileDiameter * p.projectileDiameter
  const k = withDrag ? (0.5 * p.airDensity * p.projectileCd * area) / p.projectileMass : 0
  const g = p.gravity
  const wind = p.windSpeed

  const acc = (vx: number, vy: number): [number, number] => {
    if (k === 0) return [0, -g]
    const rvx = vx - wind
    const sp = Math.hypot(rvx, vy)
    return [-k * sp * rvx, -g - k * sp * vy]
  }

  const traj: TrajectoryPoint[] = [{ t: 0, x: x0, y: y0, vx: vx0, vy: vy0 }]
  let x = x0
  let y = y0
  let vx = vx0
  let vy = vy0
  let t = 0
  let apex = y0
  const maxT = 120

  while (t < maxT) {
    const [a1x, a1y] = acc(vx, vy)
    const [a2x, a2y] = acc(vx + (dt / 2) * a1x, vy + (dt / 2) * a1y)
    const [a3x, a3y] = acc(vx + (dt / 2) * a2x, vy + (dt / 2) * a2y)
    const [a4x, a4y] = acc(vx + dt * a3x, vy + dt * a3y)

    const k1x = vx
    const k1y = vy
    const k2x = vx + (dt / 2) * a1x
    const k2y = vy + (dt / 2) * a1y
    const k3x = vx + (dt / 2) * a2x
    const k3y = vy + (dt / 2) * a2y
    const k4x = vx + dt * a3x
    const k4y = vy + dt * a3y

    const nx = x + (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x)
    const ny = y + (dt / 6) * (k1y + 2 * k2y + 2 * k3y + k4y)
    const nvx = vx + (dt / 6) * (a1x + 2 * a2x + 2 * a3x + a4x)
    const nvy = vy + (dt / 6) * (a1y + 2 * a2y + 2 * a3y + a4y)

    // A landing is a *downward* crossing from at-or-above the plane. The bare
    // "below the plane" test used here before also fired while an uphill shot
    // was still climbing toward its target, and extrapolated a phantom landing
    // backwards along the ascent.
    if (y >= groundY && ny <= groundY) {
      // Land exactly on the plane rather than one step past it.
      const frac = (y - groundY) / Math.max(y - ny, 1e-12)
      const fx = x + (nx - x) * frac
      const fvx = vx + (nvx - vx) * frac
      const fvy = vy + (nvy - vy) * frac
      t += dt * frac
      traj.push({ t, x: fx, y: groundY, vx: fvx, vy: fvy })
      return {
        trajectory: traj,
        range: fx,
        apex,
        time: t,
        impactSpeed: Math.hypot(fvx, fvy),
        impactAngle: (Math.atan2(-fvy, fvx) * 180) / Math.PI,
        landed: true,
      }
    }

    if (ny <= groundY && nvy <= 0) {
      // Below an uphill target plane and descending: nothing pushes the shot
      // back up, so it can never land. Stop here rather than integrating the
      // full 120 s of fall and calling wherever that ends a range.
      traj.push({ t: t + dt, x: nx, y: ny, vx: nvx, vy: nvy })
      return {
        trajectory: traj,
        range: nx,
        apex,
        time: t + dt,
        impactSpeed: Math.hypot(nvx, nvy),
        impactAngle: (Math.atan2(-nvy, nvx) * 180) / Math.PI,
        landed: false,
      }
    }

    x = nx
    y = ny
    vx = nvx
    vy = nvy
    t += dt
    if (y > apex) apex = y
    traj.push({ t, x, y, vx, vy })
  }

  return {
    trajectory: traj,
    range: x,
    apex,
    time: t,
    impactSpeed: Math.hypot(vx, vy),
    impactAngle: (Math.atan2(-vy, vx) * 180) / Math.PI,
    landed: false,
  }
}

export type { DynamicsScratch }
