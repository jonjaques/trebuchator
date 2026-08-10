import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx'
import { SegmentedControl } from './SegmentedControl.tsx'
import { Tip } from './Tip.tsx'
import { num } from '@/lib/format.ts'
import { SPEED_STOPS } from '@/lib/speeds.ts'

/**
 * Playback speed.
 *
 * The interesting range spans three orders of magnitude: the stroke of a
 * backyard machine is under a second and wants 0.05x to be readable, while a
 * siege engine's four-second flight wants 3x to get past. Chips cover the
 * useful stops and the box takes anything else, because the right speed for
 * watching one particular thing is not on anyone's list.
 */

const STOPS = SPEED_STOPS

/**
 * The chip that is lit, or `NaN` when the box holds a speed no chip covers.
 * `NaN` matches nothing, so a custom speed lights none of them — which is the
 * honest reading, and the control keeps its tab stop regardless.
 */
function nearestStop(speed: number): number {
  return STOPS.find((s) => Math.abs(speed - s) < 1e-9) ?? Number.NaN
}

function fmt(speed: number): string {
  return `${speed >= 1 ? num(speed, speed % 1 === 0 ? 0 : 2) : num(speed, 2).replace(/0+$/, '').replace(/\.$/, '')}×`
}

export function SpeedControl({ speed, onSpeed }: { speed: number; onSpeed: (s: number) => void }) {
  const [draft, setDraft] = useState('')

  const commit = () => {
    const parsed = Number.parseFloat(draft)
    if (Number.isFinite(parsed) && parsed > 0) onSpeed(Math.min(20, Math.max(0.01, parsed)))
    setDraft('')
  }

  return (
    <Popover>
      {/* Tip outside the trigger, not inside it: both are `asChild` slots, and
          the tooltip has to be the one that wraps or its props never reach the
          button. A drawn chevron, too, rather than the `▾` character that was
          here — that glyph lands on a different baseline in every font that has
          it, and this sheet already has an icon set. */}
      <Tip text="Playback speed. The stroke is over in under a second — slow it down to watch the sling close on the pin.">
        <PopoverTrigger asChild>
          <button
            className="tap-target tnum relative flex h-7 shrink-0 items-center gap-1 rounded-sm border border-rule px-2 font-mono text-[11px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
            aria-label={`Playback speed, currently ${fmt(speed)}`}
          >
            {fmt(speed)}
            <ChevronDown className="size-3 text-ink-3" aria-hidden />
          </button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" className="w-52 p-2">
        <div className="label pb-2 text-ink-3">Playback speed</div>
        <SegmentedControl
          label="Playback speed"
          variant="boxed"
          className="grid-cols-4"
          cellClassName="tnum font-mono text-[11px]"
          value={nearestStop(speed)}
          onChange={onSpeed}
          options={STOPS.map((s) => ({ value: s, label: fmt(s) }))}
        />
        <label className="mt-2 flex items-center gap-2 rounded-sm border border-rule bg-ground px-2 py-1.5 focus-within:border-verdigris">
          <span className="label shrink-0 text-ink-3">Custom</span>
          <input
            type="text"
            inputMode="decimal"
            placeholder={fmt(speed)}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setDraft('')
            }}
            className="tnum w-full min-w-0 bg-transparent text-right font-mono text-[11px] text-ink outline-none"
          />
          <span className="font-mono text-[10px] text-ink-3">×</span>
        </label>
        <p className="micro pt-2 text-ink-3">1× is real time. The stroke is the fast part.</p>
      </PopoverContent>
    </Popover>
  )
}
