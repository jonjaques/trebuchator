import { AlertTriangle, Ban, Trash2 } from 'lucide-react'
import type { ShotResult, TrebuchetParams } from '@/lib/treb/types.ts'
import {
  num,
  scaled,
  show,
  speedAside,
  toDisplay,
  unitSymbol,
  type Dimension,
  type UnitSystem,
} from '@/lib/format.ts'
import { EnergyBar } from './EnergyBar.tsx'
import { Section } from './Field.tsx'
import { Tip } from './Tip.tsx'
import { Button } from '@/components/ui/button.tsx'
import { useNotes } from '@/lib/notes.ts'
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
  const notes = useNotes()
  return (
    <div className="py-[3px]">
      <Tip text={notes ? undefined : hint}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="label shrink-0 text-ink-3">{label}</span>
          <span
            className={cn('tnum shrink-0 font-mono text-xs', emphasis ? 'text-ink' : 'text-ink-2')}
          >
            {value}
            {unit && <span className="micro pl-1 text-ink-3">{unit}</span>}
          </span>
        </div>
      </Tip>
      {/* Always in the DOM so a screen reader reading the row straight through
          gets the explanation; painted only when the notes layer is on. */}
      {hint && <p className={cn('text-ink-2', notes ? 'body pt-0.5' : 'sr-only')}>{hint}</p>}
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
            <p className="body text-ink-2">{error}</p>
            <p className="body pt-1.5 text-ink-2">
              That is a fault in the simulator rather than in your machine. Change any parameter to
              fire again.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!result) {
    return <div className="body p-4 text-ink-2">Setting out the machine…</div>
  }

  if (!result.ok) {
    return (
      <div className="thin-scroll h-full overflow-y-auto p-3">
        <div className="flex items-start gap-2 rounded-sm border border-bad/40 bg-bad/5 p-3">
          <Ban className="mt-px size-4 shrink-0 text-bad" aria-hidden />
          <div>
            <h3 className="stencil pb-1.5 text-bad">This machine will not throw</h3>
            <ul className="body space-y-1.5 text-ink-2">
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
    /* The tail padding is so the last reading clears the bottom edge when the
       rail is scrolled all the way down — flush against the viewport it read as
       the end of the list rather than the end of the scroll. */
    <div className="thin-scroll h-full overflow-y-auto pb-8">
      <Section
        title="The shot"
        help={
          <>
            <p>
              Range is measured along the ground from the pivot to the point of impact — not from
              the point of release, which is somewhere over your head and a few metres downrange
              already. Pace it out from the base of the frame and this is the number you should be
              standing on.
            </p>
            <p>
              <em>Carry</em> is the part of that flown after the sling let go. The difference
              between the two is the machine reaching out and putting the shot where it started.
            </p>
            <p>
              <em>Cost of air</em> is this shot against the same shot in vacuum. On a light or wide
              projectile it is the largest single thing standing between you and the range you
              expected.
            </p>
          </>
        }
      >
        <div className="flex items-end gap-2 pb-2 pt-1">
          <span className="tnum font-mono text-[2.6rem] leading-none font-medium text-quench">
            {num(toDisplay(result.range, 'length', units), 1)}
          </span>
          <span className="pb-1 font-mono text-sm text-ink-3">{lengthU}</span>
        </div>
        <p className="body pb-2 text-ink-2">
          Measured along the ground from the pivot to where it lands.
        </p>
        <Stat
          label="Carry after release"
          value={show(result.carry, 'length', units, 1)}
          unit={lengthU}
          hint="Ground distance covered after the sling let go."
        />
        <Stat label="Apex" value={show(result.apex, 'length', units, 1)} unit={lengthU} />
        <Stat label="Time of flight" value={num(result.flightTime, 2)} unit="s" />
        {/* A strong tailwind can push the shot past its vacuum range, at which
            point the air is a gain, not a cost — the sign and the label both
            have to say so, or the row prints "−-3.1". */}
        {params.enableDrag && Number.isFinite(dragCost) && (
          <Stat
            label={dragCost >= 0 ? 'Cost of air' : 'Gained from wind'}
            value={`${dragCost >= 0 ? '−' : '+'}${show(Math.abs(dragCost), 'length', units, 1)}`}
            unit={lengthU}
            hint={`In vacuum this shot would carry ${show(result.vacuumRange, 'length', units, 1)} ${lengthU}.`}
          />
        )}
      </Section>

      <Section
        title="Release"
        help={
          <>
            <p>
              The instant the loop leaves the spigot, and the four numbers that describe it. Range
              goes as the square of release speed, so this is the readout to watch while you are
              tuning: a 10% faster release is roughly a 20% longer throw.
            </p>
            <p>
              <strong className="text-ink">Pin angle used</strong> is the one to write down. Bend
              the spigot to it. Under <em>ideal release</em> it is the angle the machine would have
              wanted, which is exactly the pin you should build.
            </p>
            <p>
              <em>Launch angle</em> drifts below 45° on a real machine and that is correct — 45° is
              optimal only in vacuum, from the ground, with nothing else going on.
            </p>
          </>
        }
      >
        <Stat
          label="Speed"
          value={show(rel.speed, 'speed', units, 1)}
          unit={unitSymbol('speed', units)}
          emphasis
          hint={speedAside(rel.speed, units) ?? undefined}
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
        <Stat label="Release height" value={show(rel.y, 'length', units, 2)} unit={lengthU} />
      </Section>

      <Section
        title="Efficiency"
        help={
          <>
            <p>
              How much of the energy the counterweight gave up ended in the shot. Everything else is
              accounted for below, and the audit has to close — that is the point of drawing it as
              one bar rather than listing percentages.
            </p>
            <p>
              The bands are where it went: beam rotation, the counterweight still moving when the
              shot left, the sling and pouch, friction, air. The outlined empty band is different in
              kind — it is energy the machine still had and never released. Unused capacity, not a
              loss, which usually means the pin let go too early.
            </p>
            <p>Hover a band and it says what it is.</p>
          </>
        }
      >
        <div className="flex items-end gap-2 pb-3">
          <span className="tnum font-mono text-2xl leading-none text-ink">
            {num(result.efficiency * 100, 1)}
          </span>
          <span className="pb-0.5 font-mono text-xs text-ink-3">% into the shot</span>
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
        help={
          <>
            <p>
              These are the numbers to take to whoever is cutting your steel. A trebuchet at rest is
              a static load anyone can size for; a trebuchet mid-stroke is several times that, and
              the frame reaction here is the one that pulls a frame apart.
            </p>
            <p>
              <em>Sling tension</em> sizes the rope and the spigot. <em>Frame reaction</em> sizes
              the axle and the joints that carry it. <em>Beam bending</em> is the moment the timber
              carries at the pivot — the section right at the axle, which is also where builders cut
              the hole for it.
            </p>
            <p>
              <em>Weight box loading</em> is in g, so 3 g means the hanger is carrying three times
              the box's own weight at the worst moment.
            </p>
            <p>Apply your own factor of safety on top. None is included here.</p>
          </>
        }
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
              <li key={wmsg} className="body flex gap-2 text-ink-2">
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
                <Tip text="Loads this machine's numbers back into the design rail. The ghost stays on the sheet either way.">
                  <button
                    onClick={() => onRecall(s)}
                    className="flex flex-1 items-baseline justify-between gap-2 rounded-sm px-1.5 py-1.5 text-left hover:bg-raised"
                  >
                    <span className="body truncate text-ink-2">{s.label}</span>
                    <span className="tnum shrink-0 font-mono text-[11px] text-ink">
                      {num(toDisplay(s.range, 'length', units), 1)}
                      <span className="pl-0.5 text-ink-3">{lengthU}</span>
                    </span>
                  </button>
                </Tip>
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
