import { cockToGround } from './simulate.ts'
import type { TrebuchetParams } from './types.ts'

export interface Preset {
  id: string
  name: string
  era: 'historical' | 'modern' | 'reference'
  blurb: string
  params: TrebuchetParams
}

const BASE: TrebuchetParams = {
  type: 'hinged',
  armLong: 2.4,
  armShort: 0.6,
  armMass: 6,
  armUniform: true,
  armCgOffset: 0.9,
  armInertiaPivot: 12,
  cwMass: 60,
  cwHanger: 0.5,
  cwSize: 0.45,
  cwInertiaAuto: true,
  cwInertiaCg: 2,
  slingLength: 2,
  slingMass: 0.15,
  releaseMode: 'pin',
  releaseAngle: 45,
  pivotHeight: 2,
  troughHeight: 0.05,
  initialBeamAngle: 35,
  projectileMass: 0.6,
  projectileDiameter: 0.12,
  projectileCd: 0.5,
  gravity: 9.81,
  airDensity: 1.225,
  windSpeed: 0,
  targetDrop: 0,
  enableDrag: true,
  pivotFriction: 0.04,
  pivotRadius: 0.02,
  hingeFriction: 0.08,
  hingeRadius: 0.015,
  troughFriction: 0.3,
}

/** Apply overrides and re-cock the beam so the tip rests on the trough. */
function make(overrides: Partial<TrebuchetParams>): TrebuchetParams {
  const p = { ...BASE, ...overrides }
  return { ...p, initialBeamAngle: overrides.initialBeamAngle ?? cockToGround(p) }
}

export const PRESETS: Preset[] = [
  {
    id: 'backyard',
    name: 'Backyard Classic',
    era: 'modern',
    blurb:
      'A weekend-build hinged machine: 4:1 steel beam, 60 kg of paving slabs, throwing a baseball-sized stone. The 100:1 weight ratio is the classic starting point.',
    params: make({ releaseAngle: 29 }),
  },
  {
    id: 'simple-fixed',
    name: 'Bolted Weight',
    era: 'modern',
    blurb:
      'The same machine with the weight bolted rigidly to the short arm. Half the parts, and a useful demonstration of what the hinge is worth — the box gets dragged through an arc instead of falling.',
    params: make({ type: 'fixed', cwHanger: 0.45, releaseAngle: 34 }),
  },
  {
    id: 'floating-arm',
    name: 'Floating Arm',
    era: 'modern',
    blurb:
      'Competition design. The axle rolls on horizontal rails while the weight falls dead straight down a channel through twice the short-arm length. The most efficient of the three layouts.',
    params: make({
      type: 'floating',
      armLong: 3,
      armShort: 0.75,
      armMass: 8,
      cwMass: 180,
      cwHanger: 0.3,
      cwSize: 0.5,
      slingLength: 2.7,
      slingMass: 0.2,
      pivotHeight: 2.6,
      troughHeight: 0.05,
      projectileMass: 1,
      projectileDiameter: 0.15,
      projectileCd: 0.47,
      releaseAngle: 35,
    }),
  },
  {
    id: 'punkin',
    name: 'Pumpkin Hurler',
    era: 'modern',
    blurb:
      'Competition-class steel trebuchet built for one job: putting a 4 kg pumpkin past 300 m. Enormous weight ratio, very long sling, and structural loads to match.',
    params: make({
      armLong: 9,
      armShort: 1.8,
      armMass: 300,
      cwMass: 4500,
      cwHanger: 1.2,
      cwSize: 1.6,
      slingLength: 9,
      slingMass: 3,
      pivotHeight: 8,
      troughHeight: 0.15,
      projectileMass: 4,
      projectileDiameter: 0.22,
      projectileCd: 0.55,
      releaseAngle: 50,
      pivotFriction: 0.02,
      pivotRadius: 0.05,
      hingeFriction: 0.03,
      hingeRadius: 0.04,
    }),
  },
  {
    id: 'man-thrower',
    name: 'Man Thrower (8647 Edition)',
    era: 'modern',
    blurb:
      'A 48 m steel beam on a 31 m frame, throwing a six-foot granite boulder — 9 tonnes — half a mile. Sized against its own structure: the beam mass is what a girder carrying 43 MN·m actually weighs, and the 359 t ballast sits at the knee of the frontier, where more range starts costing frame far faster than it earns metres.',
    params: make({
      // 3.75:1 after Siano, which the sweep confirms is still the efficiency
      // optimum at 75x the scale that rule was written for.
      armLong: 38,
      armShort: 10.13,
      // Not a free number. A welded box girder at L/16 depth and 200 MPa,
      // iterated against the moment it generates until the two agree.
      armMass: 42000,
      // 40:1, not the classic 100:1. For a shot this heavy the efficiency peak
      // has moved to ~80:1 and is flat, so 40:1 gives up 2 points and halves
      // the axle load.
      cwMass: 359000,
      // Long on purpose: a hanger this deep lets the ballast fall nearly
      // straight, which is worth both efficiency and 100 t off the axle.
      cwHanger: 16,
      cwSize: 5.31,
      // 0.86x the long arm. "Sling equals long arm" costs 500 ft here.
      slingLength: 32.7,
      slingMass: 144,
      // Set by the ballast clearing the ground at the bottom of its swing, not
      // by the arm: 10.13 short arm + 16 hanger + half the box + 2.5 m.
      pivotHeight: 31.25,
      // The boulder simply resting on the ground, so its centre is one radius up.
      troughHeight: 0.91,
      projectileMass: 8978,
      projectileDiameter: 1.829,
      projectileCd: 0.55,
      releaseAngle: 20.5,
      pivotFriction: 0.16,
      pivotRadius: 0.45,
      hingeFriction: 0.16,
      hingeRadius: 0.3,
      troughFriction: 0.6,
    }),
  },
  {
    id: 'siege',
    name: 'Siege Trebuchet, c. 1250',
    era: 'historical',
    blurb:
      'A working mid-sized siege engine: 9 m oak beam, five tonnes of earth and stone in the box, throwing 45 kg shot at a curtain wall from just outside crossbow range.',
    params: make({
      // Oak beam ~8.75 m overall, tapering from roughly 450 mm square at the
      // axle: about 1.1 m3 of green oak at 750 kg/m3, plus iron banding.
      armLong: 7,
      armShort: 1.75,
      armMass: 900,
      cwMass: 5000,
      cwHanger: 1.4,
      cwSize: 1.5,
      slingLength: 6.3,
      slingMass: 8,
      pivotHeight: 6,
      troughHeight: 0.1,
      projectileMass: 45,
      projectileDiameter: 0.32,
      projectileCd: 0.55,
      releaseAngle: 37,
      // Greased timber axle turning in a timber bearing. Nothing like a modern
      // roller, and the reason medieval engineers cared so much about the axle.
      pivotFriction: 0.25,
      pivotRadius: 0.12,
      hingeFriction: 0.25,
      hingeRadius: 0.08,
      troughFriction: 0.6,
    }),
  },
  {
    id: 'warwolf',
    name: 'Warwolf, Stirling 1304',
    era: 'historical',
    blurb:
      "Edward I's monster, built on site over three months for the siege of Stirling Castle. No drawings or dimensions survive, so these figures follow the larger modern reconstructions — roughly 12 tonnes of counterweight throwing 120 kg stones.",
    params: make({
      // ~13 m beam of green oak, roughly 600 mm square at the axle tapering to
      // 250 mm: about 2.3 m3 at 750 kg/m3 before the ironwork.
      armLong: 10.5,
      armShort: 2.6,
      armMass: 2200,
      cwMass: 12000,
      cwHanger: 2,
      cwSize: 2,
      slingLength: 9.5,
      slingMass: 20,
      pivotHeight: 9,
      troughHeight: 0.15,
      projectileMass: 120,
      projectileDiameter: 0.45,
      projectileCd: 0.55,
      releaseAngle: 34,
      pivotFriction: 0.25,
      pivotRadius: 0.18,
      hingeFriction: 0.25,
      hingeRadius: 0.11,
      troughFriction: 0.6,
    }),
  },
  {
    id: 'lab',
    name: 'Laboratory Reference',
    era: 'reference',
    blurb:
      'The instrumented machine from Horsdal et al. (arXiv:2502.19442), whose rotation-sensor data and ranges this simulator is validated against. Drag and friction off to match their published ab initio figures.',
    params: {
      ...BASE,
      type: 'hinged',
      armLong: 0.975,
      armShort: 0.25,
      armMass: 4.86,
      armUniform: false,
      armCgOffset: 0.465,
      armInertiaPivot: 1.85,
      cwMass: 53.9,
      cwHanger: 0.515,
      // 53.9 kg of steel discs; drawn as the cube that mass of steel fills
      // (7850 kg/m³ → 0.19 m). Inertia comes from the measured cwInertiaCg, so
      // this only sets the drawing and the ground-clearance check.
      cwSize: 0.19,
      cwInertiaAuto: false,
      cwInertiaCg: 0,
      slingLength: 0.87,
      slingMass: 0,
      pivotHeight: 0.831,
      troughHeight: 0,
      initialBeamAngle: (0.55 * 180) / Math.PI,
      projectileMass: 0.717,
      projectileDiameter: 0.08,
      projectileCd: 0.47,
      releaseMode: 'optimal',
      releaseAngle: 45,
      enableDrag: false,
      pivotFriction: 0,
      pivotRadius: 0,
      hingeFriction: 0,
      hingeRadius: 0,
      troughFriction: 0,
    },
  },
]

export const DEFAULT_PARAMS = PRESETS[0].params

export function presetById(id: string): Preset | undefined {
  return PRESETS.find((x) => x.id === id)
}
