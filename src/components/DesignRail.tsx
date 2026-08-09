import { Field, Section, ToggleField } from './Field.tsx'
import { Button } from '@/components/ui/button.tsx'
import { beamProperties, uniformBeam } from '@/lib/treb/model.ts'
import { cockToGround } from '@/lib/treb/simulate.ts'
import type { MachineType, TrebuchetParams } from '@/lib/treb/types.ts'
import { num, show, type UnitSystem } from '@/lib/format.ts'
import { cn } from '@/lib/utils.ts'
import { Crosshair, Wand2 } from 'lucide-react'

interface Props {
  params: TrebuchetParams
  patch: (p: Partial<TrebuchetParams>) => void
  units: UnitSystem
  onTunePin: () => void
  tuning: boolean
}

const MACHINES: { id: MachineType; name: string; note: string }[] = [
  {
    id: 'hinged',
    name: 'Hinged',
    note: 'The weight hangs on its own axle and swings as a second pendulum. What the medieval engineers settled on.',
  },
  {
    id: 'fixed',
    name: 'Bolted',
    note: 'The weight is rigid on the short arm. Fewer parts, and the weight is dragged through an arc instead of falling.',
  },
  {
    id: 'floating',
    name: 'Floating arm',
    note: 'The axle rolls on rails while the weight drops straight down a channel, through twice the short arm.',
  },
]

export function DesignRail({ params, patch, units, onTunePin, tuning }: Props) {
  const beam = beamProperties(params)
  const uniform = uniformBeam(params)
  const ratio = params.armLong / Math.max(params.armShort, 1e-6)
  const massRatio = params.cwMass / Math.max(params.projectileMass, 1e-9)
  const machine = MACHINES.find((m) => m.id === params.type)!
  const cocked = cockToGround(params)
  const offCock = Math.abs(cocked - params.initialBeamAngle) > 0.5

  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <Section title="Machine" note={machine.note}>
        <div role="radiogroup" aria-label="Machine type" className="grid grid-cols-3 gap-1 pt-1">
          {MACHINES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={params.type === m.id}
              onClick={() => patch({ type: m.id })}
              className={cn(
                'label rounded-sm border px-1 py-2 transition-colors',
                params.type === m.id
                  ? 'border-verdigris bg-verdigris/10 text-ink'
                  : 'border-rule text-ink-3 hover:border-ink-3 hover:text-ink-2',
              )}
            >
              {m.name}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Beam">
        <Field
          label="Long arm"
          hint="Pivot to the sling attachment — the throwing end."
          value={params.armLong}
          onChange={(v) => patch({ armLong: v })}
          min={0.3}
          max={20}
          dim="length"
          units={units}
          aside={`ratio ${num(ratio, 2)} : 1`}
        />
        <Field
          label="Short arm"
          hint="Pivot to the counterweight attachment."
          value={params.armShort}
          onChange={(v) => patch({ armShort: v })}
          min={0.05}
          max={6}
          dim="length"
          units={units}
          aside={ratio < 3 || ratio > 6 ? 'outside 3–6:1' : 'in the usual band'}
        />
        <Field
          label="Beam mass"
          value={params.armMass}
          onChange={(v) => patch({ armMass: v })}
          min={0.2}
          max={4000}
          dim="mass"
          units={units}
        />
        <ToggleField
          label="Uniform beam"
          hint="Derive the beam's balance point and inertia from a plain prism of the given length and mass."
          checked={params.armUniform}
          onChange={(v) =>
            patch(
              v
                ? { armUniform: true }
                : { armUniform: false, armCgOffset: uniform.cg, armInertiaPivot: uniform.inertiaPivot },
            )
          }
        />
        {!params.armUniform && (
          <>
            <Field
              label="Balance point"
              hint="Beam centre of gravity, measured from the pivot toward the long arm."
              value={params.armCgOffset}
              onChange={(v) => patch({ armCgOffset: v })}
              min={-3}
              max={8}
              dim="length"
              units={units}
            />
            <Field
              label="Inertia about pivot"
              hint="Hang the beam from its axle and time a small swing to measure this."
              value={params.armInertiaPivot}
              onChange={(v) => patch({ armInertiaPivot: v })}
              min={0.01}
              max={40000}
              dim="none"
              units={units}
              aside={`uniform: ${num(uniform.inertiaPivot, 2)}`}
            />
          </>
        )}
        <p className="pt-1 text-[11px] text-ink-3">
          Balance point {show(beam.cg, 'length', units, 2)} from the pivot.
        </p>
      </Section>

      <Section title="Counterweight">
        <Field
          label="Mass"
          value={params.cwMass}
          onChange={(v) => patch({ cwMass: v })}
          min={0.5}
          max={30000}
          dim="mass"
          units={units}
          aside={`${num(massRatio, 0)} : 1 to the shot`}
        />
        <Field
          label={params.type === 'fixed' ? 'Standoff' : 'Hanger length'}
          hint={
            params.type === 'fixed'
              ? 'Extra reach past the short arm end. On a bolted machine this is just more short arm.'
              : "Short arm end to the weight's centre of gravity."
          }
          value={params.cwHanger}
          onChange={(v) => patch({ cwHanger: v })}
          min={0}
          max={5}
          dim="length"
          units={units}
        />
        <Field
          label="Box size"
          hint="Side of the weight box. Sets ground clearance and how much of the stroke it can use."
          value={params.cwSize}
          onChange={(v) => patch({ cwSize: v })}
          min={0.05}
          max={4}
          dim="length"
          units={units}
        />
        {params.type === 'hinged' && (
          <ToggleField
            label="Estimate box inertia"
            hint="Treat the box as a uniform filled cube of the given size and mass."
            checked={params.cwInertiaAuto}
            onChange={(v) => patch({ cwInertiaAuto: v })}
          />
        )}
      </Section>

      <Section title="Sling & release">
        <Field
          label="Sling length"
          hint="Beam tip to the centre of the pouch. Start near the long arm's length."
          value={params.slingLength}
          onChange={(v) => patch({ slingLength: v })}
          min={0.05}
          max={20}
          dim="length"
          units={units}
          aside={`${num((params.slingLength / params.armLong) * 100, 0)}% of long arm`}
        />
        <Field
          label="Sling & pouch mass"
          hint="Rides with the shot through the whole stroke but does not fly with it."
          value={params.slingMass}
          onChange={(v) => patch({ slingMass: v })}
          min={0}
          max={60}
          dim="mass"
          units={units}
        />
        <Field
          label="Pin angle"
          hint="Angle between the long arm and the sling when the loop slips off the spigot. This is the number you bend the finger to."
          value={params.releaseAngle}
          onChange={(v) => patch({ releaseAngle: v, releaseMode: 'pin' })}
          min={5}
          max={140}
          step={0.5}
          dim="angle"
          units={units}
          disabled={params.releaseMode === 'optimal'}
        />
        <div className="flex gap-1.5 pt-1">
          <Button
            size="sm"
            variant="outline"
            className="label h-7 flex-1 gap-1.5"
            disabled={tuning}
            onClick={onTunePin}
          >
            <Crosshair className="size-3" aria-hidden />
            {tuning ? 'Finding…' : 'Find best pin'}
          </Button>
          <Button
            size="sm"
            variant={params.releaseMode === 'optimal' ? 'default' : 'outline'}
            className="label h-7 flex-1"
            onClick={() =>
              patch({ releaseMode: params.releaseMode === 'optimal' ? 'pin' : 'optimal' })
            }
            title="Release at the instant that maximises range — the ceiling a tuned pin is chasing."
          >
            Ideal release
          </Button>
        </div>
      </Section>

      <Section title="Frame">
        <Field
          label="Pivot height"
          value={params.pivotHeight}
          onChange={(v) => patch({ pivotHeight: v })}
          min={0.2}
          max={20}
          dim="length"
          units={units}
        />
        <Field
          label="Trough height"
          hint="Height of the rail the shot slides along before liftoff. Zero is bare ground."
          value={params.troughHeight}
          onChange={(v) => patch({ troughHeight: v })}
          min={0}
          max={2}
          dim="length"
          units={units}
        />
        <Field
          label="Cocked angle"
          hint="Beam angle from vertical at rest. Zero would point the long arm straight down."
          value={params.initialBeamAngle}
          onChange={(v) => patch({ initialBeamAngle: v })}
          min={2}
          max={85}
          step={0.5}
          dim="angle"
          units={units}
          aside={offCock ? `tip rests at ${num(cocked, 1)}°` : 'tip on the trough'}
        />
        {offCock && (
          <Button
            size="sm"
            variant="outline"
            className="label mt-1 h-7 w-full gap-1.5"
            onClick={() => patch({ initialBeamAngle: cocked })}
          >
            <Wand2 className="size-3" aria-hidden />
            Rest the tip on the trough
          </Button>
        )}
      </Section>

      <Section title="Projectile">
        <Field
          label="Mass"
          value={params.projectileMass}
          onChange={(v) => patch({ projectileMass: v })}
          min={0.01}
          max={400}
          dim="mass"
          units={units}
        />
        <Field
          label="Diameter"
          value={params.projectileDiameter}
          onChange={(v) => patch({ projectileDiameter: v })}
          min={0.01}
          max={1.2}
          dim="length"
          units={units}
        />
        <Field
          label="Drag coefficient"
          hint="0.47 smooth sphere · 0.55 rough stone · 0.8 something lumpy"
          value={params.projectileCd}
          onChange={(v) => patch({ projectileCd: v })}
          min={0.1}
          max={1.5}
          step={0.01}
          dim="none"
          units={units}
        />
      </Section>

      <Section title="Losses" note="Bearing friction and the drag the shot feels before it is even released.">
        <Field
          label="Axle friction"
          value={params.pivotFriction}
          onChange={(v) => patch({ pivotFriction: v })}
          min={0}
          max={0.5}
          step={0.005}
          dim="none"
          units={units}
          hint="Coulomb coefficient. ~0.02 for a roller bearing, ~0.25 for greased timber on timber."
        />
        <Field
          label="Axle radius"
          value={params.pivotRadius}
          onChange={(v) => patch({ pivotRadius: v })}
          min={0}
          max={0.3}
          dim="length"
          units={units}
        />
        {params.type === 'hinged' && (
          <>
            <Field
              label="Hinge friction"
              value={params.hingeFriction}
              onChange={(v) => patch({ hingeFriction: v })}
              min={0}
              max={0.5}
              step={0.005}
              dim="none"
              units={units}
            />
            <Field
              label="Hinge radius"
              value={params.hingeRadius}
              onChange={(v) => patch({ hingeRadius: v })}
              min={0}
              max={0.3}
              dim="length"
              units={units}
            />
          </>
        )}
        <Field
          label="Trough friction"
          value={params.troughFriction}
          onChange={(v) => patch({ troughFriction: v })}
          min={0}
          max={1}
          step={0.01}
          dim="none"
          units={units}
        />
      </Section>

      <Section title="Conditions">
        <ToggleField
          label="Air resistance"
          checked={params.enableDrag}
          onChange={(v) => patch({ enableDrag: v })}
          hint="Off gives the textbook vacuum range, for comparison."
        />
        <Field
          label="Wind"
          hint="Positive is a tailwind, blowing the way you are shooting."
          value={params.windSpeed}
          onChange={(v) => patch({ windSpeed: v })}
          min={-25}
          max={25}
          dim="speed"
          units={units}
          disabled={!params.enableDrag}
        />
        <Field
          label="Air density"
          hint="1.225 at sea level, 1.0 at 2000 m, 1.29 on a cold day."
          value={params.airDensity}
          onChange={(v) => patch({ airDensity: v })}
          min={0}
          max={1.5}
          step={0.005}
          dim="none"
          units={units}
          disabled={!params.enableDrag}
        />
        <Field
          label="Drop to target"
          hint="How far the target sits below the machine. Positive is downhill."
          value={params.targetDrop}
          onChange={(v) => patch({ targetDrop: v })}
          min={-60}
          max={120}
          dim="length"
          units={units}
        />
        <Field
          label="Gravity"
          value={params.gravity}
          onChange={(v) => patch({ gravity: v })}
          min={0.5}
          max={30}
          step={0.01}
          dim="none"
          units={units}
          hint="9.81 on Earth, 1.62 on the Moon, 3.72 on Mars."
        />
      </Section>
    </div>
  )
}
