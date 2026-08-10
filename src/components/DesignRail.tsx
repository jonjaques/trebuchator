import { useId } from 'react'
import { Field, Section, ToggleField } from './Field.tsx'
import { SegmentedControl } from './SegmentedControl.tsx'
import { Button } from '@/components/ui/button.tsx'
import { beamProperties, uniformBeam } from '@/lib/treb/model.ts'
import { cockToGround } from '@/lib/treb/simulate.ts'
import { bearingPatch, boxSizeFor, projectileMassFor } from '@/lib/treb/materials.ts'
import {
  bearingsWith,
  fillsWith,
  shotMaterialsWith,
  type CustomMaterial,
} from '@/lib/treb/library.ts'
import { MaterialEditor } from './MaterialEditor.tsx'
import { Tip } from './Tip.tsx'
import type { MachineType, TrebuchetParams } from '@/lib/treb/types.ts'
import { num, show, unitSymbol, type UnitSystem } from '@/lib/format.ts'
import { useNotes } from '@/lib/notes.ts'
import { track } from '@/lib/analytics.ts'
import { cn } from '@/lib/utils.ts'
import { ChevronDown, Crosshair, Wand2 } from 'lucide-react'

interface Props {
  params: TrebuchetParams
  patch: (p: Partial<TrebuchetParams>) => void
  units: UnitSystem
  onTunePin: () => void
  tuning: boolean
  /** Matter this browser has added, listed under the handbook values. */
  materials: CustomMaterial[]
  onMaterials: (materials: CustomMaterial[]) => void
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

/**
 * A one-shot picker that derives a parameter from real matter. Deliberately
 * stateless — the machine is defined by its numbers, not by a remembered
 * material, so picking is an action ("set the box for sand") and the control
 * springs back to its prompt.
 */
function MaterialPick({
  label,
  kind,
  hint,
  options,
  onPick,
}: {
  label: string
  /** Which table this picker draws on — the one thing worth measuring here. */
  kind: string
  hint: string
  options: { id: string; name: string }[]
  onPick: (id: string) => void
}) {
  const id = useId()
  const notes = useNotes()
  const hintId = `${id}-hint`
  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between gap-2">
        <Tip text={notes ? undefined : hint}>
          <label htmlFor={id} className="label text-ink-2">
            {label}
          </label>
        </Tip>
        <div className="relative">
          <select
            id={id}
            value=""
            aria-describedby={hintId}
            onChange={(e) => {
              if (!e.target.value) return
              // The name is a handbook row or the builder's own words; which of
              // the two is the useful signal, so that is what goes out.
              track('material_picked', { kind, custom: e.target.value.startsWith('mat-') })
              onPick(e.target.value)
            }}
            className="label appearance-none rounded-sm border border-rule bg-ground py-1 pl-2 pr-6 text-ink-2 focus-visible:border-verdigris"
          >
            <option value="">Set from…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-1.5 top-1/2 size-3 -translate-y-1/2 text-ink-3"
            aria-hidden
          />
        </div>
      </div>
      <p id={hintId} className={cn('text-ink-2', notes ? 'body pt-1' : 'sr-only')}>
        {hint}
      </p>
    </div>
  )
}

export function DesignRail({
  params,
  patch,
  units,
  onTunePin,
  tuning,
  materials,
  onMaterials,
}: Props) {
  // Handbook values plus whatever this browser has added. Rebuilt per render
  // rather than memoised: three short array concatenations against a solver
  // call that dominates every frame these lists appear in.
  const fills = fillsWith(materials)
  const shots = shotMaterialsWith(materials)
  const bearings = bearingsWith(materials)
  const beam = beamProperties(params)
  const uniform = uniformBeam(params)
  const ratio = params.armLong / Math.max(params.armShort, 1e-6)
  const massRatio = params.cwMass / Math.max(params.projectileMass, 1e-9)
  const machine = MACHINES.find((m) => m.id === params.type)!
  const cocked = cockToGround(params)
  const offCock = Math.abs(cocked - params.initialBeamAngle) > 0.5

  return (
    /* Tail padding so the last field clears the bottom edge on a full scroll. */
    <div className="thin-scroll h-full overflow-y-auto pb-8">
      <Section
        title="Machine"
        note={machine.note}
        help={
          <>
            <p>
              All three drop a weight and whip a sling; what differs is how the weight is allowed to
              move while it falls. That is the whole design question, because a weight that falls
              straighter gives up more of its height to the shot.
            </p>
            <p>
              <strong className="text-ink">Bolted</strong> is the simplest to build and the least
              efficient — the weight is dragged around an arc rather than dropped.{' '}
              <strong className="text-ink">Hinged</strong> lets it swing on its own axle and is what
              the medieval engineers settled on. <strong className="text-ink">Floating arm</strong>{' '}
              rolls the axle along rails so the weight falls dead vertically, and buys the most
              range for the most metalwork.
            </p>
            <p>
              Switching type keeps every dimension you have set, so it is a fair comparison rather
              than a fresh start.
            </p>
          </>
        }
      >
        <SegmentedControl
          label="Machine type"
          variant="boxed"
          className="grid-cols-3 pt-1"
          value={params.type}
          onChange={(type) => {
            track('machine_type_set', { machine_type: type, from: params.type })
            patch({ type })
          }}
          options={MACHINES.map((m) => ({ value: m.id, label: m.name, title: m.note }))}
        />
      </Section>

      <Section
        title="Beam"
        help={
          <>
            <p>
              The ratio between the two arms is the machine's gearing. Long against short around
              3.75 : 1 is the usual answer and 3 : 1 to 6 : 1 the usual band — below it the shot
              never gets up to speed, above it the beam is a lever the counterweight cannot turn
              quickly enough and the stroke drags.
            </p>
            <p>
              Beam mass is not a detail. It rotates with everything else, so every kilogram of
              timber is energy spent turning the beam instead of throwing the shot — which is what
              the energy budget in the results rail is showing you.
            </p>
            <p>
              Leave <em>uniform beam</em> on unless you have actually measured yours. A real beam is
              tapered and ironbound at the pivot; if you have hung it from its axle and timed a
              small swing, turn it off and enter what you measured.
            </p>
          </>
        }
      >
        <Field
          label="Long arm"
          measures="armLong"
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
          measures="armShort"
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
                : {
                    armUniform: false,
                    armCgOffset: uniform.cg,
                    armInertiaPivot: uniform.inertiaPivot,
                  },
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
        {/* The unit was missing here, on a line telling a builder where to
            balance a beam. Every other figure in the rail states it. */}
        <p className="body pt-1 text-ink-2">
          Balance point {show(beam.cg, 'length', units, 2)} {unitSymbol('length', units)} from the
          pivot.
        </p>
      </Section>

      <Section
        title="Counterweight"
        help={
          <>
            <p>
              Around 100 : 1 against the shot is where efficiency peaks, and the machines in the
              historical record sit there — which is a result this solver reproduces rather than a
              rule it was told. Past it you keep gaining range and stop gaining it cheaply: the
              extra mass goes into the frame as load, not into the shot as speed.
            </p>
            <p>
              Hanger length sets how far the weight falls and how late it keeps pulling. Box size is
              a real constraint rather than a cosmetic one — a box that reaches the ground before
              the stroke finishes stops the machine mid-throw.
            </p>
            <p>
              <em>Fill material</em> sizes the box to hold the mass you have already set. Sand and
              rubble are what a weekend build ends up filled with; lead is what the numbers want and
              nobody can afford.
            </p>
          </>
        }
      >
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
          measures="cwHanger"
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
        <MaterialPick
          label="Fill material"
          kind="fill"
          hint="Sizes the box to hold the current mass of this fill."
          options={fills}
          onPick={(id) => {
            const fill = fills.find((f) => f.id === id)!
            patch({ cwSize: boxSizeFor(params.cwMass, fill.density) })
          }}
        />
        <div className="flex justify-end pb-1">
          <MaterialEditor materials={materials} onChange={onMaterials} defaultKind="fill" />
        </div>
        {params.type === 'hinged' && (
          <ToggleField
            label="Estimate box inertia"
            hint="Treat the box as a uniform filled cube of the given size and mass."
            checked={params.cwInertiaAuto}
            onChange={(v) => patch({ cwInertiaAuto: v })}
          />
        )}
      </Section>

      <Section
        title="Sling & release"
        help={
          <>
            <p>
              The sling is where most of the speed comes from — the beam tip does part of the work
              and the sling whips the rest. Start it near the length of the long arm; that rule of
              thumb is right often enough to be worth beginning from.
            </p>
            <p>
              The <strong className="text-ink">pin angle</strong> is the one number here you will
              hold a protractor against. It is the angle between the long arm and the sling at the
              instant the loop slips off the spigot, and you set it by bending the finger of steel
              at the beam tip. Bend it wrong and a good machine throws into the ground or straight
              up.
            </p>
            <p>
              <em>Ideal release</em> is not a machine you can build — it lets go at whichever
              instant throws furthest, which is the ceiling a bent pin is chasing.{' '}
              <em>Find best pin</em> reads that instant off one shot and hands you the angle for it.
            </p>
          </>
        }
      >
        <Field
          label="Sling length"
          measures="slingLength"
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
          <Tip text="Fires once with an ideal release and bends the pin to the angle that gave. One simulation, not a search.">
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
          </Tip>
          <Tip text="Releases at whichever instant throws furthest. Not buildable — it is the ceiling a bent pin is chasing.">
            <Button
              size="sm"
              variant={params.releaseMode === 'optimal' ? 'default' : 'outline'}
              className="label h-7 flex-1"
              aria-pressed={params.releaseMode === 'optimal'}
              onClick={() =>
                patch({ releaseMode: params.releaseMode === 'optimal' ? 'pin' : 'optimal' })
              }
            >
              Ideal release
            </Button>
          </Tip>
        </div>
      </Section>

      <Section
        title="Frame"
        help={
          <>
            <p>
              Pivot height sets how much room the counterweight has to fall and how high the shot is
              when it leaves. Both help, and both are bought with timber and with a taller thing to
              keep upright under the loads in the results rail.
            </p>
            <p>
              <strong className="text-ink">Cocked angle</strong> is where the beam sits before you
              pull the pin, measured from vertical. It has one natural value — the angle at which
              the beam tip rests on the trough — and the aside beside it says whether yours is
              there.
            </p>
            <p>
              The trough is the rail the shot slides along before it lifts off. It is not cosmetic:
              the shot is held to it by a real constraint, and where the normal force passes through
              zero is where liftoff happens.
            </p>
          </>
        }
      >
        <Field
          label="Pivot height"
          measures="pivotHeight"
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

      <Section
        title="Projectile"
        help={
          <>
            <p>
              Mass and diameter are set separately because they do different jobs: mass decides how
              much of the counterweight's energy the shot can take, diameter decides how much of it
              the air takes back. A light, wide shot is the worst of both.
            </p>
            <p>
              Picking a <em>material</em> sets the mass from the diameter you have already entered
              and that material's real density — so a 200 mm ball of granite weighs what a 200 mm
              ball of granite weighs.
            </p>
            <p>
              Drag coefficient: 0.47 for a smooth sphere, 0.55 for rough stone or a pumpkin, 0.8 for
              something lumpy. It matters more than builders expect — the air is working on the shot
              during the stroke, not only in flight.
            </p>
          </>
        }
      >
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
        <MaterialPick
          label="Material"
          kind="shot"
          hint="Sets the mass from the current diameter and this material's density."
          options={shots}
          onPick={(id) => {
            const mat = shots.find((m) => m.id === id)!
            patch({ projectileMass: projectileMassFor(params.projectileDiameter, mat.density) })
          }}
        />
        <div className="flex justify-end pb-1">
          <MaterialEditor materials={materials} onChange={onMaterials} defaultKind="shot" />
        </div>
        <Field
          label="Drag coefficient"
          hint="0.47 smooth sphere · 0.55 rough stone or pumpkin · 0.8 something lumpy"
          value={params.projectileCd}
          onChange={(v) => patch({ projectileCd: v })}
          min={0.1}
          max={1.5}
          step={0.01}
          dim="none"
          units={units}
        />
      </Section>

      <Section
        title="Losses"
        note="Bearing friction and the drag the shot feels before it is even released."
        help={
          <>
            <p>
              This is where a machine that models beautifully and throws badly goes wrong. Friction
              here is Coulomb friction scaled by the real bearing reactions, so it costs more on a
              heavy machine than on a light one — which is why a scaled-up build rarely reaches the
              range its drawing promised.
            </p>
            <p>
              Axle radius multiplies the friction coefficient into a torque. A greased timber
              bearing on a fat axle can take a fifth of the stroke; the same coefficient on a thin
              steel shaft barely registers. Both numbers matter and only together.
            </p>
            <p>
              Setting a <em>bearing type</em> fills in both coefficients from a real one. Start
              there rather than guessing.
            </p>
          </>
        }
      >
        <MaterialPick
          label="Bearing type"
          kind="bearing"
          hint="Sets both friction coefficients to this bearing's."
          options={bearings}
          onPick={(id) => patch(bearingPatch(bearings.find((b) => b.id === id)!))}
        />
        <div className="flex justify-end pb-1">
          <MaterialEditor materials={materials} onChange={onMaterials} defaultKind="bearing" />
        </div>
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

      <Section
        title="Conditions"
        help={
          <>
            <p>
              The weather on the day, and two dials that exist for comparison rather than for a
              build. Turning <em>air resistance</em> off gives the textbook vacuum range — useful
              for seeing what the air is costing you, and nothing else.
            </p>
            <p>
              <em>Drop to target</em> is how far below the machine the ground is where the shot
              lands. Shooting downhill is worth more range than almost anything you can do to the
              machine, which is why siege engines were dragged uphill.
            </p>
            <p>
              Gravity is here because it is a parameter of the model and it would be dishonest to
              hide it. 9.81 on Earth.
            </p>
          </>
        }
      >
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
