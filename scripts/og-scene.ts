// Regenerates public/og.png — the social share banner. Run: bun scripts/og-scene.ts
//
// The banner's machine is not drawn by hand: it is the app's own sheet at
// t = 0.93 s of the default shot, taken from layout() and serialized to SVG, so
// the drawing on the card is exactly the drawing in the app. The page is
// rendered by headless Chrome (with the app's fonts inlined as data URIs, so no
// network and no fontconfig lottery) at 2x, then downscaled by ImageMagick.
// Both are machine deps, not package.json deps — this runs on demand, not in CI.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PARAMS } from '../src/lib/treb/presets.ts'
import { simulateShot } from '../src/lib/treb/simulate.ts'
import { layout, type Instruction, type Stroke, type Fill } from '../src/components/stage/sheet.ts'
import { projector } from '../src/components/stage/camera.ts'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ROOT = join(import.meta.dir, '..')

const W = 1200
const H = 630
const T = 0.93
const GROUND_Y = 500
const AXLE_X = 830 // screen x of the machine datum (world x = 0)
const LAND_X = 1148 // where the stylized arc touches down

// The dark palette from index.css, verbatim. The banner is always dark: cards
// render on feeds of every theme, and the dark sheet is the identity.
const PAL = {
  sheet: '#14110e',
  ink: '#ede7da',
  ink2: '#a79c8b',
  ink3: '#7a7161',
  rule: '#372f27',
  quench: '#ff6b2c',
  verdigris: '#3fd0bc',
  oak: '#a97b4f',
  iron: '#99a0a6',
}

const params = DEFAULT_PARAMS
const result = simulateShot(params)
if (!result.ok) throw new Error(`default shot failed: ${result.errors.join(', ')}`)

// Two passes, two clocks. The machine pose is taken at T, where the beam and
// sling sit exactly as the reference frame. The shot itself is sampled just
// after release — by T the real shot is two beam-lengths above any camera that
// keeps the machine readable — so timber and shot are composed, each exact for
// its own instant.
const T_SHOT = result.timeline.releaseT + 0.045

// Where the shot is at T_SHOT and which way it is moving, in world metres.
const flightT = T_SHOT - result.timeline.releaseT
const traj = result.trajectory
let at = traj[0]
let next = traj[traj.length - 1]
for (let k = 1; k < traj.length; k++) {
  if (traj[k].t >= flightT) {
    at = traj[k - 1]
    next = traj[k]
    break
  }
}
const f = (flightT - at.t) / Math.max(1e-9, next.t - at.t)
const shotW = { x: at.x + (next.x - at.x) * f, y: at.y + (next.y - at.y) * f }
const vx = at.vx + (next.vx - at.vx) * f
const vy = at.vy + (next.vy - at.vy) * f

// Camera in banner pixels: ground on the banner's ground line, axle at AXLE_X,
// and the scale chosen so the shot hangs at a set height above the machine —
// the shot's altitude, not the timber, is what limits how big this can be.
const scale = (GROUND_Y - 135) / shotW.y
const cam = { cx: (W / 2 - AXLE_X) / scale, cy: (GROUND_Y - H / 2) / scale, scale }
const p = projector(cam, W, H)

const measure = (text: string, font: { size: number }) => text.length * font.size * 0.62
const sheetAt = (t: number) =>
  layout(
    {
      w: W,
      h: H,
      cam,
      palette: PAL,
      params,
      result,
      t,
      showDimensions: false,
      showAngles: false,
      showGrid: false,
      ghosts: [],
      preview: null,
      units: 'metric',
    },
    measure,
  )

// Sheet furniture the banner redraws full-bleed (background, ground line and
// band, downrange ticks, lettering) plus the faint full trajectory, which a
// stylized arc replaces.
const groundY = p.y(0)
const furniture = (i: Instruction): boolean => {
  if (i.op === 'rect' || i.op === 'text') return true
  if (i.op === 'path' && i.clip?.length === 4 && i.clip[0][0] === 0 && i.clip[1][0] === W) return true
  if (i.op === 'path' && i.points.length === 2) {
    const [[x0, y0], [x1, y1]] = i.points
    if (x0 === 0 && x1 === W && y0 === y1 && Math.abs(y0 - groundY) < 0.75) return true
    if (x0 === x1 && Math.abs(y0 - groundY) < 0.75 && Math.abs(y1 - (groundY + 5)) < 0.75) return true
  }
  if (i.op === 'path' && i.stroke?.dash && i.stroke.color === PAL.quench && (i.stroke.alpha ?? 1) < 0.3)
    return true
  return false
}
// Everything in the shot's accent is the shot's story; the rest is machine.
const isShot = (i: Instruction): boolean =>
  (i.op === 'path' && i.stroke?.color === PAL.quench) ||
  (i.op === 'circle' && i.fill?.color === PAL.quench)

// The sheet's hairlines are sized for an interactive canvas; on a card seen at
// thumbnail size the whip, the flown segment and the shot itself need weight.
const emphasize = (i: Instruction): Instruction => {
  if (isShot(i)) {
    if (i.op === 'path' && i.stroke) return { ...i, stroke: { ...i.stroke, width: (i.stroke.width ?? 1) * 2.2 } }
    if (i.op === 'circle') return { ...i, r: Math.max(i.r, 10) }
  }
  if (i.op === 'path' && i.stroke?.color === PAL.ink3 && i.stroke.alpha === 0.45)
    return { ...i, stroke: { ...i.stroke, width: 2.5 } } // the released sling
  return i
}

const kept = [
  ...sheetAt(T).filter((i) => !furniture(i) && !isShot(i)),
  ...sheetAt(T_SHOT).filter((i) => !furniture(i) && isShot(i)),
].map(emphasize)

// --- instruction -> SVG ------------------------------------------------------

const defs: string[] = []
let clipN = 0

function strokeAttrs(s?: Stroke): string {
  if (!s) return 'stroke="none"'
  const parts = [`stroke="${s.color}"`, `stroke-width="${s.width ?? 1}"`]
  if (s.alpha !== undefined) parts.push(`stroke-opacity="${s.alpha}"`)
  if (s.dash) parts.push(`stroke-dasharray="${s.dash.join(' ')}"`)
  if (s.cap) parts.push(`stroke-linecap="${s.cap}"`)
  if (s.join) parts.push(`stroke-linejoin="${s.join}"`)
  return parts.join(' ')
}

function fillAttrs(fill?: Fill): string {
  if (!fill) return 'fill="none"'
  return `fill="${fill.color}"` + (fill.alpha !== undefined ? ` fill-opacity="${fill.alpha}"` : '')
}

const fmtPt = ([x, y]: [number, number]) => `${x.toFixed(2)} ${y.toFixed(2)}`

function toSvg(i: Instruction): string {
  switch (i.op) {
    case 'path': {
      const d = `M ${i.points.map(fmtPt).join(' L ')}${i.close ? ' Z' : ''}`
      let clip = ''
      if (i.clip) {
        const id = `clip${clipN++}`
        defs.push(`<clipPath id="${id}"><polygon points="${i.clip.map(fmtPt).join(', ')}"/></clipPath>`)
        clip = ` clip-path="url(#${id})"`
      }
      return `<path d="${d}" ${fillAttrs(i.fill)} ${strokeAttrs(i.stroke)}${clip}/>`
    }
    case 'circle':
      return `<circle cx="${i.x.toFixed(2)}" cy="${i.y.toFixed(2)}" r="${i.r.toFixed(2)}" ${fillAttrs(i.fill)} ${strokeAttrs(i.stroke)}/>`
    case 'arc': {
      // Sampled rather than converted to SVG arc flags; nothing on the sheet
      // draws arcs precise enough to care, and sampling cannot get flags wrong.
      const n = 24
      const pts: [number, number][] = []
      for (let k = 0; k <= n; k++) {
        const a = i.from + ((i.to - i.from) * k) / n
        pts.push([i.x + Math.cos(a) * i.r, i.y + Math.sin(a) * i.r])
      }
      return `<path d="M ${pts.map(fmtPt).join(' L ')}" ${fillAttrs(i.fill)} ${strokeAttrs(i.stroke)}/>`
    }
    default:
      return ''
  }
}

const machine = kept.map(toSvg).join('\n  ')

// --- stylized continuation of the real flight --------------------------------

// Quadratic leaving the shot along its true velocity, landing at LAND_X. The
// arc itself is compressed — the real range at this scale would run three
// banners wide — which is why the dimension below quotes the real figure.
const sx = p.x(shotW.x)
const sy = p.y(shotW.y)
const ul = Math.hypot(vx, vy)
const ux = vx / ul
const uy = -vy / ul
let k = (0.45 * (LAND_X - sx)) / Math.max(0.05, ux)
if (sy + uy * k < -60) k = (-60 - sy) / uy
const cx = sx + ux * k
const cy = sy + uy * k

const rangeFig = `${result.range.toFixed(1)} m`
const releaseFig = `${result.release.angle.toFixed(1)}°`
const effFig = `${Math.round(result.efficiency * 100)}%`

// --- fonts -------------------------------------------------------------------

const b64 = (path: string) => readFileSync(path).toString('base64')
const sansFont = b64(
  join(ROOT, 'node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2'),
)
const monoFont = b64(
  join(ROOT, 'node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2'),
)

// --- the page ----------------------------------------------------------------

const dimMid = (p.x(0) + LAND_X) / 2

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face {
  font-family: "Instrument Sans Variable";
  font-style: normal; font-weight: 400 700; font-display: block;
  src: url(data:font/woff2;base64,${sansFont}) format("woff2-variations");
}
@font-face {
  font-family: "Geist Mono Variable";
  font-style: normal; font-weight: 100 900; font-display: block;
  src: url(data:font/woff2;base64,${monoFont}) format("woff2-variations");
}
* { margin: 0; padding: 0; }
body { width: 1200px; height: 630px; background: ${PAL.sheet}; overflow: hidden;
  font-family: "Instrument Sans Variable", sans-serif; position: relative; }
svg.scene { position: absolute; inset: 0; }
.copy { position: absolute; left: 84px; top: 150px; width: 560px; }
.stencil { font-size: 19px; font-weight: 500; letter-spacing: 0.18em;
  text-transform: uppercase; color: ${PAL.verdigris}; }
h1 { font-size: 96px; font-weight: 640; letter-spacing: -0.015em;
  color: ${PAL.ink}; margin: 18px 0 20px; }
.tag { font-size: 27px; font-weight: 400; color: ${PAL.ink2}; line-height: 1.45; }
.data { position: absolute; left: 84px; bottom: 64px;
  font-family: "Geist Mono Variable", monospace; font-size: 19px; color: ${PAL.ink3}; }
.data b { font-weight: 500; color: ${PAL.ink}; }
.url { position: absolute; right: 40px; top: 34px;
  font-family: "Geist Mono Variable", monospace; font-size: 17px; color: ${PAL.ink3}; }
.figure { font-family: "Geist Mono Variable", monospace; font-size: 21px;
  fill: ${PAL.verdigris}; }
</style></head><body>

<svg class="scene" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <pattern id="grid" width="42" height="42" patternUnits="userSpaceOnUse">
      <path d="M 42 0 L 0 0 0 42" fill="none" stroke="${PAL.rule}" stroke-width="1" opacity="0.45"/>
    </pattern>
    ${defs.join('\n    ')}
  </defs>
  <rect width="1200" height="630" fill="url(#grid)"/>

  <!-- ground line + hatch band -->
  <line x1="0" y1="${GROUND_Y}" x2="1200" y2="${GROUND_Y}" stroke="${PAL.ink3}" stroke-width="2"/>
  <g stroke="${PAL.ink3}" stroke-width="1.4" opacity="0.7">
    ${Array.from({ length: 60 }, (_, i) => {
      const x = 8 + i * 20
      return `<line x1="${x}" y1="${GROUND_Y}" x2="${x - 10}" y2="${GROUND_Y + 12}"/>`
    }).join('\n    ')}
  </g>

  <!-- the app's own machine at t = ${T} s -->
  ${machine}

  <!-- the flight continues: dotted, landing on the dimension -->
  <path d="M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${LAND_X} ${GROUND_Y}"
    fill="none" stroke="${PAL.quench}" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="0.1 16"/>

  <!-- range dimension, drafting style -->
  <g stroke="${PAL.verdigris}" stroke-width="2" fill="none">
    <line x1="${p.x(0).toFixed(1)}" y1="512" x2="${p.x(0).toFixed(1)}" y2="566"/>
    <line x1="${LAND_X}" y1="512" x2="${LAND_X}" y2="566"/>
    <line x1="${(p.x(0) + 6).toFixed(1)}" y1="558" x2="${LAND_X - 6}" y2="558"/>
    <path d="M ${p.x(0).toFixed(1)} 558 l 12 -5 M ${p.x(0).toFixed(1)} 558 l 12 5" stroke-linecap="round"/>
    <path d="M ${LAND_X} 558 l -12 -5 M ${LAND_X} 558 l -12 5" stroke-linecap="round"/>
  </g>
  <rect x="${dimMid - 52}" y="544" width="104" height="28" fill="${PAL.sheet}"/>
  <text class="figure" x="${dimMid}" y="565" text-anchor="middle">${rangeFig}</text>
</svg>

<div class="copy">
  <div class="stencil">Counterweight siege engine</div>
  <h1>Trebuchator</h1>
  <div class="tag">Model every dimension and mass, fire it, and see how far it throws.</div>
</div>
<div class="data">range <b>${rangeFig}</b> · release <b>${releaseFig}</b> · efficiency <b>${effFig}</b></div>
<div class="url">trebuchator.jonjaques.com</div>

</body></html>`

// --- render ------------------------------------------------------------------

const work = mkdtempSync(join(tmpdir(), 'trebuchator-og-'))
const page = join(work, 'og.html')
const shot2x = join(work, 'og-2x.png')
writeFileSync(page, html)
execFileSync(CHROME, [
  '--headless',
  '--disable-gpu',
  `--screenshot=${shot2x}`,
  '--window-size=1200,630',
  '--force-device-scale-factor=2',
  '--virtual-time-budget=3000',
  '--hide-scrollbars',
  `file://${page}`,
])
execFileSync('magick', [shot2x, '-resize', '1200x630', join(ROOT, 'public/og.png')])
console.log(
  `public/og.png — range ${rangeFig}, release ${releaseFig}, efficiency ${effFig}, ` +
    `releaseT ${result.timeline.releaseT.toFixed(3)} s, shot at (${sx.toFixed(0)}, ${sy.toFixed(0)}), ${kept.length} instructions kept`,
)
