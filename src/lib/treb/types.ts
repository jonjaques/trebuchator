/**
 * Parameter model for the trebuchet simulator. Everything here is SI —
 * metres, kilograms, seconds, radians-on-the-inside/degrees-on-the-outside.
 * Unit conversion happens at the UI boundary only (see units.ts), because a
 * mixed-unit core is how you end up throwing a 300 kg stone 4 furlongs.
 */

import type { ShotTimeline } from './timeline.ts'

/**
 * The three counterweight topologies we solve. They differ *only* in
 * kinematics — the same Lagrangian assembler runs all of them.
 *
 * - `hinged`   Classic medieval counterweight trebuchet. The weight box hangs
 *              from the short arm on its own axle and swings as a second
 *              pendulum. 3 DOF (beam, hanger, sling).
 * - `fixed`    Counterweight rigidly bolted to the short arm. Simpler to
 *              build, noticeably less efficient — the weight is dragged
 *              sideways through an arc instead of falling. 2 DOF.
 * - `floating` Floating-arm trebuchet. The main axle rolls on a horizontal
 *              track while the weight is confined to a vertical drop channel,
 *              so the weight falls dead straight through 2x the short-arm
 *              length. Modern competition design. 2 DOF.
 */
export type MachineType = 'hinged' | 'fixed' | 'floating'

/**
 * How the sling lets go.
 *
 * - `pin`     Physical release: the finger/spigot on the beam tip is bent to a
 *             set angle and the loose sling loop slips off when the sling
 *             lines up with it. This is what you actually build and tune.
 * - `optimal` The simulator releases at whichever instant maximises range.
 *             Not buildable, but it tells you the ceiling your pin angle is
 *             chasing — and the pin angle it corresponds to.
 */
export type ReleaseMode = 'pin' | 'optimal'

export interface TrebuchetParams {
  type: MachineType

  // ---- Beam ---------------------------------------------------------------
  /** L1 — pivot to sling attachment (the throwing end). */
  armLong: number
  /** L2 — pivot to counterweight attachment. */
  armShort: number
  armMass: number
  /**
   * When true the beam is treated as a uniform prism and its CG offset and
   * inertia are derived from L1/L2/mass. Real beams are tapered and carry
   * hardware at the tip, so the manual values exist for measured machines.
   */
  armUniform: boolean
  /** Beam CG measured from the pivot, positive toward the long arm. */
  armCgOffset: number
  /**
   * Beam rotational inertia **about the pivot**, not about its own CG. That is
   * the number a builder can actually measure (hang the beam from its axle,
   * time the small-amplitude swing); the solver converts internally.
   */
  armInertiaPivot: number

  // ---- Counterweight ------------------------------------------------------
  cwMass: number
  /** L3 — short-arm end to the counterweight's CG. Its hanger/strap length. */
  cwHanger: number
  /** Side length of the weight box. Drawn to scale and used for ground clearance. */
  cwSize: number
  /** Derive the box's own rotational inertia from mass and size. */
  cwInertiaAuto: boolean
  /** Counterweight inertia about its own CG (only used when `hinged`). */
  cwInertiaCg: number

  // ---- Sling and release --------------------------------------------------
  /** L4 — beam tip to the centre of the pouch. */
  slingLength: number
  /** Combined sling + pouch mass. Rides with the shot but does not fly with it. */
  slingMass: number
  releaseMode: ReleaseMode
  /**
   * Pin (spigot) angle in degrees: the angle between the beam's long arm and
   * the sling at the instant the loop slips off. Only used in `pin` mode.
   */
  releaseAngle: number

  // ---- Frame and starting pose -------------------------------------------
  /** H — ground to the main axle. */
  pivotHeight: number
  /** Height of the projectile trough/rail above the ground. 0 = bare earth. */
  troughHeight: number
  /**
   * Beam angle at rest, degrees from vertical, where 0 means the long arm
   * points straight *down*. The machine fires as this angle grows toward 180.
   * `cockToGround()` computes the value that rests the tip on the trough.
   */
  initialBeamAngle: number

  // ---- Projectile ---------------------------------------------------------
  projectileMass: number
  projectileDiameter: number
  /** Drag coefficient. ~0.47 sphere, ~0.6 rough stone, ~0.8 a pumpkin.  */
  projectileCd: number

  // ---- Environment --------------------------------------------------------
  gravity: number
  airDensity: number
  /** Positive = tailwind (blowing the way you are shooting). */
  windSpeed: number
  /** Drop from the machine's ground plane to the target's, positive downhill. */
  targetDrop: number
  /** Master switch for aerodynamics — off reproduces textbook "vacuum range". */
  enableDrag: boolean

  // ---- Losses -------------------------------------------------------------
  /** Coulomb friction coefficient at the main axle. */
  pivotFriction: number
  /** Main axle radius — friction torque scales with it. */
  pivotRadius: number
  /** Coulomb friction coefficient at the counterweight hinge. */
  hingeFriction: number
  hingeRadius: number
  /** Sliding friction between the projectile and its trough before liftoff. */
  troughFriction: number
}

export interface Vec2 {
  x: number
  y: number
}

/** Named points on the machine, for drawing and for load reporting. */
export interface MachinePose {
  pivot: Vec2
  /** Same as `pivot` except on a floating-arm machine, where the axle rolls. */
  axle: Vec2
  tip: Vec2
  shortEnd: Vec2
  cw: Vec2
  projectile: Vec2
  /** Beam angle from vertical, radians, 0 = long arm straight down. */
  theta: number
  /** Counterweight hanger angle from vertical, radians. */
  psi: number
  /** Sling angle, radians. */
  phi: number
}

export interface SimFrame {
  t: number
  pose: MachinePose
  /** 'ground' while the shot is still being dragged along the trough. */
  phase: 'ground' | 'swing'
  /** Angle between the long arm and the sling, degrees. Drives pin release. */
  gamma: number
  /** Tension in the sling, newtons. Negative means the sling has gone slack. */
  slingTension: number
  /** Trough normal force, newtons. Reaches zero at liftoff. */
  normalForce: number
  /** Reaction at the main axle (rail load on a floating arm), newtons. */
  axleLoad: number
  /** Bending moment the beam carries at the pivot, newton-metres. */
  beamMoment: number
  projectileSpeed: number
  /** Energy that has gone into the shot so far, joules. */
  keProjectile: number
}

export interface EnergyBudget {
  /** Potential energy the machine gives up over a full stroke, joules. */
  available: number
  /** Kinetic energy carried off by the projectile at release. */
  projectile: number
  /** Left spinning in the beam at release — dead weight, and it slams the frame. */
  beam: number
  /** Still swinging in the counterweight at release. */
  counterweight: number
  /** Carried off by the sling and pouch rather than the stone. */
  sling: number
  /** Spent simply hoisting the shot from the trough to release height. */
  lift: number
  /** Potential energy not yet cashed in when the sling let go. */
  unspent: number
  /** Burned in the axle and hinge bearings. */
  friction: number
  /** Burned pushing the projectile through air during the swing. */
  drag: number
  /** available - (everything above). Should be ~0; it is the solver's receipt. */
  residual: number
}

export interface PeakLoads {
  slingTension: number
  slingTensionAt: number
  axleLoad: number
  axleLoadAt: number
  beamMoment: number
  beamMomentAt: number
  cwAcceleration: number
}

export interface ReleaseState {
  t: number
  x: number
  y: number
  vx: number
  vy: number
  speed: number
  /** Launch angle above horizontal, degrees. */
  angle: number
  /** Sling-to-arm angle at release, degrees — i.e. the pin angle to build. */
  gamma: number
  /** Beam angle from vertical at release, degrees. */
  beamAngle: number
}

export interface TrajectoryPoint {
  t: number
  x: number
  y: number
  vx: number
  vy: number
}

interface ShotOutcome {
  warnings: string[]
  errors: string[]
  frames: SimFrame[]
  trajectory: TrajectoryPoint[]
  /** Ground distance from the machine datum to the impact point, metres. */
  range: number
  /** Distance travelled after release only — the "carry". */
  carry: number
  apex: number
  flightTime: number
  impactSpeed: number
  impactAngle: number
  /** Kinetic energy delivered on target, joules. */
  impactEnergy: number
  /** Projectile KE at release / energy available. The number that matters. */
  efficiency: number
  /** Range you would get in vacuum, for comparison against the drag-limited one. */
  vacuumRange: number
  energy: EnergyBudget
  peaks: PeakLoads
}

/**
 * A shot that fired, or the reasons it could not.
 *
 * Discriminated on `ok` so the "release is present iff the shot succeeded"
 * invariant is carried by the type rather than by prose and a `!` at every call
 * site. Failed shots keep the zeroed measurements so a panel can render one
 * without branching on every field, but they have no release and no timeline —
 * there is no instant at which nothing happened.
 */
export type ShotResult =
  | (ShotOutcome & { ok: true; release: ReleaseState; timeline: ShotTimeline })
  | (ShotOutcome & { ok: false; release: null; timeline: null })

/** A shot that fired. Narrow with `result.ok` rather than reaching for this. */
export type FiredShot = Extract<ShotResult, { ok: true }>
