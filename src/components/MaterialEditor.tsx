import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx'
import { SegmentedControl } from './SegmentedControl.tsx'
import { BEARINGS, CW_FILLS, PROJECTILE_MATERIALS } from '@/lib/treb/materials.ts'
import type { CustomMaterial } from '@/lib/treb/library.ts'
import { newId } from '@/lib/store.ts'
import { num } from '@/lib/format.ts'
import { track } from '@/lib/analytics.ts'

/**
 * The builder's own matter.
 *
 * The shipped tables are handbook values and stay read-only: two people quoting
 * "granite" to each other have to be quoting the same 2700 kg/m³, and an
 * editable reference is a reference that silently disagrees between browsers.
 * What varies is the pile in someone's yard — wet sand is not dry sand, and the
 * scrap bin is whatever is in it — so an addition sits beside the handbook
 * rather than overwriting it.
 *
 * Densities are entered in kg/m³ in both unit systems. That is the one place
 * this app does not convert, and it is deliberate: density is the number
 * printed in every reference a builder will look it up in, and lb/ft³ would
 * mean transcribing a conversion to use a table.
 */

interface Props {
  materials: CustomMaterial[]
  onChange: (materials: CustomMaterial[]) => void
  /**
   * Which kind the editor opens on. One editor per picker, each opening on the
   * kind it sits beneath: someone who has just failed to find their fill in the
   * fill list should not then have to say "fill" a second time. The editor
   * still covers all three, because the alternative is three near-identical
   * panels differing only in the word on one field.
   */
  defaultKind: Kind
}

type Kind = CustomMaterial['kind']

const KINDS: { value: Kind; label: string }[] = [
  { value: 'fill', label: 'Box fill' },
  { value: 'shot', label: 'Shot' },
  { value: 'bearing', label: 'Bearing' },
]

const BUILT_IN: Record<Kind, { name: string; figure: string }[]> = {
  fill: CW_FILLS.map((m) => ({ name: m.name, figure: `${num(m.density, 0)} kg/m³` })),
  shot: PROJECTILE_MATERIALS.map((m) => ({ name: m.name, figure: `${num(m.density, 0)} kg/m³` })),
  bearing: BEARINGS.map((b) => ({ name: b.name, figure: `µ ${b.mu}` })),
}

export function MaterialEditor({ materials, onChange, defaultKind }: Props) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Kind>(defaultKind)
  const [name, setName] = useState('')
  const [figure, setFigure] = useState('')

  const bearing = kind === 'bearing'
  const value = Number(figure)
  // A bearing coefficient above 1 is not a bearing, and a fill denser than
  // osmium is a typo. Both are refused at the field rather than accepted and
  // then reported as an impossible machine three panels away.
  const valid =
    name.trim().length > 0 &&
    figure.trim().length > 0 &&
    Number.isFinite(value) &&
    value > 0 &&
    (bearing ? value <= 1 : value <= 25000)

  const mine = materials.filter((m) => m.kind === kind)

  function add() {
    if (!valid) return
    const entry: CustomMaterial = bearing
      ? { id: newId('mat'), kind: 'bearing', name: name.trim(), mu: value }
      : { id: newId('mat'), kind, name: name.trim(), density: value }
    // The kind and nothing else. A name and a density are what somebody has in
    // their own yard, and the handbook this sits beside is already in the repo.
    track('material_added', { kind })
    onChange([...materials, entry])
    setName('')
    setFigure('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="label h-7 gap-1.5 px-2 text-ink-3">
          <Plus className="size-3" aria-hidden />
          Add a material
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[21rem] p-0">
        <div className="label rule-b bg-raised px-3 py-2 text-ink-3">Your materials</div>

        <div className="px-3 py-2.5">
          <SegmentedControl
            label="What it sets"
            variant="boxed"
            className="grid-cols-3"
            value={kind}
            onChange={setKind}
            options={KINDS}
          />
        </div>

        <div className="rule-t px-3 py-2.5">
          <div className="flex items-end gap-2">
            <label className="flex-1">
              <span className="label block pb-1 text-ink-2">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && add()}
                placeholder={bearing ? 'Nylon bushing' : 'Wet sand'}
                className="label w-full rounded-sm border border-rule bg-ground px-2 py-1.5 text-ink placeholder:text-ink-3 focus-visible:border-verdigris"
              />
            </label>
            <label className="w-[6.5rem]">
              <span className="label block pb-1 text-ink-2">{bearing ? 'µ' : 'kg/m³'}</span>
              <input
                value={figure}
                onChange={(e) => setFigure(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && add()}
                inputMode="decimal"
                placeholder={bearing ? '0.12' : '1900'}
                className="tnum w-full rounded-sm border border-rule bg-ground px-2 py-1.5 font-mono text-xs text-ink placeholder:text-ink-3 focus-visible:border-verdigris"
              />
            </label>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="label mt-2.5 h-8 w-full"
            onClick={add}
            disabled={!valid}
          >
            Add {KINDS.find((k) => k.value === kind)!.label.toLowerCase()}
          </Button>
          <p className="body pt-2 text-ink-3">
            {bearing
              ? 'Coulomb coefficient, 0 to 1. Roller bearings run about 0.02, dry timber 0.4.'
              : 'Bulk density as it packs, not the solid figure — poured sand is about 1600, rubble 2200.'}
          </p>
        </div>

        <div className="thin-scroll max-h-[16rem] overflow-y-auto">
          {mine.length > 0 && (
            <ul className="rule-t">
              {mine.map((m) => (
                <li key={m.id} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="label flex-1 truncate text-ink">{m.name}</span>
                  <span className="tnum font-mono text-[11px] text-ink-2">
                    {m.kind === 'bearing' ? `µ ${m.mu}` : `${num(m.density, 0)} kg/m³`}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="tap-target relative size-6 shrink-0"
                    onClick={() => {
                      track('material_deleted', { kind })
                      onChange(materials.filter((x) => x.id !== m.id))
                    }}
                    aria-label={`Delete ${m.name}`}
                  >
                    <Trash2 className="size-3" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {/* The handbook, shown so an addition can be judged against it rather
              than guessed at — and so it is obvious which rows cannot be edited. */}
          <div className="label rule-t rule-b bg-raised px-3 py-1.5 text-ink-3">
            Reference values
          </div>
          <ul className="pb-1">
            {BUILT_IN[kind].map((m) => (
              <li key={m.name} className="flex items-center gap-2 px-3 py-1">
                <span className="body flex-1 truncate text-ink-2">{m.name}</span>
                <span className="tnum font-mono text-[11px] text-ink-3">{m.figure}</span>
              </li>
            ))}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  )
}
