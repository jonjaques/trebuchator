import { useMemo, useState } from 'react'
import type { SweepMode, SweepPoint, TunableKey } from '@/lib/treb/optimize.ts'
import { TUNABLES } from '@/lib/treb/optimize.ts'
import { num, toDisplay, unitSymbol, type Dimension, type UnitSystem } from '@/lib/format.ts'
import { niceStep, tickDecimals, usePlotWidth } from './charts.ts'
import { cn } from '@/lib/utils.ts'

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

/**
 * A figure with its unit set beside it, in the sheet's own rule: the number in
 * tabular mono, the symbol in `ink-3` micro type, never inside the figure.
 *
 * Right-aligned in a reserved width so the caption's columns hold still as the
 * hovered value runs from two digits to four. `wide` is the range column, which
 * carries the larger numbers.
 */
function Figure({
  text,
  unit,
  wide,
  tone = 'text-ink',
}: {
  text: string
  unit: string
  wide?: boolean
  tone?: string
}) {
  return (
    <span className={cn('tnum label text-right font-mono', wide ? 'w-20' : 'w-14', tone)}>
      {text}
      {unit && <span className="micro pl-0.5 text-ink-3">{unit}</span>}
    </span>
  )
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
  /** The hovered value, or null on leave — the sheet previews that machine. */
  onHover?: (value: number | null) => void
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
  onHover,
}: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const [plotRef, W] = usePlotWidth()
  // The y-axis gutter has to hold a number; on a narrow sheet it gives ground.
  const PAD = { l: W < 420 ? 32 : 46, r: 14, t: 14, b: 26 }
  const spec = TUNABLES.find((t) => t.key === paramKey)
  // The sweep spec already names its dimension; 'ratio' is the one value in
  // that union with no display unit.
  const dim: Dimension = spec == null || spec.unit === 'ratio' ? 'none' : spec.unit
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
    const sx = (v: number) => PAD.l + ((v - x0) / Math.max(1e-9, x1 - x0)) * (W - PAD.l - PAD.r)
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
  const fmtX = (v: number) => num(toDisplay(v, dim, units), dim === 'angle' ? 0 : 2)
  /** Spoken form, for the label a screen reader reads off the whole figure. */
  const sayX = (v: number) => `${fmtX(v)} ${xUnit}`.trim()
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
          aria-label={`Range against ${spec?.label ?? paramKey}. Currently ${sayX(current)} giving ${num(dsp(atCurrent), 1)} ${yUnit}. Best is ${sayX(best.value)} giving ${num(dsp(best.range), 1)} ${yUnit}.`}
          onMouseLeave={() => {
            setHover(null)
            onHover?.(null)
          }}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const vx = e.clientX - r.left
            let bi = 0
            for (let i = 1; i < valid.length; i++)
              if (Math.abs(sx(valid[i].value) - vx) < Math.abs(sx(valid[bi].value) - vx)) bi = i
            setHover(bi)
            onHover?.(valid[bi].value)
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

      {/* A caption whose height is a function of the width and nothing else.
          It was a wrapping flex row of four sentences, and the hovered reading
          is longer than the resting one — so pointing at the curve wrapped the
          row onto a second line, which grew the drawer, which shrank the sheet
          above it. The chart moved out from under the pointer that was reading
          it. Two rows now, always both, every cell on one line.

          It is also a table rather than four sentences, because it was always
          answering one question in two readings — you are here, you could be
          there — and a table says that in a glance where prose made the reader
          parse "Best sling length is 113.48ft for +31.7 ft". */}
      <figcaption className="flex flex-col gap-1 pt-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        {/* Every column is a reserved width, not `auto`. Auto columns size to
            their content, so "Yours" becoming "Hovered" and 50.00 becoming
            113.48 shuffled the whole row sideways under a pointer that was
            trying to read it. */}
        <div className="grid shrink-0 grid-cols-[3.5rem_auto_auto_auto_auto] items-baseline gap-x-2 gap-y-0.5 whitespace-nowrap">
          <span className="label text-ink-3">{hovered ? 'Hovered' : 'Yours'}</span>
          <Figure text={fmtX(hovered?.value ?? current)} unit={xUnit} />
          <span className="label text-ink-3">throws</span>
          {hovered || Number.isFinite(atCurrent) ? (
            <Figure text={num(dsp(hovered?.range ?? atCurrent), 1)} unit={yUnit} wide />
          ) : (
            /* The machine is set outside the span being swept, so the curve has
               no reading for it — a fact worth stating rather than a blank. */
            <span className="label w-20 text-right text-ink-3">off the curve</span>
          )}
          <span />

          <span className="label text-ink-3">Best</span>
          <Figure text={fmtX(best.value)} unit={xUnit} />
          <span className="label text-ink-3">throws</span>
          <Figure text={num(dsp(best.range), 1)} unit={yUnit} wide />
          {Number.isFinite(gain) && gain > 0.05 ? (
            <Figure text={`+${num(dsp(gain), 1)}`} unit={yUnit} tone="text-quench" />
          ) : (
            <span className="label pl-1 text-ink-3">that is yours</span>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-0.5 sm:items-end">
          <span className="label truncate text-ink-3">
            {loading
              ? 'Sweeping…'
              : mode === 'bestCase'
                ? 'Each point re-cocked, ideal release'
                : 'Everything else as built'}
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
        </div>
      </figcaption>
    </figure>
  )
}
