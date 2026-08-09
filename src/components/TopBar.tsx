import { useEffect, useRef, useState } from 'react'
import { BookmarkPlus, Check, ChevronDown, Link2, Moon, PanelLeft, PanelRight, Save, Sun, Trash2, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx'
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
       single row does not actually fit until about 900px: between the two it
       overflowed a shell that deliberately cannot scroll, so the last control
       was silently clipped off the edge rather than wrapping. */
    <header className="rule-b flex shrink-0 flex-col bg-ground lg:h-12 lg:flex-row lg:items-center lg:gap-2 lg:px-3">
      {/* Wraps rather than clips. Below about 380px the wordmark and the four
          settings controls genuinely do not fit on one line, and the shell
          cannot scroll — so without this the last control was simply gone off
          the edge. Wrapping costs a row only on the phones that need one, which
          is cheaper than a fourth breakpoint and a shrunken wordmark. */}
      <div className="flex min-h-12 flex-wrap items-center gap-2 px-3 py-1.5 lg:min-h-0 lg:flex-nowrap lg:py-0 lg:px-0">
        <TrebuchetMark />
        <div className="leading-none">
          <h1 className="wordmark text-ink">Trebuchator</h1>
          <p className="label hidden whitespace-nowrap pt-1 text-ink-3 sm:block">
            Counterweight siege engine calculator
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 lg:hidden">
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

      {/* The action buttons share the row's slack equally instead of huddling
          at the left with a dead gap before the settings cluster. */}
      <div className="rule-t flex h-12 flex-1 items-center gap-2 px-3 lg:h-auto lg:border-t-0 lg:px-0">
        <span className="mx-1 hidden h-6 w-px bg-rule lg:block" aria-hidden />

      {/* Controlled so picking closes it. Uncontrolled, the menu stayed open
          over the sheet after a choice, hiding the machine it had just changed
          — the one thing the reader wanted to look at. */}
      <Popover open={presetOpen} onOpenChange={setPresetOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="label h-8 min-w-0 flex-1 gap-2">
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
                    <button
                      onClick={() => onDeleteMachine(m.id)}
                      aria-label={`Delete ${m.name}`}
                      title={`Delete ${m.name}`}
                      className="tap-target relative px-3 text-ink-3 transition-colors hover:bg-ground hover:text-bad focus-visible:text-bad"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
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
            className="label h-8 min-w-0 flex-1 gap-1.5"
            title="Search feasible builds for the frontier of range against frame load"
          >
            <Wand2 className="size-3.5" aria-hidden />
            {optimizing ? 'Searching…' : 'Optimize'}
          </Button>
        </PopoverTrigger>
        {/* 26rem is wider than a small phone, so it gives ground rather than
            sitting flush against both edges with the chart's axis labels
            touching the bezel. */}
        <PopoverContent align="start" className="w-[min(26rem,calc(100vw-1.5rem))] p-0">
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
            Sling, hanger, cocked angle and short arm searched. Every build is feasible
            and none beats another on both counts — more of what you asked for is only
            bought with a heavier-loaded frame. The pin comes bent to the angle each
            build wants.
          </p>
          {optimizing ? (
            <p className="body px-3 py-6 text-ink-2">Firing candidate machines…</p>
          ) : pareto == null || pareto.length === 0 ? (
            <p className="body px-3 py-6 text-ink-2">
              No feasible builds found near this machine. Widen it — a longer sling or a
              heavier counterweight gives the search somewhere to go.
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

      <Button
        variant="outline"
        size="sm"
        className="label h-8 min-w-0 flex-1 gap-1.5"
        onClick={onSave}
        disabled={!canSave}
        title="Keep this shot on the sheet as a dashed ghost to compare against"
      >
        <BookmarkPlus className="size-3.5" aria-hidden />
        Save shot
      </Button>

      <ShareButton presetId={presetId} />

        <div className="ml-auto flex items-center gap-1.5">
          {/* The width is reserved rather than the text hidden: an always-present
              "Solving" is announced on every pass through the bar and never
              announced when it actually starts, which is backwards. */}
          <span className="label hidden w-12 pr-1 text-right text-ink-3 sm:inline-block" aria-live="polite">
            {busy ? 'Solving' : ''}
          </span>

          <div className="hidden items-center gap-1.5 lg:flex">
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
    <Button
      size="icon"
      variant="outline"
      className="tap-target relative size-8 shrink-0"
      onClick={() => void copy()}
      disabled={!shareable}
      aria-label="Copy a link to this machine"
      title={
        shareable
          ? 'Copy a link to this machine'
          : 'Only the machines in the list have a link. This one is yours, and it is kept in this browser.'
      }
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

function UnitToggle({
  units,
  onUnits,
}: {
  units: UnitSystem
  onUnits: (u: UnitSystem) => void
}) {
  return (
    <SegmentedControl
      label="Units"
      value={units}
      onChange={onUnits}
      options={[
        { value: 'metric', label: 'm · kg' },
        { value: 'imperial', label: 'ft · lb' },
      ]}
    />
  )
}


function ThemeButton({ dark, onDark }: { dark: boolean; onDark: (v: boolean) => void }) {
  return (
    <Button
      size="icon"
      variant="outline"
      className="tap-target relative size-8 shrink-0"
      onClick={() => onDark(!dark)}
      aria-label={dark ? 'Switch to the light sheet' : 'Switch to the dark sheet'}
      title={dark ? 'Light sheet' : 'Dark sheet'}
    >
      {dark ? <Sun className="size-3.5" aria-hidden /> : <Moon className="size-3.5" aria-hidden />}
    </Button>
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
      <Button
        size="icon"
        variant="outline"
        className="tap-target relative size-8 shrink-0 xl:hidden"
        onClick={onToggleDesign}
        aria-pressed={showDesign}
        aria-label="Toggle the design panel"
      >
        <PanelLeft className="size-3.5" aria-hidden />
      </Button>
      <Button
        size="icon"
        variant="outline"
        className="tap-target relative size-8 shrink-0 xl:hidden"
        onClick={onToggleResults}
        aria-pressed={showResults}
        aria-label="Toggle the results panel"
      >
        <PanelRight className="size-3.5" aria-hidden />
      </Button>
    </>
  )
}

/** The machine in miniature: frame, beam, weight, sling. */
function TrebuchetMark() {
  return (
    <svg viewBox="0 0 28 24" className="size-6 shrink-0" aria-hidden focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.4" className="text-ink-3">
        <path d="M4 21 L13 8 L22 21" />
        <path d="M2 21 H26" />
      </g>
      <path d="M6 4 L21 15" stroke="var(--oak)" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <rect x="18.5" y="16" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-ink-2" />
      <path d="M6 4 L3 11" stroke="var(--ink-3)" strokeWidth="1" fill="none" />
      <circle cx="3" cy="11" r="2" fill="var(--quench)" />
    </svg>
  )
}
