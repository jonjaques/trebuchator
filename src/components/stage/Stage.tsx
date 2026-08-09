import { useEffect, useMemo, useRef, useState } from 'react'
import type { ShotResult, TrebuchetParams } from '@/lib/treb/types.ts'
import type { UnitSystem } from '@/lib/format.ts'
import { paint, type Ghost, type Palette } from './paint.ts'
import {
  approach,
  fitRect,
  near,
  padRect,
  unionRect,
  type Camera,
  type Rect,
} from './camera.ts'

export type CameraMode = 'auto' | 'machine' | 'field' | 'free'

interface StageProps {
  result: ShotResult | null
  params: TrebuchetParams
  t: number
  units: UnitSystem
  showDimensions: boolean
  showGrid: boolean
  ghosts: Ghost[]
  mode: CameraMode
  onModeChange: (mode: CameraMode) => void
}

function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el)
  const get = (name: string) => cs.getPropertyValue(`--${name}`).trim() || '#888'
  return {
    sheet: get('sheet'),
    ground: get('ground'),
    ink: get('ink'),
    ink2: get('ink-2'),
    ink3: get('ink-3'),
    rule: get('rule'),
    quench: get('quench'),
    verdigris: get('verdigris'),
    oak: get('oak'),
    iron: get('iron'),
    warn: get('warn'),
  }
}

/** Bounding box of everything the machine sweeps through, plus its frame. */
function machineRect(result: ShotResult, params: TrebuchetParams): Rect {
  const reach = params.armLong + params.slingLength
  let r: Rect = {
    x0: -params.pivotHeight * 0.55,
    y0: 0,
    x1: params.pivotHeight * 0.55,
    y1: params.pivotHeight + params.armShort + params.cwHanger,
  }
  const upto = result.release?.t ?? Infinity
  for (const f of result.frames) {
    if (f.t > upto) break
    for (const pt of [f.pose.tip, f.pose.cw, f.pose.projectile, f.pose.shortEnd]) {
      r = unionRect(r, { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y })
    }
  }
  return padRect(r, Math.max(0.4, reach * 0.12))
}

function fieldRect(result: ShotResult, params: TrebuchetParams): Rect {
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
  showGrid,
  ghosts,
  mode,
  onModeChange,
}: StageProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const camRef = useRef<Camera | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [palette, setPalette] = useState<Palette | null>(null)
  const [fontsReady, setFontsReady] = useState(false)
  const [grabbing, setGrabbing] = useState(false)
  // Bumped to request one more frame while the camera is still easing. The
  // parent re-renders us every frame during playback, but a mode change while
  // paused would otherwise freeze the zoom halfway.
  const [tick, setTick] = useState(0)
  const dragRef = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)

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
    if (!result?.ok) return null
    return { machine: machineRect(result, params), field: fieldRect(result, params) }
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

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(size.w * dpr)
    canvas.height = Math.round(size.h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    if (!result?.ok || !rects) {
      ctx.clearRect(0, 0, size.w, size.h)
      ctx.fillStyle = palette.sheet
      ctx.fillRect(0, 0, size.w, size.h)
      return
    }

    let target: Rect
    if (mode === 'machine') target = rects.machine
    else if (mode === 'field') target = rects.field
    else if (mode === 'auto') {
      // Follow the shot: hold on the machine through the stroke, then open out
      // just far enough to keep the shot and its trail on the sheet.
      const releaseT = result.release?.t ?? 0
      if (t <= releaseT) target = rects.machine
      else {
        let flown: Rect = rects.machine
        const flightT = t - releaseT
        for (const pt of result.trajectory) {
          if (pt.t > flightT + 0.35) break
          flown = unionRect(flown, { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y })
        }
        target = padRect(flown, Math.max(1, result.range * 0.05))
      }
    } else target = rects.machine

    const fitted = fitRect(target, size.w, size.h, 56)
    let settled = true
    if (mode === 'free' && camRef.current) {
      // Leave the camera exactly where the user put it.
    } else if (!camRef.current) {
      camRef.current = fitted
    } else if (near(camRef.current, fitted)) {
      camRef.current = fitted
    } else {
      camRef.current = approach(camRef.current, fitted, 0.22)
      settled = false
    }

    paint({
      ctx,
      w: size.w,
      h: size.h,
      cam: camRef.current,
      palette,
      params,
      result,
      t,
      showDimensions,
      showGrid,
      ghosts,
      units,
    })

    if (settled) return
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
    showGrid,
    ghosts,
    units,
    fontsReady,
    tick,
  ])

  return (
    <div ref={hostRef} className="relative h-full w-full overflow-hidden bg-sheet">
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none"
        style={{ width: size.w, height: size.h, cursor: grabbing ? 'grabbing' : 'grab' }}
        onWheel={(e) => {
          if (!camRef.current) return
          const factor = Math.exp(-e.deltaY * 0.0015)
          camRef.current = { ...camRef.current, scale: camRef.current.scale * factor }
          onModeChange('free')
        }}
        onPointerDown={(e) => {
          if (!camRef.current) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setGrabbing(true)
          dragRef.current = {
            x: e.clientX,
            y: e.clientY,
            cx: camRef.current.cx,
            cy: camRef.current.cy,
          }
        }}
        onPointerMove={(e) => {
          const d = dragRef.current
          const cam = camRef.current
          if (!d || !cam) return
          camRef.current = {
            ...cam,
            cx: d.cx - (e.clientX - d.x) / cam.scale,
            cy: d.cy + (e.clientY - d.y) / cam.scale,
          }
          onModeChange('free')
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId)
          dragRef.current = null
          setGrabbing(false)
        }}
      />
    </div>
  )
}
