import type { MachinePose, ShotResult, TrebuchetParams } from '@/lib/treb/types.ts'
import { isDone, isFlying, strokeT } from '@/lib/treb/timeline.ts'
import { toDisplay, unitSymbol, num, type UnitSystem } from '@/lib/format.ts'
import { projector, type Camera, type Projector } from './camera.ts'

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
 * This module decides *what* is drawn and where; `paint.ts` puts it on a canvas.
 * The split exists because every rule worth arguing about lives here — when a
 * dimension is too short to letter, when a protractor's figure goes inside its
 * arc rather than outside, what a grid step rounds to — and none of them could
 * be reached from a test while the only way in was a `CanvasRenderingContext2D`
 * that jsdom does not implement. Instructions are plain objects in screen
 * pixels, so a test asserts on the drawing instead of spying on the brush.
 */

export type Point = [number, number]

export interface Font {
  size: number
  weight: number
  family: 'sans' | 'mono'
  /** em, for the tracked capitals the sheet uses as section lettering. */
  tracking?: number
}

export interface Stroke {
  color: string
  width?: number
  alpha?: number
  dash?: number[]
  cap?: CanvasLineCap
  join?: CanvasLineJoin
}

export interface Fill {
  color: string
  alpha?: number
}

/**
 * `clip` is a polygon rather than baked-into-the-geometry trimming: working out
 * where a hatch line crosses a rotated box is exactly the sort of thing a
 * canvas is good at, and the rule worth testing is the spacing and the angle.
 */
export type Instruction =
  | { op: 'rect'; x: number; y: number; w: number; h: number; fill: Fill }
  | {
      op: 'path'
      points: Point[]
      close?: boolean
      stroke?: Stroke
      fill?: Fill
      clip?: Point[]
    }
  | { op: 'circle'; x: number; y: number; r: number; stroke?: Stroke; fill?: Fill }
  | {
      op: 'arc'
      x: number
      y: number
      r: number
      from: number
      to: number
      ccw?: boolean
      /** Close back through the centre and fill, for a swept sector. */
      sector?: boolean
      stroke?: Stroke
      fill?: Fill
    }
  | {
      op: 'text'
      x: number
      y: number
      text: string
      font: Font
      fill: Fill
      align?: CanvasTextAlign
      baseline?: CanvasTextBaseline
    }

/**
 * Text width in pixels. An internal seam, not part of the interface: the canvas
 * adapter passes its own `measureText`, and a test passes an estimator. Only
 * the dimension figure needs it, to size the gap it sits in.
 */
export type MeasureText = (text: string, font: Font) => number

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

/** Below this length a dimension's figure is wider than the dimension itself. */
export const MIN_DIMENSION = 52

/** Below this radius a protractor is smaller than its own graduations. */
export const MIN_PROTRACTOR_RADIUS = 16

/** Above this radius the arc has room for its figure inside it. */
export const LABEL_INSIDE_RADIUS = 44

const mono = (size: number, weight = 500): Font => ({ size, weight, family: 'mono' })
const sans = (size: number, weight = 500, tracking?: number): Font => ({
  size,
  weight,
  family: 'sans',
  tracking,
})

function seg(x0: number, y0: number, x1: number, y1: number, stroke: Stroke): Instruction {
  return { op: 'path', points: [[x0, y0], [x1, y1]], stroke }
}

// --- drafting rules ----------------------------------------------------------

/** Solid drafting arrowhead at (x, y), pointing along `ang`. */
export function arrowHead(x: number, y: number, ang: number, size: number): Point[] {
  const spread = 0.26
  return [
    [x, y],
    [x - size * Math.cos(ang - spread), y - size * Math.sin(ang - spread)],
    [x - size * Math.cos(ang + spread), y - size * Math.sin(ang + spread)],
  ]
}

/** Section hatching at 45° across a box, to be clipped to the real outline. */
export function hatchLines(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  spacing: number,
): Point[][] {
  const out: Point[][] = []
  const span = x1 - x0 + (y1 - y0)
  for (let d = -(y1 - y0); d < span; d += spacing) {
    out.push([
      [x0 + d, y1],
      [x0 + d + (y1 - y0), y0],
    ])
  }
  return out
}

/**
 * 1 / 2 / 5 x 10^n spacing, never finer than 90 px on screen.
 *
 * The upper bound is 2.5x that rather than anything tidier: a target landing
 * just above 2 in its decade has to round up to 5. (The comment here used to
 * claim 46-150 px, which no scale actually produces.)
 */
export function gridStep(scale: number): number {
  const target = 90 / scale
  const mag = Math.pow(10, Math.floor(Math.log10(target)))
  for (const m of [1, 2, 5, 10]) if (mag * m >= target) return mag * m
  return mag * 10
}

/** Shortest signed rotation from a to b, in (-pi, pi]. */
export function delta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d <= -Math.PI) d += Math.PI * 2
  return d
}

/** Index of the last frame at or before `t`. Frames are time-ordered. */
export function frameIndexAt(frames: ShotResult['frames'], t: number): number {
  let lo = 0
  let hi = frames.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (frames[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Position along the flight path at `t`, interpolated between samples. */
export function sampleTrajectory(traj: ShotResult['trajectory'], t: number) {
  if (t <= 0) return traj[0]
  for (let i = 1; i < traj.length; i++) {
    if (traj[i].t >= t) {
      const a = traj[i - 1]
      const b = traj[i]
      const k = (t - a.t) / Math.max(1e-9, b.t - a.t)
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
    }
  }
  return traj[traj.length - 1]
}

/**
 * A dimension: witness lines out from the two measured points, a dimension line
 * between them offset perpendicular by `off` screen pixels, arrowheads turned
 * outward, and the figure set in a gap in the middle of the line.
 *
 * This is the signature of the whole interface. It is used for the machine's
 * geometry, for the range across the bottom of the sheet, and — in miniature —
 * for the marker on the sweep chart, so the same reading applies everywhere.
 *
 * Returns nothing at all below `MIN_DIMENSION`: a cluster of short dimensions
 * around the pivot letters over itself, and dropping one is better than that.
 */
export function dimension(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  off: number,
  label: string,
  colour: string,
  measure: MeasureText,
  opts: { fontSize?: number; weight?: number; clampX?: [number, number] } = {},
): Instruction[] {
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy)
  if (len < MIN_DIMENSION) return []

  const ux = dx / len
  const uy = dy / len
  // Perpendicular, pointing to the offset side.
  const nx = -uy
  const ny = ux
  const ox = nx * off
  const oy = ny * off

  const a: Point = [ax + ox, ay + oy]
  const b: Point = [bx + ox, by + oy]

  const stroke: Stroke = { color: colour, width: 1 }
  const out: Instruction[] = []

  // Witness lines, with the small gap from the measured point that a
  // draughtsman leaves so the extension does not touch the object.
  const gap = 3
  const side = Math.sign(off || 1)
  out.push(seg(ax + nx * gap * side, ay + ny * gap * side, a[0] + nx * 4, a[1] + ny * 4, stroke))
  out.push(seg(bx + nx * gap * side, by + ny * gap * side, b[0] + nx * 4, b[1] + ny * 4, stroke))

  const font = mono(opts.fontSize ?? 11, opts.weight ?? 500)
  const halfGap = measure(label, font) / 2 + 6

  let mx = (a[0] + b[0]) / 2
  let my = (a[1] + b[1]) / 2
  if (opts.clampX) {
    // When one end runs off the sheet the figure still has to be readable, so
    // it slides along its own dimension line rather than vanishing with the end.
    const [lo, hi] = opts.clampX
    mx = Math.min(Math.max(mx, Math.min(lo, hi) + halfGap), Math.max(lo, hi) - halfGap)
    if (Math.abs(uy) < 0.01) my = a[1]
  }

  const md = (mx - a[0]) * ux + (my - a[1]) * uy
  out.push(seg(a[0], a[1], a[0] + ux * (md - halfGap), a[1] + uy * (md - halfGap), stroke))
  out.push(seg(a[0] + ux * (md + halfGap), a[1] + uy * (md + halfGap), b[0], b[1], stroke))

  const ah = Math.min(7, len / 3)
  const head: Fill = { color: colour }
  out.push({ op: 'path', points: arrowHead(a[0], a[1], Math.atan2(-uy, -ux), ah), close: true, fill: head })
  out.push({ op: 'path', points: arrowHead(b[0], b[1], Math.atan2(uy, ux), ah), close: true, fill: head })

  // A drawn figure sits *in* the line, which is why the line was broken above.
  out.push({
    op: 'text',
    x: mx,
    y: my,
    text: label,
    font,
    fill: { color: colour },
    align: 'center',
    baseline: 'middle',
  })
  return out
}

/**
 * A protractor: a graduated arc centred on a joint, with the swept sector
 * filled and a radial pointer on the live angle.
 *
 * Angles are what a trebuchet is actually made of — the beam sweep, the sling
 * lagging behind the arm, the weight box trailing its hanger — and none of them
 * are legible from a linear dimension. Drawn in the measurement accent, in the
 * same idiom as the dimension lines.
 *
 * Canvas angles run clockwise from +x with y down, so world angles measured
 * from vertical are converted by the caller rather than here.
 */
export function protractor(
  cx: number,
  cy: number,
  radius: number,
  from: number,
  to: number,
  label: string,
  colour: string,
  opts: { graduate?: boolean; pointerAt?: number; ghostAt?: number; ghostLabel?: string } = {},
): Instruction[] {
  if (radius < MIN_PROTRACTOR_RADIUS) return []
  const span = to - from
  const ccw = span < 0
  const out: Instruction[] = []

  // Swept sector, very faint. It sits under the beam, so anything heavier
  // reads as a coloured block over the machine rather than as an annotation.
  out.push({
    op: 'arc',
    x: cx,
    y: cy,
    r: radius,
    from,
    to,
    ccw,
    sector: true,
    fill: { color: colour, alpha: 0.06 },
  })
  out.push({ op: 'arc', x: cx, y: cy, r: radius, from, to, ccw, stroke: { color: colour, width: 1 } })

  if (opts.graduate) {
    const stepRad = (10 * Math.PI) / 180
    const dir = Math.sign(span) || 1
    for (let i = 0; i * stepRad <= Math.abs(span); i++) {
      const a = from + dir * i * stepRad
      const major = i % 3 === 0
      const len = major ? 7 : 3.5
      out.push(
        seg(
          cx + Math.cos(a) * radius,
          cy + Math.sin(a) * radius,
          cx + Math.cos(a) * (radius + len),
          cy + Math.sin(a) * (radius + len),
          { color: colour, width: 1, alpha: major ? 0.9 : 0.45 },
        ),
      )
    }
  }

  // A dashed radial for a target the live angle is closing on — the pin angle
  // at the beam tip, which is the single most useful thing to watch while tuning.
  if (opts.ghostAt != null) {
    out.push(
      seg(
        cx,
        cy,
        cx + Math.cos(opts.ghostAt) * (radius + 12),
        cy + Math.sin(opts.ghostAt) * (radius + 12),
        { color: colour, width: 1, alpha: 0.75, dash: [4, 3] },
      ),
    )
    if (opts.ghostLabel) {
      out.push({
        op: 'text',
        x: cx + Math.cos(opts.ghostAt) * (radius + 26),
        y: cy + Math.sin(opts.ghostAt) * (radius + 26),
        text: opts.ghostLabel,
        font: sans(10, 400),
        fill: { color: colour, alpha: 0.75 },
        align: 'center',
        baseline: 'middle',
      })
    }
  }

  if (opts.pointerAt != null) {
    out.push(
      seg(
        cx,
        cy,
        cx + Math.cos(opts.pointerAt) * (radius + 8),
        cy + Math.sin(opts.pointerAt) * (radius + 8),
        { color: colour, width: 1.5 },
      ),
    )
  }

  // Big arcs have room for the figure inside them; small ones do not, and on a
  // short hanger the label would land inside the weight box.
  const mid = from + span / 2
  const lr = radius > LABEL_INSIDE_RADIUS ? radius * 0.62 : radius + 15
  out.push({
    op: 'text',
    x: cx + Math.cos(mid) * lr,
    y: cy + Math.sin(mid) * lr,
    text: label,
    font: mono(11),
    fill: { color: colour },
    align: 'center',
    baseline: 'middle',
  })
  return out
}

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

function dimensionParts(
  p: Projector,
  params: TrebuchetParams,
  pal: Palette,
  pose: MachinePose,
  units: UnitSystem,
  measure: MeasureText,
): Instruction[] {
  const u = unitSymbol('length', units)
  const fmt = (v: number) => `${num(toDisplay(v, 'length', units), 2)}${u}`
  const c = pal.verdigris

  // Beam dimensions ride on the beam so they stay legible as it swings; the
  // pivot height is measured off the frame, where a builder would measure it.
  return [
    ...dimension(
      p.x(pose.axle.x), p.y(pose.axle.y), p.x(pose.tip.x), p.y(pose.tip.y),
      -20, fmt(params.armLong), c, measure,
    ),
    ...dimension(
      p.x(pose.shortEnd.x), p.y(pose.shortEnd.y), p.x(pose.axle.x), p.y(pose.axle.y),
      -20, fmt(params.armShort), c, measure,
    ),
    ...(params.cwHanger > 0.02
      ? dimension(
          p.x(pose.shortEnd.x), p.y(pose.shortEnd.y), p.x(pose.cw.x), p.y(pose.cw.y),
          28, fmt(params.cwHanger), c, measure,
        )
      : []),
    ...dimension(
      p.x(pose.tip.x), p.y(pose.tip.y), p.x(pose.projectile.x), p.y(pose.projectile.y),
      24, fmt(params.slingLength), c, measure,
    ),
    ...dimension(
      p.x(0), p.y(0), p.x(0), p.y(params.pivotHeight),
      -Math.max(46, p.s(params.armLong * 0.55)), fmt(params.pivotHeight), c, measure,
    ),
  ]
}

// --- the sheet ---------------------------------------------------------------

export function layout(input: SheetInput, measure: MeasureText): Instruction[] {
  const { w, h, cam, palette: pal, params, result, t, units } = input
  const p = projector(cam, w, h)
  const out: Instruction[] = []

  out.push({ op: 'rect', x: 0, y: 0, w, h, fill: { color: pal.sheet } })

  const groundY = p.y(0)
  const step = gridStep(cam.scale)

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
      text: `${num(toDisplay(i * step, 'length', units), 0)}${u}`,
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

  if (!result.ok) {
    out.push({
      op: 'text',
      x: w / 2,
      y: h / 2,
      text: 'NO VALID SHOT',
      font: sans(12, 500, 0.16),
      fill: { color: pal.ink3 },
      align: 'center',
    })
    return out
  }

  const timeline = result.timeline
  const flying = isFlying(timeline, t)
  const frames = result.frames
  const frame = frames.length
    ? frames[Math.min(frames.length - 1, Math.max(0, frameIndexAt(frames, strokeT(timeline, t))))]
    : null

  // --- flight path --------------------------------------------------------
  const traj = result.trajectory
  if (traj.length > 1) {
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
  // clearest illustration of why a sling beats a bare arm.
  if (frames.length > 1) {
    const whip: Point[] = [[p.x(frames[0].pose.projectile.x), p.y(frames[0].pose.projectile.y)]]
    for (const f of frames) {
      if (f.t > strokeT(timeline, t)) break
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

    if (input.showDimensions) out.push(...dimensionParts(p, params, pal, pose, units, measure))
    if (input.showAngles) out.push(...angleParts(p, params, pal, pose))
  }

  // --- shot in flight -----------------------------------------------------
  if (flying && traj.length) {
    const at = sampleTrajectory(traj, t - timeline.releaseT)
    out.push({
      op: 'circle',
      x: p.x(at.x),
      y: p.y(at.y),
      r: Math.max(3, p.s(params.projectileDiameter / 2)),
      fill: { color: pal.quench },
    })
  }

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

  if (isDone(timeline, t)) {
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
