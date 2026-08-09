import { useId, useState } from 'react'
import { DraftSlider } from './DraftSlider.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { cn } from '@/lib/utils.ts'
import {
  fromDisplay,
  toDisplay,
  unitSymbol,
  type Dimension,
  type UnitSystem,
} from '@/lib/format.ts'

interface FieldProps {
  label: string
  /** SI value. Conversion to and from display units happens here. */
  value: number
  onChange: (next: number) => void
  min: number
  max: number
  step?: number
  dim: Dimension
  units: UnitSystem
  hint?: string
  disabled?: boolean
  /** Rendered to the right of the label — used for derived values and warnings. */
  aside?: string
  /**
   * Force the slider's response curve. Left alone, a range that spans more than
   * two decades goes logarithmic on its own.
   */
  scale?: 'linear' | 'log'
}

/** Trim trailing zeros, but only ever after a decimal point — 60 is not 6. */
function trimZeros(text: string): string {
  if (!text.includes('.')) return text
  return text.replace(/0+$/, '').replace(/\.$/, '')
}

/**
 * One parameter: name, slider, typed value, unit.
 *
 * The number box is authoritative and accepts anything within range — sliders
 * are for feeling out a shape, but nobody builds a trebuchet to slider
 * precision. Both write SI upward; the display units never leak inward.
 */
export function Field({
  label,
  value,
  onChange,
  min,
  max,
  step,
  dim,
  units,
  hint,
  disabled,
  aside,
  scale,
}: FieldProps) {
  const id = useId()
  const dMin = toDisplay(min, dim, units)
  const dMax = toDisplay(max, dim, units)
  const dValue = toDisplay(value, dim, units)

  // Trebuchets run from a 60 kg backyard machine to a 12 tonne siege engine, so
  // a linear slider over that range moves in 150 kg steps and is useless at the
  // small end. Anything spanning more than two decades gets a log response, and
  // the slider then works the same at either scale.
  const logScale = (scale ?? (dMin > 0 && dMax / dMin >= 100 ? 'log' : 'linear')) === 'log' && dMin > 0
  const toPos = (v: number) =>
    logScale ? Math.log(v / dMin) / Math.log(dMax / dMin) : (v - dMin) / (dMax - dMin)
  const fromPos = (s: number) =>
    logScale ? dMin * Math.pow(dMax / dMin, s) : dMin + s * (dMax - dMin)

  // The text box holds its own draft so a half-typed "0." is not clobbered by a
  // re-render, and drops it whenever the committed value moves from elsewhere —
  // a slider drag, a preset, the auto-tuner. Adjusting during render rather
  // than in an effect avoids showing one frame of the stale draft.
  const [draft, setDraft] = useState<string | null>(null)
  const [seen, setSeen] = useState({ value, units })
  if (seen.value !== value || seen.units !== units) {
    setSeen({ value, units })
    setDraft(null)
  }

  // Precision follows the value, not the range: a 0.15 kg pouch and a 12000 kg
  // counterweight share a slider but not a sensible number of decimals.
  const mag = Math.abs(dValue)
  const decimals = mag >= 1000 ? 0 : mag >= 100 ? 1 : mag >= 10 ? 2 : 3
  const shown = draft ?? trimZeros(dValue.toFixed(decimals))

  const commit = (text: string) => {
    const parsed = Number.parseFloat(text)
    if (Number.isFinite(parsed)) {
      onChange(fromDisplay(Math.min(Math.max(parsed, dMin), dMax), dim, units))
    }
    setDraft(null)
  }

  return (
    <div className={cn('group py-1.5', disabled && 'opacity-40')}>
      <div className="flex items-baseline justify-between gap-2 pb-1">
        <label htmlFor={id} className="stencil-sm text-ink-2 truncate" title={hint}>
          {label}
        </label>
        {aside && <span className="tnum font-mono text-[10px] text-ink-3 shrink-0">{aside}</span>}
      </div>
      <div className="flex items-center gap-2">
        <DraftSlider
          className="flex-1"
          label={label}
          valueText={`${shown} ${unitSymbol(dim, units)}`}
          value={[Math.min(1, Math.max(0, toPos(dValue)))]}
          min={0}
          max={1}
          step={step != null && !logScale ? toDisplay(step, dim, units) / (dMax - dMin) : 0.002}
          disabled={disabled}
          onValueChange={([s]) => onChange(fromDisplay(fromPos(s), dim, units))}
        />
        <div className="flex w-[86px] shrink-0 items-center gap-1 rounded-sm border border-rule bg-ground px-1.5 py-1 focus-within:border-verdigris">
          <input
            id={id}
            type="text"
            inputMode="decimal"
            disabled={disabled}
            value={shown}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
              if (e.key === 'Escape') setDraft(null)
            }}
            className="tnum w-full min-w-0 bg-transparent text-right font-mono text-xs text-ink outline-none"
          />
          <span className="font-mono text-[10px] text-ink-3 shrink-0">
            {unitSymbol(dim, units)}
          </span>
        </div>
      </div>
    </div>
  )
}

export function ToggleField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  hint?: string
}) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <label htmlFor={id} className="stencil-sm text-ink-2" title={hint}>
        {label}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

export function Section({
  title,
  children,
  note,
}: {
  title: string
  children: React.ReactNode
  note?: string
}) {
  return (
    <section className="rule-b px-3 py-3 last:border-b-0">
      <h3 className="stencil text-ink flex items-baseline gap-2 pb-1">
        <span className="h-px w-3 shrink-0 bg-verdigris" aria-hidden />
        {title}
      </h3>
      {note && <p className="pb-1.5 text-[11px] leading-snug text-ink-3">{note}</p>}
      {children}
    </section>
  )
}
