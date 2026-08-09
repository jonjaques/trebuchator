import { useMemo, useState } from 'react'
import { goalValue, type ParetoGoal, type ParetoPoint } from '@/lib/treb/optimize.ts'
import { num, toDisplay, unitSymbol, type UnitSystem } from '@/lib/format.ts'
import { tickDecimals, ticksTo, usePlotWidth } from './charts.ts'

/**
 * The frontier, drawn.
 *
 * A Pareto frontier is a shape, and it was being served as a table of nine
 * rows. The table could tell you that one build throws 4 m further than
 * another; it could not show that the first six builds cost almost nothing in
 * frame load and the last three cost a great deal, which is the entire reason
 * to compute a frontier rather than a maximum. Curvature is the finding here,
 * so the curve is the readout.
 *
 * Axes are fixed by meaning, not by preference. Cost runs along x because it is
 * the thing being spent, the goal runs up y because it is the thing being
 * bought, and the curve therefore always climbs to the right — a shape a reader
 * can learn once and then read at a glance for any goal.
 *
 * Colour follows the sheet: `--quench` is what a projectile does, so the
 * candidate builds and their curve carry it; `--verdigris` means measurement,
 * so the machine you actually have is marked in it. There is no third accent
 * and no legend — the two marks are lettered where they sit.
 */

interface Props {
  points: ParetoPoint[]
  goal: ParetoGoal
  units: UnitSystem
  height?: number
  /** Adopt this build. */
  onPick: (point: ParetoPoint) => void
  /** Hovered build, or null on leave — the sheet previews its trajectory. */
  onHover?: (point: ParetoPoint | null) => void
}

const GOAL_UNIT = { range: 'length', efficiency: 'none', releaseSpeed: 'speed' } as const

const GOAL_LABEL: Record<ParetoGoal, string> = {
  range: 'Range',
  efficiency: 'Efficiency',
  releaseSpeed: 'Release speed',
}

/**
 * One magnitude for the whole axis.
 *
 * `scaled()` chooses a prefix per value, which is right for a single readout
 * and wrong for an axis: two builds a decade apart would be lettered kN and N
 * and then plotted as though the numbers were comparable. The prefix is picked
 * once, from the heaviest load on the frontier, and every point is divided by
 * that same divisor.
 */
function forceScale(maxLoad: number, units: UnitSystem) {
  const top = Math.abs(toDisplay(maxLoad, 'force', units))
  const u = unitSymbol('force', units)
  if (top >= 1e6) return { div: 1e6, unit: `M${u}` }
  if (top >= 1e3) return { div: 1e3, unit: `k${u}` }
  return { div: 1, unit: u }
}

export function ParetoChart({ points, goal, units, height = 168, onPick, onHover }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const [plotRef, W] = usePlotWidth()

  const dim = GOAL_UNIT[goal]
  // Efficiency is a fraction the reader knows as a percentage; everything else
  // converts through the unit system like any other measurement.
  const toY = (pt: ParetoPoint) =>
    goal === 'efficiency' ? goalValue(pt, goal) * 100 : toDisplay(goalValue(pt, goal), dim, units)
  const yUnit = goal === 'efficiency' ? '%' : unitSymbol(dim, units)

  const PAD = { l: W < 420 ? 38 : 50, r: 16, t: 14, b: 30 }
  const H = height

  const geom = useMemo(() => {
    if (points.length === 0) return null
    const ys = points.map(toY)
    const force = forceScale(Math.max(...points.map((p) => p.axleLoad)), units)
    const loads = points.map((p) => toDisplay(p.axleLoad, 'force', units) / force.div)
    const yTop = Math.max(...ys) * 1.12
    const xTop = Math.max(...loads) * 1.08
    return { ys, loads, force, yTop: yTop > 0 ? yTop : 1, xTop: xTop > 0 ? xTop : 1 }
    // `toY` closes over goal and units, both of which are in the dep list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, goal, units])

  if (points.length === 0 || !geom) return null

  const { ys, loads, force, yTop, xTop } = geom
  const plotW = Math.max(1, W - PAD.l - PAD.r)
  const plotH = Math.max(1, H - PAD.t - PAD.b)
  const sx = (v: number) => PAD.l + (v / xTop) * plotW
  const sy = (v: number) => PAD.t + plotH - (v / yTop) * plotH

  // The unit sits above the axis at `PAD.t - 3`, and a top tick landing within
  // a line of it prints straight through it — "mph" over "100". Which goals
  // collide depends on where `niceStep` puts the last tick relative to the 12%
  // headroom, so it is dropped by position rather than by guessing a headroom
  // that never produces one.
  const yTicks = ticksTo(yTop, 4).filter((v) => sy(v) > PAD.t + 9)
  const xTicks = ticksTo(xTop, 4)
  const yDec = tickDecimals(yTicks[1] ?? yTop)
  const xDec = tickDecimals(xTicks[1] ?? xTop)
  const forceUnit = force.unit

  // Sorted by axle load at the source, so the polyline is already in order.
  const path = points.map((_, i) => `${i ? 'L' : 'M'}${sx(loads[i])},${sy(ys[i])}`).join(' ')

  // The build you already have. `paretoSearch` evaluates the current machine as
  // candidate zero, so if it is on the frontier it is one of these points —
  // marking it is what turns the chart from a list of options into an answer to
  // "is what I have any good?".
  const hereIndex = points.findIndex((p) => p.isCurrent)
  const active = hover != null ? points[hover] : null

  return (
    <figure className="m-0">
      <div ref={plotRef} className="w-full">
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block cursor-crosshair select-none"
          role="img"
          aria-label={`${points.length} feasible builds, plotted as ${GOAL_LABEL[goal]} against peak axle load. The best throws ${num(Math.max(...ys), yDec)} ${yUnit} for ${num(loads[ys.indexOf(Math.max(...ys))], xDec)} ${forceUnit}.`}
          onMouseLeave={() => {
            setHover(null)
            onHover?.(null)
          }}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const vx = e.clientX - r.left
            const vy = e.clientY - r.top
            let bi = 0
            let bd = Infinity
            for (let i = 0; i < points.length; i++) {
              const d = (sx(loads[i]) - vx) ** 2 + (sy(ys[i]) - vy) ** 2
              if (d < bd) {
                bd = d
                bi = i
              }
            }
            setHover(bi)
            onHover?.(points[bi])
          }}
          onClick={() => active && onPick(active)}
        >
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
                {num(v, yDec)}
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

          {xTicks.map((v) => (
            <g key={v}>
              <line
                x1={sx(v)}
                y1={H - PAD.b}
                x2={sx(v)}
                y2={H - PAD.b + 4}
                stroke="var(--rule)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={sx(v)}
                y={H - PAD.b + 15}
                textAnchor="middle"
                fill="var(--ink-3)"
                fontSize={10}
                fontFamily="'Geist Mono Variable', monospace"
              >
                {num(v, xDec)}
              </text>
            </g>
          ))}
          <text
            x={W - PAD.r}
            y={H - 3}
            textAnchor="end"
            fill="var(--ink-3)"
            fontSize={9}
            fontFamily="'Instrument Sans Variable', sans-serif"
          >
            peak axle load ({forceUnit})
          </text>

          <path
            d={path}
            fill="none"
            stroke="var(--quench)"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={0.5}
            vectorEffect="non-scaling-stroke"
          />

          {points.map((_, i) => (
            <circle
              key={i}
              cx={sx(loads[i])}
              cy={sy(ys[i])}
              r={hover === i ? 5 : 3}
              fill="var(--quench)"
              opacity={hover == null || hover === i ? 1 : 0.45}
            />
          ))}

          {/* Where the machine in hand sits. A ring rather than a filled dot, so
              it reads as an annotation on a candidate rather than as a tenth
              option — it is both. */}
          {hereIndex >= 0 && (
            <>
              <circle
                cx={sx(loads[hereIndex])}
                cy={sy(ys[hereIndex])}
                r={8}
                fill="none"
                stroke="var(--verdigris)"
                strokeWidth={1.5}
              />
              <text
                x={sx(loads[hereIndex])}
                y={sy(ys[hereIndex]) - 14}
                textAnchor="middle"
                fill="var(--verdigris)"
                fontSize={9}
                fontFamily="'Instrument Sans Variable', sans-serif"
              >
                as built
              </text>
            </>
          )}

          {active && (
            <>
              <line
                x1={sx(loads[hover!])}
                y1={sy(ys[hover!])}
                x2={sx(loads[hover!])}
                y2={H - PAD.b}
                stroke="var(--quench)"
                strokeWidth={1}
                opacity={0.4}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={PAD.l}
                y1={sy(ys[hover!])}
                x2={sx(loads[hover!])}
                y2={sy(ys[hover!])}
                stroke="var(--quench)"
                strokeWidth={1}
                opacity={0.4}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>
      </div>

      {/* The hovered build's numbers, in a fixed-height row so the panel does
          not jump as the pointer crosses the plot. */}
      <figcaption className="rule-t grid min-h-[2.75rem] grid-cols-3 items-center gap-x-3 px-3 py-2">
        {active ? (
          <>
            <Readout label={GOAL_LABEL[goal]} value={`${num(toY(active), yDec)} ${yUnit}`} lead />
            {/* Lettered off the same divisor as the axis, so the figure under
                the pointer is the figure the pointer is sitting on. */}
            <Readout
              label="Axle load"
              value={`${num(toDisplay(active.axleLoad, 'force', units) / force.div, xDec)} ${forceUnit}`}
            />
            <Readout label="Shot’s share" value={`${num(active.efficiency * 100, 0)}%`} />
          </>
        ) : (
          <p className="body col-span-3 text-ink-3">
            {points.length} feasible builds. Point at one to fly it on the sheet; click to adopt it.
          </p>
        )}
      </figcaption>
    </figure>
  )
}

function Readout({ label, value, lead }: { label: string; value: string; lead?: boolean }) {
  return (
    <div className="leading-tight">
      <div className="micro text-ink-3">{label}</div>
      <div className={lead ? 'tnum font-mono text-xs text-ink' : 'tnum font-mono text-xs text-ink-2'}>
        {value}
      </div>
    </div>
  )
}
