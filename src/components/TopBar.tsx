import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  BookmarkPlus,
  Check,
  ChevronDown,
  Link2,
  Moon,
  PanelLeft,
  PanelRight,
  Save,
  Sun,
  Trash2,
  Wand2,
} from 'lucide-react'
import { Button } from '@/components/ui/button.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx'
import { Explain } from './Explain.tsx'
import { Tip } from './Tip.tsx'
import { SegmentedControl } from './SegmentedControl.tsx'
import { ParetoChart } from './ParetoChart.tsx'
import { PRESETS } from '@/lib/treb/presets.ts'
import { shareUrl } from '@/lib/share.ts'
import { GOALS, type ParetoGoal, type ParetoPoint } from '@/lib/treb/optimize.ts'
import type { SavedMachine } from '@/lib/treb/library.ts'
import { type UnitSystem } from '@/lib/format.ts'
import { cn } from '@/lib/utils.ts'

interface Props {
  presetId: string | null
  onPreset: (id: string) => void
  units: UnitSystem
  onUnits: (u: UnitSystem) => void
  dark: boolean
  onDark: (v: boolean) => void
  onSave: () => void
  /** False while there is no fired shot to keep — the save button no-ops then,
   *  so it should look like it will. */
  canSave: boolean
  /** The machines this browser has kept, newest last. */
  machines: SavedMachine[]
  onSaveMachine: (name: string) => void
  onLoadMachine: (id: string) => void
  onDeleteMachine: (id: string) => void
  /** Kick off a Pareto frontier search around the current machine. */
  onOptimize: () => void
  optimizing: boolean
  /** The frontier of the last search, or null when none is current. */
  pareto: ParetoPoint[] | null
  goal: ParetoGoal
  onGoal: (goal: ParetoGoal) => void
  onApplyPareto: (point: ParetoPoint) => void
  /** Hovered frontier build — the sheet flies it. Null on leave. */
  onPreviewPareto: (point: ParetoPoint | null) => void
  busy: boolean
  showDesign: boolean
  showResults: boolean
  onToggleDesign: () => void
  onToggleResults: () => void
}

const ERA_LABEL: Record<string, string> = {
  modern: 'Build one this weekend',
  historical: 'From the record',
  reference: 'Validation',
}

export function TopBar({
  presetId,
  onPreset,
  units,
  onUnits,
  dark,
  onDark,
  onSave,
  canSave,
  machines,
  onSaveMachine,
  onLoadMachine,
  onDeleteMachine,
  onOptimize,
  optimizing,
  pareto,
  goal,
  onGoal,
  onApplyPareto,
  onPreviewPareto,
  busy,
  showDesign,
  showResults,
  onToggleDesign,
  onToggleResults,
}: Props) {
  const eras = ['modern', 'historical', 'reference'] as const
  const [optimizeOpen, setOptimizeOpen] = useState(false)
  const [presetOpen, setPresetOpen] = useState(false)
  const currentName =
    PRESETS.find((p) => p.id === presetId)?.name ??
    machines.find((m) => m.id === presetId)?.name ??
    'Custom machine'

  return (
    /* Two rows below `lg`, one above. On a phone the wordmark, the preset name
       and four icon buttons cannot share a row without the first two colliding
       — which is exactly what they did. The switch used to be at `md`, but the
       single row does not actually fit until about 1000px: between the two it
       overflowed a shell that deliberately cannot scroll, so the last control
       was silently clipped off the edge rather than wrapping.

       At `xl` the header is three cells and they are the *body's* three columns:
       identity over the design rail at `21rem`, actions over the sheet, settings
       over the results rail at `20rem` — each separated by the same 1px rule
       that runs down the column beneath it. The bar used to be a left cluster,
       a right cluster and 800px of nothing between them on a wide screen; this
       spends that width on structure instead, and the sheet's own column now has
       a header of its own. Below `xl` the cells collapse back to a plain
       toolbar, because there are no columns to agree with. */
    <header className="rule-b flex shrink-0 flex-col bg-ground lg:h-12 lg:flex-row lg:items-stretch">
      {/* The settings cluster sits beside the wordmark down to about 340px, and
          wraps below that rather than clipping — the shell cannot scroll, so
          without the wrap the last control is simply gone off the edge. It used
          to wrap at every phone width, which cost a whole row on an iPhone: the
          units control was a two-cell segment 104px wide, and shrinking it to
          one 56px chip is what bought the row back. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 lg:flex-nowrap lg:py-0 xl:rule-r xl:w-[21rem] xl:shrink-0">
        {/* One flex item rather than two siblings so the hover that sets the
            mark's trajectory marching covers the whole lockup, not a 28px
            square nobody's pointer will find. */}
        <div className="brand flex items-center gap-2">
          <TrebuchetMark />
          <div className="leading-none">
            <h1 className="wordmark text-ink">Trebuchator</h1>
            <p className="label hidden whitespace-nowrap pt-1 text-ink-3 sm:block">
              Counterweight siege engine calculator
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1 lg:hidden">
          <UnitToggle units={units} onUnits={onUnits} />
          <ThemeButton dark={dark} onDark={onDark} />
          <PanelButtons
            showDesign={showDesign}
            showResults={showResults}
            onToggleDesign={onToggleDesign}
            onToggleResults={onToggleResults}
          />
        </div>
      </div>

      {/* Real vertical padding rather than a fixed height. `h-12` was here and
          did nothing: `flex-1` sets `flex-basis: 0%`, which in this column
          header overrides the height outright, so the row collapsed to its 32px
          buttons and they sat hard against both rules. The height belongs at
          `lg`, where this row *is* the header row. */}
      <div className="rule-t flex min-w-0 items-center gap-2 px-3 py-2 lg:flex-1 lg:border-t-0 lg:py-0">
        {/* At `xl` the cell's own left rule does this job, and two separators a
            few pixels apart would read as a mistake. */}
        <span className="mx-1 hidden h-6 w-px bg-rule lg:block xl:hidden" aria-hidden />

        {/* Controlled so picking closes it. Uncontrolled, the menu stayed open
          over the sheet after a choice, hiding the machine it had just changed
          — the one thing the reader wanted to look at. */}
        <Popover open={presetOpen} onOpenChange={setPresetOpen}>
          <PopoverTrigger asChild>
            {/* On a phone the four actions share the row's slack, because there
                is exactly enough of it. From `sm` up they stop growing: `flex-1`
                gave each of them a quarter of the bar, and a 400px-wide "Save
                shot" reads as a banner rather than as a control. The menu keeps
                growing to `14rem` because it is the one whose label varies, and
                that is enough for the longest preset name without truncation. */}
            <Button
              variant="outline"
              size="sm"
              className="label h-8 min-w-0 flex-1 gap-2 sm:max-w-56"
              aria-label={`Machine: ${currentName}. Choose another.`}
            >
              <span className="truncate">{currentName}</span>
              <ChevronDown className="size-3 shrink-0 text-ink-3" aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[22rem] p-0">
            <div className="thin-scroll max-h-[70vh] overflow-y-auto">
              {machines.length > 0 && (
                <div>
                  <div className="label rule-b bg-raised px-3 py-2 text-ink-3">Your machines</div>
                  {machines.map((m) => (
                    <div key={m.id} className="rule-b group/row relative flex items-stretch">
                      <button
                        onClick={() => {
                          onLoadMachine(m.id)
                          setPresetOpen(false)
                        }}
                        className={cn(
                          'flex-1 border-l border-l-transparent px-3 py-2.5 text-left transition-colors hover:border-l-verdigris hover:bg-ground',
                          m.id === presetId && 'border-l-verdigris bg-verdigris/8',
                        )}
                      >
                        <div className="label text-ink">{m.name}</div>
                      </button>
                      <Tip
                        text={`Forget ${m.name}. Kept in this browser only, so there is nowhere to get it back from.`}
                      >
                        <button
                          onClick={() => onDeleteMachine(m.id)}
                          aria-label={`Delete ${m.name}`}
                          className="tap-target relative px-3 text-ink-3 transition-colors hover:bg-ground hover:text-bad focus-visible:text-bad"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      </Tip>
                    </div>
                  ))}
                </div>
              )}
              {eras.map((era) => (
                <div key={era}>
                  <div className="label rule-b bg-raised px-3 py-2 text-ink-3">
                    {ERA_LABEL[era]}
                  </div>
                  {PRESETS.filter((p) => p.era === era).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        onPreset(p.id)
                        setPresetOpen(false)
                      }}
                      className={cn(
                        /* `hover:bg-raised` was not a weak hover, it was no hover:
                         `--popover` *is* `--raised`, so the rows were already
                         sitting on the colour they hovered to. `--ground` is the
                         one neutral that differs from the popover surface in
                         both themes, and the hairline that lights up beside the
                         row is what a draughtsman would use to point at it. */
                        'rule-b block w-full border-l border-l-transparent px-3 py-2.5 text-left transition-colors hover:border-l-verdigris hover:bg-ground',
                        p.id === presetId && 'border-l-verdigris bg-verdigris/8',
                      )}
                    >
                      <div className="label pb-1 text-ink">{p.name}</div>
                      <div className="body text-ink-2">{p.blurb}</div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
            {/* Saving lives with the list it saves into rather than as a fourth
              button on a bar that already wraps on a phone. */}
            <SaveMachineRow
              onSave={(name) => {
                onSaveMachine(name)
                setPresetOpen(false)
              }}
            />
          </PopoverContent>
        </Popover>

        <Popover
          open={optimizeOpen}
          onOpenChange={(open) => {
            setOptimizeOpen(open)
            // A fresh open with no current frontier starts the search at once —
            // an empty panel with a second "go" button is a step nobody needs.
            if (open && pareto == null && !optimizing) onOptimize()
            // Closing over a hovered point would otherwise strand its trajectory
            // on the sheet with nothing left on screen to explain it.
            if (!open) onPreviewPareto(null)
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="label h-8 min-w-0 flex-1 gap-1.5 sm:flex-none"
            >
              <Wand2 className="size-3.5" aria-hidden />
              {optimizing ? 'Searching…' : 'Optimize'}
            </Button>
          </PopoverTrigger>
          {/* 26rem is wider than a small phone, so it gives ground rather than
            sitting flush against both edges with the chart's axis labels
            touching the bezel. */}
          <PopoverContent align="start" className="w-[min(26rem,calc(100vw-1.5rem))] p-0">
            <div className="rule-b flex items-center gap-2 px-3 py-2">
              <h3 className="stencil flex flex-1 items-baseline gap-2 text-ink">
                <span className="h-px w-3 shrink-0 bg-verdigris" aria-hidden />
                Optimize for
              </h3>
              <Explain title="The frontier">
                <p>
                  This is not a search for one best machine. Every gain is bought with frame: a
                  longer sling throws further and loads the axle harder, and there is no arrangement
                  that gives you the first without the second.
                </p>
                <p>
                  So the search keeps the builds where nothing else wins on <em>both</em> counts,
                  and draws them as a curve. Reading left to right along it is reading the price of
                  range in kilonewtons through your pivot. Your machine as built is on the same
                  chart, so you can see what you would be paying.
                </p>
                <p>
                  Sling length, hanger, cocked angle and short arm are varied. Masses stay yours —
                  they are usually the part already sitting in the yard.
                </p>
              </Explain>
            </div>
            <div className="px-3 py-2.5">
              <SegmentedControl
                label="Optimize for"
                variant="boxed"
                className="grid-cols-3"
                value={goal}
                onChange={onGoal}
                options={GOALS.map((g) => ({ value: g.goal, label: g.label, title: g.blurb }))}
              />
            </div>
            <p className="body rule-t rule-b px-3 py-2 text-ink-2">
              Sling, hanger, cocked angle and short arm searched. Every build is feasible and none
              beats another on both counts — more of what you asked for is only bought with a
              heavier-loaded frame. The pin comes bent to the angle each build wants.
            </p>
            {optimizing ? (
              <p className="body px-3 py-6 text-ink-2">Firing candidate machines…</p>
            ) : pareto == null || pareto.length === 0 ? (
              <p className="body px-3 py-6 text-ink-2">
                No feasible builds found near this machine. Widen it — a longer sling or a heavier
                counterweight gives the search somewhere to go.
              </p>
            ) : (
              <ParetoChart
                points={pareto}
                goal={goal}
                units={units}
                onHover={onPreviewPareto}
                onPick={(pt) => {
                  onApplyPareto(pt)
                  onPreviewPareto(null)
                  setOptimizeOpen(false)
                }}
              />
            )}
          </PopoverContent>
        </Popover>

        {/* The disabled case says nothing here on purpose: a disabled control
            takes no pointer events, so a tip explaining *why* would be the one
            tip nobody could open. The reason is already in the results rail,
            in full. */}
        <Tip text="Keeps this trajectory on the sheet as a dashed ghost, and its machine in the results rail, so the next change has something to beat.">
          <Button
            variant="outline"
            size="sm"
            className="label h-8 min-w-0 flex-1 gap-1.5 sm:flex-none"
            onClick={onSave}
            disabled={!canSave}
          >
            <BookmarkPlus className="size-3.5" aria-hidden />
            Save shot
          </Button>
        </Tip>

        <ShareButton presetId={presetId} />

        {/* Solving stays in the sheet's cell rather than moving to the settings
            one: it is a fact about the drawing, and at `xl` it now sits at the
            right edge of the column the drawing is in.

            The width is reserved rather than the text hidden: an always-present
            "Solving" is announced on every pass through the bar and never
            announced when it actually starts, which is backwards. */}
        <span
          className="label ml-auto hidden w-12 shrink-0 pl-2 text-right text-ink-3 sm:inline-block"
          aria-live="polite"
        >
          {busy ? 'Solving' : ''}
        </span>
      </div>

      <div className="hidden items-center justify-end gap-1.5 px-3 lg:flex xl:rule-l xl:w-[20rem] xl:shrink-0">
        <UnitToggle units={units} onUnits={onUnits} />
        <ThemeButton dark={dark} onDark={onDark} />
        <PanelButtons
          showDesign={showDesign}
          showResults={showResults}
          onToggleDesign={onToggleDesign}
          onToggleResults={onToggleResults}
        />
      </div>
    </header>
  )
}

/**
 * A link to the machine on the sheet.
 *
 * Only the machines in the list have one, and the control says why rather than
 * going quietly dead. The two it refuses are refused for different reasons and
 * both are worth stating: a machine you have *edited* is thirty-odd numbers that
 * are not in the address, and one you have *saved* is in this browser's storage
 * and nobody else's. Either would hand someone a link that quietly loaded a
 * different machine from the one on screen, which is worse than no link.
 *
 * There is nothing to build the link from — `App` already keeps the address bar
 * naming the loaded preset — so this copies what is effectively already there,
 * and says so when the clipboard refuses.
 */
function ShareButton({ presetId }: { presetId: string | null }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const shareable = presetId != null && PRESETS.some((p) => p.id === presetId)

  const copy = async () => {
    const href = shareUrl(presetId, window.location.href)
    if (!href) return
    try {
      await navigator.clipboard.writeText(href)
      setState('copied')
    } catch {
      setState('failed')
    }
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), 2400)
  }

  return (
    <Tip
      text={
        state === 'copied'
          ? 'Copied.'
          : 'Copies a link that opens this machine. Only the machines in the menu have one — an edited machine is thirty numbers that are not in the address, and a saved one lives in this browser and nobody else’s.'
      }
    >
      <Button
        size="icon"
        variant="outline"
        className="tap-target relative size-8 shrink-0"
        onClick={() => void copy()}
        disabled={!shareable}
        aria-label="Copy a link to this machine"
      >
        {/* The swapped glyph is the whole confirmation. A colour would have to be
          verdigris or nothing, and verdigris means measurement here. */}
        {state === 'copied' ? (
          <Check className="size-3.5" aria-hidden />
        ) : (
          <Link2 className="size-3.5" aria-hidden />
        )}
        <span className="sr-only" aria-live="polite">
          {state === 'copied'
            ? 'Link copied'
            : state === 'failed'
              ? 'Could not reach the clipboard. The link is in the address bar.'
              : ''}
        </span>
      </Button>
    </Tip>
  )
}

/**
 * Keep the machine in hand under a name.
 *
 * Saved to this browser only — the product has no backend by constraint — and
 * the hint says so rather than letting "saved" imply a sync that does not
 * exist. A machine is its numbers, so this keeps the parameters and nothing
 * else: no shot, no camera, no panel state to go stale against a later build.
 */
function SaveMachineRow({ onSave }: { onSave: (name: string) => void }) {
  const [name, setName] = useState('')
  const trimmed = name.trim()

  return (
    <div className="rule-t bg-raised px-3 py-2.5">
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !trimmed) return
            onSave(trimmed)
            setName('')
          }}
          placeholder="Name this machine"
          aria-label="Name for the machine you are saving"
          className="label min-w-0 flex-1 rounded-sm border border-rule bg-ground px-2 py-1.5 text-ink placeholder:text-ink-3 focus-visible:border-verdigris"
        />
        <Button
          variant="outline"
          size="sm"
          className="label h-8 shrink-0 gap-1.5"
          disabled={!trimmed}
          onClick={() => {
            onSave(trimmed)
            setName('')
          }}
        >
          <Save className="size-3.5" aria-hidden />
          Save
        </Button>
      </div>
      <p className="body pt-1.5 text-ink-3">Kept in this browser only.</p>
    </div>
  )
}

const UNIT_NAME: Record<UnitSystem, { chip: string; spoken: string }> = {
  metric: { chip: 'm·kg', spoken: 'metres and kilograms' },
  imperial: { chip: 'ft·lb', spoken: 'feet and pounds' },
}

/**
 * Which units the sheet is lettered in.
 *
 * A two-cell segmented control before, and it was the widest thing in the top
 * bar at 104px — for a choice of two that every reader already understands and
 * that nobody makes twice. Showing only the system you are *in*, with the swap
 * arrows that say it is a toggle, costs 56px and is what stops the identity row
 * from wrapping on a phone.
 *
 * The visible chip leads the accessible name rather than being replaced by it,
 * so "click m kg" still reaches this control by voice.
 */
function UnitToggle({ units, onUnits }: { units: UnitSystem; onUnits: (u: UnitSystem) => void }) {
  const next: UnitSystem = units === 'metric' ? 'imperial' : 'metric'
  return (
    <Tip text={`Lettered in ${UNIT_NAME[units].spoken}. Switch to ${UNIT_NAME[next].spoken}.`}>
      <Button
        variant="outline"
        size="sm"
        className="tap-target relative h-7 shrink-0 gap-1 px-1.5 lg:h-8"
        onClick={() => onUnits(next)}
        aria-label={`${UNIT_NAME[units].chip} — ${UNIT_NAME[units].spoken}. Switch to ${UNIT_NAME[next].spoken}.`}
      >
        <span className="micro font-mono text-ink">{UNIT_NAME[units].chip}</span>
        <ArrowLeftRight className="size-3 text-ink-3" aria-hidden />
      </Button>
    </Tip>
  )
}

function ThemeButton({ dark, onDark }: { dark: boolean; onDark: (v: boolean) => void }) {
  return (
    <Tip
      text={
        dark
          ? 'Chalk on charred oak. Switch to the whiteprint.'
          : 'A warm whiteprint. Switch to the dark sheet.'
      }
    >
      <Button
        size="icon"
        variant="outline"
        className="tap-target relative size-7 shrink-0 lg:size-8"
        onClick={() => onDark(!dark)}
        aria-label={dark ? 'Switch to the light sheet' : 'Switch to the dark sheet'}
      >
        {dark ? (
          <Sun className="size-3.5" aria-hidden />
        ) : (
          <Moon className="size-3.5" aria-hidden />
        )}
      </Button>
    </Tip>
  )
}

function PanelButtons({
  showDesign,
  showResults,
  onToggleDesign,
  onToggleResults,
}: {
  showDesign: boolean
  showResults: boolean
  onToggleDesign: () => void
  onToggleResults: () => void
}) {
  return (
    <>
      <Tip text="The machine’s dimensions, masses and materials. Only one rail is open at a time on a screen this size.">
        <Button
          size="icon"
          variant="outline"
          className="tap-target relative size-7 shrink-0 lg:size-8 xl:hidden"
          onClick={onToggleDesign}
          aria-pressed={showDesign}
          aria-label="Toggle the design panel"
        >
          <PanelLeft className="size-3.5" aria-hidden />
        </Button>
      </Tip>
      <Tip text="What the shot did: range, release, efficiency and the loads to size the frame for.">
        <Button
          size="icon"
          variant="outline"
          className="tap-target relative size-7 shrink-0 lg:size-8 xl:hidden"
          onClick={onToggleResults}
          aria-pressed={showResults}
          aria-label="Toggle the results panel"
        >
          <PanelRight className="size-3.5" aria-hidden />
        </Button>
      </Tip>
    </>
  )
}

/**
 * The machine in miniature, caught at the moment of release — and throwing
 * toward +x, which the old mark had backwards while the solver has a test
 * insisting on it. Drawn in the sheet's own vocabulary: hatched ground band,
 * timber beam, hairline sling, the quench shot with its dashed trajectory.
 * Hovering the lockup (`.brand`, in index.css) sets the dashes marching.
 */
function TrebuchetMark() {
  return (
    <svg viewBox="0 0 30 26" className="size-7 shrink-0" aria-hidden focusable="false">
      <g fill="none" stroke="var(--ink-3)" strokeWidth="1.2">
        <path d="M1.5 22.5 H29" />
        <path d="M6 22.5 l-2.2 2.2 M10.5 22.5 l-2.2 2.2 M15 22.5 l-2.2 2.2" />
      </g>
      <path
        d="M5 22.5 L10.5 9.5 L16 22.5"
        fill="none"
        stroke="var(--ink-2)"
        strokeWidth="1.5"
        opacity="0.75"
      />
      <path d="M9.03 13.07 V15.4" stroke="var(--ink-3)" strokeWidth="1.1" fill="none" />
      {/* Filled with the header's own ground so the frame leg reads as passing
          behind the weight rather than through it. */}
      <rect
        x="6.83"
        y="15.4"
        width="4.4"
        height="4.4"
        fill="var(--ground)"
        stroke="var(--ink-2)"
        strokeWidth="1.3"
      />
      <path
        d="M14 1 L9.03 13.07"
        stroke="var(--oak)"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <circle
        cx="10.5"
        cy="9.5"
        r="1.35"
        fill="var(--ground)"
        stroke="var(--ink-2)"
        strokeWidth="1.1"
      />
      <path d="M14 1 L18.6 3.2" stroke="var(--ink-2)" strokeWidth="1.2" fill="none" />
      <circle cx="19.1" cy="3.3" r="2.2" fill="var(--quench)" />
      <path
        className="mark-flight"
        d="M22.4 2.3 C 24.6 1.4 26.6 1 28.8 1"
        fill="none"
        stroke="var(--quench)"
        strokeWidth="1.7"
        strokeDasharray="2.8 2.3"
        opacity="0.9"
      />
    </svg>
  )
}
