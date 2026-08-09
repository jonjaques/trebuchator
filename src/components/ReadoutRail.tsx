import { AlertTriangle, Ban, Trash2 } from 'lucide-react'
import type { ShotResult, TrebuchetParams } from '@/lib/treb/types.ts'
import { num, scaled, show, speedAside, toDisplay, unitSymbol, type Dimension, type UnitSystem } from '@/lib/format.ts'
import { EnergyBar } from './EnergyBar.tsx'
import { Section } from './Field.tsx'
import { Button } from '@/components/ui/button.tsx'
import { cn } from '@/lib/utils.ts'

export interface SavedShot {
  id: number
  label: string
  range: number
  trajectory: { x: number; y: number }[]
  params: TrebuchetParams
}

interface Props {
  result: ShotResult | null
  /** The solver itself failed — distinct from a machine that will not throw. */
  error?: string | null
  params: TrebuchetParams
  units: UnitSystem
  saved: SavedShot[]
  onRecall: (shot: SavedShot) => void
  onDrop: (id: number) => void
}

function Stat({
  label,
  value,
  unit,
  hint,
  emphasis,
}: {
  label: string
  value: string
  unit?: string
  hint?: string
  emphasis?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-[3px]" title={hint}>
      <span className="label shrink-0 text-ink-3">{label}</span>
      <span className="h-px flex-1 translate-y-[-2px] bg-rule/60" aria-hidden />
      <span
        className={cn(
          'tnum shrink-0 font-mono text-xs',
          emphasis ? 'text-ink' : 'text-ink-2',
        )}
      >
        {value}
        {unit && <span className="pl-1 text-[10px] text-ink-3">{unit}</span>}
      </span>
    </div>
  )
}

function si(value: number, dim: Dimension, units: UnitSystem) {
  const s = scaled(value, dim, units)
  return { value: s.text, unit: s.unit }
}

export function ReadoutRail({ result, error, params, units, saved, onRecall, onDrop }: Props) {
  if (error) {
    return (
      <div className="thin-scroll h-full overflow-y-auto p-3">
        <div className="flex items-start gap-2 rounded-sm border border-bad/40 bg-bad/5 p-3">
          <Ban className="mt-px size-4 shrink-0 text-bad" aria-hidden />
          <div>
            <h3 className="stencil pb-1.5 text-bad">The solver stopped</h3>
            <p className="text-[11px] leading-snug text-ink-2">{error}</p>
            <p className="pt-1.5 text-[11px] leading-snug text-ink-3">
              That is a fault in the simulator rather than in your machine. Change any parameter
              to fire again.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="p-4 text-[11px] text-ink-3">Setting out the machine…</div>
    )
  }

  if (!result.ok) {
    return (
      <div className="thin-scroll h-full overflow-y-auto p-3">
        <div className="flex items-start gap-2 rounded-sm border border-bad/40 bg-bad/5 p-3">
          <Ban className="mt-px size-4 shrink-0 text-bad" aria-hidden />
          <div>
            <h3 className="stencil pb-1.5 text-bad">This machine will not throw</h3>
            <ul className="space-y-1.5 text-[11px] leading-snug text-ink-2">
              {result.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    )
  }

  const rel = result.release
  const lengthU = unitSymbol('length', units)
  const impact = si(result.impactEnergy, 'energy', units)
  const tension = si(result.peaks.slingTension, 'force', units)
  const axle = si(result.peaks.axleLoad, 'force', units)
  const moment = si(result.peaks.beamMoment, 'moment', units)
  const dragCost = result.vacuumRange - result.range

  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <Section title="The shot">
        <div className="flex items-end gap-2 pb-2 pt-1">
          <span className="tnum font-mono text-[2.6rem] leading-none font-medium text-quench">
            {num(toDisplay(result.range, 'length', units), 1)}
          </span>
          <span className="pb-1 font-mono text-sm text-ink-3">{lengthU}</span>
        </div>
        <p className="pb-2 text-[11px] leading-snug text-ink-3">
          Measured along the ground from the pivot to where it lands.
        </p>
        <Stat
          label="Carry after release"
          value={show(result.carry, 'length', units, 1)}
          unit={lengthU}
          hint="Ground distance covered after the sling let go."
        />
        <Stat
          label="Apex"
          value={show(result.apex, 'length', units, 1)}
          unit={lengthU}
        />
        <Stat label="Time of flight" value={num(result.flightTime, 2)} unit="s" />
        {params.enableDrag && (
          <Stat
            label="Cost of air"
            value={`−${show(dragCost, 'length', units, 1)}`}
            unit={lengthU}
            hint={`In vacuum this shot would carry ${show(result.vacuumRange, 'length', units, 1)} ${lengthU}.`}
          />
        )}
      </Section>

      <Section title="Release">
        <Stat
          label="Speed"
          value={show(rel.speed, 'speed', units, 1)}
          unit={unitSymbol('speed', units)}
          emphasis
          hint={speedAside(rel.speed, units)}
        />
        <Stat label="Launch angle" value={num(rel.angle, 1)} unit="°" />
        <Stat
          label="Pin angle used"
          value={num(rel.gamma, 1)}
          unit="°"
          hint="Angle between the long arm and the sling at release — bend the spigot to this."
        />
        <Stat
          label="Beam at release"
          value={num(rel.beamAngle, 1)}
          unit="°"
          hint="Beam angle from vertical. 180° is the long arm straight up."
        />
        <Stat label="Stroke time" value={num(result.timeline.releaseT, 3)} unit="s" />
        <Stat
          label="Liftoff"
          value={num(result.timeline.liftoffT, 3)}
          unit="s"
          hint="When the trough stopped carrying the shot and the sling took it."
        />
        <Stat
          label="Release height"
          value={show(rel.y, 'length', units, 2)}
          unit={lengthU}
        />
      </Section>

      <Section title="Efficiency">
        <div className="flex items-end gap-2 pb-3">
          <span className="tnum font-mono text-2xl leading-none text-ink">
            {num(result.efficiency * 100, 1)}
          </span>
          <span className="pb-0.5 font-mono text-xs text-ink-3">
            % into the shot
          </span>
        </div>
        <EnergyBar energy={result.energy} units={units} />
      </Section>

      <Section title="On target">
        <Stat
          label="Impact speed"
          value={show(result.impactSpeed, 'speed', units, 1)}
          unit={unitSymbol('speed', units)}
        />
        <Stat label="Angle of fall" value={num(result.impactAngle, 0)} unit="°" />
        <Stat label="Impact energy" value={impact.value} unit={impact.unit} emphasis />
      </Section>

      <Section
        title="Structure"
        note="Peak loads through the stroke. Size the axle and the beam for these, not for the static weight."
      >
        <Stat
          label="Sling tension"
          value={tension.value}
          unit={tension.unit}
          hint={`Peaks at ${num(result.peaks.slingTensionAt, 3)} s.`}
        />
        <Stat
          label="Frame reaction"
          value={axle.value}
          unit={axle.unit}
          hint={`Load through the main axle into the frame. Peaks at ${num(result.peaks.axleLoadAt, 3)} s.`}
        />
        <Stat
          label="Beam bending"
          value={moment.value}
          unit={moment.unit}
          hint="Bending moment the beam carries at the pivot."
        />
        <Stat
          label="Weight box loading"
          value={num(result.peaks.cwAcceleration, 1)}
          unit="g"
          hint="Peak force on the hanger as a multiple of the box's own weight."
        />
      </Section>

      {result.warnings.length > 0 && (
        <Section title="Watch out">
          <ul className="space-y-2">
            {result.warnings.map((wmsg) => (
              <li key={wmsg} className="flex gap-2 text-[11px] leading-snug text-ink-2">
                <AlertTriangle className="mt-px size-3.5 shrink-0 text-warn" aria-hidden />
                <span>{wmsg}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {saved.length > 0 && (
        <Section title="Saved shots" note="Drawn on the sheet as dashed ghosts.">
          <ul className="space-y-px">
            {saved.map((s) => (
              <li key={s.id} className="flex items-center gap-1">
                <button
                  onClick={() => onRecall(s)}
                  className="flex flex-1 items-baseline justify-between gap-2 rounded-sm px-1.5 py-1.5 text-left hover:bg-raised"
                  title="Load this machine back into the panel"
                >
                  <span className="truncate text-[11px] text-ink-2">{s.label}</span>
                  <span className="tnum shrink-0 font-mono text-[11px] text-ink">
                    {num(toDisplay(s.range, 'length', units), 1)}
                    <span className="pl-0.5 text-ink-3">{lengthU}</span>
                  </span>
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 shrink-0 text-ink-3 hover:text-bad"
                  onClick={() => onDrop(s.id)}
                  aria-label={`Remove ${s.label}`}
                >
                  <Trash2 className="size-3" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
