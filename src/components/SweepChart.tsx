import { useCallback, useMemo, useState } from 'react'
import type { SweepMode, SweepPoint, TunableKey } from '@/lib/treb/optimize.ts'
import { TUNABLES } from '@/lib/treb/optimize.ts'
import { num, toDisplay, unitSymbol, type Dimension, type UnitSystem } from '@/lib/format.ts'

/**
 * Range against one parameter, everything else held.
 *
 * One series, so no legend — the caption names it. What the first version got
 * wrong was context: it drew a curve, marked the peak, and left the reader with
 * no axis to read a value off, no idea what the machine they currently have
 * scores, and therefore no reason to believe any of it. So this one carries a
 * y-axis with real gridlines, a labelled x-axis, and — the part that actually
 * answers the question being asked — an explicit "you are here → you could be
 * there" readout with the gain spelled out.
 *
 * The current-value marker borrows the sheet's dimension-line idiom (witness
 * line down to the axis, figure in the gap) so it reads the same way as every
 * measurement on the drawing.
 */

const DIM_OF: Partial<Record<TunableKey, Dimension>> = {
  slingLength: 'length',
  armLong: 'length',
  armShort: 'length',
  cwHanger: 'length',
  pivotHeight: 'length',
  cwMass: 'mass',
  projectileMass: 'mass',
  armMass: 'mass',
  releaseAngle: 'angle',
  initialBeamAngle: 'angle',
  windSpeed: 'speed',
}

interface Props {
  points: SweepPoint[]
  paramKey: TunableKey
  current: number
  units: UnitSystem
  loading: boolean
  mode: SweepMode
  height?: number
  onPick: (value: number) => void
}

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
function usePlotWidth() {
  const [w, setW] = useState(0)
  // A callback ref, not an effect over a ref object. This component swaps which
  // element carries the ref when it flips between the placeholder and the plot,
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
function niceStep(span: number, target: number): number {
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
function tickDecimals(step: number): number {
  for (let d = 0; d < 4; d++) {
    const scaledStep = step * 10 ** d
    if (Math.abs(scaledStep - Math.round(scaledStep)) < 1e-9) return d
  }
  return 4
}

export function SweepChart({
  points,
  paramKey,
  current,
  units,
  loading,
  mode,
  height = 150,
  onPick,
}: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const [plotRef, W] = usePlotWidth()
  // The y-axis gutter has to hold a number; on a narrow sheet it gives ground.
  const PAD = { l: W < 420 ? 32 : 46, r: 14, t: 14, b: 26 }
  const spec = TUNABLES.find((t) => t.key === paramKey)
  const dim = DIM_OF[paramKey] ?? 'none'
  const xUnit = unitSymbol(dim, units)
  const yUnit = unitSymbol('length', units)
  const H = height

  const valid = useMemo(() => points.filter((p) => Number.isFinite(p.range)), [points])

  const geom = useMemo(() => {
    if (valid.length < 2) return null
    const xs = points.map((p) => p.value)
    const x0 = Math.min(...xs)
    const x1 = Math.max(...xs)
    const top = Math.max(...valid.map((p) => p.range))
    // Bars start at zero. Sensitivity curves are about *relative* differences,
    // and a truncated y-axis turns a 2% spread into a dramatic cliff.
    const yTop = toDisplay(top, 'length', units) * 1.1
    const sx = (v: number) =>
      PAD.l + ((v - x0) / Math.max(1e-9, x1 - x0)) * (W - PAD.l - PAD.r)
    const sy = (vDisplay: number) =>
      H - PAD.b - (vDisplay / Math.max(1e-9, yTop)) * (H - PAD.t - PAD.b)
    let best = valid[0]
    for (const p of valid) if (p.range > best.range) best = p

    // Range at the machine's current setting, read off the curve rather than
    // recomputed, so the "you are here" number always agrees with the line.
    let atCurrent = Number.NaN
    for (let i = 1; i < valid.length; i++) {
      const a = valid[i - 1]
      const b = valid[i]
      if ((a.value - current) * (b.value - current) <= 0 && b.value !== a.value) {
        const k = (current - a.value) / (b.value - a.value)
        atCurrent = a.range + (b.range - a.range) * k
        break
      }
    }
    return { x0, x1, yTop, sx, sy, best, atCurrent }
  }, [points, valid, H, W, PAD.l, PAD.r, PAD.t, PAD.b, current, units])

  if (!geom || W === 0) {
    return (
      <div
        ref={plotRef}
        className="body flex w-full items-center justify-center text-ink-2"
        style={{ height: H }}
      >
        {loading ? 'Sweeping…' : 'Not enough valid shots to plot.'}
      </div>
    )
  }

  const { sx, sy, best, atCurrent, x0, x1, yTop } = geom
  const dsp = (v: number) => toDisplay(v, 'length', units)
  const path = valid
    .map((p, i) => `${i ? 'L' : 'M'}${sx(p.value).toFixed(1)},${sy(dsp(p.range)).toFixed(1)}`)
    .join('')
  const hovered = hover != null ? valid[hover] : null
  const fmtX = (v: number) => `${num(toDisplay(v, dim, units), dim === 'angle' ? 0 : 2)}${xUnit}`
  const inRange = current >= x0 && current <= x1
  const gain = Number.isFinite(atCurrent) ? best.range - atCurrent : Number.NaN

  const yStep = niceStep(yTop, 3)
  const yDecimals = tickDecimals(yStep)
  const yTicks: number[] = []
  for (let v = 0; v <= yTop; v += yStep) yTicks.push(v)
  const xSpanDisplay = toDisplay(x1, dim, units) - toDisplay(x0, dim, units)
  const xStep = niceStep(Math.abs(xSpanDisplay), 6)
  const xDecimals = tickDecimals(xStep)
  const xTicks: number[] = []
  {
    const lo = toDisplay(x0, dim, units)
    const start = Math.ceil(lo / xStep) * xStep
    for (let v = start; v <= toDisplay(x1, dim, units) + 1e-9; v += xStep) xTicks.push(v)
  }

  // Merge consecutive dead values so a long unusable stretch is one shaded
  // region rather than a picket fence.
  const deadBands: { from: number; to: number }[] = []
  const gapWidth = ((x1 - x0) / Math.max(1, points.length - 1)) * 1.5
  for (const pt of points) {
    if (Number.isFinite(pt.range)) continue
    const last = deadBands[deadBands.length - 1]
    if (last && Math.abs(last.to - pt.value) < gapWidth) last.to = pt.value
    else deadBands.push({ from: pt.value, to: pt.value })
  }

  return (
    <figure className="m-0">
      <div ref={plotRef} className="w-full">
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="block cursor-crosshair select-none"
        role="img"
        aria-label={`Range against ${spec?.label ?? paramKey}. Currently ${fmtX(current)} giving ${num(dsp(atCurrent), 1)} ${yUnit}. Best is ${fmtX(best.value)} giving ${num(dsp(best.range), 1)} ${yUnit}.`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const vx = e.clientX - r.left
          let bi = 0
          for (let i = 1; i < valid.length; i++)
            if (Math.abs(sx(valid[i].value) - vx) < Math.abs(sx(valid[bi].value) - vx)) bi = i
          setHover(bi)
        }}
        onClick={() => hovered && onPick(hovered.value)}
      >
        {/* y grid — recessive, but present, so a value can be read off */}
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.l}
              y1={sy(v)}
              x2={W - PAD.r}
              y2={sy(v)}
              stroke="var(--rule)"
              strokeWidth={1}
              opacity={v === 0 ? 1 : 0.45}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={PAD.l - 8}
              y={sy(v) + 3}
              textAnchor="end"
              fill="var(--ink-3)"
              fontSize={10}
              fontFamily="'Geist Mono Variable', monospace"
            >
              {num(v, yDecimals)}
            </text>
          </g>
        ))}
        <text
          x={PAD.l - 8}
          y={PAD.t - 3}
          textAnchor="end"
          fill="var(--ink-3)"
          fontSize={9}
          fontFamily="'Instrument Sans Variable', sans-serif"
        >
          {yUnit}
        </text>

        {deadBands.map((b, i) => (
          <rect
            key={i}
            x={sx(b.from)}
            y={PAD.t}
            width={Math.max(2, sx(b.to) - sx(b.from))}
            height={H - PAD.t - PAD.b}
            fill="var(--ink-3)"
            opacity={0.12}
          />
        ))}

        {/* x ticks */}
        {xTicks.map((v) => {
          // Ticks are chosen on round display values, then mapped back through
          // SI to a pixel — so "0.5 m" and "1.5 ft" both land on tidy numbers.
          const px = sx(
            x0 + ((v - toDisplay(x0, dim, units)) / Math.max(1e-9, xSpanDisplay)) * (x1 - x0),
          )
          return (
            <g key={v}>
              <line
                x1={px}
                y1={H - PAD.b}
                x2={px}
                y2={H - PAD.b + 4}
                stroke="var(--rule)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={px}
                y={H - PAD.b + 15}
                textAnchor="middle"
                fill="var(--ink-3)"
                fontSize={10}
                fontFamily="'Geist Mono Variable', monospace"
              >
                {num(v, xDecimals)}
              </text>
            </g>
          )
        })}

        <path
          d={path}
          fill="none"
          stroke="var(--quench)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* Best */}
        <g>
          <circle
            cx={sx(best.value)}
            cy={sy(dsp(best.range))}
            r={4}
            fill="var(--quench)"
            stroke="var(--sheet)"
            strokeWidth={1.5}
          />
          <text
            x={Math.min(Math.max(sx(best.value), PAD.l + 34), W - PAD.r - 34)}
            y={Math.max(sy(dsp(best.range)) - 9, PAD.t + 8)}
            textAnchor="middle"
            fill="var(--ink-2)"
            fontSize={11}
            fontFamily="'Geist Mono Variable', monospace"
          >
            best {num(dsp(best.range), 1)}
          </text>
        </g>

        {/* Where this machine sits, in the sheet's dimension idiom */}
        {inRange && (
          <g>
            <line
              x1={sx(current)}
              y1={PAD.t}
              x2={sx(current)}
              y2={H - PAD.b}
              stroke="var(--verdigris)"
              strokeWidth={1}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
            {Number.isFinite(atCurrent) && (
              <circle
                cx={sx(current)}
                cy={sy(dsp(atCurrent))}
                r={3.5}
                fill="var(--verdigris)"
                stroke="var(--sheet)"
                strokeWidth={1.5}
              />
            )}
            <polygon
              points={`${sx(current)},${H - PAD.b - 5} ${sx(current) - 4},${H - PAD.b + 2} ${sx(current) + 4},${H - PAD.b + 2}`}
              fill="var(--verdigris)"
            />
            {/* Dropped when it would letter over the "best" figure. That one
                carries a number and this one does not, and the caption names
                both regardless. */}
            {Math.abs(sx(current) - sx(best.value)) > 56 && (
              <text
                x={Math.min(Math.max(sx(current), PAD.l + 26), W - PAD.r - 26)}
                y={PAD.t + 9}
                textAnchor="middle"
                fill="var(--verdigris)"
                fontSize={10}
                fontFamily="'Instrument Sans Variable', sans-serif"
              >
                yours
              </text>
            )}
          </g>
        )}

        {hovered && (
          <g>
            <line
              x1={sx(hovered.value)}
              y1={PAD.t}
              x2={sx(hovered.value)}
              y2={H - PAD.b}
              stroke="var(--ink-3)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={sx(hovered.value)}
              cy={sy(dsp(hovered.range))}
              r={4}
              fill="var(--quench)"
              stroke="var(--sheet)"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>
      </div>

      <figcaption className="flex flex-wrap items-baseline gap-x-4 gap-y-1 pt-1.5">
        <span className="label text-ink-2">
          {hovered ? (
            <>
              <span className="text-ink-3">At </span>
              <span className="tnum font-mono text-ink">{fmtX(hovered.value)}</span>
              <span className="text-ink-3"> this machine throws </span>
              <span className="tnum font-mono text-ink">
                {num(dsp(hovered.range), 1)} {yUnit}
              </span>
            </>
          ) : (
            <>
              <span className="text-ink-3">Yours: </span>
              <span className="tnum font-mono text-ink">{fmtX(current)}</span>
              <span className="text-ink-3"> throws </span>
              <span className="tnum font-mono text-ink">
                {Number.isFinite(atCurrent) ? `${num(dsp(atCurrent), 1)} ${yUnit}` : '—'}
              </span>
            </>
          )}
        </span>
        <span className="label text-ink-3">
          Best {spec?.label.toLowerCase()} is{' '}
          <span className="tnum font-mono text-ink-2">{fmtX(best.value)}</span>
          {Number.isFinite(gain) && gain > 0.05 && (
            <>
              {' '}
              for{' '}
              <span className="tnum font-mono text-quench">+{num(dsp(gain), 1)} {yUnit}</span>
            </>
          )}
          {Number.isFinite(gain) && gain <= 0.05 && ' — you are already there'}
        </span>
        {deadBands.length > 0 && (
          /* The shading had no key. A reader met a grey block on a chart of
             ranges with nothing to tell them whether it meant "no data" or
             "very short shot" — which are opposite conclusions. */
          <span className="label flex items-center gap-1.5 text-ink-3">
            <span aria-hidden className="h-2.5 w-4 shrink-0 bg-ink-3/12" />
            Shaded: will not throw
          </span>
        )}
        <span className="label ml-auto text-ink-3">
          {loading
            ? 'Sweeping…'
            : mode === 'bestCase'
              ? 'Each point re-cocked and released ideally'
              : 'Everything else held exactly as built'}
        </span>
      </figcaption>
    </figure>
  )
}
