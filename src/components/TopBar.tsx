import { BookmarkPlus, Moon, PanelLeft, PanelRight, Sun, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx'
import { SegmentedControl } from './SegmentedControl.tsx'
import { PRESETS } from '@/lib/treb/presets.ts'
import type { UnitSystem } from '@/lib/format.ts'
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
  onAutoTune: () => void
  tuning: boolean
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
  onAutoTune,
  tuning,
  busy,
  showDesign,
  showResults,
  onToggleDesign,
  onToggleResults,
}: Props) {
  const current = PRESETS.find((p) => p.id === presetId)
  const eras = ['modern', 'historical', 'reference'] as const

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

      <div className="rule-t flex h-12 items-center gap-2 px-3 lg:h-auto lg:border-t-0 lg:px-0">
        <span className="mx-1 hidden h-6 w-px bg-rule lg:block" aria-hidden />

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="label h-8 min-w-0 max-w-[13rem] shrink gap-2">
            <span className="truncate">{current?.name ?? 'Custom machine'}</span>
            <span aria-hidden className="text-ink-3">
              ▾
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[22rem] p-0">
          <div className="thin-scroll max-h-[70vh] overflow-y-auto">
            {eras.map((era) => (
              <div key={era}>
                <div className="label rule-b bg-raised px-3 py-2 text-ink-3">
                  {ERA_LABEL[era]}
                </div>
                {PRESETS.filter((p) => p.era === era).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => onPreset(p.id)}
                    className={cn(
                      'rule-b block w-full px-3 py-2.5 text-left transition-colors hover:bg-raised',
                      p.id === presetId && 'bg-verdigris/8',
                    )}
                  >
                    <div className="label pb-1 text-ink">{p.name}</div>
                    <div className="body text-ink-2">{p.blurb}</div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <Button
        variant="outline"
        size="sm"
        className="label h-8 shrink-0 gap-1.5"
        onClick={onAutoTune}
        disabled={tuning}
        title="Search sling length, hanger, cocked angle and pin angle for the longest shot this machine can make"
      >
        <Wand2 className="size-3.5" aria-hidden />
        {tuning ? 'Tuning…' : 'Auto-tune'}
      </Button>

      <Button
        variant="outline"
        size="sm"
        className="label h-8 shrink-0 gap-1.5"
        onClick={onSave}
        disabled={!canSave}
        title="Keep this shot on the sheet as a dashed ghost to compare against"
      >
        <BookmarkPlus className="size-3.5" aria-hidden />
        Save shot
      </Button>

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
