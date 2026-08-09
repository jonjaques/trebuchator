import { BookmarkPlus, Moon, PanelLeft, PanelRight, Sun, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx'
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
    <header className="rule-b flex h-12 shrink-0 items-center gap-2 bg-ground px-3">
      <div className="flex items-center gap-2.5">
        <TrebuchetMark />
        <div className="leading-none">
          <h1
            className="font-[600] text-ink"
            style={{
              fontFamily: "'IBM Plex Sans Condensed', sans-serif",
              letterSpacing: '0.2em',
              fontSize: '0.9rem',
            }}
          >
            TREBUCHATOR
          </h1>
          <p className="stencil-sm hidden pt-1 text-ink-3 md:block">
            Counterweight siege engine calculator
          </p>
        </div>
      </div>

      <span className="mx-1 hidden h-6 w-px bg-rule sm:block" aria-hidden />

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="stencil-sm h-8 max-w-[15rem] gap-2">
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
                <div className="stencil-sm rule-b bg-raised px-3 py-2 text-ink-3">
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
                    <div className="stencil pb-1 text-ink">{p.name}</div>
                    <div className="text-[11px] leading-snug text-ink-3">{p.blurb}</div>
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
        className="stencil-sm hidden h-8 gap-1.5 lg:inline-flex"
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
        className="stencil-sm hidden h-8 gap-1.5 md:inline-flex"
        onClick={onSave}
        title="Keep this shot on the sheet as a dashed ghost to compare against"
      >
        <BookmarkPlus className="size-3.5" aria-hidden />
        Save shot
      </Button>

      <div className="ml-auto flex items-center gap-1.5">
        <span
          className={cn(
            'stencil-sm pr-1 text-ink-3 transition-opacity',
            busy ? 'opacity-100' : 'opacity-0',
          )}
          aria-live="polite"
        >
          Solving
        </span>

        <div role="radiogroup" aria-label="Units" className="flex overflow-hidden rounded-sm border border-rule">
          {(['metric', 'imperial'] as const).map((u) => (
            <button
              key={u}
              role="radio"
              aria-checked={units === u}
              onClick={() => onUnits(u)}
              className={cn(
                'stencil-sm px-2 py-1.5 transition-colors',
                units === u ? 'bg-verdigris/12 text-verdigris' : 'text-ink-3 hover:text-ink-2',
              )}
            >
              {u === 'metric' ? 'm · kg' : 'ft · lb'}
            </button>
          ))}
        </div>

        <Button
          size="icon"
          variant="outline"
          className="size-8"
          onClick={() => onDark(!dark)}
          aria-label={dark ? 'Switch to the light sheet' : 'Switch to the dark sheet'}
          title={dark ? 'Light sheet' : 'Dark sheet'}
        >
          {dark ? <Sun className="size-3.5" aria-hidden /> : <Moon className="size-3.5" aria-hidden />}
        </Button>

        <Button
          size="icon"
          variant="outline"
          className="size-8 xl:hidden"
          onClick={onToggleDesign}
          aria-pressed={showDesign}
          aria-label="Toggle the design panel"
        >
          <PanelLeft className="size-3.5" aria-hidden />
        </Button>
        <Button
          size="icon"
          variant="outline"
          className="size-8 xl:hidden"
          onClick={onToggleResults}
          aria-pressed={showResults}
          aria-label="Toggle the results panel"
        >
          <PanelRight className="size-3.5" aria-hidden />
        </Button>
      </div>
    </header>
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
