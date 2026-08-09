import { describe, expect, it } from 'vitest'
import { BLAST_LIFE, crater, fireball, type BlastColours } from './blast.ts'
import type { Instruction } from './draft.ts'

const c: BlastColours = {
  ember: '#ember',
  flame: '#flame',
  fire: '#fire',
  ink2: '#ink2',
  ink3: '#ink3',
}

/** Impact at (400, 300), 12 px per metre, a six-foot boulder. */
const at = (age: number, scale = 12) => fireball(400, 300, scale, 1.829, age, c)

const circles = (ins: Instruction[], colour: string) =>
  ins.filter(
    (i): i is Extract<Instruction, { op: 'circle' }> =>
      i.op === 'circle' && i.fill?.color === colour,
  )

const paths = (ins: Instruction[], pick: (p: Extract<Instruction, { op: 'path' }>) => boolean) =>
  ins.filter((i): i is Extract<Instruction, { op: 'path' }> => i.op === 'path' && pick(i))

/** The chunks of granite: closed rock-coloured polygons. */
const chunks = (ins: Instruction[]) =>
  paths(ins, (p) => p.close === true && p.fill?.color === '#ink2')

describe('the fireball', () => {
  it('is the same explosion every time it is replayed', () => {
    // The rest of the drawing is a pure function of the playback cursor and
    // this has to be too — scattered from `Math.random` instead, scrubbing back
    // and forth across the impact would reshuffle the rubble each pass.
    expect(at(0.4)).toEqual(at(0.4))
    expect(at(1.7)).toEqual(at(1.7))
  })

  it('has not happened before the impact and is spent after its life', () => {
    expect(at(-0.01)).toHaveLength(0)
    expect(at(BLAST_LIFE)).toHaveLength(0)
    expect(at(BLAST_LIFE + 5)).toHaveLength(0)
    expect(at(0).length).toBeGreaterThan(0)
  })

  it('punches through its own smoke rather than being veiled by it', () => {
    // Instruction order is the only depth this drawing has.
    const ins = at(0.4)
    const smoke = ins.findIndex((i) => i.op === 'circle' && i.fill?.color === '#ink2')
    const fire = ins.findIndex((i) => i.op === 'circle' && i.fill?.color === '#fire')
    expect(smoke).toBeGreaterThanOrEqual(0)
    expect(fire).toBeGreaterThan(smoke)
  })

  it('is measured in metres, not pixels', () => {
    // Sized off the world scale so the camera can pull back off it. Fixed in
    // pixels it would have grown to half a kilometre across as the sheet
    // reframed from the crater to the range.
    const near = circles(at(0.3, 40), '#fire').at(-1)!
    const far = circles(at(0.3, 10), '#fire').at(-1)!
    expect(near.r).toBeCloseTo(far.r * 4, 6)
  })

  it('throws granite up and lets all of it come back down before it fades', () => {
    // Screen y grows downward, so "above the impact" is a smaller y. Rubble
    // that hung in the air and then vanished would be the one thing here a
    // reader could catch out, so the launch speed is bounded by the fade.
    const early = chunks(at(0.35))
    expect(early.length).toBeGreaterThan(10)
    expect(early.some((p) => p.points.every(([, y]) => y < 290))).toBe(true)

    const settled = chunks(at(BLAST_LIFE - 0.3))
    expect(settled).toHaveLength(early.length)
    expect(settled.every((p) => p.points.some(([, y]) => y >= 299))).toBe(true)
  })
})

describe('the crater', () => {
  it('dips the ground line through a bowl and meets it again at both rims', () => {
    const bowl = paths(crater(400, 300, 12, 1.829, c), (p) => p.stroke?.color === '#ink2')
    expect(bowl).toHaveLength(1)
    const ys = bowl[0].points.map(([, y]) => y)
    expect(ys[0]).toBeCloseTo(300, 6)
    expect(ys.at(-1)).toBeCloseTo(300, 6)
    expect(Math.max(...ys)).toBeGreaterThan(300)
  })

  it('is drafted rather than scorched', () => {
    // Hatching clipped to the bowl, in the ground band's own idiom, plus
    // unclipped fractures running out from the rim. A dark smudge would have
    // been easier and would have vanished on the dark sheet, where the ground
    // is already near-black.
    const ins = crater(400, 300, 12, 1.829, c)
    expect(paths(ins, (p) => p.stroke?.color === '#ink3' && p.clip != null).length).toBeGreaterThan(
      3,
    )
    expect(paths(ins, (p) => p.stroke?.color === '#ink3' && p.clip == null)).toHaveLength(7)
    // Nothing in the permanent record is drawn in a fire colour.
    expect(circles(ins, '#fire')).toHaveLength(0)
    expect(circles(ins, '#ember')).toHaveLength(0)
  })
})
