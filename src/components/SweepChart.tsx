import { useMemo, useState } from 'react'
import type { SweepPoint, TunableKey } from '@/lib/treb/optimize.ts'
import { TUNABLES } from '@/lib/treb/optimize.ts'
import { num, toDisplay, unitSymbol, type Dimension, type UnitSystem } from '@/lib/format.ts'

/**
 * Range against one parameter, everything else held.
 *
 * One series, so no legend — the caption names it. The two annotations are the
 * peak and where the machine currently sits, and the current-value marker
 * borrows the sheet's dimension-line vocabulary (witness line down to the axis,
 * figure in the gap) so it reads the same way as every measurement on the
 * drawing.
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
  height?: number
  onPick: (value: number) => void
}

export function SweepChart({
  points,
  paramKey,
  current,
  units,
  loading,
  height = 118,
  onPick,
}: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const spec = TUNABLES.find((t) => t.key === paramKey)
  const dim = DIM_OF[paramKey] ?? 'none'
  const xUnit = unitSymbol(dim, units)
  const yUnit = unitSymbol('length', units)

  const pad = { l: 8, r: 8, t: 10, b: 18 }
  const W = 1000
  const H = height

  const valid = points.filter((p) => Number.isFinite(p.range))
  const geom = useMemo(() => {
    if (valid.length < 2) return null
    const xs = points.map((p) => p.value)
    const x0 = Math.min(...xs)
    const x1 = Math.max(...xs)
    const y1 = Math.max(...valid.map((p) => p.range))
    const sx = (v: number) => pad.l + ((v - x0) / Math.max(1e-9, x1 - x0)) * (W - pad.l - pad.r)
    const sy = (v: number) => H - pad.b - (v / Math.max(1e-9, y1 * 1.12)) * (H - pad.t - pad.b)
    let best = valid[0]
    for (const p of valid) if (p.range > best.range) best = p
    return { x0, x1, y1, sx, sy, best }
  }, [points, valid, H, pad.b, pad.l, pad.r, pad.t])

  if (!geom) {
    return (
      <div
        className="flex items-center justify-center text-[11px] text-ink-3"
        style={{ height: H }}
      >
        {loading ? 'Sweeping…' : 'Not enough valid shots to plot.'}
      </div>
    )
  }

  const { sx, sy, best } = geom
  // Merge consecutive dead values into one band so a long unusable stretch is
  // a single shaded region rather than a picket fence.
  const deadBands: { from: number; to: number }[] = []
  for (const pt of points) {
    if (Number.isFinite(pt.range)) continue
    const last = deadBands[deadBands.length - 1]
    if (last && Math.abs(last.to - pt.value) < (geom.x1 - geom.x0) / (points.length - 1) * 1.5)
      last.to = pt.value
    else deadBands.push({ from: pt.value, to: pt.value })
  }
  const deadCount = points.filter((pt) => !Number.isFinite(pt.range)).length
  const path = valid.map((p, i) => `${i ? 'L' : 'M'}${sx(p.value).toFixed(1)},${sy(p.range).toFixed(1)}`).join('')
  const hovered = hover != null ? valid[hover] : null
  const fmtX = (v: number) => `${num(toDisplay(v, dim, units), dim === 'angle' ? 0 : 2)}${xUnit}`

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full cursor-crosshair select-none"
        style={{ height: H }}
        role="img"
        aria-label={`Range against ${spec?.label ?? paramKey}. Peak ${num(toDisplay(best.range, 'length', units), 1)} ${yUnit} at ${fmtX(best.value)}.`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const vx = ((e.clientX - r.left) / r.width) * W
          let bi = 0
          for (let i = 1; i < valid.length; i++)
            if (Math.abs(sx(valid[i].value) - vx) < Math.abs(sx(valid[bi].value) - vx)) bi = i
          setHover(bi)
        }}
        onClick={() => hovered && onPick(hovered.value)}
      >
        <line
          x1={pad.l}
          y1={H - pad.b}
          x2={W - pad.r}
          y2={H - pad.b}
          stroke="var(--rule)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />

        {/* Values that produce no shot at all are a real finding, so the band is
            shaded rather than left as a silent gap in the line. Kept faint: it
            marks dead ground, it is not data to read off. */}
        {deadBands.map((b, i) => (
          <rect
            key={i}
            x={sx(b.from)}
            y={pad.t}
            width={Math.max(2, sx(b.to) - sx(b.from))}
            height={H - pad.t - pad.b}
            fill="var(--ink-3)"
            opacity={0.12}
          />
        ))}

        <path
          d={path}
          fill="none"
          stroke="var(--quench)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* Peak */}
        <g>
          <circle cx={sx(best.value)} cy={sy(best.range)} r={4} fill="var(--quench)" />
          <text
            x={Math.min(Math.max(sx(best.value), 40), W - 40)}
            y={Math.max(sy(best.range) - 8, 10)}
            textAnchor="middle"
            fill="var(--ink-2)"
            fontSize={11}
            fontFamily="'IBM Plex Mono', monospace"
          >
            {num(toDisplay(best.range, 'length', units), 1)}
            {yUnit}
          </text>
        </g>

        {/* Where this machine currently sits, in the sheet's dimension idiom. */}
        {current >= geom.x0 && current <= geom.x1 && (
          <g>
            <line
              x1={sx(current)}
              y1={pad.t}
              x2={sx(current)}
              y2={H - pad.b}
              stroke="var(--verdigris)"
              strokeWidth={1}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
            <polygon
              points={`${sx(current)},${H - pad.b - 5} ${sx(current) - 4},${H - pad.b + 2} ${sx(current) + 4},${H - pad.b + 2}`}
              fill="var(--verdigris)"
            />
            <text
              x={Math.min(Math.max(sx(current), 34), W - 34)}
              y={H - 5}
              textAnchor="middle"
              fill="var(--verdigris)"
              fontSize={10}
              fontFamily="'IBM Plex Mono', monospace"
            >
              {fmtX(current)}
            </text>
          </g>
        )}

        {hovered && (
          <g>
            <line
              x1={sx(hovered.value)}
              y1={pad.t}
              x2={sx(hovered.value)}
              y2={H - pad.b}
              stroke="var(--ink-3)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={sx(hovered.value)}
              cy={sy(hovered.range)}
              r={4}
              fill="var(--quench)"
              stroke="var(--sheet)"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>

      <figcaption className="flex items-baseline justify-between gap-2 pt-1">
        <span className="stencil-sm text-ink-3">
          Range vs {spec?.label ?? paramKey}
          {deadCount > 0 && (
            <span className="pl-2 normal-case tracking-normal">
              shaded: no shot at all
            </span>
          )}
        </span>
        <span className="tnum font-mono text-[11px] text-ink-2">
          {hovered
            ? `${fmtX(hovered.value)} → ${num(toDisplay(hovered.range, 'length', units), 1)} ${yUnit}`
            : `peak at ${fmtX(best.value)}`}
        </span>
      </figcaption>
    </figure>
  )
}
