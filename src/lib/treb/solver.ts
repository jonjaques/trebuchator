import {
  evalPoint,
  evalPointAcc,
  evalPointVel,
  pointHessianDiag,
  pointJacobian,
  type MachineModel,
} from './model.ts'
import type { TrebuchetParams } from './types.ts'

/**
 * Equations of motion, assembled numerically from the kinematic model.
 *
 * We build the mass matrix M(q) from the bodies' Jacobians and take the
 * Coriolis/centrifugal vector from dM/dq directly, rather than writing out
 * Lagrange's equations by hand per machine:
 *
 *     M(q) qdd + c(q, qd) + dV/dq = Q
 *     c_i = SUM_jk dM_ij/dq_k qd_j qd_k  -  1/2 SUM_jk dM_jk/dq_i qd_j qd_k
 *
 * The second form of the Coriolis term is the standard Christoffel contraction
 * with the symmetry already folded in. Because each kinematic term depends on a
 * single coordinate, dM/dq has very few non-zero paths, so this costs about the
 * same as a hand-derived expression while staying honest across topologies.
 */

const EPS_V = 1e-4 // velocity below which Coulomb friction is smoothly faded out

/**
 * Dense LU with partial pivoting. n <= 3 here. `workA`/`workX` receive copies of
 * A and b so the caller's arrays survive — they come from the scratch struct
 * because this runs a dozen times per integration step, and per-call `slice()`s
 * were most of the solver's garbage.
 */
function luSolve(
  A: Float64Array,
  b: Float64Array,
  n: number,
  out: Float64Array,
  workA: Float64Array,
  workX: Float64Array,
): boolean {
  const a = workA
  const x = workX
  a.set(A)
  x.set(b)

  for (let col = 0; col < n; col++) {
    let best = col
    let bestVal = Math.abs(a[col * n + col])
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(a[r * n + col])
      if (v > bestVal) {
        bestVal = v
        best = r
      }
    }
    if (bestVal < 1e-14) return false
    if (best !== col) {
      for (let c = 0; c < n; c++) {
        const t = a[col * n + c]
        a[col * n + c] = a[best * n + c]
        a[best * n + c] = t
      }
      const t = x[col]
      x[col] = x[best]
      x[best] = t
    }
    const d = a[col * n + col]
    for (let r = col + 1; r < n; r++) {
      const f = a[r * n + col] / d
      if (f === 0) continue
      for (let c = col; c < n; c++) a[r * n + c] -= f * a[col * n + c]
      x[r] -= f * x[col]
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r]
    for (let c = r + 1; c < n; c++) s -= a[r * n + c] * out[c]
    out[r] = s / a[r * n + r]
  }
  return true
}

/** Signum, faded to zero across +/-EPS_V so stiction does not chatter the integrator. */
function softSign(v: number): number {
  return v / (Math.abs(v) + EPS_V)
}

export interface DynamicsScratch {
  n: number
  M: Float64Array
  dM: Float64Array // [i*n*n + j*n + k]
  Jx: Float64Array[]
  Jy: Float64Array[]
  Hx: Float64Array[]
  Hy: Float64Array[]
  grav: Float64Array
  cor: Float64Array
  Q: Float64Array
  rhs: Float64Array
  qdd: Float64Array
  tmpA: Float64Array
  tmpB: Float64Array
  /** Work space for `luSolve` — see the comment there. */
  luA: Float64Array
  luX: Float64Array
  /** RK4 stage buffers. A stroke is thousands of steps, so these live here
   *  rather than being reallocated per step. */
  rkQ0: Float64Array
  rkV0: Float64Array
  rkQt: Float64Array
  rkVt: Float64Array
  rkKq: Float64Array[]
  rkKv: Float64Array[]
}

export function makeScratch(n: number, nBodies: number): DynamicsScratch {
  const mk = () => Array.from({ length: nBodies }, () => new Float64Array(n))
  const mk4 = () => Array.from({ length: 4 }, () => new Float64Array(n))
  return {
    n,
    M: new Float64Array(n * n),
    dM: new Float64Array(n * n * n),
    Jx: mk(),
    Jy: mk(),
    Hx: mk(),
    Hy: mk(),
    grav: new Float64Array(n),
    cor: new Float64Array(n),
    Q: new Float64Array(n),
    rhs: new Float64Array(n),
    qdd: new Float64Array(n),
    tmpA: new Float64Array(n),
    tmpB: new Float64Array(n),
    luA: new Float64Array(n * n),
    luX: new Float64Array(n),
    rkQ0: new Float64Array(n),
    rkV0: new Float64Array(n),
    rkQt: new Float64Array(n),
    rkVt: new Float64Array(n),
    rkKq: mk4(),
    rkKv: mk4(),
  }
}

/**
 * Bearing loads from the previous accepted step. Coulomb friction depends on
 * the reaction forces, which depend on the accelerations, which depend on the
 * friction — so we break the algebraic loop by lagging the loads one step. At
 * the step sizes used here (2e-4 s against a ~0.6 s stroke) the lag is far
 * below the other modelling error, and it keeps the RHS a pure function.
 */
export interface BearingLoads {
  pivot: number
  hinge: number
}

export interface RhsOptions {
  /** Ground contact active: the shot is still being dragged along the trough. */
  constrained: boolean
  loads: BearingLoads
}

export interface RhsResult {
  /** Trough normal force. Goes through zero at liftoff. */
  lambda: number
  /** Power dissipated in the bearings, watts. */
  frictionPower: number
  /** Power dissipated by air on the projectile during the swing, watts. */
  dragPower: number
}

/**
 * Evaluate accelerations for the machine at (q, qd).
 *
 * Writes `qdd` into `scratch.qdd` and returns the diagnostics that the caller
 * needs for phase transitions and the energy audit.
 */
export function dynamics(
  model: MachineModel,
  p: TrebuchetParams,
  q: Float64Array,
  qd: Float64Array,
  scratch: DynamicsScratch,
  opts: RhsOptions,
): RhsResult {
  const n = model.nq
  const { M, dM, Jx, Jy, Hx, Hy, grav, cor, Q, rhs, qdd } = scratch
  M.fill(0)
  dM.fill(0)
  grav.fill(0)
  Q.fill(0)

  const bodies = model.bodies
  for (let b = 0; b < bodies.length; b++) {
    const body = bodies[b]
    pointJacobian(body, q, Jx[b], Jy[b])
    pointHessianDiag(body, q, Hx[b], Hy[b])
    const m = body.m
    const jx = Jx[b]
    const jy = Jy[b]
    const hx = Hx[b]
    const hy = Hy[b]

    for (let i = 0; i < n; i++) {
      grav[i] += m * p.gravity * jy[i]
      for (let j = 0; j < n; j++) {
        M[i * n + j] += m * (jx[i] * jx[j] + jy[i] * jy[j])
        if (body.I !== 0) M[i * n + j] += body.I * body.dAng[i] * body.dAng[j]
        // dM_ij/dq_k is non-zero only where k picks out one of i or j, because
        // the cross second derivatives of the kinematics vanish identically.
        dM[i * n * n + j * n + i] += m * (hx[i] * jx[j] + hy[i] * jy[j])
        dM[i * n * n + j * n + j] += m * (jx[i] * hx[j] + jy[i] * hy[j])
      }
    }
  }

  for (let i = 0; i < n; i++) {
    let ci = 0
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        const w = qd[j] * qd[k]
        ci += (dM[i * n * n + j * n + k] - 0.5 * dM[j * n * n + k * n + i]) * w
      }
    }
    cor[i] = ci
  }

  // --- Generalised forces ---------------------------------------------------
  const proj = model.points.projectile
  const jxP = Jx[model.iProjectile]
  const jyP = Jy[model.iProjectile]
  const vP = evalPointVel(proj, q, qd)

  let dragPower = 0
  if (p.enableDrag) {
    // The shot is already pushing air before it leaves the sling; on a fast
    // machine with a light projectile this is not a rounding error.
    const area = 0.25 * Math.PI * p.projectileDiameter * p.projectileDiameter
    const rvx = vP.x - p.windSpeed
    const rvy = vP.y
    const sp = Math.hypot(rvx, rvy)
    if (sp > 1e-6) {
      const k = -0.5 * p.airDensity * p.projectileCd * area * sp
      const fx = k * rvx
      const fy = k * rvy
      for (let i = 0; i < n; i++) Q[i] += fx * jxP[i] + fy * jyP[i]
      dragPower = -(fx * vP.x + fy * vP.y)
    }
  }

  let frictionPower = 0
  const iTheta = model.iTheta
  const thetaDot = qd[iTheta]
  if (p.pivotFriction > 0 && p.pivotRadius > 0) {
    const tau = -p.pivotFriction * opts.loads.pivot * p.pivotRadius * softSign(thetaDot)
    Q[iTheta] += tau
    frictionPower += Math.abs(tau * thetaDot)
  }
  if (model.iPsi >= 0 && p.hingeFriction > 0 && p.hingeRadius > 0) {
    const rel = qd[model.iPsi] - thetaDot
    const tau = -p.hingeFriction * opts.loads.hinge * p.hingeRadius * softSign(rel)
    Q[model.iPsi] += tau
    Q[iTheta] -= tau
    frictionPower += Math.abs(tau * rel)
  }

  for (let i = 0; i < n; i++) rhs[i] = Q[i] - cor[i] - grav[i]

  const { luA, luX } = scratch
  if (!opts.constrained) {
    if (!luSolve(M, rhs, n, qdd, luA, luX)) qdd.fill(0)
    return { lambda: 0, frictionPower, dragPower }
  }

  // --- Ground phase: projectile pinned to the trough ------------------------
  // Constraint g(q) = y_proj - troughY = 0, enforced at the acceleration level
  // with Baumgarte stabilisation so it cannot drift over a long drag.
  const G = jyP
  const hyP = Hy[model.iProjectile]
  let quad = 0
  for (let i = 0; i < n; i++) quad += hyP[i] * qd[i] * qd[i]
  const pos = evalPoint(proj, q)
  const gVal = pos.y - model.troughY
  let gDot = 0
  for (let i = 0; i < n; i++) gDot += G[i] * qd[i]
  const alpha = 40
  const target = -quad - 2 * alpha * gDot - alpha * alpha * gVal

  const { tmpA, tmpB } = scratch
  if (!luSolve(M, rhs, n, tmpA, luA, luX)) {
    qdd.fill(0)
    return { lambda: 0, frictionPower, dragPower }
  }
  // G aliases the projectile's Jacobian row; safe to pass straight through
  // because `luSolve` works on its own copies.
  if (!luSolve(M, G, n, tmpB, luA, luX)) {
    qdd.fill(0)
    return { lambda: 0, frictionPower, dragPower }
  }
  let gMinvF = 0
  let gMinvG = 0
  for (let i = 0; i < n; i++) {
    gMinvF += G[i] * tmpA[i]
    gMinvG += G[i] * tmpB[i]
  }
  const lambda = Math.abs(gMinvG) < 1e-14 ? 0 : (target - gMinvF) / gMinvG
  for (let i = 0; i < n; i++) qdd[i] = tmpA[i] + lambda * tmpB[i]

  if (p.troughFriction > 0 && lambda > 0) {
    const f = -p.troughFriction * lambda * softSign(vP.x)
    for (let i = 0; i < n; i++) rhs[i] += f * jxP[i]
    frictionPower += Math.abs(f * vP.x)
    // Re-solve with friction folded in; one extra pass is cheaper than an
    // iteration and the coupling is weak (friction is normal to the constraint).
    if (luSolve(M, rhs, n, tmpA, luA, luX)) {
      let g2 = 0
      for (let i = 0; i < n; i++) g2 += G[i] * tmpA[i]
      const lam2 = Math.abs(gMinvG) < 1e-14 ? 0 : (target - g2) / gMinvG
      for (let i = 0; i < n; i++) qdd[i] = tmpA[i] + lam2 * tmpB[i]
      return { lambda: lam2, frictionPower, dragPower }
    }
  }

  return { lambda, frictionPower, dragPower }
}

/**
 * Reaction forces at the bearings for the current state. Used both for the
 * next step's Coulomb friction and for the structural readouts a builder needs
 * to size an axle.
 */
export function bearingLoads(
  model: MachineModel,
  p: TrebuchetParams,
  q: Float64Array,
  qd: Float64Array,
  qdd: Float64Array,
  lambda: number,
  constrained: boolean,
): { pivot: number; hinge: number; frame: { x: number; y: number }; slingTension: number } {
  const g = p.gravity
  let sx = 0
  let sy = 0
  for (const body of model.bodies) {
    const a = evalPointAcc(body, q, qd, qdd)
    sx += body.m * a.x
    sy += body.m * (a.y + g)
  }

  // External forces on the machine other than the axle: the trough pushing up
  // on the shot, and air pushing back on it.
  let extX = 0
  let extY = constrained ? lambda : 0
  if (p.enableDrag) {
    const v = evalPointVel(model.points.projectile, q, qd)
    const area = 0.25 * Math.PI * p.projectileDiameter * p.projectileDiameter
    const rvx = v.x - p.windSpeed
    const sp = Math.hypot(rvx, v.y)
    if (sp > 1e-6) {
      const k = -0.5 * p.airDensity * p.projectileCd * area * sp
      extX += k * rvx
      extY += k * v.y
    }
    if (constrained && p.troughFriction > 0 && lambda > 0) {
      extX += -p.troughFriction * lambda * softSign(v.x)
    }
  } else if (constrained && p.troughFriction > 0 && lambda > 0) {
    const v = evalPointVel(model.points.projectile, q, qd)
    extX += -p.troughFriction * lambda * softSign(v.x)
  }

  const frame = { x: sx - extX, y: sy - extY }

  // Force the hanger strap carries: whatever it takes to accelerate the box.
  const cwBody = model.bodies[1]
  const aCw = evalPointAcc(cwBody, q, qd, qdd)
  const hinge = cwBody.m * Math.hypot(aCw.x, aCw.y + g)

  // Sling tension: net force on the slung lump, resolved along the sling.
  const projBody = model.bodies[model.iProjectile]
  const aP = evalPointAcc(projBody, q, qd, qdd)
  const pPos = evalPoint(model.points.projectile, q)
  const tPos = evalPoint(model.points.tip, q)
  let fx = projBody.m * aP.x
  let fy = projBody.m * (aP.y + g)
  fx -= extX
  fy -= extY
  const dx = tPos.x - pPos.x
  const dy = tPos.y - pPos.y
  const dl = Math.hypot(dx, dy) || 1
  const slingTension = (fx * dx + fy * dy) / dl

  return { pivot: Math.hypot(frame.x, frame.y), hinge, frame, slingTension }
}

export interface IntegratorState {
  q: Float64Array
  qd: Float64Array
}

/**
 * Classical RK4 over (q, qd). Fixed step: the trebuchet stroke is smooth and
 * short, and a fixed step keeps the energy audit reproducible between runs,
 * which matters more here than shaving milliseconds.
 */
export function rk4Step(
  model: MachineModel,
  p: TrebuchetParams,
  st: IntegratorState,
  dt: number,
  scratch: DynamicsScratch,
  opts: RhsOptions,
): RhsResult {
  const n = model.nq
  const { rkQ0: q0, rkV0: v0, rkQt: qt, rkVt: vt, rkKq: kq, rkKv: kv } = scratch
  q0.set(st.q)
  v0.set(st.qd)
  const weights = [0, 0.5, 0.5, 1]
  let first: RhsResult = { lambda: 0, frictionPower: 0, dragPower: 0 }

  for (let s = 0; s < 4; s++) {
    const h = weights[s] * dt
    for (let i = 0; i < n; i++) {
      qt[i] = q0[i] + (s === 0 ? 0 : h * kq[s - 1][i])
      vt[i] = v0[i] + (s === 0 ? 0 : h * kv[s - 1][i])
    }
    const r = dynamics(model, p, qt, vt, scratch, opts)
    if (s === 0) first = r
    kq[s].set(vt)
    kv[s].set(scratch.qdd)
  }

  for (let i = 0; i < n; i++) {
    st.q[i] = q0[i] + (dt / 6) * (kq[0][i] + 2 * kq[1][i] + 2 * kq[2][i] + kq[3][i])
    st.qd[i] = v0[i] + (dt / 6) * (kv[0][i] + 2 * kv[1][i] + 2 * kv[2][i] + kv[3][i])
  }
  return first
}

/** Total kinetic energy of the machine, split per body. */
export function kineticEnergies(
  model: MachineModel,
  q: Float64Array,
  qd: Float64Array,
): { beam: number; cw: number; slung: number } {
  const out = { beam: 0, cw: 0, slung: 0 }
  const keys: Array<keyof typeof out> = ['beam', 'cw', 'slung']
  for (let b = 0; b < model.bodies.length; b++) {
    const body = model.bodies[b]
    const v = evalPointVel(body, q, qd)
    let omega = 0
    for (let i = 0; i < model.nq; i++) omega += body.dAng[i] * qd[i]
    out[keys[b]] = 0.5 * body.m * (v.x * v.x + v.y * v.y) + 0.5 * body.I * omega * omega
  }
  return out
}

/** Gravitational potential energy of the machine at pose q. */
export function potentialEnergy(
  model: MachineModel,
  gravity: number,
  q: ArrayLike<number>,
): number {
  let u = 0
  for (const body of model.bodies) u += body.m * gravity * evalPoint(body, q).y
  return u
}
