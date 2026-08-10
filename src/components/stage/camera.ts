export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Camera {
  cx: number
  cy: number
  /** World units to CSS pixels. */
  scale: number
}

export function unionRect(a: Rect, b: Rect): Rect {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  }
}

export function padRect(r: Rect, pad: number): Rect {
  return { x0: r.x0 - pad, y0: r.y0 - pad, x1: r.x1 + pad, y1: r.y1 + pad }
}

/**
 * Move `k` of the way from one framing to another.
 *
 * Centres interpolate linearly and half-extents in log space, for exactly the
 * reason `approach` does the same to scale: a linear zoom crawls out of a tight
 * framing and then arrives in a rush.
 *
 * This exists so a camera can be given a *continuous target* rather than a
 * sequence of framings it eases between. Easing smooths a jump but it cannot
 * hide one: a target that switches from the machine to a window a fortieth the
 * size still reads as a cut however gently the camera chases it. Returns `a`
 * exactly at `k = 0` and `b` exactly at `k = 1`.
 */
export function blendRect(a: Rect, b: Rect, k: number): Rect {
  const mix = (p: number, q: number) => p + (q - p) * k
  const geo = (p: number, q: number) => {
    const lo = Math.log(Math.max(p, 1e-6))
    return Math.exp(lo + (Math.log(Math.max(q, 1e-6)) - lo) * k)
  }
  const cx = mix((a.x0 + a.x1) / 2, (b.x0 + b.x1) / 2)
  const cy = mix((a.y0 + a.y1) / 2, (b.y0 + b.y1) / 2)
  const hw = geo((a.x1 - a.x0) / 2, (b.x1 - b.x0) / 2)
  const hh = geo((a.y1 - a.y0) / 2, (b.y1 - b.y0) / 2)
  return { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh }
}

/** Ease in and out, so a blend leaves and arrives at rest. */
export function smoothstep(k: number): number {
  const u = Math.min(1, Math.max(0, k))
  return u * u * (3 - 2 * u)
}

/** Camera that contains `rect` inside a w x h viewport, with px of screen inset. */
export function fitRect(rect: Rect, w: number, h: number, inset: number): Camera {
  const vw = Math.max(1, w - inset * 2)
  const vh = Math.max(1, h - inset * 2)
  const rw = Math.max(1e-6, rect.x1 - rect.x0)
  const rh = Math.max(1e-6, rect.y1 - rect.y0)
  return {
    cx: (rect.x0 + rect.x1) / 2,
    cy: (rect.y0 + rect.y1) / 2,
    scale: Math.min(vw / rw, vh / rh),
  }
}

/**
 * Move `k` of the way from one camera to another. Scale is interpolated in log
 * space so a pull-back from the machine to the whole field reads as an even
 * zoom rather than a slow start and a rush at the end.
 */
export function blendCamera(a: Camera, b: Camera, k: number): Camera {
  return {
    cx: a.cx + (b.cx - a.cx) * k,
    cy: a.cy + (b.cy - a.cy) * k,
    scale: Math.exp(Math.log(a.scale) + (Math.log(b.scale) - Math.log(a.scale)) * k),
  }
}

/**
 * Ease the camera toward a target. `rate` is per 60 fps frame — the rates were
 * tuned on a 60 Hz display — and `dt` is the real time since the last step in
 * those frames. Without the `dt` term a step was a fixed fraction per *paint*,
 * so the move ran twice as fast on a 120 Hz display, and any easing lag behind
 * a moving target swung with the frame time instead of holding steady.
 */
export function approach(cam: Camera, target: Camera, rate: number, dt: number): Camera {
  return blendCamera(cam, target, 1 - Math.exp(-rate * dt))
}

export function near(a: Camera, b: Camera): boolean {
  return (
    Math.abs(a.cx - b.cx) < 1e-3 &&
    Math.abs(a.cy - b.cy) < 1e-3 &&
    Math.abs(Math.log(a.scale / b.scale)) < 1e-4
  )
}

export interface Projector {
  x: (wx: number) => number
  y: (wy: number) => number
  s: (len: number) => number
  /** Inverse, for hit-testing pointer positions back into world space. */
  invX: (px: number) => number
  invY: (py: number) => number
}

export function projector(cam: Camera, w: number, h: number): Projector {
  return {
    x: (wx) => w / 2 + (wx - cam.cx) * cam.scale,
    y: (wy) => h / 2 - (wy - cam.cy) * cam.scale,
    s: (len) => len * cam.scale,
    invX: (px) => cam.cx + (px - w / 2) / cam.scale,
    invY: (py) => cam.cy - (py - h / 2) / cam.scale,
  }
}
