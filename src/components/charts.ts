import { useCallback, useState } from 'react'

/**
 * The parts both plots on this sheet are built from.
 *
 * Extracted when the optimizer grew a chart of its own: the width hook in
 * particular encodes two failures that are not obvious from reading it, and
 * having a second copy of it would mean a second chance to reintroduce either.
 */

/**
 * Measured rather than scaled.
 *
 * A viewBox with `preserveAspectRatio="none"` stretches the coordinate system
 * to whatever width it is given, which stretches the *text* with it — on a
 * phone the axis labels came out squashed to a third of their width. Drawing in
 * real pixels costs a ResizeObserver and keeps every glyph the shape it was
 * designed to be.
 *
 * The observer goes on a plain full-width wrapper, never on the svg itself: an
 * svg sized `w-full` inside the measured element makes its own width depend on
 * the measurement, and the pair settles at whatever the first frame happened to
 * report.
 */
export function usePlotWidth() {
  const [w, setW] = useState(0)
  // A callback ref, not an effect over a ref object. These components swap which
  // element carries the ref when they flip between a placeholder and the plot,
  // and a mount-only effect would go on observing the detached node forever —
  // which is exactly how the width got stuck at its initial guess.
  const ref = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    const ro = new ResizeObserver(([entry]) =>
      setW(Math.max(0, Math.round(entry.contentRect.width))),
    )
    ro.observe(node)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** 1 / 2 / 5 x 10^n tick spacing giving roughly `target` divisions. */
export function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target)
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  for (const m of [1, 2, 2.5, 5, 10]) if (mag * m >= raw) return mag * m
  return mag * 10
}

/**
 * Decimals the whole axis is lettered to: the fewest that still write the step
 * exactly. Formatting each tick against its own magnitude instead put "8.00"
 * next to "10" on one axis, which is not something a draughtsman would do.
 */
export function tickDecimals(step: number): number {
  for (let d = 0; d < 4; d++) {
    const scaledStep = step * 10 ** d
    if (Math.abs(scaledStep - Math.round(scaledStep)) < 1e-9) return d
  }
  return 4
}

/** Evenly spaced ticks covering [0, top] on a `niceStep` grid. */
export function ticksTo(top: number, divisions: number): number[] {
  const step = niceStep(top, divisions)
  const out: number[] = []
  for (let v = 0; v <= top + step * 0.5; v += step) out.push(v)
  return out
}
