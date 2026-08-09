import type { MachinePose, ShotResult, TrebuchetParams } from '@/lib/treb/types.ts'
import { toDisplay, unitSymbol, num, type UnitSystem } from '@/lib/format.ts'
import { projector, type Camera, type Projector } from './camera.ts'

/**
 * The drawing.
 *
 * Everything the simulator has to say about a shot is said on one sheet, in the
 * vocabulary of a setting-out drawing: hatched ground, a hairline grid, timber
 * drawn to scale, and measurements carried on proper dimension lines with
 * witness lines, arrowheads and a gap for the figure. The range is not a number
 * in a card — it is the dimension across the bottom of the sheet, which is both
 * the most legible way to show "how far" and the thing that keeps this from
 * looking like every other simulator.
 */

export interface Palette {
  sheet: string
  ground: string
  ink: string
  ink2: string
  ink3: string
  rule: string
  quench: string
  verdigris: string
  oak: string
  iron: string
  warn: string
}

export interface Ghost {
  trajectory: { x: number; y: number }[]
  label: string
}

export interface PaintInput {
  ctx: CanvasRenderingContext2D
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

const SANS = "'Instrument Sans Variable', sans-serif"
const MONO = "'Geist Mono Variable', monospace"

// --- primitives --------------------------------------------------------------

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
  ctx.stroke()
}

function poly(ctx: CanvasRenderingContext2D, pts: number[][], close = true) {
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
  if (close) ctx.closePath()
}

/** Solid drafting arrowhead, pointing along `ang`. */
function arrowHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ang: number,
  size: number,
) {
  const spread = 0.26
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x - size * Math.cos(ang - spread), y - size * Math.sin(ang - spread))
  ctx.lineTo(x - size * Math.cos(ang + spread), y - size * Math.sin(ang + spread))
  ctx.closePath()
  ctx.fill()
}

/**
 * A dimension: witness lines out from the two measured points, a dimension line
 * between them offset perpendicular by `off` screen pixels, arrowheads turned
 * outward, and the figure set in a gap in the middle of the line.
 *
 * This is the signature of the whole interface. It is used for the machine's
 * geometry, for the range across the bottom of the sheet, and — in miniature —
 * for the marker on the sweep chart, so the same reading applies everywhere.
 */
function dimension(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  off: number,
  label: string,
  colour: string,
  opts: { fontSize?: number; weight?: number; clampX?: [number, number] } = {},
) {
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy)
  // Below about this length the figure is wider than the dimension it labels,
  // and a cluster of them around the pivot becomes unreadable. Dropping the
  // dimension is better than lettering over its neighbours.
  if (len < 52) return
  const ux = dx / len
  const uy = dy / len
  // Perpendicular, pointing to the offset side.
  const nx = -uy
  const ny = ux
  const ox = nx * off
  const oy = ny * off

  const a = [ax + ox, ay + oy]
  const b = [bx + ox, by + oy]

  ctx.save()
  ctx.strokeStyle = colour
  ctx.fillStyle = colour
  ctx.lineWidth = 1

  // Witness lines, with the small gap from the measured point that a
  // draughtsman leaves so the extension does not touch the object.
  const gap = 3
  line(ctx, ax + nx * gap * Math.sign(off || 1), ay + ny * gap * Math.sign(off || 1), a[0] + nx * 4, a[1] + ny * 4)
  line(ctx, bx + nx * gap * Math.sign(off || 1), by + ny * gap * Math.sign(off || 1), b[0] + nx * 4, b[1] + ny * 4)

  const fontSize = opts.fontSize ?? 11
  ctx.font = `${opts.weight ?? 500} ${fontSize}px ${MONO}`
  const tw = ctx.measureText(label).width
  const halfGap = tw / 2 + 6

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
  line(ctx, a[0], a[1], a[0] + ux * (md - halfGap), a[1] + uy * (md - halfGap))
  line(ctx, a[0] + ux * (md + halfGap), a[1] + uy * (md + halfGap), b[0], b[1])

  const ah = Math.min(7, len / 3)
  arrowHead(ctx, a[0], a[1], Math.atan2(-uy, -ux), ah)
  arrowHead(ctx, b[0], b[1], Math.atan2(uy, ux), ah)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // A drawn figure sits *in* the line, so clear a slot for it rather than
  // letting the rule run behind the digits.
  ctx.fillText(label, mx, my)
  ctx.restore()
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
 * from vertical are converted at the two call sites rather than here.
 */
function protractor(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  from: number,
  to: number,
  label: string,
  colour: string,
  opts: { graduate?: boolean; pointerAt?: number; ghostAt?: number; ghostLabel?: string } = {},
) {
  if (radius < 16) return
  const span = to - from
  ctx.save()
  ctx.strokeStyle = colour
  ctx.fillStyle = colour
  ctx.lineWidth = 1

  // Swept sector, very faint. It sits under the beam, so anything heavier
  // reads as a coloured block over the machine rather than as an annotation.
  ctx.globalAlpha = 0.06
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.arc(cx, cy, radius, from, to, span < 0)
  ctx.closePath()
  ctx.fill()
  ctx.globalAlpha = 1

  ctx.beginPath()
  ctx.arc(cx, cy, radius, from, to, span < 0)
  ctx.stroke()

  if (opts.graduate) {
    const stepRad = (10 * Math.PI) / 180
    const dir = Math.sign(span) || 1
    for (let i = 0; i * stepRad <= Math.abs(span); i++) {
      const a = from + dir * i * stepRad
      const major = i % 3 === 0
      const len = major ? 7 : 3.5
      ctx.globalAlpha = major ? 0.9 : 0.45
      line(
        ctx,
        cx + Math.cos(a) * radius,
        cy + Math.sin(a) * radius,
        cx + Math.cos(a) * (radius + len),
        cy + Math.sin(a) * (radius + len),
      )
    }
    ctx.globalAlpha = 1
  }

  // A dashed radial for a target the live angle is closing on — the pin angle
  // at the beam tip, which is the single most useful thing to watch while tuning.
  if (opts.ghostAt != null) {
    ctx.save()
    ctx.setLineDash([4, 3])
    ctx.globalAlpha = 0.75
    line(
      ctx,
      cx,
      cy,
      cx + Math.cos(opts.ghostAt) * (radius + 12),
      cy + Math.sin(opts.ghostAt) * (radius + 12),
    )
    if (opts.ghostLabel) {
      ctx.setLineDash([])
      ctx.font = `400 10px ${SANS}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(
        opts.ghostLabel,
        cx + Math.cos(opts.ghostAt) * (radius + 26),
        cy + Math.sin(opts.ghostAt) * (radius + 26),
      )
    }
    ctx.restore()
  }

  if (opts.pointerAt != null) {
    ctx.lineWidth = 1.5
    line(
      ctx,
      cx,
      cy,
      cx + Math.cos(opts.pointerAt) * (radius + 8),
      cy + Math.sin(opts.pointerAt) * (radius + 8),
    )
  }

  const mid = from + span / 2
  ctx.font = `500 11px ${MONO}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // Big arcs have room for the figure inside them; small ones do not, and on a
  // short hanger the label would land inside the weight box.
  const lr = radius > 44 ? radius * 0.62 : radius + 15
  ctx.fillText(label, cx + Math.cos(mid) * lr, cy + Math.sin(mid) * lr)
  ctx.restore()
}

/** Section hatching at 45°, clipped to the current path. */
function hatch(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  spacing: number,
  colour: string,
  width = 1,
) {
  ctx.save()
  ctx.clip()
  ctx.strokeStyle = colour
  ctx.lineWidth = width
  ctx.beginPath()
  const span = x1 - x0 + (y1 - y0)
  for (let d = -(y1 - y0); d < span; d += spacing) {
    ctx.moveTo(x0 + d, y1)
    ctx.lineTo(x0 + d + (y1 - y0), y0)
  }
  ctx.stroke()
  ctx.restore()
}

/** 1 / 2 / 5 x 10^n spacing that lands between 46 and 150 px on screen. */
function gridStep(scale: number): number {
  const target = 90 / scale
  const mag = Math.pow(10, Math.floor(Math.log10(target)))
  for (const m of [1, 2, 5, 10]) if (mag * m >= target) return mag * m
  return mag * 10
}

// --- machine -----------------------------------------------------------------

function drawFrame(
  ctx: CanvasRenderingContext2D,
  p: Projector,
  params: TrebuchetParams,
  pal: Palette,
  pose: MachinePose,
) {
  const H = params.pivotHeight
  ctx.save()
  ctx.lineJoin = 'round'
  // The frame is scenery and the beam is the figure, so the frame recedes.
  // Drawn in the same timber at reduced opacity rather than a second brown,
  // which keeps the palette closed and still separates the moving part.
  ctx.globalAlpha = 0.62

  if (params.type === 'floating') {
    // Rails the axle rolls on, and the channel the weight drops through. The
    // rail is drawn over the axle's whole travel so the mechanism is legible
    // even when the arm is parked at one end of it.
    const railY = p.y(H)
    const x0 = p.x(-params.armShort - 0.25)
    const x1 = p.x(0.25)
    ctx.strokeStyle = pal.iron
    ctx.lineWidth = 3
    line(ctx, x0, railY, x1, railY)
    ctx.lineWidth = 1
    ctx.strokeStyle = pal.rule
    line(ctx, x0, railY + 5, x1, railY + 5)

    const half = p.s(Math.max(params.cwSize, 0.2) / 2 + 0.05)
    ctx.strokeStyle = pal.iron
    ctx.setLineDash([6, 4])
    ctx.lineWidth = 1.5
    line(ctx, p.x(0) - half, p.y(H + params.armShort + 0.4), p.x(0) - half, p.y(0))
    line(ctx, p.x(0) + half, p.y(H + params.armShort + 0.4), p.x(0) + half, p.y(0))
    ctx.setLineDash([])

    for (const sx of [-params.armShort - 0.2, 0.2]) {
      ctx.strokeStyle = pal.oak
      ctx.lineWidth = Math.max(2, p.s(H * 0.035))
      line(ctx, p.x(sx), railY, p.x(sx), p.y(0))
    }
  } else {
    // A-frame in side elevation: two raking legs to the axle plus a ground sill.
    const spread = H * 0.42
    ctx.strokeStyle = pal.oak
    ctx.lineWidth = Math.max(2.5, p.s(H * 0.045))
    ctx.lineCap = 'round'
    line(ctx, p.x(-spread), p.y(0), p.x(0), p.y(H))
    line(ctx, p.x(spread), p.y(0), p.x(0), p.y(H))
    ctx.lineWidth = Math.max(2, p.s(H * 0.035))
    line(ctx, p.x(-spread - 0.15), p.y(0), p.x(spread + 0.15), p.y(0))
    // Cross brace, at the height the real ones sit.
    ctx.lineWidth = Math.max(1.5, p.s(H * 0.022))
    ctx.strokeStyle = pal.rule
    line(ctx, p.x(-spread * 0.45), p.y(H * 0.55), p.x(spread * 0.45), p.y(H * 0.55))
    ctx.lineCap = 'butt'
  }

  // Trough. Drawn where the shot actually runs, so it reads as part of the
  // machine rather than as an arbitrary line on the ground.
  const reach = params.armLong + params.slingLength
  ctx.strokeStyle = pal.rule
  ctx.lineWidth = 2
  line(ctx, p.x(-reach * 0.55), p.y(params.troughHeight), p.x(reach * 0.5), p.y(params.troughHeight))

  ctx.restore()
  void pose
}

function drawBeam(
  ctx: CanvasRenderingContext2D,
  p: Projector,
  params: TrebuchetParams,
  pal: Palette,
  pose: MachinePose,
) {
  const { axle, tip, shortEnd } = pose
  const dx = tip.x - axle.x
  const dy = tip.y - axle.y
  const l = Math.hypot(dx, dy) || 1
  const nx = -dy / l
  const ny = dx / l

  const wRoot = Math.max(2.5, p.s(params.armLong * 0.028))
  const wTip = Math.max(1.5, p.s(params.armLong * 0.013))
  const wShort = Math.max(2, p.s(params.armLong * 0.024))

  const P = (wx: number, wy: number, off: number) => [p.x(wx) + nx * off, p.y(wy) - ny * off]

  ctx.save()
  poly(ctx, [
    P(shortEnd.x, shortEnd.y, wShort),
    P(axle.x, axle.y, wRoot),
    P(tip.x, tip.y, wTip),
    P(tip.x, tip.y, -wTip),
    P(axle.x, axle.y, -wRoot),
    P(shortEnd.x, shortEnd.y, -wShort),
  ])
  ctx.fillStyle = pal.oak
  ctx.fill()
  ctx.strokeStyle = pal.ink
  ctx.globalAlpha = 0.5
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.restore()
}

function drawCounterweight(
  ctx: CanvasRenderingContext2D,
  p: Projector,
  params: TrebuchetParams,
  pal: Palette,
  pose: MachinePose,
) {
  const { cw, shortEnd } = pose

  ctx.save()
  ctx.strokeStyle = pal.iron
  ctx.lineWidth = Math.max(1.5, p.s(params.cwSize * 0.06))
  line(ctx, p.x(shortEnd.x), p.y(shortEnd.y), p.x(cw.x), p.y(cw.y))

  const s = Math.max(8, p.s(params.cwSize))
  ctx.translate(p.x(cw.x), p.y(cw.y))
  ctx.rotate(pose.psi)
  ctx.beginPath()
  ctx.rect(-s / 2, -s / 2, s, s)
  ctx.fillStyle = pal.sheet
  ctx.fill()
  // Hatched like a section through a filled box, because that is what it is:
  // a crate of earth and stone, not a solid block of metal.
  ctx.save()
  ctx.beginPath()
  ctx.rect(-s / 2, -s / 2, s, s)
  ctx.globalAlpha = 0.55
  hatch(ctx, -s / 2, -s / 2, s / 2, s / 2, Math.max(4, s / 7), pal.iron, 1)
  ctx.restore()
  ctx.beginPath()
  ctx.rect(-s / 2, -s / 2, s, s)
  ctx.strokeStyle = pal.ink
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()
}

function drawPivot(ctx: CanvasRenderingContext2D, p: Projector, pal: Palette, pose: MachinePose) {
  const x = p.x(pose.axle.x)
  const y = p.y(pose.axle.y)
  ctx.save()
  ctx.strokeStyle = pal.ink
  ctx.fillStyle = pal.sheet
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(x, y, 4.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  // Centre mark, drafting convention.
  ctx.lineWidth = 1
  ctx.strokeStyle = pal.ink3
  line(ctx, x - 9, y, x + 9, y)
  line(ctx, x, y - 9, x, y + 9)
  ctx.restore()
}

function drawSling(
  ctx: CanvasRenderingContext2D,
  p: Projector,
  pal: Palette,
  pose: MachinePose,
  radius: number,
  released: boolean,
) {
  ctx.save()
  ctx.strokeStyle = released ? pal.ink3 : pal.ink2
  ctx.globalAlpha = released ? 0.45 : 1
  ctx.lineWidth = 1.5
  line(ctx, p.x(pose.tip.x), p.y(pose.tip.y), p.x(pose.projectile.x), p.y(pose.projectile.y))
  if (!released) {
    // Pouch: a shallow cradle across the back of the shot.
    const ang = Math.atan2(pose.tip.y - pose.projectile.y, pose.tip.x - pose.projectile.x)
    ctx.translate(p.x(pose.projectile.x), p.y(pose.projectile.y))
    ctx.rotate(-ang)
    ctx.beginPath()
    ctx.arc(0, 0, radius + 2.5, Math.PI * 0.35, Math.PI * 1.65)
    ctx.stroke()
  }
  ctx.restore()
}

// --- main --------------------------------------------------------------------

export function paint(input: PaintInput) {
  const { ctx, w, h, cam, palette: pal, params, result, t, units } = input
  const p = projector(cam, w, h)

  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = pal.sheet
  ctx.fillRect(0, 0, w, h)

  const groundY = p.y(0)
  const step = gridStep(cam.scale)

  // --- grid ---------------------------------------------------------------
  if (input.showGrid) {
    const wx0 = p.invX(0)
    const wx1 = p.invX(w)
    const wy0 = p.invY(h)
    const wy1 = p.invY(0)
    ctx.save()
    ctx.lineWidth = 1
    for (let i = Math.floor(wx0 / step); i <= Math.ceil(wx1 / step); i++) {
      ctx.strokeStyle = pal.rule
      ctx.globalAlpha = i % 5 === 0 ? 0.55 : 0.25
      const gx = Math.round(p.x(i * step)) + 0.5
      line(ctx, gx, 0, gx, h)
    }
    for (let i = Math.floor(wy0 / step); i <= Math.ceil(wy1 / step); i++) {
      ctx.strokeStyle = pal.rule
      ctx.globalAlpha = i % 5 === 0 ? 0.55 : 0.25
      const gy = Math.round(p.y(i * step)) + 0.5
      line(ctx, 0, gy, w, gy)
    }
    ctx.restore()
  }

  // --- ground -------------------------------------------------------------
  ctx.save()
  ctx.strokeStyle = pal.ink2
  ctx.lineWidth = 1.5
  line(ctx, 0, groundY, w, groundY)
  ctx.beginPath()
  ctx.rect(0, groundY, w, 12)
  ctx.globalAlpha = 0.5
  hatch(ctx, 0, groundY, w, groundY + 12, 9, pal.ink3, 1)
  ctx.restore()

  // Downrange ticks along the ground.
  ctx.save()
  ctx.font = `500 10px ${MONO}`
  ctx.fillStyle = pal.ink3
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const u = unitSymbol('length', units)
  for (let i = Math.floor(p.invX(0) / step); i <= Math.ceil(p.invX(w) / step); i++) {
    if (i === 0) continue
    const gx = p.x(i * step)
    ctx.strokeStyle = pal.ink3
    ctx.lineWidth = 1
    line(ctx, gx, groundY, gx, groundY + 5)
    if (i % (step * cam.scale < 60 ? 2 : 1) === 0)
      ctx.fillText(`${num(toDisplay(i * step, 'length', units), 0)}${u}`, gx, groundY + 16)
  }
  ctx.restore()

  // --- ghosts -------------------------------------------------------------
  for (const ghost of input.ghosts) {
    if (ghost.trajectory.length < 2) continue
    ctx.save()
    ctx.strokeStyle = pal.ink3
    ctx.globalAlpha = 0.4
    ctx.lineWidth = 1
    ctx.setLineDash([3, 4])
    ctx.beginPath()
    ctx.moveTo(p.x(ghost.trajectory[0].x), p.y(ghost.trajectory[0].y))
    for (const pt of ghost.trajectory) ctx.lineTo(p.x(pt.x), p.y(pt.y))
    ctx.stroke()
    ctx.restore()
  }

  if (!result.ok || !result.release) {
    drawMachineAtRest(input)
    return
  }

  const releaseT = result.release.t
  const flying = t > releaseT
  const frames = result.frames
  const frame = frames.length
    ? frames[Math.min(frames.length - 1, Math.max(0, binarySearch(frames, Math.min(t, releaseT))))]
    : null

  // --- flight path --------------------------------------------------------
  const traj = result.trajectory
  if (traj.length > 1) {
    ctx.save()
    ctx.strokeStyle = pal.quench
    ctx.lineWidth = 1
    ctx.globalAlpha = 0.22
    ctx.setLineDash([2, 5])
    ctx.beginPath()
    ctx.moveTo(p.x(traj[0].x), p.y(traj[0].y))
    for (const pt of traj) ctx.lineTo(p.x(pt.x), p.y(pt.y))
    ctx.stroke()
    ctx.restore()

    if (flying) {
      const flightT = t - releaseT
      ctx.save()
      ctx.strokeStyle = pal.quench
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(p.x(traj[0].x), p.y(traj[0].y))
      for (const pt of traj) {
        if (pt.t > flightT) break
        ctx.lineTo(p.x(pt.x), p.y(pt.y))
      }
      ctx.stroke()
      ctx.restore()
    }
  }

  // The shot's path *inside* the machine — the whip. Short, and the single
  // clearest illustration of why a sling beats a bare arm.
  if (frames.length > 1) {
    ctx.save()
    ctx.strokeStyle = pal.quench
    ctx.globalAlpha = 0.35
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(p.x(frames[0].pose.projectile.x), p.y(frames[0].pose.projectile.y))
    for (const f of frames) {
      if (f.t > Math.min(t, releaseT)) break
      ctx.lineTo(p.x(f.pose.projectile.x), p.y(f.pose.projectile.y))
    }
    ctx.stroke()
    ctx.restore()
  }

  // --- machine ------------------------------------------------------------
  const pose = frame?.pose ?? frames[0]?.pose
  if (pose) {
    const radius = Math.max(2.5, p.s(params.projectileDiameter / 2))
    drawFrame(ctx, p, params, pal, pose)
    drawBeam(ctx, p, params, pal, pose)
    drawCounterweight(ctx, p, params, pal, pose)
    drawSling(ctx, p, pal, pose, radius, flying)
    drawPivot(ctx, p, pal, pose)

    if (!flying) {
      ctx.save()
      ctx.fillStyle = pal.quench
      ctx.beginPath()
      ctx.arc(p.x(pose.projectile.x), p.y(pose.projectile.y), radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    if (input.showDimensions) drawDimensions(ctx, p, params, pal, pose, units)
    if (input.showAngles) drawAngles(ctx, p, params, pal, pose)
  }

  // --- shot in flight -----------------------------------------------------
  if (flying && traj.length) {
    const flightT = t - releaseT
    const at = sampleTrajectory(traj, flightT)
    const radius = Math.max(3, p.s(params.projectileDiameter / 2))
    ctx.save()
    ctx.fillStyle = pal.quench
    ctx.beginPath()
    ctx.arc(p.x(at.x), p.y(at.y), radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // --- impact + range dimension -------------------------------------------
  const impactX = p.x(result.range)
  const done = t >= releaseT + result.flightTime - 1e-6
  if (done) {
    ctx.save()
    ctx.strokeStyle = pal.quench
    ctx.lineWidth = 1.5
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI * (0.15 + i * 0.175)
      line(
        ctx,
        impactX + Math.cos(a) * 4,
        groundY + Math.sin(a) * 4,
        impactX + Math.cos(a) * 11,
        groundY + Math.sin(a) * 11,
      )
    }
    ctx.restore()
  }

  // The headline measurement, drawn rather than displayed.
  const rangeLabel = `${num(toDisplay(result.range, 'length', units), 1)} ${u}`
  dimension(ctx, p.x(0), groundY, impactX, groundY, 40, rangeLabel, pal.verdigris, {
    fontSize: 13,
    weight: 600,
    clampX: [8, w - 8],
  })

  ctx.save()
  ctx.font = `500 9px ${SANS}`
  ctx.fillStyle = pal.ink3
  ctx.textAlign = 'center'
  ctx.letterSpacing = '0.14em'
  ctx.fillText('RANGE FROM PIVOT', (Math.min(Math.max(impactX, 60), w - 60) + p.x(0)) / 2, groundY + 62)
  ctx.restore()
}

function drawMachineAtRest(input: PaintInput) {
  const { ctx, palette: pal } = input
  ctx.save()
  ctx.fillStyle = pal.ink3
  ctx.font = `500 12px ${SANS}`
  ctx.textAlign = 'center'
  ctx.letterSpacing = '0.16em'
  ctx.fillText('NO VALID SHOT', input.w / 2, input.h / 2)
  ctx.restore()
}

function binarySearch(frames: ShotResult['frames'], t: number): number {
  let lo = 0
  let hi = frames.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (frames[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

function sampleTrajectory(traj: ShotResult['trajectory'], t: number) {
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

/** Shortest signed rotation from a to b, in (-pi, pi]. */
function delta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d <= -Math.PI) d += Math.PI * 2
  return d
}

/**
 * Angle instrumentation at the joints.
 *
 * Screen space has y running down, so a world beam angle theta (measured from
 * straight down, growing as the machine fires) maps to a canvas angle of
 * simply pi/2 + theta. Every other angle here is taken from the projected
 * points directly, which is immune to the sign conventions in the model.
 */
function drawAngles(
  ctx: CanvasRenderingContext2D,
  p: Projector,
  params: TrebuchetParams,
  pal: Palette,
  pose: MachinePose,
) {
  const deg = (rad: number) => `${num((rad * 180) / Math.PI, 1)}°`

  const axleS = { x: p.x(pose.axle.x), y: p.y(pose.axle.y) }
  const tipS = { x: p.x(pose.tip.x), y: p.y(pose.tip.y) }
  const projS = { x: p.x(pose.projectile.x), y: p.y(pose.projectile.y) }
  const shortS = { x: p.x(pose.shortEnd.x), y: p.y(pose.shortEnd.y) }
  const cwS = { x: p.x(pose.cw.x), y: p.y(pose.cw.y) }

  // --- beam sweep, at the main axle ---------------------------------------
  const theta0 = (params.initialBeamAngle * Math.PI) / 180
  const armFrom = Math.PI / 2 + theta0
  const armNow = Math.PI / 2 + pose.theta
  protractor(
    ctx,
    axleS.x,
    axleS.y,
    Math.min(130, Math.max(24, p.s(params.armLong * 0.4))),
    armFrom,
    armNow,
    deg(pose.theta),
    pal.verdigris,
    { graduate: true, pointerAt: armNow },
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
    protractor(
      ctx,
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
    )
  }

  // --- hanger, at the short-arm end ----------------------------------------
  if (params.type === 'hinged' && params.cwHanger > 0.02) {
    const down = Math.PI / 2
    const hanger = Math.atan2(cwS.y - shortS.y, cwS.x - shortS.x)
    if (Math.abs(delta(down, hanger)) > 0.09) {
      protractor(
        ctx,
        shortS.x,
        shortS.y,
        Math.min(56, Math.max(18, p.s(params.cwHanger * 0.55))),
        down,
        hanger,
        deg(Math.abs(delta(down, hanger))),
        pal.verdigris,
      )
    }
  }
}

function drawDimensions(
  ctx: CanvasRenderingContext2D,
  p: Projector,
  params: TrebuchetParams,
  pal: Palette,
  pose: MachinePose,
  units: UnitSystem,
) {
  const u = unitSymbol('length', units)
  const fmt = (v: number) => `${num(toDisplay(v, 'length', units), 2)}${u}`

  // Beam dimensions ride on the beam so they stay legible as it swings; the
  // pivot height is measured off the frame, where a builder would measure it.
  dimension(
    ctx,
    p.x(pose.axle.x),
    p.y(pose.axle.y),
    p.x(pose.tip.x),
    p.y(pose.tip.y),
    -20,
    fmt(params.armLong),
    pal.verdigris,
  )
  dimension(
    ctx,
    p.x(pose.shortEnd.x),
    p.y(pose.shortEnd.y),
    p.x(pose.axle.x),
    p.y(pose.axle.y),
    -20,
    fmt(params.armShort),
    pal.verdigris,
  )
  if (params.cwHanger > 0.02)
    dimension(
      ctx,
      p.x(pose.shortEnd.x),
      p.y(pose.shortEnd.y),
      p.x(pose.cw.x),
      p.y(pose.cw.y),
      28,
      fmt(params.cwHanger),
      pal.verdigris,
    )
  dimension(
    ctx,
    p.x(pose.tip.x),
    p.y(pose.tip.y),
    p.x(pose.projectile.x),
    p.y(pose.projectile.y),
    24,
    fmt(params.slingLength),
    pal.verdigris,
  )
  dimension(
    ctx,
    p.x(0),
    p.y(0),
    p.x(0),
    p.y(params.pivotHeight),
    -Math.max(46, p.s(params.armLong * 0.55)),
    fmt(params.pivotHeight),
    pal.verdigris,
  )
}
