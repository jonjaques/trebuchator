import { describe, expect, it } from 'vitest'
import { isBoulderShot, layout, type Palette, type SheetInput } from './sheet.ts'
import type { Instruction, MeasureText } from './draft.ts'
import { fitRect } from './camera.ts'
import { simulateShot } from '@/lib/treb/simulate.ts'
import { PRESETS, presetById } from '@/lib/treb/presets.ts'

/**
 * Every glyph is 0.6 em wide. Real metrics come from the canvas, but nothing
 * here is asserting typography — the drafting rules that care about the width
 * of a figure are tested against `draft.ts` directly.
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
  ember: '#ember',
  flame: '#flame',
}

const texts = (ins: Instruction[]) =>
  ins.flatMap((i) => (i.op === 'text' ? [i as Extract<Instruction, { op: 'text' }>] : []))

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

  it('still draws the machine when it will not throw', () => {
    // The reason is reported over the sheet by `Stage`; the drawing stays up,
    // because it is where someone finds the dimension that broke it.
    const dead = simulateShot({ ...params, cwMass: 0 })
    expect(dead.ok).toBe(false)
    const ins = layout(sheet({ result: dead }), measure)
    const beam = ins.filter((i) => i.op === 'path' && i.stroke?.color === palette.oak)
    expect(beam.length).toBeGreaterThan(0)
  })

  it('carries no range dimension for a shot that never flew', () => {
    const dead = simulateShot({ ...params, cwMass: 0 })
    const ins = layout(sheet({ result: dead }), measure)
    expect(texts(ins).map((t) => t.text)).not.toContain('RANGE FROM PIVOT')
  })

  it('draws the pointed-at dimension with the annotation layer off', () => {
    const off = layout(sheet(), measure)
    const lit = layout(sheet({ highlight: 'slingLength' }), measure)
    // One dimension appears: witness lines, a broken rule, two heads, a figure.
    expect(lit.length).toBeGreaterThan(off.length)
  })

  it('fades the others when one dimension is pointed at', () => {
    const all = layout(sheet({ showDimensions: true }), measure)
    const lit = layout(sheet({ showDimensions: true, highlight: 'slingLength' }), measure)
    const faded = (ins: Instruction[]) =>
      ins.filter(
        (i) => i.op === 'path' && i.stroke?.color === palette.verdigris && i.stroke.alpha === 0.32,
      )
    expect(faded(all)).toHaveLength(0)
    expect(faded(lit).length).toBeGreaterThan(0)
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
    const on = layout(sheet({ t: result.timeline.releaseT / 2, showAngles: true }), measure).length
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
    const ghost = {
      trajectory: [
        { x: 0, y: 1 },
        { x: 5, y: 4 },
        { x: 12, y: 0 },
      ],
      label: 'earlier',
    }
    const ins = layout(sheet({ ghosts: [ghost] }), measure)
    const dashedGhosts = ins.filter(
      (i) => i.op === 'path' && i.stroke?.color === palette.ink3 && i.stroke.dash?.[0] === 3,
    )
    expect(dashedGhosts).toHaveLength(1)
  })

  it('letters each ghost at its apex so saved shots can be told apart', () => {
    const ghosts = [
      {
        trajectory: [
          { x: 0, y: 1 },
          { x: 5, y: 4 },
          { x: 12, y: 0 },
        ],
        label: 'earlier',
      },
      {
        trajectory: [
          { x: 0, y: 1 },
          { x: 7, y: 6 },
          { x: 16, y: 0 },
        ],
        label: 'longer sling',
      },
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
      sheet({
        params: { ...params, targetDrop: 20 },
        result: dropped,
        t: dropped.timeline.duration,
      }),
      measure,
    )
    // The caption follows the dimension, which hangs below the landing plane.
    const caption = (ins: Instruction[]) => texts(ins).find((t) => t.text === 'RANGE FROM PIVOT')!
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

describe('the boulder', () => {
  const params = presetById('man-thrower')!.params
  const result = simulateShot(params)
  if (!result.ok) throw new Error('the man thrower should throw')

  // Something to hand `layout` in place of a decoded image. Nothing in the
  // drawing touches it — it is carried straight through to `drawImage`.
  const sprite = {} as CanvasImageSource

  const sheet = (over: Partial<SheetInput> = {}): SheetInput => ({
    w: 900,
    h: 500,
    cam: fitRect({ x0: -20, y0: -2, x1: 60, y1: 50 }, 900, 500, 56),
    palette,
    params,
    result,
    t: 0,
    showDimensions: false,
    showAngles: false,
    showGrid: false,
    ghosts: [],
    units: 'metric',
    sprite,
    ...over,
  })

  const images = (ins: Instruction[]) => ins.filter((i) => i.op === 'image')

  it('is the only machine in the library throwing one', () => {
    // The trigger is physical rather than a preset id, so it survives someone
    // lengthening the sling. These two thresholds are what keep it from also
    // catching the siege engines, which throw stone at a fifth the size, and
    // the pumpkin hurlers, which throw something boulder-sized at a quarter the
    // density.
    const boulders = PRESETS.filter((p) => isBoulderShot(p.params)).map((p) => p.id)
    expect(boulders).toEqual(['man-thrower'])
  })

  it('stays a boulder when the machine around it is retuned', () => {
    expect(isBoulderShot({ ...params, slingLength: 40, cwMass: 500_000 })).toBe(true)
    expect(isBoulderShot({ ...params, projectileMass: 1500 })).toBe(false)
  })

  it('is drawn in place of the quench mark, cradled and in the air alike', () => {
    const cocked = layout(sheet(), measure)
    const flying = layout(sheet({ t: result.timeline.releaseT + 2 }), measure)
    expect(images(cocked)).toHaveLength(1)
    expect(images(flying)).toHaveLength(1)
    const dots = (ins: Instruction[]) =>
      ins.filter((i) => i.op === 'circle' && i.fill?.color === palette.quench)
    expect(dots(cocked)).toHaveLength(0)
    expect(dots(flying)).toHaveLength(0)
  })

  it('falls back to the quench mark until the sprite has decoded', () => {
    // A sprite that has not loaded — or never will — must not take the shot off
    // the sheet.
    const ins = layout(sheet({ sprite: null }), measure)
    expect(images(ins)).toHaveLength(0)
    expect(ins.filter((i) => i.op === 'circle' && i.fill?.color === palette.quench)).toHaveLength(1)
  })

  it('tumbles slowly, and only once it is off the sling', () => {
    const turn = (t: number) => {
      const img = images(layout(sheet({ t }), measure))[0]
      if (img.op !== 'image') throw new Error('expected the boulder')
      return img.rotate ?? 0
    }
    const held = turn(result.timeline.releaseT)
    const flown = turn(result.timeline.releaseT + 4)
    // Under a turn a second. Free rotation at the speed it left the sling would
    // be roughly sixteen, which reads as machinery rather than as nine tonnes.
    expect(Math.abs(flown - held) / 4).toBeLessThan(2 * Math.PI)
    expect(Math.abs(flown - held)).toBeGreaterThan(0.5)
  })

  it('leaves a crater on landing and only detonates when given a clock', () => {
    const landed = layout(sheet({ t: result.timeline.duration }), measure)
    const blazing = layout(sheet({ t: result.timeline.duration, blast: 0.2 }), measure)
    const fire = (ins: Instruction[]) =>
      ins.filter(
        (i) => i.op === 'circle' && i.fill?.color === palette.quench && i.fill.alpha != null,
      )
    // The crater is permanent; the fireball is on `Stage`'s wall clock, and is
    // absent under reduced motion, which is what a null blast means.
    expect(fire(landed)).toHaveLength(0)
    expect(fire(blazing).length).toBeGreaterThan(0)
    expect(blazing.length).toBeGreaterThan(landed.length)
  })

  it('replaces the splash rather than drawing both marks', () => {
    const stone = layout(sheet({ t: result.timeline.duration }), measure)
    // The splash is five two-point rays in flat quench. The whip inside the
    // machine is the same colour and weight, so the run length is what tells
    // them apart.
    const splash = (ins: Instruction[]) =>
      ins.filter(
        (i) =>
          i.op === 'path' &&
          i.points.length === 2 &&
          i.stroke?.color === palette.quench &&
          i.stroke.width === 1.5 &&
          i.stroke.alpha == null,
      )
    expect(splash(stone)).toHaveLength(0)
    // …and it is still there for every machine that is not throwing granite.
    const backyard = presetById('backyard')!.params
    const shot = simulateShot(backyard)
    if (!shot.ok) throw new Error('the backyard preset should throw')
    expect(
      splash(
        layout(
          sheet({ params: backyard, result: shot, t: shot.timeline.duration, sprite: null }),
          measure,
        ),
      ),
    ).toHaveLength(5)
  })
})
