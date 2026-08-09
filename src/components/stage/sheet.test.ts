import { describe, expect, it } from 'vitest'
import { layout, type Palette, type SheetInput } from './sheet.ts'
import type { Instruction, MeasureText } from './draft.ts'
import { fitRect } from './camera.ts'
import { simulateShot } from '@/lib/treb/simulate.ts'
import { presetById } from '@/lib/treb/presets.ts'

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
      ins.filter((i) => i.op === 'path' && i.stroke?.color === palette.verdigris && i.stroke.alpha === 0.32)
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
