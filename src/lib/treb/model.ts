import type { MachinePose, TrebuchetParams, Vec2 } from './types.ts'

/**
 * Kinematics as a sum of trigonometric link terms.
 *
 * Every point on any of the three machines can be written as
 *
 *     p(q) = p0 + SUM_t ( cx_t * sin(s_t*q_k + w_t),  cy_t * cos(s_t*q_k + w_t) )
 *
 * where each term depends on exactly one generalised coordinate. That is not a
 * coincidence — it falls out of the fact that a trebuchet is a chain of rigid
 * links, each hinged about one angle.
 *
 * Writing kinematics this way instead of hand-deriving equations of motion per
 * machine buys two things. The Jacobian and Hessian come out analytically (no
 * finite differences, no step-size tuning, no drift in the energy audit), and
 * the *cross* second derivatives vanish identically — d2p/dqi dqj is zero
 * unless i == j — which collapses the Coriolis assembly from O(n^3) to
 * something trivial. One solver then covers hinged, fixed and floating-arm
 * machines; adding a fourth topology means adding a term list, not a
 * derivation.
 *
 * Angle convention: u(a) = (sin a, cos a), so `a` is measured from straight up,
 * increasing toward +x (the direction we shoot). The beam angle theta is 0 with
 * the long arm pointing straight down, and grows to pi as the machine fires.
 */
export interface Term {
  /** Index of the generalised coordinate this term hinges on. */
  k: number
  /** Sign on the coordinate: +1 or -1. */
  s: number
  /** Phase offset, radians. */
  w: number
  cx: number
  cy: number
}

export interface PointDef {
  x0: number
  y0: number
  terms: Term[]
}

export interface BodyDef extends PointDef {
  name: string
  m: number
  /** Rotational inertia about the body's own centre of gravity. */
  I: number
  /** d(orientation)/dq — constant, because every link angle is affine in q. */
  dAng: number[]
}

export interface MachineModel {
  type: TrebuchetParams['type']
  nq: number
  /** Coordinate slots. -1 means the machine does not have that freedom. */
  iTheta: number
  iPsi: number
  iPhi: number
  bodies: BodyDef[]
  /** Index into `bodies` of the projectile+pouch lump. */
  iProjectile: number
  points: {
    axle: PointDef
    tip: PointDef
    shortEnd: PointDef
    cw: PointDef
    projectile: PointDef
  }
  /** Total mass riding on the sling during the swing (shot + pouch). */
  slungMass: number
  /** Height of the projectile trough above the ground datum. */
  troughY: number
  /** Ground-plane height of the main axle (constant on every machine here). */
  axleY: number
}

const TAU_4 = Math.PI / 2

function pt(x0: number, y0: number, terms: Term[]): PointDef {
  return { x0, y0, terms }
}

/** Concatenate a point definition with extra terms — link chaining. */
function extend(base: PointDef, terms: Term[]): PointDef {
  return { x0: base.x0, y0: base.y0, terms: [...base.terms, ...terms] }
}

/** Uniform-prism beam properties, used when `armUniform` is set. */
export function uniformBeam(p: TrebuchetParams) {
  const len = p.armLong + p.armShort
  const cg = (p.armLong - p.armShort) / 2
  // I about the pivot = I_cg + m d^2, with I_cg = m L^2 / 12.
  const inertiaPivot = (p.armMass * (len * len + 3 * (2 * cg) * (2 * cg))) / 12
  return { cg, inertiaPivot }
}

export function beamProperties(p: TrebuchetParams) {
  if (p.armUniform) {
    const u = uniformBeam(p)
    return { cg: u.cg, inertiaPivot: u.inertiaPivot }
  }
  return { cg: p.armCgOffset, inertiaPivot: p.armInertiaPivot }
}

export function cwInertia(p: TrebuchetParams) {
  // A filled box of side `cwSize` about its own centre: m(a^2+b^2)/12 = m a^2/6.
  return p.cwInertiaAuto ? (p.cwMass * p.cwSize * p.cwSize) / 6 : p.cwInertiaCg
}

/**
 * Build the kinematic model for a parameter set.
 *
 * Coordinate ordering is machine-dependent, which is why nothing outside this
 * file should index `q` by a literal — use iTheta / iPsi / iPhi.
 */
export function buildModel(p: TrebuchetParams): MachineModel {
  const { cg, inertiaPivot } = beamProperties(p)
  const armIcg = Math.max(0, inertiaPivot - p.armMass * cg * cg)
  const slungMass = p.projectileMass + p.slingMass
  const troughY = p.troughHeight
  const axleY = p.pivotHeight

  const iTheta = 0
  const iPsi = p.type === 'hinged' ? 1 : -1
  const iPhi = p.type === 'hinged' ? 2 : 1
  const nq = p.type === 'hinged' ? 3 : 2

  // We shoot toward +x, which fixes every sign below. The long arm hangs down
  // and *behind* the pivot at rest (-x), sweeps up over the top, and the shot
  // leaves as it passes vertical — so the beam turns clockwise on screen and
  // the short arm, carrying the weight, starts high on the target side.
  // Getting this mirrored is silent and expensive: the machine still throws,
  // just backwards, and every range comes out negative.
  const longArm = (len: number): Term => ({ k: iTheta, s: -1, w: Math.PI, cx: -len, cy: len })
  const shortArm = (len: number): Term => ({ k: iTheta, s: -1, w: 0, cx: -len, cy: len })
  // The sling trails off the tip, ahead of it at rest and whipping round past
  // vertical by release.
  const sling = (len: number): Term => ({ k: iPhi, s: -1, w: -TAU_4, cx: -len, cy: len })

  let axle: PointDef
  let cwPoint: PointDef
  let cwDAng: number[]
  let cwI: number

  if (p.type === 'floating') {
    // Floating arm: the axle rolls along a horizontal rail while the weight is
    // trapped in a vertical drop channel at x = 0. Pinning the short-arm end to
    // that channel forces axle.x = L2*sin(theta), which is the whole trick —
    // the weight then falls dead straight through 2*L2 instead of arcing, and
    // the arm "floats" forward under it.
    axle = pt(0, axleY, [{ k: iTheta, s: 1, w: 0, cx: -p.armShort, cy: 0 }])
    const shortEnd = extend(axle, [shortArm(p.armShort)])
    // Channel-guided weight: no rotation, so no rotational kinetic energy.
    cwPoint = { x0: shortEnd.x0, y0: shortEnd.y0 - p.cwHanger, terms: shortEnd.terms }
    cwDAng = new Array(nq).fill(0)
    cwI = 0
  } else if (p.type === 'fixed') {
    // Rigid weight: the hanger is just more short arm, and the box turns with
    // the beam, so its own inertia loads the beam directly.
    axle = pt(0, axleY, [])
    cwPoint = extend(axle, [shortArm(p.armShort + p.cwHanger)])
    cwDAng = new Array(nq).fill(0)
    cwDAng[iTheta] = 1
    cwI = cwInertia(p)
  } else {
    axle = pt(0, axleY, [])
    const shortEnd = extend(axle, [shortArm(p.armShort)])
    // Hanging box: swings on its own axle about psi, measured from vertical.
    cwPoint = extend(shortEnd, [{ k: iPsi, s: -1, w: Math.PI, cx: -p.cwHanger, cy: p.cwHanger }])
    cwDAng = new Array(nq).fill(0)
    cwDAng[iPsi] = 1
    cwI = cwInertia(p)
  }

  const shortEnd = extend(axle, [shortArm(p.armShort)])
  const tip = extend(axle, [longArm(p.armLong)])
  const beamCg = extend(axle, [longArm(cg)])
  const projectile = extend(tip, [sling(p.slingLength)])

  const beamDAng = new Array(nq).fill(0)
  beamDAng[iTheta] = 1

  const bodies: BodyDef[] = [
    { name: 'beam', m: p.armMass, I: armIcg, dAng: beamDAng, ...beamCg },
    { name: 'counterweight', m: p.cwMass, I: cwI, dAng: cwDAng, ...cwPoint },
    { name: 'projectile', m: slungMass, I: 0, dAng: new Array(nq).fill(0), ...projectile },
  ]

  return {
    type: p.type,
    nq,
    iTheta,
    iPsi,
    iPhi,
    bodies,
    iProjectile: 2,
    points: { axle, tip, shortEnd, cw: cwPoint, projectile },
    slungMass,
    troughY,
    axleY,
  }
}

// --- Point evaluation --------------------------------------------------------

export function evalPoint(d: PointDef, q: ArrayLike<number>): Vec2 {
  let x = d.x0
  let y = d.y0
  for (const t of d.terms) {
    const a = t.s * q[t.k] + t.w
    x += t.cx * Math.sin(a)
    y += t.cy * Math.cos(a)
  }
  return { x, y }
}

/** Velocity of a point: J(q) * qd. */
export function evalPointVel(d: PointDef, q: ArrayLike<number>, qd: ArrayLike<number>): Vec2 {
  let x = 0
  let y = 0
  for (const t of d.terms) {
    const a = t.s * q[t.k] + t.w
    x += t.s * t.cx * Math.cos(a) * qd[t.k]
    y -= t.s * t.cy * Math.sin(a) * qd[t.k]
  }
  return { x, y }
}

/**
 * Acceleration of a point: J*qdd + qd^T H qd. The Hessian is diagonal (each
 * term touches one coordinate), so the quadratic part is a plain sum of
 * squares rather than a double loop.
 */
export function evalPointAcc(
  d: PointDef,
  q: ArrayLike<number>,
  qd: ArrayLike<number>,
  qdd: ArrayLike<number>,
): Vec2 {
  let x = 0
  let y = 0
  for (const t of d.terms) {
    const a = t.s * q[t.k] + t.w
    const sa = Math.sin(a)
    const ca = Math.cos(a)
    const v = qd[t.k]
    x += t.s * t.cx * ca * qdd[t.k] - t.cx * sa * v * v
    y += -t.s * t.cy * sa * qdd[t.k] - t.cy * ca * v * v
  }
  return { x, y }
}

/** Fill Jx/Jy with the point's Jacobian rows. Hot path — writes in place. */
export function pointJacobian(
  d: PointDef,
  q: ArrayLike<number>,
  Jx: Float64Array,
  Jy: Float64Array,
): void {
  Jx.fill(0)
  Jy.fill(0)
  for (const t of d.terms) {
    const a = t.s * q[t.k] + t.w
    Jx[t.k] += t.s * t.cx * Math.cos(a)
    Jy[t.k] -= t.s * t.cy * Math.sin(a)
  }
}

/** Diagonal of the point's Hessian; off-diagonal entries are identically zero. */
export function pointHessianDiag(
  d: PointDef,
  q: ArrayLike<number>,
  Hx: Float64Array,
  Hy: Float64Array,
): void {
  Hx.fill(0)
  Hy.fill(0)
  for (const t of d.terms) {
    const a = t.s * q[t.k] + t.w
    Hx[t.k] -= t.cx * Math.sin(a)
    Hy[t.k] -= t.cy * Math.cos(a)
  }
}

// --- Pose --------------------------------------------------------------------

export function poseOf(model: MachineModel, q: ArrayLike<number>): MachinePose {
  const axle = evalPoint(model.points.axle, q)
  // `psi` is reported as the weight box's tilt from vertical, which is what the
  // renderer needs: a hanging box swings on its own hinge, a bolted-on box is
  // carried round with the beam, and a channel-guided box never tips at all.
  let psi: number
  if (model.iPsi >= 0) psi = q[model.iPsi]
  else if (model.type === 'fixed') psi = -q[model.iTheta]
  else psi = 0
  return {
    pivot: axle,
    axle,
    tip: evalPoint(model.points.tip, q),
    shortEnd: evalPoint(model.points.shortEnd, q),
    cw: evalPoint(model.points.cw, q),
    projectile: evalPoint(model.points.projectile, q),
    theta: q[model.iTheta],
    psi,
    phi: q[model.iPhi],
  }
}

/**
 * Angle between the long arm (pivot to tip) and the sling (tip to pouch), in
 * degrees. This is the quantity a release pin actually measures: the loop
 * slides off the spigot when the sling swings round to line up with it. It
 * starts obtuse — sling trailing well behind the arm — and closes through the
 * throw, so pin release is a downward threshold crossing.
 */
export function slingArmAngle(pose: MachinePose): number {
  const ax = pose.tip.x - pose.axle.x
  const ay = pose.tip.y - pose.axle.y
  const sx = pose.projectile.x - pose.tip.x
  const sy = pose.projectile.y - pose.tip.y
  const na = Math.hypot(ax, ay)
  const ns = Math.hypot(sx, sy)
  if (na < 1e-12 || ns < 1e-12) return 0
  const c = Math.min(1, Math.max(-1, (ax * sx + ay * sy) / (na * ns)))
  return (Math.acos(c) * 180) / Math.PI
}
