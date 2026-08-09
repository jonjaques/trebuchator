import { hatchLines, seg, type Instruction, type Point } from './draft.ts'

/**
 * What happens when a nine-tonne granite boulder arrives.
 *
 * This is the only part of the drawing that is not engineering, and it lives in
 * its own file so that stays true of everything else. `sheet.ts` calls it from
 * two places and nothing else knows it exists — delete this module and those
 * calls and the easter egg is gone without a trace anywhere in the drafting.
 *
 * **Two halves, drawn under different rules.** `crater()` is the permanent
 * record of where the shot landed, and it is *drafted*: a dished ground line
 * with the same 45° hatching as the ground band and radial fractures running
 * out from the rim. Anything a reader might measure keeps the sheet's own voice.
 * `fireball()` is the corn, it lasts `BLAST_LIFE`, and it is the only place on
 * this sheet allowed to be loud.
 *
 * **Everything is a pure function of `age`.** The rest of the drawing is a pure
 * function of the playback cursor and this has to be too, or scrubbing back off
 * the end of a shot would leave a fireball behind that no longer has a cause.
 * That is also why the debris is scattered by a seeded LCG rather than
 * `Math.random`: the same boulder throws the same chunks in the same directions
 * every time it is replayed, which is the difference between an explosion and a
 * screensaver.
 *
 * **Sizes are multiples of the projectile's own diameter**, converted through
 * the world scale rather than written in pixels, so the blast keeps its size in
 * *metres* while the camera pulls back off it. A fireball that stayed 200 px
 * across would grow to half a kilometre as the sheet reframed to the range.
 */

/** Seconds. After this the fireball is spent and only the crater remains. */
export const BLAST_LIFE = 2.6

/**
 * Canvas-only depiction colours, in the same sense as `oak` and `iron`: they
 * draw a material, they never appear in the interface, and they are not part of
 * the four-hue signal palette. `fire` is `quench` — the fireball *is* the
 * projectile, so it has every right to the projectile's colour — and only the
 * two hotter tones the shot's own accent cannot reach are new.
 */
export interface BlastColours {
  /** White-hot centre. */
  ember: string
  /** The gold between the core and the body. */
  flame: string
  /** The body of the fireball. `quench`. */
  fire: string
  /** Smoke, thrown rock, and the crater's own ground line. `ink-2`. */
  ink2: string
  /** Crater hatching and the fractures out from its rim. `ink-3`. */
  ink3: string
}

const DEBRIS = 22
const PUFFS = 7

/**
 * Deterministic pseudo-random stream, same idiom as the Pareto search. The seed
 * is fixed rather than derived from the shot: two machines that land in the same
 * place should throw the same rubble, and there is nothing about a trajectory
 * that a debris pattern could honestly encode.
 */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const clamp01 = (u: number) => Math.min(1, Math.max(0, u))
/** 0 before `from`, 1 after `to`, linear between. */
const span = (age: number, from: number, to: number) => clamp01((age - from) / (to - from))
/** Fast out of the gate and asymptotic at the end, which is how blasts expand. */
const easeOut = (u: number, k = 3) => 1 - Math.pow(1 - u, k)

/** A closed regular polygon, for the chunks and the comic flash. */
function polygon(cx: number, cy: number, r: number, sides: number, phase: number): Point[] {
  const out: Point[] = []
  for (let i = 0; i < sides; i++) {
    const a = phase + (i / sides) * Math.PI * 2
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  return out
}

/** The comic sunburst: alternating long and short spikes. */
function star(cx: number, cy: number, outer: number, inner: number, points: number): Point[] {
  const out: Point[] = []
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2
    const r = i % 2 === 0 ? outer : inner
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  return out
}

/** An ellipse as a polyline, for the ground-hugging shock rings. */
function ellipse(cx: number, cy: number, rx: number, ry: number): Point[] {
  const out: Point[] = []
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry])
  }
  return out
}

/**
 * The hole in the ground, and the only part that outlives the bang.
 *
 * Drawn as drafting, not as damage: the ground line dips through a cosine bowl,
 * the bowl carries the ground band's own hatching, and fractures run out from
 * the rim as hairlines. A dark smudge would have been easier and would have
 * disappeared on the dark sheet, where the ground is already near-black.
 *
 * `x`/`y` are the impact in screen pixels, `scale` is pixels per metre, `d` is
 * the projectile diameter in metres.
 */
export function crater(
  x: number,
  y: number,
  scale: number,
  d: number,
  c: BlastColours,
): Instruction[] {
  const r = Math.max(6, scale * d * 1.5)
  const depth = r * 0.42
  const out: Instruction[] = []

  // The bowl, sampled as a cosine so the rim meets the ground line tangentially
  // rather than as two corners.
  const bowl: Point[] = []
  const STEPS = 18
  for (let i = 0; i <= STEPS; i++) {
    const u = i / STEPS
    bowl.push([x - r + 2 * r * u, y + depth * (0.5 - 0.5 * Math.cos(u * Math.PI * 2))])
  }

  // Hatched to the same 9 px pitch as the ground band, so the disturbed ground
  // reads as a section through the same material the band is drawn in. The clip
  // is the bowl alone — `paint` closes a clip path, which runs the last rim back
  // to the first along the ground line for free.
  for (const [a, b] of hatchLines(x - r, y, x + r, y + depth, 9)) {
    out.push({
      op: 'path',
      points: [a, b],
      stroke: { color: c.ink3, width: 1, alpha: 0.5 },
      clip: bowl,
    })
  }
  out.push({ op: 'path', points: bowl, stroke: { color: c.ink2, width: 1.5 } })

  // Fractures out from the rim. Deterministic, and drawn along the ground
  // rather than radiating in all directions — this is a plan of a crack, seen
  // in elevation.
  const rand = lcg(0x5eed)
  for (let i = 0; i < 7; i++) {
    const side = i % 2 === 0 ? 1 : -1
    const from = r * (0.98 + rand() * 0.1)
    const len = r * (0.25 + rand() * 0.7)
    out.push(
      seg(x + side * from, y, x + side * (from + len), y - rand() * 2, {
        color: c.ink3,
        width: 1,
        alpha: 0.55,
      }),
    )
  }
  return out
}

/**
 * The fireball, `age` seconds after impact. Empty outside its life, so a caller
 * can hand it any age without gating.
 *
 * Five overlapping runs, all keyed off the boulder's diameter: a flash and its
 * comic sunburst, the billowing body, two shock rings along the ground, granite
 * thrown on real ballistic arcs, and smoke that outlasts all of it.
 */
export function fireball(
  x: number,
  y: number,
  scale: number,
  d: number,
  age: number,
  c: BlastColours,
): Instruction[] {
  if (age < 0 || age >= BLAST_LIFE) return []
  const out: Instruction[] = []
  /** A length in boulder-diameters, on screen. */
  const m = (k: number) => scale * d * k
  const rand = lcg(0xb1a57)

  // --- smoke ---------------------------------------------------------------
  // Under everything: the fireball punches through its own smoke rather than
  // being veiled by it.
  for (let i = 0; i < PUFFS; i++) {
    const delay = rand() * 0.45
    const drift = (rand() - 0.5) * 2.4
    const rise = 3.4 + rand() * 3.2
    const grow = 0.9 + rand() * 1.9
    const u = span(age, 0.12 + delay, BLAST_LIFE)
    if (u <= 0) continue
    const px = x + m(drift * u)
    const py = y - m(rise * easeOut(u, 1.7)) - m(0.6)
    const r = m(0.55 + grow * easeOut(u, 1.5))
    // Peaks early and thins out — smoke gets bigger and fainter at once, which
    // a single fade would not give.
    const alpha = 0.34 * Math.sin(Math.PI * Math.pow(u, 0.7))
    // Three overlapping lobes per puff, because a circle reads as a bubble and
    // a cluster reads as billow.
    for (const [ox, oy, k] of [
      [0, 0, 1],
      [-0.55, -0.3, 0.72],
      [0.5, -0.42, 0.66],
    ] as const) {
      out.push({
        op: 'circle',
        x: px + r * ox,
        y: py + r * oy,
        r: r * k,
        fill: { color: c.ink2, alpha },
      })
    }
  }

  // --- ground shock --------------------------------------------------------
  // Two rings, offset in time, flattened hard: this is dust kicked out along the
  // ground in elevation, not a ring seen from above.
  for (const [start, life, width] of [
    [0, 0.5, 2.5],
    [0.09, 0.62, 1.5],
  ] as const) {
    const u = span(age, start, start + life)
    if (u <= 0 || u >= 1) continue
    const rx = m(0.8 + 9.5 * easeOut(u, 2.2))
    out.push({
      op: 'path',
      points: ellipse(x, y, rx, rx * 0.2),
      stroke: { color: c.flame, width, alpha: (1 - u) * 0.75 },
    })
  }

  // --- the body ------------------------------------------------------------
  const b = span(age, 0, 0.8)
  if (b < 1) {
    const rise = m(1.7 * easeOut(b, 2))
    const R = m(0.7 + 5.6 * easeOut(b, 2.4))
    const cy = y - rise - R * 0.35
    const fade = 1 - span(age, 0.4, 0.86)

    // Lobes first, so the body's own disc reads as the mass they bulge out of.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + b * 0.9
      out.push({
        op: 'circle',
        x: x + Math.cos(a) * R * 0.68,
        y: cy + Math.sin(a) * R * 0.62,
        r: R * (0.38 + 0.08 * Math.sin(i * 2.3)),
        fill: { color: c.fire, alpha: fade * 0.85 },
      })
    }
    out.push({ op: 'circle', x, y: cy, r: R, fill: { color: c.fire, alpha: fade } })
    // The two hotter tones sit inside and die first, which is what turns an
    // orange disc into something with a temperature.
    out.push({
      op: 'circle',
      x,
      y: cy + R * 0.08,
      r: R * 0.62,
      fill: { color: c.flame, alpha: fade * (1 - span(age, 0.22, 0.6)) },
    })
    out.push({
      op: 'circle',
      x,
      y: cy + R * 0.12,
      r: R * 0.3,
      fill: { color: c.ember, alpha: 1 - span(age, 0.05, 0.34) },
    })
  }

  // --- flash ---------------------------------------------------------------
  const f = span(age, 0, 0.15)
  if (f < 1) {
    const outer = m(2 + 6.5 * easeOut(f, 2))
    out.push({
      op: 'path',
      points: star(x, y - m(0.5), outer, outer * 0.4, 11),
      close: true,
      fill: { color: c.ember, alpha: (1 - f) * 0.85 },
    })
    out.push({
      op: 'circle',
      x,
      y: y - m(0.5),
      r: m(0.6 + 2.4 * easeOut(f, 2)),
      fill: { color: c.ember, alpha: 1 - f },
    })
  }

  // --- debris --------------------------------------------------------------
  // Last, so the rubble is thrown *in front of* the fireball. Drawn under it,
  // the chunks spent the whole first half second inside an opaque disc six
  // times their own throw distance across, and the blast read as a plain
  // cartoon balloon with nothing coming out of it.
  //
  // Real ballistics at 1 g, in world units, so they arc instead of drifting.
  // They rest where they land — the crater under them is permanent, and rubble
  // that vanished in mid-air would be the one thing here a reader could catch
  // out.
  const G = 9.81
  // Chosen so the longest hang time (straight up, at the top of the speed
  // range) is just inside the moment the fade starts, which is what makes the
  // claim above true: every chunk is resting on the ground before any of them
  // begins to disappear.
  const V = 4.5 * d
  const gone = span(age, BLAST_LIFE - 0.55, BLAST_LIFE)
  for (let i = 0; i < DEBRIS; i++) {
    const a = (-165 + rand() * 150) * (Math.PI / 180)
    const v = V * (0.35 + rand() * 0.85)
    // 20–70 cm off a six-foot boulder, which is what spalls off granite hit
    // this hard — and, at the framing the camera pulls out to, the smallest
    // chunk that is still a chunk rather than a speck.
    const size = m(0.11 + rand() * 0.27)
    const spin = (rand() - 0.5) * 14
    const vx = Math.cos(a) * v
    const vy = -Math.sin(a) * v
    // Flight time back to the ground, so a chunk stops at its own landing
    // rather than at some shared cut-off.
    const land = vy > 0 ? (2 * vy) / G : 0
    const tt = Math.min(age, land)
    const px = x + scale * vx * tt
    const py = y - scale * (vy * tt - 0.5 * G * tt * tt)
    out.push({
      op: 'path',
      points: polygon(px, py, size, 5, spin * tt),
      close: true,
      fill: { color: c.ink2, alpha: (1 - gone) * 0.9 },
    })
  }

  return out
}
