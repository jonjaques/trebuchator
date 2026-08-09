import type { MachinePose, ShotResult, TrebuchetParams } from '@/lib/treb/types.ts'
import {
  frameIndexAt,
  isDone,
  isFlying,
  sampleTrajectory,
  strokeT,
} from '@/lib/treb/timeline.ts'
import { fromDisplay, toDisplay, unitSymbol, num, type UnitSystem } from '@/lib/format.ts'
import { projector, type Camera, type Projector } from './camera.ts'
import {
  delta,
  dimension,
  gridStep,
  hatchLines,
  mono,
  protractor,
  sans,
  seg,
  type Instruction,
  type MeasureText,
  type Point,
  type Stroke,
} from './draft.ts'

/**
 * The drawing, as data.
 *
 * Everything the simulator has to say about a shot is said on one sheet, in the
 * vocabulary of a setting-out drawing: hatched ground, a hairline grid, timber
 * drawn to scale, and measurements carried on proper dimension lines with
 * witness lines, arrowheads and a gap for the figure. The range is not a number
 * in a card — it is the dimension across the bottom of the sheet, which is both
 * the most legible way to show "how far" and the thing that keeps this from
 * looking like every other simulator.
 *
 * This module decides *what* is drawn and where, and it is the only one of the
 * three that knows what a trebuchet is. `draft.ts` holds the drafting
 * vocabulary it composes with — instructions, type, dimensions, protractors —
 * and `paint.ts` walks the result onto a canvas. Instructions are plain objects
 * in screen pixels, so a test asserts on the drawing rather than on the brush.
 */

export interface Palette {
  sheet: string
  ink: string
  ink2: string
  ink3: string
  rule: string
  quench: string
  verdigris: string
  oak: string
  iron: string
}

export interface Ghost {
  trajectory: { x: number; y: number }[]
  label: string
}

export interface SheetInput {
  w: number
  h: number
  cam: Camera
  palette: Palette
  params: TrebuchetParams
  result: ShotResult
  /** Playback cursor, seconds from the start of the stroke. */
  t: number
  showDimensions: boolean
  showAngles: boolean
  showGrid: boolean
  ghosts: Ghost[]
  /** Live what-if trajectory from hovering the sweep chart, in the accent. */
  preview?: Ghost | null
  /**
   * The dimension a control is currently pointing at. Drawn even when the
   * annotation layer is off, which is the point: it answers "which one is
   * that?" for the control under the pointer without turning on five.
   */
  highlight?: DimensionKey | null
  units: UnitSystem
}

/**
 * The inset a camera must leave around the machine, in screen pixels.
 *
 * It has to clear the sheet's own furniture, all of which is measured from the
 * drawing rather than from the viewport: the range dimension sits 40 px below
 * the ground line, its caption another 22 below that, and the ground hatch band
 * is 12 deep. Framing used to pick this number independently of the module that
 * draws the furniture, so tightening one silently clipped the other.
 */
export const SHEET_MARGIN = 56

// --- machine -----------------------------------------------------------------

function frameParts(p: Projector, params: TrebuchetParams, pal: Palette): Instruction[] {
  const H = params.pivotHeight
  const out: Instruction[] = []
  // The frame is scenery and the beam is the figure, so the frame recedes.
  // Drawn in the same timber at reduced opacity rather than a second brown,
  // which keeps the palette closed and still separates the moving part.
  const alpha = 0.62

  if (params.type === 'floating') {
    // Rails the axle rolls on, and the channel the weight drops through. The
    // rail is drawn over the axle's whole travel so the mechanism is legible
    // even when the arm is parked at one end of it.
    const railY = p.y(H)
    const x0 = p.x(-params.armShort - 0.25)
    const x1 = p.x(0.25)
    out.push(seg(x0, railY, x1, railY, { color: pal.iron, width: 3, alpha }))
    out.push(seg(x0, railY + 5, x1, railY + 5, { color: pal.rule, width: 1, alpha }))

    const half = p.s(Math.max(params.cwSize, 0.2) / 2 + 0.05)
    const channel: Stroke = { color: pal.iron, width: 1.5, alpha, dash: [6, 4] }
    const top = p.y(H + params.armShort + 0.4)
    out.push(seg(p.x(0) - half, top, p.x(0) - half, p.y(0), channel))
    out.push(seg(p.x(0) + half, top, p.x(0) + half, p.y(0), channel))

    for (const sx of [-params.armShort - 0.2, 0.2]) {
      out.push(
        seg(p.x(sx), railY, p.x(sx), p.y(0), {
          color: pal.oak,
          width: Math.max(2, p.s(H * 0.035)),
          alpha,
        }),
      )
    }
  } else {
    // A-frame in side elevation: two raking legs to the axle plus a ground sill.
    const spread = H * 0.42
    const leg: Stroke = {
      color: pal.oak,
      width: Math.max(2.5, p.s(H * 0.045)),
      alpha,
      cap: 'round',
    }
    out.push(seg(p.x(-spread), p.y(0), p.x(0), p.y(H), leg))
    out.push(seg(p.x(spread), p.y(0), p.x(0), p.y(H), leg))
    out.push(
      seg(p.x(-spread - 0.15), p.y(0), p.x(spread + 0.15), p.y(0), {
        color: pal.oak,
        width: Math.max(2, p.s(H * 0.035)),
        alpha,
        cap: 'round',
      }),
    )
    // Cross brace, at the height the real ones sit.
    out.push(
      seg(p.x(-spread * 0.45), p.y(H * 0.55), p.x(spread * 0.45), p.y(H * 0.55), {
        color: pal.rule,
        width: Math.max(1.5, p.s(H * 0.022)),
        alpha,
        cap: 'round',
      }),
    )
  }

  // Trough. Drawn where the shot actually runs, so it reads as part of the
  // machine rather than as an arbitrary line on the ground.
  const reach = params.armLong + params.slingLength
  out.push(
    seg(p.x(-reach * 0.55), p.y(params.troughHeight), p.x(reach * 0.5), p.y(params.troughHeight), {
      color: pal.rule,
      width: 2,
      alpha,
    }),
  )
  return out
}

function beamParts(
  p: Projector,
  params: TrebuchetParams,
  pal: Palette,
  pose: MachinePose,
): Instruction[] {
  const { axle, tip, shortEnd } = pose
  const dx = tip.x - axle.x
  const dy = tip.y - axle.y
  const l = Math.hypot(dx, dy) || 1
  const nx = -dy / l
  const ny = dx / l

  const wRoot = Math.max(2.5, p.s(params.armLong * 0.028))
  const wTip = Math.max(1.5, p.s(params.armLong * 0.013))
  const wShort = Math.max(2, p.s(params.armLong * 0.024))

  const P = (wx: number, wy: number, off: number): Point => [p.x(wx) + nx * off, p.y(wy) - ny * off]

  return [
    {
      op: 'path',
      points: [
        P(shortEnd.x, shortEnd.y, wShort),
        P(axle.x, axle.y, wRoot),
        P(tip.x, tip.y, wTip),
        P(tip.x, tip.y, -wTip),
        P(axle.x, axle.y, -wRoot),
        P(shortEnd.x, shortEnd.y, -wShort),
      ],
      close: true,
      fill: { color: pal.oak },
      stroke: { color: pal.ink, width: 1, alpha: 0.5 },
    },
  ]
}

function counterweightParts(
  p: Projector,
  params: TrebuchetParams,
  pal: Palette,
  pose: MachinePose,
): Instruction[] {
  const { cw, shortEnd } = pose
  const out: Instruction[] = []
  out.push(
    seg(p.x(shortEnd.x), p.y(shortEnd.y), p.x(cw.x), p.y(cw.y), {
      color: pal.iron,
      width: Math.max(1.5, p.s(params.cwSize * 0.06)),
    }),
  )

  // The box hangs at the hanger angle, so its outline is a rotated square in
  // absolute screen coordinates rather than a canvas transform.
  const s = Math.max(8, p.s(params.cwSize))
  const cx = p.x(cw.x)
  const cy = p.y(cw.y)
  const cos = Math.cos(pose.psi)
  const sin = Math.sin(pose.psi)
  const corner = (ox: number, oy: number): Point => [cx + ox * cos - oy * sin, cy + ox * sin + oy * cos]
  const box: Point[] = [
    corner(-s / 2, -s / 2),
    corner(s / 2, -s / 2),
    corner(s / 2, s / 2),
    corner(-s / 2, s / 2),
  ]

  out.push({ op: 'path', points: box, close: true, fill: { color: pal.sheet } })
  // Hatched like a section through a filled box, because that is what it is:
  // a crate of earth and stone, not a solid block of metal.
  for (const [a, b] of hatchLines(cx - s, cy - s, cx + s, cy + s, Math.max(4, s / 7))) {
    out.push({
      op: 'path',
      points: [a, b],
      stroke: { color: pal.iron, width: 1, alpha: 0.55 },
      clip: box,
    })
  }
  out.push({ op: 'path', points: box, close: true, stroke: { color: pal.ink, width: 1.5 } })
  return out
}

function pivotParts(p: Projector, pal: Palette, pose: MachinePose): Instruction[] {
  const x = p.x(pose.axle.x)
  const y = p.y(pose.axle.y)
  const centre: Stroke = { color: pal.ink3, width: 1 }
  return [
    { op: 'circle', x, y, r: 4.5, fill: { color: pal.sheet }, stroke: { color: pal.ink, width: 1.5 } },
    // Centre mark, drafting convention.
    seg(x - 9, y, x + 9, y, centre),
    seg(x, y - 9, x, y + 9, centre),
  ]
}

function slingParts(
  p: Projector,
  pal: Palette,
  pose: MachinePose,
  radius: number,
  released: boolean,
): Instruction[] {
  const stroke: Stroke = {
    color: released ? pal.ink3 : pal.ink2,
    width: 1.5,
    alpha: released ? 0.45 : 1,
  }
  const out: Instruction[] = [
    seg(p.x(pose.tip.x), p.y(pose.tip.y), p.x(pose.projectile.x), p.y(pose.projectile.y), stroke),
  ]
  if (!released) {
    // Pouch: a shallow cradle across the back of the shot, swung round to face
    // the beam tip.
    const ang = Math.atan2(pose.tip.y - pose.projectile.y, pose.tip.x - pose.projectile.x)
    out.push({
      op: 'arc',
      x: p.x(pose.projectile.x),
      y: p.y(pose.projectile.y),
      r: radius + 2.5,
      from: Math.PI * 0.35 - ang,
      to: Math.PI * 1.65 - ang,
      stroke,
    })
  }
  return out
}

/**
 * Angle instrumentation at the joints.
 *
 * Screen space has y running down, so a world beam angle theta (measured from
 * straight down, growing as the machine fires) maps to a canvas angle of
 * simply pi/2 + theta. Every other angle here is taken from the projected
 * points directly, which is immune to the sign conventions in the model.
 */
function angleParts(
  p: Projector,
  params: TrebuchetParams,
  pal: Palette,
  pose: MachinePose,
): Instruction[] {
  const deg = (rad: number) => `${num((rad * 180) / Math.PI, 1)}°`
  const out: Instruction[] = []

  const axleS = { x: p.x(pose.axle.x), y: p.y(pose.axle.y) }
  const tipS = { x: p.x(pose.tip.x), y: p.y(pose.tip.y) }
  const projS = { x: p.x(pose.projectile.x), y: p.y(pose.projectile.y) }
  const shortS = { x: p.x(pose.shortEnd.x), y: p.y(pose.shortEnd.y) }
  const cwS = { x: p.x(pose.cw.x), y: p.y(pose.cw.y) }

  // --- beam sweep, at the main axle ---------------------------------------
  const armFrom = Math.PI / 2 + (params.initialBeamAngle * Math.PI) / 180
  const armNow = Math.PI / 2 + pose.theta
  out.push(
    ...protractor(
      axleS.x,
      axleS.y,
      Math.min(130, Math.max(24, p.s(params.armLong * 0.4))),
      armFrom,
      armNow,
      deg(pose.theta),
      pal.verdigris,
      { graduate: true, pointerAt: armNow },
    ),
  )

  // --- sling against the arm, at the beam tip ------------------------------
  // This is the pin angle as it actually happens. The dashed radial is the
  // spigot you have bent; watching the sling close on it is the whole of tuning.
  const armOut = Math.atan2(tipS.y - axleS.y, tipS.x - axleS.x)
  const slingDir = Math.atan2(projS.y - tipS.y, projS.x - tipS.x)
  const gamma = delta(armOut, slingDir)
  if (Math.abs(gamma) > 0.06) {
    const side = Math.sign(gamma)
    const pin = (params.releaseAngle * Math.PI) / 180
    out.push(
      ...protractor(
        tipS.x,
        tipS.y,
        Math.min(72, Math.max(20, p.s(params.slingLength * 0.3))),
        armOut,
        slingDir,
        deg(Math.abs(gamma)),
        pal.verdigris,
        params.releaseMode === 'pin'
          ? { ghostAt: armOut + side * pin, ghostLabel: `pin ${num(params.releaseAngle, 0)}°` }
          : {},
      ),
    )
  }

  // --- hanger, at the short-arm end ----------------------------------------
  if (params.type === 'hinged' && params.cwHanger > 0.02) {
    const down = Math.PI / 2
    const hanger = Math.atan2(cwS.y - shortS.y, cwS.x - shortS.x)
    if (Math.abs(delta(down, hanger)) > 0.09) {
      out.push(
        ...protractor(
          shortS.x,
          shortS.y,
          Math.min(56, Math.max(18, p.s(params.cwHanger * 0.55))),
          down,
          hanger,
          deg(Math.abs(delta(down, hanger))),
          pal.verdigris,
        ),
      )
    }
  }
  return out
}

/**
 * A machine dimension a control can ask the sheet to point at.
 *
 * Deliberately the parameter's own name, so a control declares what it is
 * measuring rather than mapping to a drawing-side identifier that would drift
 * from it the first time either side was renamed.
 */
export type DimensionKey = 'armLong' | 'armShort' | 'cwHanger' | 'slingLength' | 'pivotHeight'

interface DimRun {
  key: DimensionKey
  ax: number
  ay: number
  bx: number
  by: number
  off: number
  value: number
}

function dimensionParts(
  p: Projector,
  params: TrebuchetParams,
  pal: Palette,
  pose: MachinePose,
  units: UnitSystem,
  measure: MeasureText,
  opts: { showAll: boolean; highlight: DimensionKey | null },
): Instruction[] {
  const u = unitSymbol('length', units)
  const fmt = (v: number) => `${num(toDisplay(v, 'length', units), 2)}${u}`

  // Beam dimensions ride on the beam so they stay legible as it swings; the
  // pivot height is measured off the frame, where a builder would measure it.
  const runs: DimRun[] = [
    { key: 'armLong', ax: p.x(pose.axle.x), ay: p.y(pose.axle.y), bx: p.x(pose.tip.x), by: p.y(pose.tip.y), off: -20, value: params.armLong },
    { key: 'armShort', ax: p.x(pose.shortEnd.x), ay: p.y(pose.shortEnd.y), bx: p.x(pose.axle.x), by: p.y(pose.axle.y), off: -20, value: params.armShort },
    ...(params.cwHanger > 0.02
      ? [{ key: 'cwHanger' as const, ax: p.x(pose.shortEnd.x), ay: p.y(pose.shortEnd.y), bx: p.x(pose.cw.x), by: p.y(pose.cw.y), off: 28, value: params.cwHanger }]
      : []),
    { key: 'slingLength', ax: p.x(pose.tip.x), ay: p.y(pose.tip.y), bx: p.x(pose.projectile.x), by: p.y(pose.projectile.y), off: 24, value: params.slingLength },
    { key: 'pivotHeight', ax: p.x(0), ay: p.y(0), bx: p.x(0), by: p.y(params.pivotHeight), off: -Math.max(46, p.s(params.armLong * 0.55)), value: params.pivotHeight },
  ]

  // With the annotation layer off, pointing at a control brings up that one
  // dimension and nothing else — the drawing answers "which number is that?"
  // without the reader having to turn the whole layer on and find it. With the
  // layer on, the pointed-at run is set heavier and its neighbours fade, which
  // is emphasis inside the one accent that already means measurement.
  const out: Instruction[] = []
  for (const r of runs) {
    const lit = r.key === opts.highlight
    if (!lit && !opts.showAll) continue
    out.push(
      ...dimension(r.ax, r.ay, r.bx, r.by, r.off, fmt(r.value), pal.verdigris, measure, {
        fontSize: lit ? 13 : 11,
        weight: lit ? 600 : 500,
        alpha: opts.highlight && !lit ? 0.32 : 1,
      }),
    )
  }
  return out
}

// --- the sheet ---------------------------------------------------------------

export function layout(input: SheetInput, measure: MeasureText): Instruction[] {
  const { w, h, cam, palette: pal, params, result, t, units } = input
  const p = projector(cam, w, h)
  const out: Instruction[] = []

  out.push({ op: 'rect', x: 0, y: 0, w, h, fill: { color: pal.sheet } })

  const groundY = p.y(0)
  const stepDisplay = gridStep(cam.scale, toDisplay(1, 'length', units))
  const step = fromDisplay(stepDisplay, 'length', units)

  // --- grid ---------------------------------------------------------------
  if (input.showGrid) {
    for (let i = Math.floor(p.invX(0) / step); i <= Math.ceil(p.invX(w) / step); i++) {
      const gx = Math.round(p.x(i * step)) + 0.5
      out.push(seg(gx, 0, gx, h, { color: pal.rule, width: 1, alpha: i % 5 === 0 ? 0.55 : 0.25 }))
    }
    for (let i = Math.floor(p.invY(h) / step); i <= Math.ceil(p.invY(0) / step); i++) {
      const gy = Math.round(p.y(i * step)) + 0.5
      out.push(seg(0, gy, w, gy, { color: pal.rule, width: 1, alpha: i % 5 === 0 ? 0.55 : 0.25 }))
    }
  }

  // --- ground -------------------------------------------------------------
  const band = 12
  out.push(seg(0, groundY, w, groundY, { color: pal.ink2, width: 1.5 }))
  const bandClip: Point[] = [
    [0, groundY],
    [w, groundY],
    [w, groundY + band],
    [0, groundY + band],
  ]
  for (const [a, b] of hatchLines(0, groundY, w, groundY + band, 9)) {
    out.push({ op: 'path', points: [a, b], stroke: { color: pal.ink3, width: 1, alpha: 0.5 }, clip: bandClip })
  }

  // Downrange ticks along the ground.
  const u = unitSymbol('length', units)
  for (let i = Math.floor(p.invX(0) / step); i <= Math.ceil(p.invX(w) / step); i++) {
    if (i === 0) continue
    const gx = p.x(i * step)
    out.push(seg(gx, groundY, gx, groundY + 5, { color: pal.ink3, width: 1 }))
    // Every tick gets its figure: `gridStep` never spaces ticks closer than
    // 90 px, so they cannot crowd. (A thinning rule used to sit here, keyed on
    // a spacing below 60 px that the grid can never produce.)
    out.push({
      op: 'text',
      x: gx,
      y: groundY + 16,
      // Lettered from the display-unit step directly, so the figures are the
      // round numbers the step was chosen to produce.
      text: `${num(i * stepDisplay, 0)}${u}`,
      font: mono(10),
      fill: { color: pal.ink3 },
      align: 'center',
      baseline: 'top',
    })
  }

  // --- ghosts -------------------------------------------------------------
  for (const ghost of input.ghosts) {
    if (ghost.trajectory.length < 2) continue
    out.push({
      op: 'path',
      points: ghost.trajectory.map((pt): Point => [p.x(pt.x), p.y(pt.y)]),
      stroke: { color: pal.ink3, width: 1, alpha: 0.4, dash: [3, 4] },
    })
    // Lettered at the apex — with several ghosts on the sheet the dashed
    // curves are otherwise indistinguishable, and the apex is the one point
    // where neighbouring trajectories are furthest apart.
    let apex = ghost.trajectory[0]
    for (const pt of ghost.trajectory) if (pt.y > apex.y) apex = pt
    out.push({
      op: 'text',
      x: p.x(apex.x),
      y: p.y(apex.y) - 6,
      text: ghost.label,
      font: sans(10, 400),
      fill: { color: pal.ink3, alpha: 0.85 },
      align: 'center',
    })
  }

  // --- what-if preview ------------------------------------------------------
  // The trajectory the hovered point on the sweep chart would fly. In the
  // projectile's own accent — it *is* a projectile path, just a conditional one
  // — and dashed harder than the saved ghosts so live speculation cannot be
  // mistaken for a shot that was kept.
  if (input.preview && input.preview.trajectory.length > 1) {
    const pv = input.preview
    out.push({
      op: 'path',
      points: pv.trajectory.map((pt): Point => [p.x(pt.x), p.y(pt.y)]),
      stroke: { color: pal.quench, width: 1.5, alpha: 0.55, dash: [6, 4] },
    })
    let apex = pv.trajectory[0]
    for (const pt of pv.trajectory) if (pt.y > apex.y) apex = pt
    out.push({
      op: 'text',
      x: p.x(apex.x),
      y: p.y(apex.y) - 6,
      text: pv.label,
      font: sans(10, 400),
      fill: { color: pal.quench, alpha: 0.9 },
      align: 'center',
    })
  }

  // A machine that will not throw is still a machine, and it stays on the
  // sheet. Everything about the *shot* drops out — no trajectory, no impact, no
  // range to carry — but the drawing is where someone finds the dimension to
  // change, and the fault is frequently visible in the cocked pose itself: an
  // arm tip through the trough, a weight box below ground. The reason is
  // reported over the sheet by `Stage`, where it can be read and dismissed;
  // lettering "NO VALID SHOT" into the middle used to replace the entire
  // drawing with two words that named no cause and offered no fix.
  const timeline = result.ok ? result.timeline : null
  const flying = timeline != null && isFlying(timeline, t)
  const frames = result.frames
  const frame = frames.length
    ? frames[
        Math.min(
          frames.length - 1,
          Math.max(0, timeline ? frameIndexAt(frames, strokeT(timeline, t)) : 0),
        )
      ]
    : null

  // --- flight path --------------------------------------------------------
  const traj = result.trajectory
  if (timeline && traj.length > 1) {
    out.push({
      op: 'path',
      points: traj.map((pt): Point => [p.x(pt.x), p.y(pt.y)]),
      stroke: { color: pal.quench, width: 1, alpha: 0.22, dash: [2, 5] },
    })

    if (flying) {
      const flightT = t - timeline.releaseT
      const flown: Point[] = [[p.x(traj[0].x), p.y(traj[0].y)]]
      for (const pt of traj) {
        if (pt.t > flightT) break
        flown.push([p.x(pt.x), p.y(pt.y)])
      }
      out.push({
        op: 'path',
        points: flown,
        stroke: { color: pal.quench, width: 2, join: 'round' },
      })
    }
  }

  // The shot's path *inside* the machine — the whip. Short, and the single
  // clearest illustration of why a sling beats a bare arm. Clamped at release
  // explicitly: frames continue into the follow-through, where the "projectile"
  // point is the empty pouch, whose wanderings are not part of the shot.
  if (timeline && frames.length > 1) {
    const whipEnd = Math.min(t, timeline.releaseT)
    const whip: Point[] = [[p.x(frames[0].pose.projectile.x), p.y(frames[0].pose.projectile.y)]]
    for (const f of frames) {
      if (f.t > whipEnd) break
      whip.push([p.x(f.pose.projectile.x), p.y(f.pose.projectile.y)])
    }
    out.push({ op: 'path', points: whip, stroke: { color: pal.quench, width: 1.5, alpha: 0.35 } })
  }

  // --- machine ------------------------------------------------------------
  const pose = frame?.pose ?? frames[0]?.pose
  if (pose) {
    const radius = Math.max(2.5, p.s(params.projectileDiameter / 2))
    out.push(...frameParts(p, params, pal))
    out.push(...beamParts(p, params, pal, pose))
    out.push(...counterweightParts(p, params, pal, pose))
    out.push(...slingParts(p, pal, pose, radius, flying))
    out.push(...pivotParts(p, pal, pose))

    if (!flying) {
      out.push({
        op: 'circle',
        x: p.x(pose.projectile.x),
        y: p.y(pose.projectile.y),
        r: radius,
        fill: { color: pal.quench },
      })
    }

    const highlight = input.highlight ?? null
    if (input.showDimensions || highlight)
      out.push(
        ...dimensionParts(p, params, pal, pose, units, measure, {
          showAll: input.showDimensions,
          highlight,
        }),
      )
    if (input.showAngles) out.push(...angleParts(p, params, pal, pose))
  }

  // --- shot in flight -----------------------------------------------------
  if (timeline && flying && traj.length) {
    const at = sampleTrajectory(traj, t - timeline.releaseT)
    out.push({
      op: 'circle',
      x: p.x(at.x),
      y: p.y(at.y),
      r: Math.max(3, p.s(params.projectileDiameter / 2)),
      fill: { color: pal.quench },
    })
  }

  // Everything past here is about a shot that actually happened.
  if (!result.ok) return out

  // --- impact + range dimension -------------------------------------------
  // The shot lands on the *target's* ground plane, which sits below (or above)
  // the machine's whenever "drop to target" is set. Everything about the
  // landing — the shelf of ground, the splash, the range dimension — belongs on
  // that plane; drawn on the machine's, the trajectory punched through the
  // ground line and the splash floated where nothing ever landed.
  const impactX = p.x(result.range)
  const targetY = p.y(-params.targetDrop)
  if (Math.abs(targetY - groundY) > 2) {
    // A shelf of target ground running from just short of the impact to the
    // sheet edge, in the same idiom as the machine's ground line. The model has
    // no opinion about where the slope between the two planes lies, so the
    // shelf claims only the ground the landing actually needs.
    const shelfX = Math.min(Math.max(impactX - 60, 0), w)
    out.push(seg(shelfX, targetY, w, targetY, { color: pal.ink2, width: 1.5 }))
    const shelfClip: Point[] = [
      [shelfX, targetY],
      [w, targetY],
      [w, targetY + band],
      [shelfX, targetY + band],
    ]
    for (const [a, b] of hatchLines(shelfX, targetY, w, targetY + band, 9)) {
      out.push({ op: 'path', points: [a, b], stroke: { color: pal.ink3, width: 1, alpha: 0.5 }, clip: shelfClip })
    }
  }

  if (isDone(result.timeline, t)) {
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI * (0.15 + i * 0.175)
      out.push(
        seg(
          impactX + Math.cos(a) * 4,
          targetY + Math.sin(a) * 4,
          impactX + Math.cos(a) * 11,
          targetY + Math.sin(a) * 11,
          { color: pal.quench, width: 1.5 },
        ),
      )
    }
  }

  // The headline measurement, drawn rather than displayed. It hangs below the
  // lower of the two ground planes so its witness lines reach the landing.
  const dimY = Math.max(groundY, targetY)
  out.push(
    ...dimension(
      p.x(0),
      dimY,
      impactX,
      dimY,
      40,
      `${num(toDisplay(result.range, 'length', units), 1)} ${u}`,
      pal.verdigris,
      measure,
      { fontSize: 13, weight: 600, clampX: [8, w - 8] },
    ),
  )

  out.push({
    op: 'text',
    x: (Math.min(Math.max(impactX, 60), w - 60) + p.x(0)) / 2,
    y: dimY + 62,
    text: 'RANGE FROM PIVOT',
    font: sans(9, 500, 0.14),
    fill: { color: pal.ink3 },
    align: 'center',
  })

  return out
}
