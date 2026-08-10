import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { FiredShot, ShotResult, TrebuchetParams } from '@/lib/treb/types.ts'
import type { UnitSystem } from '@/lib/format.ts'
import { once, throttle } from '@/lib/analytics.ts'
import { isDone, sampleTrajectory } from '@/lib/treb/timeline.ts'
import { paint } from './paint.ts'
import { BLAST_LIFE } from './blast.ts'
import {
  isBoulderShot,
  SHEET_MARGIN,
  type DimensionKey,
  type Ghost,
  type Palette,
} from './sheet.ts'
import {
  approach,
  blendCamera,
  blendRect,
  fitRect,
  near,
  padRect,
  smoothstep,
  unionRect,
  type Camera,
  type Rect,
} from './camera.ts'
import boulderUrl from '@/assets/granite-boulder.webp'

export type CameraMode = 'auto' | 'machine' | 'field' | 'free'

/**
 * The boulder sprite, fetched the first time a machine asks for one and held
 * for the session. A module-level promise for the same reason the worker is a
 * module singleton: StrictMode mounts twice, and this would otherwise be two
 * requests and two decodes.
 *
 * Static `import` of the URL rather than a dynamic one — Vite emits the file as
 * an asset either way, and the module only ever carries the string. Nothing is
 * fetched until a boulder is actually on the sheet.
 */
let spritePromise: Promise<HTMLImageElement> | null = null
function loadBoulder(): Promise<HTMLImageElement> {
  spritePromise ??= new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = boulderUrl
  })
  return spritePromise
}

/**
 * The chase window's world *height*, in boulder diameters — one for the flight
 * and a much wider one for the impact.
 *
 * They differ by nearly a factor of ten because the two moments want opposite
 * things. In the air the boulder *is* the subject: at 1.9 diameters it fills
 * something like two fifths of the sheet, close enough to read the granite and
 * watch it turn. On landing the fireball alone is twelve diameters across and
 * the debris carries further than that, so the camera has to get out of its own
 * way. The pull-out between them is fired by the impact and is deliberately not
 * eased at the chase rate — see the note on stiffness below.
 */
const CHASE_SPAN = 1.9
const BLAST_SPAN = 18
/** How far downrange of centre the window sits, as a fraction of its span. */
const CHASE_LEAD = 0.16
/** Seconds spent pushing in off the machine, and opening out for the landing. */
const CHASE_ENTER = 0.55
const BLAST_OPEN = 1.2
/**
 * Seconds of wall time to absorb a discontinuous cut *into* the chase — the
 * camera mode flipped to auto mid-flight, or a scrub landing the cursor in the
 * air. The ordinary entry at release needs none of this: `chaseRect` leaves
 * from the machine framing the camera is already sitting on.
 */
const CHASE_CATCH = 0.35
/** Seconds the camera stays down on the impact before it lets go of it. */
const BLAST_HOLD = 1.3

interface StageProps {
  result: ShotResult | null
  params: TrebuchetParams
  t: number
  units: UnitSystem
  showDimensions: boolean
  showAngles: boolean
  showGrid: boolean
  ghosts: Ghost[]
  /** Live what-if trajectory from the sweep chart, or null. */
  preview: Ghost | null
  /** The dimension a control is pointing at. Drawn even with annotations off. */
  highlight: DimensionKey | null
  /**
   * True while a control is being changed. The camera comes back to the machine
   * for as long as it is: a slider nudged with playback parked at the end of a
   * flight was otherwise adjusting something two thirds of a field away and off
   * the bottom of the sheet, so the whole point of dragging it — watching the
   * machine change — was invisible.
   */
  editing: boolean
  mode: CameraMode
  onModeChange: (mode: CameraMode) => void
}

function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el)
  const get = (name: string) => cs.getPropertyValue(`--${name}`).trim() || '#888'
  return {
    sheet: get('sheet'),
    ink: get('ink'),
    ink2: get('ink-2'),
    ink3: get('ink-3'),
    rule: get('rule'),
    quench: get('quench'),
    verdigris: get('verdigris'),
    oak: get('oak'),
    iron: get('iron'),
    ember: get('ember'),
    flame: get('flame'),
  }
}

/**
 * Bounding box of everything the machine sweeps through, plus its frame. All
 * frames, follow-through included — the arm whipping over the top after
 * release is part of what "frame the machine" has to hold.
 */
function machineRect(result: ShotResult, params: TrebuchetParams): Rect {
  const reach = params.armLong + params.slingLength
  let r: Rect = {
    x0: -params.pivotHeight * 0.55,
    y0: 0,
    x1: params.pivotHeight * 0.55,
    y1: params.pivotHeight + params.armShort + params.cwHanger,
  }
  // A failed shot carries one frame — the cocked pose — so this frames that
  // instead of the whole sweep, and the drawing stays on the sheet while the
  // reader fixes whatever stopped it throwing.
  for (const f of result.frames) {
    for (const pt of [f.pose.tip, f.pose.cw, f.pose.projectile, f.pose.shortEnd]) {
      r = unionRect(r, { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y })
    }
  }
  return padRect(r, Math.max(0.4, reach * 0.12))
}

/** A square window of world height `span` centred on the shot, with lead room. */
function windowAt(result: FiredShot, flightT: number, span: number, lead: number): Rect {
  const at = sampleTrajectory(result.trajectory, flightT)
  const cx = at.x + span * CHASE_LEAD * lead
  return { x0: cx - span / 2, y0: at.y - span / 2, x1: cx + span / 2, y1: at.y + span / 2 }
}

/**
 * The whole camera move for a thrown boulder, as one continuous function of
 * time in the air.
 *
 * The ordinary auto camera answers "how far did it go", which is the right
 * question for a machine you are dimensioning and the wrong one for nine tonnes
 * of granite: at 835 m the shot is two pixels across and the throw is a line on
 * a chart. This holds the boulder at about two fifths of the sheet and lets the
 * ground streak past instead, which is the only way the thing reads as fast.
 *
 * It is written as one function, and blended rather than switched, because the
 * first version *did* switch — machine, then chase, then blast — and no easing
 * rate could rescue it. A stiff rate turned each change into a cut; a gentle one
 * lagged the boulder several window-widths behind the frame and lost it off the
 * edge entirely. The three framings are still here, but the camera is only ever
 * given somewhere continuous to be:
 *
 * - It **leaves from the machine.** At `flightT` zero this returns the machine's
 *   own framing exactly, so release is seamless and the push-in happens over the
 *   first half second while the shot is still near the frame.
 * - It **rides** at `CHASE_SPAN` for the body of the flight.
 * - It **opens out before the landing**, not after it. Anticipating the impact
 *   is both better camerawork and the thing that keeps the flash off the whole
 *   sheet: pulled out afterwards, the frame was still a few metres wide when the
 *   fireball lit, which is a full-screen white flare nobody asked for.
 *
 * Both blends are clamped to a third of the flight each, so a short throw gets a
 * proportionally shorter move rather than two overlapping ones.
 *
 * `fitRect` fits the *smaller* viewport axis, so a square of side `span`
 * guarantees exactly that much world height and rather more width.
 */
function chaseRect(
  result: FiredShot,
  params: TrebuchetParams,
  machine: Rect,
  flightT: number,
): Rect {
  const flight = Math.max(result.flightTime, 1e-6)
  // No floor on the span: `isBoulderShot` will not let a projectile under 1.2 m
  // through, so the tightest window this can produce is still metres across.
  const d = params.projectileDiameter
  const enter = Math.min(CHASE_ENTER, flight / 3)
  const open = Math.min(BLAST_OPEN, flight / 3)

  // Opening for the landing owns the tail of the flight, and takes the lead room
  // with it — what matters at the impact is centred on the crater rather than
  // ahead of it.
  const opening = smoothstep((flightT - (flight - open)) / open)
  const span = Math.exp(
    Math.log(d * CHASE_SPAN) + (Math.log(d * BLAST_SPAN) - Math.log(d * CHASE_SPAN)) * opening,
  )
  const chase = windowAt(result, flightT, span, 1 - opening)

  return blendRect(machine, chase, smoothstep(flightT / enter))
}

function fieldRect(result: FiredShot, params: TrebuchetParams): Rect {
  return padRect(
    {
      x0: Math.min(-params.pivotHeight, -params.armLong),
      y0: Math.min(0, -params.targetDrop),
      x1: Math.max(result.range, 1),
      y1: Math.max(result.apex, params.pivotHeight + params.armShort),
    },
    Math.max(result.range, 10) * 0.06,
  )
}

export function Stage({
  result,
  params,
  t,
  units,
  showDimensions,
  showAngles,
  showGrid,
  ghosts,
  preview,
  highlight,
  editing,
  mode,
  onModeChange,
}: StageProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const camRef = useRef<Camera | null>(null)
  /**
   * How the camera is attached to the boulder chase: riding the window exactly
   * (`'locked'`), or still blending in from wherever a mid-flight mode flip
   * left it. Null whenever the last paint was not chasing. The lock exists
   * because easing after the window does not work: the window moves with the
   * boulder at up to 90 m/s, so an eased camera rides a lag proportional to
   * the frame time, and frame-time jitter shook that lag — visibly, on a
   * window barely two boulders tall. The window is already a continuous
   * function of the cursor, so the camera can simply *be* it.
   */
  const chaseRef = useRef<'locked' | { from: Camera; start: number } | null>(null)
  /** When the previous camera step ran, for frame-rate-independent easing. */
  const stepRef = useRef(0)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [palette, setPalette] = useState<Palette | null>(null)
  const [fontsReady, setFontsReady] = useState(false)
  const [grabbing, setGrabbing] = useState(false)
  // Bumped whenever the canvas needs a frame the parent will not provide: the
  // camera still easing after a mode change, and every pan/zoom gesture. The
  // parent re-renders us each frame during playback, which masked a real bug —
  // the gesture handlers below mutate `camRef` and set the mode to 'free', but
  // once the mode already *is* 'free' that state write bails out, so with
  // playback paused a drag moved the camera without ever repainting it.
  const [tick, setTick] = useState(0)
  const dragRef = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)
  // Live pointer positions by id. One down is a pan; two down is a pinch. The
  // canvas is `touch-none`, so the browser will never pinch for us — without
  // this a second finger just restarted the drag with a jump.
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  // The camera and geometry at the moment the second finger landed. Each move
  // re-derives from this anchor rather than compounding per-event ratios,
  // which accumulate rounding until the sheet drifts under steady fingers.
  const pinchRef = useRef<{ dist: number; mx: number; my: number; cam: Camera } | null>(null)

  // --- the boulder ----------------------------------------------------------
  const boulder = isBoulderShot(params)
  const [sprite, setSprite] = useState<HTMLImageElement | null>(null)
  const [reduceMotion, setReduceMotion] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  )
  /**
   * When the boulder landed, in wall time. Not derived and not derivable: the
   * shot's own clock ends at the impact, and everything after it happens in the
   * room rather than in the model. A ref rather than state for the same reason
   * the camera is one — it is read during the paint and never renders on its own.
   */
  const blastRef = useRef<number | null>(null)

  useEffect(() => {
    if (!boulder) return
    let cancelled = false
    // A sprite that will not load is not something the reader can act on: the
    // sheet falls back to the quench mark and the shot still flies.
    void loadBoulder().then(
      (img) => {
        if (!cancelled) setSprite(img)
      },
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [boulder])

  useEffect(() => {
    if (!boulder || !result?.ok) return
    // Once per visit. The question about an easter egg is how many readers ever
    // reach it, not how many times they nudged a slider while it was loaded.
    once('boulder', 'boulder_thrown', { range_m: result.range, reduced_motion: reduceMotion })
  }, [boulder, result, reduceMotion])

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const update = () => setReduceMotion(mq.matches)
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // A fresh answer from the solver re-arms the fireball, so nudging a slider
  // while parked on the impact detonates again rather than leaving a crater
  // that has already gone cold. Declared above the paint effect so the disarm
  // lands before the paint that would otherwise read a stale timestamp.
  useEffect(() => {
    blastRef.current = null
    // A different shot means a different chase window: re-enter it through the
    // catch blend rather than hard-cutting from wherever the old lock sat.
    chaseRef.current = null
  }, [result])

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const box = entry.contentRect
      setSize({ w: Math.round(box.width), h: Math.round(box.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Re-read tokens whenever the theme class flips, so the drawing follows the
  // palette instead of caching a stale one.
  useEffect(() => {
    const update = () => setPalette(readPalette(document.documentElement))
    update()
    const mo = new MutationObserver(update)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    void document.fonts.ready.then(() => {
      if (!cancelled) setFontsReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const rects = useMemo(() => {
    if (!result) return null
    return {
      machine: machineRect(result, params),
      // Only a fired shot has a field to frame; a failed one has the machine
      // and nothing beyond it.
      field: result.ok ? fieldRect(result, params) : machineRect(result, params),
    }
  }, [result, params])

  // Reset the camera when the machine changes shape enough that easing from the
  // old framing would just be a long, pointless slide.
  useEffect(() => {
    camRef.current = null
  }, [params.type, params.armLong, params.pivotHeight])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !palette || !size.w || !size.h) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Sized only when the size actually changed: assigning `canvas.width`
    // resets the bitmap even when the value is the same, which made every
    // animation frame pay for a full backing-store clear and reallocation.
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const pw = Math.round(size.w * dpr)
    const ph = Math.round(size.h * dpr)
    if (canvas.width !== pw) canvas.width = pw
    if (canvas.height !== ph) canvas.height = ph
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Only a genuinely empty sheet — no solver answer at all — blanks. A shot
    // that failed still has a machine to draw, and blanking it was the app
    // taking the drawing away at the exact moment the reader needed to look at
    // it.
    if (!result || !rects) {
      ctx.clearRect(0, 0, size.w, size.h)
      ctx.fillStyle = palette.sheet
      ctx.fillRect(0, 0, size.w, size.h)
      return
    }

    // The fireball's clock. Armed by the landing, disarmed by scrubbing back
    // off it — the drawing is a pure function of the cursor everywhere else and
    // an explosion that outlived its own cause would be the one thing on the
    // sheet that could not be rewound. Silenced outright under reduced motion,
    // which leaves the crater and takes away the flash.
    const landed = result.ok && isDone(result.timeline, t)
    if (!landed || !boulder) blastRef.current = null
    else blastRef.current ??= performance.now()
    const blast =
      blastRef.current == null || reduceMotion
        ? null
        : (performance.now() - blastRef.current) / 1000

    let target: Rect
    // How hard the camera is pulled toward its target, per 60 fps frame. The
    // boulder chase takes no rate at all — it rides its window exactly, see
    // `chaseRef` — so what remains are the ordinary framing moves and the
    // long, slack pull-back off the crater to the whole field, which is the
    // reveal of how far the thing actually went and should take its time.
    let rate = 0.22
    let chasing = false
    // Editing outranks every automatic framing but not an explicit one: someone
    // who has pinned the camera to the field or dragged it themselves has said
    // where they want to look, and a slider is not permission to overrule that.
    if (editing && mode === 'auto') target = rects.machine
    else if (mode === 'machine') target = rects.machine
    else if (!result.ok) target = rects.machine
    else if (mode === 'field') target = rects.field
    else if (mode === 'auto') {
      // Follow the shot: hold on the machine through the stroke, then open out
      // just far enough to keep the shot and its trail on the sheet.
      const releaseT = result.timeline.releaseT
      if (t <= releaseT) target = rects.machine
      else if (boulder && !reduceMotion) {
        // Only for the boulder: ride with it, hold on the impact long enough for
        // the fireball, then let go and pull back to the range — which is still
        // the headline of this sheet and is unreadable from inside a crater.
        if (!landed || blast == null || blast < BLAST_HOLD) {
          chasing = true
          target = chaseRect(
            result,
            params,
            rects.machine,
            landed ? result.flightTime : t - releaseT,
          )
        } else {
          rate = 0.09
          target = rects.field
        }
      } else {
        let flown: Rect = rects.machine
        const flightT = t - releaseT
        for (const pt of result.trajectory) {
          if (pt.t > flightT + 0.35) break
          flown = unionRect(flown, { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y })
        }
        target = padRect(flown, Math.max(1, result.range * 0.05))
      }
    } else target = rects.machine

    // The inset comes from the module that draws the furniture it has to clear.
    const fitted = fitRect(target, size.w, size.h, SHEET_MARGIN)
    // Real time since the previous camera step, in the 60 fps frames the rates
    // are tuned in. Clamped so the first paint — and a tab coming back from
    // the background — takes one long step instead of teleporting.
    const now = performance.now()
    const dt = Math.min(3, ((now - stepRef.current) / 1000) * 60)
    stepRef.current = now

    let settled = true
    if (mode === 'free' && camRef.current) {
      // Leave the camera exactly where the user put it.
      chaseRef.current = null
    } else if (chasing && camRef.current) {
      // Entry from the stroke is continuous — `chaseRect` leaves from the
      // machine framing the camera is already holding, and `near` is float
      // dust — so the camera locks straight on. A genuine cut into the chase
      // blends in over wall time instead; wall rather than shot time so a
      // mode flip while playback is paused still finishes its move.
      let hold = chaseRef.current
      if (hold == null) {
        hold = near(camRef.current, fitted) ? 'locked' : { from: camRef.current, start: now }
        chaseRef.current = hold
      }
      if (hold !== 'locked') {
        const k = smoothstep((now - hold.start) / (CHASE_CATCH * 1000))
        if (k >= 1) chaseRef.current = 'locked'
        else {
          camRef.current = blendCamera(hold.from, fitted, k)
          settled = false
        }
      }
      if (chaseRef.current === 'locked') camRef.current = fitted
    } else {
      chaseRef.current = null
      if (!camRef.current || near(camRef.current, fitted)) {
        camRef.current = fitted
      } else {
        camRef.current = approach(camRef.current, fitted, rate, dt)
        settled = false
      }
    }

    paint(ctx, {
      w: size.w,
      h: size.h,
      cam: camRef.current,
      palette,
      params,
      result,
      t,
      showDimensions,
      showAngles,
      showGrid,
      ghosts,
      preview,
      highlight,
      units,
      sprite,
      blast,
    })

    // Playback has already stopped by the time the boulder lands, so the
    // fireball has nothing driving it but this: keep asking for frames until it
    // burns out, then let the sheet go quiet on the crater.
    if (settled && (blast == null || blast >= BLAST_LIFE)) return
    const id = requestAnimationFrame(() => setTick((n) => n + 1))
    return () => cancelAnimationFrame(id)
  }, [
    result,
    params,
    t,
    size,
    palette,
    rects,
    mode,
    showDimensions,
    showAngles,
    showGrid,
    ghosts,
    preview,
    highlight,
    editing,
    units,
    fontsReady,
    tick,
    boulder,
    sprite,
    reduceMotion,
  ])

  // Shared by pointerup and pointercancel — a cancelled touch must tear down
  // the same gesture state or the next touch inherits a phantom finger.
  const endPointer = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
    pointersRef.current.delete(e.pointerId)
    const pts = [...pointersRef.current.values()]
    if (pts.length === 2 && pinchRef.current && camRef.current) {
      // Three fingers down to two: re-anchor on the survivors, whichever pair
      // they are — the old anchor may describe a finger that just left.
      const rect = e.currentTarget.getBoundingClientRect()
      pinchRef.current = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        mx: (pts[0].x + pts[1].x) / 2 - rect.left,
        my: (pts[0].y + pts[1].y) / 2 - rect.top,
        cam: camRef.current,
      }
    } else if (pts.length === 1 && camRef.current) {
      // A pinch losing one finger degrades to a pan from where the survivor
      // stands, so lifting a finger never jumps the sheet.
      pinchRef.current = null
      dragRef.current = {
        x: pts[0].x,
        y: pts[0].y,
        cx: camRef.current.cx,
        cy: camRef.current.cy,
      }
    } else if (pts.length === 0) {
      pinchRef.current = null
      dragRef.current = null
      setGrabbing(false)
    }
  }

  return (
    <div ref={hostRef} className="relative h-full w-full overflow-hidden bg-sheet">
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none"
        style={{ width: size.w, height: size.h, cursor: grabbing ? 'grabbing' : 'grab' }}
        onWheel={(e) => {
          const cam = camRef.current
          if (!cam) return
          // A gesture is one intent and a few hundred events. The leading edge
          // of each burst is what says the reader went looking at the drawing
          // rather than only at the rails.
          throttle('gesture:zoom', 4000, 'sheet_gesture', { gesture: 'zoom' })
          const factor = Math.exp(-e.deltaY * 0.0015)
          // Zoom about the cursor: the world point under it stays put. Zooming
          // about the viewport centre instead made the machine slide away from
          // the very detail being zoomed toward.
          const rect = e.currentTarget.getBoundingClientRect()
          const px = e.clientX - rect.left
          const py = e.clientY - rect.top
          const scale = cam.scale * factor
          const wx = cam.cx + (px - size.w / 2) / cam.scale
          const wy = cam.cy - (py - size.h / 2) / cam.scale
          camRef.current = {
            scale,
            cx: wx - (px - size.w / 2) / scale,
            cy: wy + (py - size.h / 2) / scale,
          }
          onModeChange('free')
          setTick((n) => n + 1)
        }}
        onPointerDown={(e) => {
          if (!camRef.current) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setGrabbing(true)
          pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          const pts = [...pointersRef.current.values()]
          if (pts.length === 2) {
            // Second finger down: the drag becomes a pinch, anchored where the
            // fingers are now.
            dragRef.current = null
            const rect = e.currentTarget.getBoundingClientRect()
            pinchRef.current = {
              dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
              mx: (pts[0].x + pts[1].x) / 2 - rect.left,
              my: (pts[0].y + pts[1].y) / 2 - rect.top,
              cam: camRef.current,
            }
          } else if (pts.length === 1) {
            dragRef.current = {
              x: e.clientX,
              y: e.clientY,
              cx: camRef.current.cx,
              cy: camRef.current.cy,
            }
          }
          // A third finger neither pans nor re-anchors: the pinch carries on
          // between the first two.
        }}
        onPointerMove={(e) => {
          if (pointersRef.current.has(e.pointerId))
            pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

          const pinch = pinchRef.current
          if (pinch && pointersRef.current.size >= 2) {
            const [a, b] = [...pointersRef.current.values()]
            const rect = e.currentTarget.getBoundingClientRect()
            const mx = (a.x + b.x) / 2 - rect.left
            const my = (a.y + b.y) / 2 - rect.top
            const dist = Math.hypot(a.x - b.x, a.y - b.y)
            const scale = pinch.cam.scale * (Math.max(dist, 1) / Math.max(pinch.dist, 1))
            // Same invariant as the wheel: the world point under the gesture
            // stays under the gesture, while it moves and while it spreads.
            const wx = pinch.cam.cx + (pinch.mx - size.w / 2) / pinch.cam.scale
            const wy = pinch.cam.cy - (pinch.my - size.h / 2) / pinch.cam.scale
            camRef.current = {
              scale,
              cx: wx - (mx - size.w / 2) / scale,
              cy: wy + (my - size.h / 2) / scale,
            }
            throttle('gesture:pinch', 4000, 'sheet_gesture', { gesture: 'pinch' })
            onModeChange('free')
            setTick((n) => n + 1)
            return
          }

          const d = dragRef.current
          const cam = camRef.current
          if (!d || !cam) return
          camRef.current = {
            ...cam,
            cx: d.cx - (e.clientX - d.x) / cam.scale,
            cy: d.cy + (e.clientY - d.y) / cam.scale,
          }
          throttle('gesture:pan', 4000, 'sheet_gesture', { gesture: 'pan' })
          onModeChange('free')
          setTick((n) => n + 1)
        }}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      />
      {/* The first solve costs a worker boot plus 20–45 ms, and an unmarked
          blank sheet is the first thing anyone sees of this app. */}
      {result == null && (
        <p className="body pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-ink-2">
          Setting out the machine…
        </p>
      )}

      {/* A machine that will not throw used to take the drawing away and say
          "nothing to draw" in the middle of an empty sheet — at the one moment
          the reader most needed to see what they had built, and without naming
          the cause. The machine stays drawn; this names the fault over the top
          of it, and below `xl` (where the results rail is closed) it is the
          only place the reason appears at all. */}
      {result && !result.ok && (
        <div
          role="status"
          className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-3"
        >
          {/* The one sanctioned shadow: an element that has genuinely left the
              layout and is floating over the sheet, same as the rails do below
              `xl`. No blur behind it — the system separates with tone and a 1px
              rule, and a near-opaque `raised` already carries the text. */}
          <div className="pointer-events-auto max-w-[30rem] rounded-sm border border-rule bg-raised/95 px-3 py-2.5 shadow-2xl">
            <div className="flex items-center gap-2">
              <TriangleAlert className="size-3.5 shrink-0 text-bad" aria-hidden />
              <span className="label text-ink">This machine will not throw</span>
            </div>
            <ul className="body space-y-1 pt-1.5 text-ink-2">
              {result.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
            <p className="body pt-1.5 text-ink-3">
              The drawing is the cocked pose as specified — the fault is usually visible in it.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
