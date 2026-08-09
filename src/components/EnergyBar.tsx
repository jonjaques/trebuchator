import { useState } from 'react'
import type { EnergyBudget } from '@/lib/treb/types.ts'
import { num, scaled, toDisplay, unitSymbol, type UnitSystem } from '@/lib/format.ts'
import { cn } from '@/lib/utils.ts'

/**
 * Where the machine's energy actually went.
 *
 * Parts of a whole, so: one horizontal 100% bar. The buckets are not five
 * separate identities needing five hues — one is the payoff and the rest are
 * graded overheads — so the payoff takes the single accent and the overheads
 * take a lightness ramp.
 *
 * "Never released" is drawn as an outlined void rather than a fifth fill,
 * because it is not a loss: it is stroke the machine still had left when the
 * sling let go. An empty slot reads that immediately, and it keeps the palette
 * at one accent plus one ramp.
 */

interface Bucket {
  key: string
  label: string
  value: number
  fill: string | null
  note: string
}

function buckets(e: EnergyBudget): Bucket[] {
  return [
    {
      key: 'shot',
      label: 'Into the shot',
      value: e.projectile,
      fill: 'var(--quench)',
      note: 'Kinetic energy the projectile carries away. This is the number efficiency measures.',
    },
    {
      key: 'machine',
      label: 'Left in the machine',
      value: e.beam + e.counterweight + e.sling,
      fill: 'var(--ramp-1)',
      note: 'Still moving the beam, the weight and the sling at the moment of release. It ends up in the frame.',
    },
    {
      key: 'lift',
      label: 'Hoisting the shot',
      value: e.lift,
      fill: 'var(--ramp-2)',
      note: 'Spent raising the projectile from the trough to release height. Not wasted — it buys you a higher launch.',
    },
    {
      key: 'losses',
      label: 'Friction & air',
      value: e.friction + e.drag,
      fill: 'var(--ramp-3)',
      note: 'Burned in the bearings and pushing the shot through air during the stroke.',
    },
    {
      key: 'unspent',
      label: 'Never released',
      value: Math.max(0, e.unspent),
      fill: null,
      note: 'Stroke the machine still had left when the sling let go. Not a loss — unused capacity.',
    },
  ]
}

export function EnergyBar({ energy, units }: { energy: EnergyBudget; units: UnitSystem }) {
  const [hover, setHover] = useState<string | null>(null)
  const rows = buckets(energy)
  const total = Math.max(
    1e-9,
    rows.reduce((s, b) => s + Math.max(0, b.value), 0),
  )
  const available = scaled(energy.available, 'energy', units)
  const active = rows.find((r) => r.key === hover)

  return (
    <div>
      <div className="flex items-baseline justify-between pb-2">
        <span className="label text-ink-3">Available this stroke</span>
        <span className="tnum font-mono text-xs text-ink">
          {available.text}
          <span className="pl-1 text-ink-3">{available.unit}</span>
        </span>
      </div>

      <div
        className="flex h-6 w-full gap-[2px]"
        role="img"
        aria-label={rows
          .map((b) => `${b.label} ${num((b.value / total) * 100, 0)} percent`)
          .join(', ')}
        onMouseLeave={() => setHover(null)}
      >
        {rows.map((b) => {
          const pct = (Math.max(0, b.value) / total) * 100
          if (pct < 0.15) return null
          return (
            <button
              key={b.key}
              type="button"
              style={{ width: `${pct}%`, background: b.fill ?? 'transparent' }}
              className={cn(
                'relative h-full min-w-[3px] rounded-[1px] transition-opacity',
                b.fill === null && 'border border-dashed border-rule',
                hover && hover !== b.key && 'opacity-45',
              )}
              onMouseEnter={() => setHover(b.key)}
              onFocus={() => setHover(b.key)}
              onBlur={() => setHover(null)}
              aria-label={`${b.label}: ${num((b.value / total) * 100, 0)}%`}
            />
          )
        })}
      </div>

      <p className="min-h-[2.4rem] pt-2 text-[11px] leading-snug text-ink-3">
        {active?.note ?? 'Hover a band to see what it accounts for.'}
      </p>

      <dl className="pt-1">
        {rows.map((b) => {
          const pct = (Math.max(0, b.value) / total) * 100
          return (
            <div
              key={b.key}
              className={cn(
                'flex items-center gap-2 py-[3px] transition-opacity',
                hover && hover !== b.key && 'opacity-45',
              )}
              onMouseEnter={() => setHover(b.key)}
              onMouseLeave={() => setHover(null)}
            >
              <span
                aria-hidden
                className={cn('h-2.5 w-2.5 shrink-0 rounded-[1px]', b.fill === null && 'border border-dashed border-rule')}
                style={b.fill ? { background: b.fill } : undefined}
              />
              <dt className="flex-1 truncate text-[11px] text-ink-2">{b.label}</dt>
              <dd className="tnum shrink-0 font-mono text-[11px] text-ink-3">
                {num(toDisplay(b.value, 'energy', units))} {unitSymbol('energy', units)}
              </dd>
              <dd className="tnum w-9 shrink-0 text-right font-mono text-[11px] text-ink">
                {num(pct, 0)}%
              </dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}
