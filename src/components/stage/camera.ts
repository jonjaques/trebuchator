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
 * Ease the camera toward a target. Scale is interpolated in log space so a
 * pull-back from the machine to the whole field reads as an even zoom rather
 * than a slow start and a rush at the end.
 */
export function approach(cam: Camera, target: Camera, rate: number): Camera {
  const k = 1 - Math.exp(-rate)
  return {
    cx: cam.cx + (target.cx - cam.cx) * k,
    cy: cam.cy + (target.cy - cam.cy) * k,
    scale: Math.exp(Math.log(cam.scale) + (Math.log(target.scale) - Math.log(cam.scale)) * k),
  }
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
