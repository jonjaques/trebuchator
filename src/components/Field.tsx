import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { DraftSlider } from './DraftSlider.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { useNotes } from '@/lib/notes.ts'
import { usePointAt } from '@/lib/pointing.ts'
import type { DimensionKey } from './stage/sheet.ts'
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
  /**
   * The dimension on the sheet this control sets. Pointing at the control draws
   * that measurement on the drawing, so the two readings of the same fact are
   * connected without the reader having to find one from the other.
   */
  measures?: DimensionKey
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
  measures,
}: FieldProps) {
  const id = useId()
  const notes = useNotes()
  const pointAt = usePointAt()
  const hintId = `${id}-hint`
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
    /* Focus counts as pointing, so a keyboard gets the connection too. React's
       `onFocus`/`onBlur` are delegated `focusin`/`focusout`, so they reach this
       wrapper from the slider or the number box inside it — the native DOM
       events of those names do not bubble and would never fire here. Touch is
       covered by the pointer events a tap already sends. */
    <div
      className={cn('group py-1.5', disabled && 'opacity-40')}
      onPointerEnter={measures ? () => pointAt(measures) : undefined}
      onPointerLeave={measures ? () => pointAt(null) : undefined}
      onFocus={measures ? () => pointAt(measures) : undefined}
      onBlur={measures ? () => pointAt(null) : undefined}
    >
      <div className="flex items-baseline justify-between gap-2 pb-1">
        {/* The tooltip is the fallback for a mouse when the notes are folded
            away, not the only copy of the text — see `lib/notes.ts`. */}
        <label
          htmlFor={id}
          className="label truncate text-ink-2"
          title={notes ? undefined : hint}
        >
          {label}
        </label>
        {aside && <span className="tnum micro shrink-0 font-mono text-ink-3">{aside}</span>}
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
            aria-describedby={hint ? hintId : undefined}
            value={shown}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
              if (e.key === 'Escape') setDraft(null)
            }}
            className="tnum w-full min-w-0 bg-transparent text-right font-mono text-xs text-ink outline-none"
          />
          <span className="micro shrink-0 font-mono text-ink-3">{unitSymbol(dim, units)}</span>
        </div>
      </div>
      {hint && (
        <p id={hintId} className={cn('text-ink-2', notes ? 'body pt-1' : 'sr-only')}>
          {hint}
        </p>
      )}
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
  const notes = useNotes()
  const hintId = `${id}-hint`
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="label text-ink-2" title={notes ? undefined : hint}>
          {label}
        </label>
        <Switch
          id={id}
          checked={checked}
          onCheckedChange={onChange}
          aria-describedby={hint ? hintId : undefined}
        />
      </div>
      {hint && (
        <p id={hintId} className={cn('text-ink-2', notes ? 'body pt-1' : 'sr-only')}>
          {hint}
        </p>
      )}
    </div>
  )
}

/**
 * A titled run of fields or readings, collapsible from its header.
 *
 * Native `details`/`summary` rather than state: the browser gives the toggle,
 * the keyboard contract and the announcement for free, and eleven sections of
 * open/closed is not state the app needs to own. Open by default — collapsing
 * is for the reader who knows what they no longer need.
 */
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
    <details open className="group/sec rule-b px-3 py-3 last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <h3 className="stencil text-ink flex flex-1 items-baseline gap-2">
          <span className="h-px w-3 shrink-0 bg-verdigris" aria-hidden />
          {title}
        </h3>
        <ChevronDown
          className="size-3 shrink-0 text-ink-3 transition-transform group-open/sec:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="pt-1">
        {note && <p className="body pb-1.5 text-ink-2">{note}</p>}
        {children}
      </div>
    </details>
  )
}
