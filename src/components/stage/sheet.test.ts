import { describe, expect, it } from 'vitest'
import {
  arrowHead,
  delta,
  dimension,
  frameIndexAt,
  gridStep,
  hatchLines,
  layout,
  LABEL_INSIDE_RADIUS,
  MIN_DIMENSION,
  MIN_PROTRACTOR_RADIUS,
  protractor,
  sampleTrajectory,
  type Instruction,
  type MeasureText,
  type Palette,
  type SheetInput,
} from './sheet.ts'
import { fitRect } from './camera.ts'
import { simulateShot } from '@/lib/treb/simulate.ts'
import { presetById } from '@/lib/treb/presets.ts'

/**
 * Every glyph is 0.6 em wide. Real metrics come from the canvas, but nothing
 * here is asserting typography — the rules under test only care that a wider
 * figure needs a wider gap.
 */
const measure: MeasureText = (text, font) => text.length * font.size * 0.6

const palette: Palette = {
  sheet: '#sheet',
  ink: '#ink',
  ink2: '#ink2',
  ink3: '#ink3',
  rule: '#rule',
  quench: '#quench',
  verdigris: '#verdigris',
  oak: '#oak',
  iron: '#iron',
}

const texts = (ins: Instruction[]) =>
  ins.flatMap((i) => (i.op === 'text' ? [i as Extract<Instruction, { op: 'text' }>] : []))

describe('grid spacing', () => {
  it('rounds to 1, 2 or 5 times a power of ten', () => {
    for (const scale of [0.03, 0.4, 1, 7, 55, 400]) {
      const step = gridStep(scale)
      const mantissa = step / Math.pow(10, Math.floor(Math.log10(step)))
      expect([1, 2, 5], `scale ${scale}`).toContain(Math.round(mantissa * 10) / 10)
    }
  })

  it('keeps a step inside a legible band on screen', () => {
    // Never finer than the 90 px it targets, and never worse than the 2.5x a
    // round-up from just over 2 in the decade costs.
    for (const scale of [0.05, 0.5, 3, 40, 250]) {
      const px = gridStep(scale) * scale
      expect(px, `scale ${scale}`).toBeGreaterThanOrEqual(90 - 1e-9)
      expect(px, `scale ${scale}`).toBeLessThan(225 + 1e-9)
    }
  })
})

describe('angle arithmetic', () => {
  it('takes the shorter way round', () => {
    expect(delta(0, 0.5)).toBeCloseTo(0.5, 12)
    expect(delta(0, -0.5)).toBeCloseTo(-0.5, 12)
    // Just past half a turn is a small rotation the other way, not a big one.
    expect(delta(0, Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1, 12)
    expect(delta(0.1, 0.1 + 4 * Math.PI)).toBeCloseTo(0, 12)
  })

  it('puts a half turn at +pi, never -pi', () => {
    expect(delta(0, Math.PI)).toBeCloseTo(Math.PI, 12)
    expect(delta(0, -Math.PI)).toBeCloseTo(Math.PI, 12)
  })
})

describe('reading a shot at a time', () => {
  const frames = [0, 0.1, 0.2, 0.3, 0.4].map((t) => ({ t }))

  it('finds the last frame at or before the cursor', () => {
    expect(frameIndexAt(frames as never, -1)).toBe(0)
    expect(frameIndexAt(frames as never, 0.2)).toBe(2)
    expect(frameIndexAt(frames as never, 0.25)).toBe(2)
    expect(frameIndexAt(frames as never, 99)).toBe(4)
  })

  const traj = [
    { t: 0, x: 0, y: 10, vx: 1, vy: 0 },
    { t: 1, x: 10, y: 20, vx: 1, vy: 0 },
    { t: 2, x: 30, y: 0, vx: 1, vy: 0 },
  ]

  it('interpolates between flight samples', () => {
    expect(sampleTrajectory(traj, 0.5)).toEqual({ x: 5, y: 15 })
    expect(sampleTrajectory(traj, 1.25)).toEqual({ x: 15, y: 15 })
  })

  it('holds at both ends rather than running off them', () => {
    expect(sampleTrajectory(traj, -5)).toBe(traj[0])
    expect(sampleTrajectory(traj, 0)).toBe(traj[0])
    expect(sampleTrajectory(traj, 99)).toBe(traj[2])
  })

  it('survives two samples sharing a timestamp', () => {
    const flat = [
      { t: 0, x: 0, y: 0, vx: 0, vy: 0 },
      { t: 0, x: 4, y: 4, vx: 0, vy: 0 },
    ]
    const at = sampleTrajectory(flat, 0.5)
    expect(Number.isFinite(at.x)).toBe(true)
    expect(Number.isFinite(at.y)).toBe(true)
  })
})

describe('section hatching', () => {
  it('rules parallel lines at 45 degrees', () => {
    const lines = hatchLines(0, 0, 100, 40, 10)
    expect(lines.length).toBeGreaterThan(5)
    for (const [a, b] of lines) {
      // Down-right at 45: equal run and rise.
      expect(Math.abs(b[0] - a[0])).toBeCloseTo(Math.abs(b[1] - a[1]), 9)
    }
  })

  it('spaces them by the spacing it was given', () => {
    const a = hatchLines(0, 0, 100, 40, 10)
    const b = hatchLines(0, 0, 100, 40, 5)
    expect(b.length).toBeGreaterThan(a.length)
    expect(a[1][0][0] - a[0][0][0]).toBeCloseTo(10, 9)
  })

  it('starts far enough back to cover the near corner', () => {
    const lines = hatchLines(0, 0, 100, 40, 10)
    expect(lines[0][0][0]).toBeLessThanOrEqual(0)
  })
})

describe('arrowheads', () => {
  it('points its apex at the measured end', () => {
    const head = arrowHead(50, 20, 0, 7)
    expect(head).toHaveLength(3)
    expect(head[0]).toEqual([50, 20])
    // Body sits behind the apex, along -ang.
    expect(head[1][0]).toBeLessThan(50)
    expect(head[2][0]).toBeLessThan(50)
  })
})

describe('dimensions', () => {
  const draw = (ax: number, ay: number, bx: number, by: number, opts = {}) =>
    dimension(ax, ay, bx, by, -20, '1.25m', '#c', measure, opts)

  it('drops a dimension too short to letter', () => {
    // A cluster of these around the pivot letters over itself, and one missing
    // figure is better than three illegible ones.
    expect(draw(0, 0, MIN_DIMENSION - 1, 0)).toEqual([])
    expect(draw(0, 0, MIN_DIMENSION + 1, 0).length).toBeGreaterThan(0)
  })

  it('draws witness lines, a broken dimension line, two heads and a figure', () => {
    const ins = draw(0, 0, 200, 0)
    expect(texts(ins).map((t) => t.text)).toEqual(['1.25m'])
    const heads = ins.filter((i) => i.op === 'path' && i.close && i.fill)
    expect(heads).toHaveLength(2)
    // Two witness lines plus the dimension line broken either side of the gap.
    const lines = ins.filter((i) => i.op === 'path' && !i.close && i.stroke)
    expect(lines).toHaveLength(4)
  })

  it('leaves a gap wide enough for the figure', () => {
    const ins = draw(0, 0, 300, 0)
    const label = texts(ins)[0]
    const runs = ins.filter(
      (i): i is Extract<Instruction, { op: 'path' }> => i.op === 'path' && !i.close && !!i.stroke,
    )
    // The last two strokes are the dimension line either side of the figure.
    const [left, right] = runs.slice(-2)
    const gap = right.points[0][0] - left.points[1][0]
    expect(gap).toBeGreaterThan(measure('1.25m', { size: 11, weight: 500, family: 'mono' }))
    expect(label.x).toBeGreaterThan(left.points[1][0])
    expect(label.x).toBeLessThan(right.points[0][0])
  })

  it('slides the figure back onto the sheet when an end runs off it', () => {
    // The range dimension often has its far end past the right-hand edge; the
    // figure has to stay readable rather than leave with the arrowhead.
    const free = draw(0, 100, 4000, 100)
    const clamped = draw(0, 100, 4000, 100, { clampX: [8, 400] as [number, number] })
    expect(texts(free)[0].x).toBeGreaterThan(400)
    expect(texts(clamped)[0].x).toBeLessThanOrEqual(400)
    // A horizontal dimension keeps its figure on the line it belongs to.
    expect(texts(clamped)[0].y).toBeCloseTo(80, 9)
  })
})

describe('protractors', () => {
  const draw = (radius: number, opts = {}) =>
    protractor(100, 100, radius, 0, Math.PI / 2, '45.0°', '#c', opts)

  it('bails below the radius its own graduations need', () => {
    expect(draw(MIN_PROTRACTOR_RADIUS - 1)).toEqual([])
    expect(draw(MIN_PROTRACTOR_RADIUS).length).toBeGreaterThan(0)
  })

  it('fills the swept sector under the stroked arc', () => {
    const ins = draw(60)
    const arcs = ins.filter((i): i is Extract<Instruction, { op: 'arc' }> => i.op === 'arc')
    expect(arcs).toHaveLength(2)
    expect(arcs[0].sector).toBe(true)
    expect(arcs[0].fill?.alpha).toBeLessThan(0.1)
    expect(arcs[1].stroke).toBeTruthy()
  })

  it('puts the figure inside a big arc and outside a small one', () => {
    const big = texts(draw(LABEL_INSIDE_RADIUS + 20))[0]
    const small = texts(draw(LABEL_INSIDE_RADIUS - 20))[0]
    const from = (t: { x: number; y: number }) => Math.hypot(t.x - 100, t.y - 100)
    expect(from(big)).toBeLessThan(LABEL_INSIDE_RADIUS + 20)
    // On a short hanger an inside label would land inside the weight box.
    expect(from(small)).toBeGreaterThan(LABEL_INSIDE_RADIUS - 20)
  })

  it('graduates every ten degrees, every third one major', () => {
    const ins = protractor(0, 0, 60, 0, Math.PI, '180°', '#c', { graduate: true })
    const ticks = ins.filter(
      (i): i is Extract<Instruction, { op: 'path' }> =>
        i.op === 'path' && i.stroke?.alpha !== undefined && i.stroke.alpha < 1,
    )
    // 180 degrees in 10 degree steps, inclusive of both ends.
    expect(ticks).toHaveLength(19)
    const major = ticks.filter((t) => (t.stroke?.alpha ?? 0) > 0.5)
    expect(major).toHaveLength(7)
  })

  it('draws the pin it is closing on as a dashed radial', () => {
    const ins = draw(60, { ghostAt: 1, ghostLabel: 'pin 40°' })
    const dashed = ins.filter((i) => i.op === 'path' && i.stroke?.dash)
    expect(dashed).toHaveLength(1)
    expect(texts(ins).map((t) => t.text)).toContain('pin 40°')
  })
})

describe('the whole sheet', () => {
  const params = presetById('backyard')!.params
  const result = simulateShot(params)
  if (!result.ok) throw new Error('the backyard preset should throw')

  const sheet = (over: Partial<SheetInput> = {}): SheetInput => ({
    w: 900,
    h: 500,
    // Framed on the machine. Zoomed out to the whole field every dimension is
    // shorter than MIN_DIMENSION and correctly dropped, which is its own test.
    cam: fitRect({ x0: -3, y0: -0.5, x1: 3, y1: 4 }, 900, 500, 56),
    palette,
    params,
    result,
    t: 0,
    showDimensions: false,
    showAngles: false,
    showGrid: true,
    ghosts: [],
    units: 'metric',
    ...over,
  })

  it('says so plainly when the machine will not throw', () => {
    const dead = simulateShot({ ...params, cwMass: 0 })
    const ins = layout(sheet({ result: dead }), measure)
    expect(texts(ins).map((t) => t.text)).toContain('NO VALID SHOT')
  })

  it('carries the range as a dimension across the bottom', () => {
    const ins = layout(sheet(), measure)
    const labels = texts(ins).map((t) => t.text)
    expect(labels).toContain('RANGE FROM PIVOT')
    expect(labels.some((l) => l.endsWith(' m'))).toBe(true)
  })

  it('only draws the machine dimensions when they are asked for', () => {
    const off = layout(sheet(), measure).length
    const on = layout(sheet({ showDimensions: true }), measure).length
    expect(on).toBeGreaterThan(off)
  })

  it('only draws the protractors when they are asked for', () => {
    const off = layout(sheet({ t: result.timeline.releaseT / 2 }), measure).length
    const on = layout(
      sheet({ t: result.timeline.releaseT / 2, showAngles: true }),
      measure,
    ).length
    expect(on).toBeGreaterThan(off)
  })

  it('marks the impact only once the shot has landed', () => {
    const mid = layout(sheet({ t: result.timeline.releaseT + 0.1 }), measure)
    const landed = layout(sheet({ t: result.timeline.duration }), measure)
    expect(landed.length).toBeGreaterThan(mid.length)
  })

  it('drops the grid when it is switched off', () => {
    const on = layout(sheet(), measure).length
    const off = layout(sheet({ showGrid: false }), measure).length
    expect(off).toBeLessThan(on)
  })

  it('draws a saved shot as one dashed ghost', () => {
    const ghost = { trajectory: [{ x: 0, y: 1 }, { x: 5, y: 4 }, { x: 12, y: 0 }], label: 'earlier' }
    const ins = layout(sheet({ ghosts: [ghost] }), measure)
    const dashedGhosts = ins.filter(
      (i) => i.op === 'path' && i.stroke?.color === palette.ink3 && i.stroke.dash?.[0] === 3,
    )
    expect(dashedGhosts).toHaveLength(1)
  })

  it('letters each ghost at its apex so saved shots can be told apart', () => {
    const ghosts = [
      { trajectory: [{ x: 0, y: 1 }, { x: 5, y: 4 }, { x: 12, y: 0 }], label: 'earlier' },
      { trajectory: [{ x: 0, y: 1 }, { x: 7, y: 6 }, { x: 16, y: 0 }], label: 'longer sling' },
    ]
    const ins = layout(sheet({ ghosts }), measure)
    const labels = texts(ins).map((t) => t.text)
    expect(labels).toContain('earlier')
    expect(labels).toContain('longer sling')
  })

  it('lands the impact and the range dimension on the target plane, not the machine’s', () => {
    const dropped = simulateShot({ ...params, targetDrop: 20 })
    if (!dropped.ok) throw new Error('the dropped-target shot should throw')
    const level = layout(sheet({ t: result.timeline.duration }), measure)
    const below = layout(
      sheet({ params: { ...params, targetDrop: 20 }, result: dropped, t: dropped.timeline.duration }),
      measure,
    )
    // The caption follows the dimension, which hangs below the landing plane.
    const caption = (ins: Instruction[]) =>
      texts(ins).find((t) => t.text === 'RANGE FROM PIVOT')!
    expect(caption(below).y).toBeGreaterThan(caption(level).y)
    // A second ground line appears: the shelf of target ground under the impact.
    const groundLines = (ins: Instruction[]) =>
      ins.filter(
        (i): i is Extract<Instruction, { op: 'path' }> =>
          i.op === 'path' && !i.close && i.stroke?.color === palette.ink2 && i.stroke.width === 1.5,
      )
    expect(groundLines(below)).toHaveLength(groundLines(level).length + 1)
  })
})
