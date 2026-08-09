/**
 * The drafting vocabulary: instructions, type, and the rules of a setting-out
 * drawing. There is no trebuchet in this file.
 *
 * `sheet.ts` composes a machine out of these; `paint.ts` walks the instructions
 * onto a canvas. The three-way split exists because the rules worth arguing
 * about are all *here* — when a dimension is too short to letter, when a
 * protractor's figure goes inside its arc rather than outside, what a grid step
 * rounds to — and they are the part that wants asserting on directly.
 *
 * They used to live in `sheet.ts` alongside the composer, which meant every one
 * of them had to be exported so a test could reach it: eight exports on the
 * sheet's interface that no caller ever used, and a test suite that mostly
 * asserted on the sheet's internals rather than on its drawing. Splitting the
 * module is what lets both halves be tested through an interface someone
 * actually calls.
 *
 * Instructions are plain objects in screen pixels, so a test asserts on the
 * drawing instead of spying on the brush.
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

/** Below this length a dimension's figure is wider than the dimension itself. */
export const MIN_DIMENSION = 52

/** Below this radius a protractor is smaller than its own graduations. */
export const MIN_PROTRACTOR_RADIUS = 16

/** Above this radius the arc has room for its figure inside it. */
export const LABEL_INSIDE_RADIUS = 44

export const mono = (size: number, weight = 500): Font => ({ size, weight, family: 'mono' })
export const sans = (size: number, weight = 500, tracking?: number): Font => ({
  size,
  weight,
  family: 'sans',
  tracking,
})

/** A single straight run. The drawing is mostly these. */
export function seg(x0: number, y0: number, x1: number, y1: number, stroke: Stroke): Instruction {
  return { op: 'path', points: [[x0, y0], [x1, y1]], stroke }
}

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
 * 1 / 2 / 5 x 10^n spacing, never finer than 90 px on screen — computed and
 * returned in *display* units, which is the whole point: a grid stepped in
 * tidy metres letters itself as "7 ft, 13 ft" the moment the sheet reads in
 * feet. `unitScale` is display units per metre (1 for metric, ~3.28 for feet);
 * the caller converts the returned step back to metres to place the lines.
 *
 * The upper bound is 2.5x the 90 px target rather than anything tidier: a
 * target landing just above 2 in its decade has to round up to 5.
 */
export function gridStep(scale: number, unitScale = 1): number {
  const target = (90 / scale) * unitScale
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
  opts: {
    fontSize?: number
    weight?: number
    clampX?: [number, number]
    /**
     * Fades the whole run — rule, heads and figure together. It exists so a
     * sheet can emphasise one dimension by dimming its neighbours rather than
     * by giving the important one a colour of its own; this drawing carries two
     * accents with one job each, and verdigris already means "measurement".
     */
    alpha?: number
  } = {},
): Instruction[] {
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy)
  if (len < MIN_DIMENSION) return []
  const alpha = opts.alpha ?? 1

  const ux = dx / len
  const uy = dy / len
  // Perpendicular, pointing to the offset side.
  const nx = -uy
  const ny = ux
  const ox = nx * off
  const oy = ny * off

  const a: Point = [ax + ox, ay + oy]
  const b: Point = [bx + ox, by + oy]

  const stroke: Stroke = { color: colour, width: 1, alpha }
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
  const head: Fill = { color: colour, alpha }
  out.push({ op: 'path', points: arrowHead(a[0], a[1], Math.atan2(-uy, -ux), ah), close: true, fill: head })
  out.push({ op: 'path', points: arrowHead(b[0], b[1], Math.atan2(uy, ux), ah), close: true, fill: head })

  // A drawn figure sits *in* the line, which is why the line was broken above.
  out.push({
    op: 'text',
    x: mx,
    y: my,
    text: label,
    font,
    fill: { color: colour, alpha },
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
