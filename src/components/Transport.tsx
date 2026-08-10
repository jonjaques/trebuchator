import { useCallback, useState, useSyncExternalStore } from 'react'
import {
  ChevronDown,
  Crosshair,
  DraftingCompass,
  Frame,
  Grid3x3,
  Info,
  Maximize2,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Ruler,
  SlidersHorizontal,
} from 'lucide-react'
import { Button } from '@/components/ui/button.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx'
import { DraftSlider } from './DraftSlider.tsx'
import { SpeedControl } from './SpeedControl.tsx'
import { Tip } from './Tip.tsx'
import { SPEED_STOPS } from '@/lib/speeds.ts'
import { cn } from '@/lib/utils.ts'
import { num } from '@/lib/format.ts'
import type { CameraMode } from './stage/Stage.tsx'
import { isFlying, type ShotTimeline } from '@/lib/treb/timeline.ts'

interface Props {
  t: number
  /** Null while the machine will not throw; the transport is disabled then. */
  timeline: ShotTimeline | null
  playing: boolean
  speed: number
  onSeek: (t: number) => void
  onPlay: () => void
  onPause: () => void
  onReplay: () => void
  onSpeed: (s: number) => void
  cameraMode: CameraMode
  onCameraMode: (m: CameraMode) => void
  showDimensions: boolean
  onShowDimensions: (v: boolean) => void
  showAngles: boolean
  onShowAngles: (v: boolean) => void
  showGrid: boolean
  onShowGrid: (v: boolean) => void
  notes: boolean
  onNotes: (v: boolean) => void
  disabled: boolean
}

/** Step to the neighbouring speed stop. A custom speed steps to the nearest. */
function SpeedStep({
  dir,
  speed,
  onSpeed,
}: {
  dir: -1 | 1
  speed: number
  onSpeed: (s: number) => void
}) {
  const next =
    dir < 0
      ? [...SPEED_STOPS].reverse().find((s) => s < speed - 1e-9)
      : SPEED_STOPS.find((s) => s > speed + 1e-9)
  return (
    <Tip text={dir < 0 ? 'Slower playback' : 'Faster playback'}>
      <button
        onClick={() => next != null && onSpeed(next)}
        disabled={next == null}
        aria-label={dir < 0 ? 'Slower playback' : 'Faster playback'}
        className="tap-target relative flex size-7 shrink-0 items-center justify-center rounded-sm border border-rule text-ink-3 transition-colors hover:border-ink-3 hover:text-ink-2 disabled:opacity-40 disabled:hover:border-rule disabled:hover:text-ink-3"
      >
        {dir < 0 ? (
          <Minus className="size-3" aria-hidden />
        ) : (
          <Plus className="size-3" aria-hidden />
        )}
      </button>
    </Tip>
  )
}

function IconToggle({
  on,
  onClick,
  label,
  tip,
  children,
}: {
  on: boolean
  onClick: () => void
  label: string
  /** The sentence the glyph cannot carry. Falls back to the label. */
  tip?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Tip text={tip ?? label}>
      <button
        onClick={onClick}
        aria-pressed={on}
        aria-label={label}
        className={cn(
          'tap-target relative flex size-7 shrink-0 items-center justify-center rounded-sm border transition-colors',
          on
            ? 'border-verdigris bg-verdigris/10 text-verdigris'
            : 'border-rule text-ink-3 hover:border-ink-3 hover:text-ink-2',
        )}
      >
        {children}
      </button>
    </Tip>
  )
}

/** A view control given room to say what it does, for the folded panel. */
function ViewRow({
  on,
  onClick,
  name,
  note,
  shortcut,
  children,
}: {
  on: boolean
  onClick: () => void
  name: string
  note: string
  shortcut?: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'flex w-full items-start gap-2.5 border-l px-3 py-2 text-left transition-colors',
        on
          ? 'border-l-verdigris bg-verdigris/8 text-verdigris'
          : 'border-l-transparent text-ink-3 hover:bg-ground hover:text-ink-2',
      )}
    >
      <span className="mt-px shrink-0">{children}</span>
      <span className="min-w-0 flex-1">
        <span className="label flex items-baseline gap-1.5 text-ink">
          {name}
          {shortcut && <kbd className="micro font-mono text-ink-3">{shortcut}</kbd>}
        </span>
        <span className="body block pt-0.5 text-ink-2">{note}</span>
      </span>
    </button>
  )
}

const CAMERAS: { mode: CameraMode; name: string; note: string; icon: React.ReactNode }[] = [
  {
    mode: 'auto',
    name: 'Follow the shot',
    note: 'The view rides the projectile downrange and opens out before it lands.',
    icon: <Crosshair className="size-3.5" aria-hidden />,
  },
  {
    mode: 'machine',
    name: 'Frame the machine',
    note: 'Held on the trebuchet itself, whatever the shot is doing.',
    icon: <Frame className="size-3.5" aria-hidden />,
  },
  {
    mode: 'field',
    name: 'Frame the whole field',
    note: 'Machine and impact point together, at whatever scale that takes.',
    icon: <Maximize2 className="size-3.5" aria-hidden />,
  },
]

/**
 * The width the camera and annotation toggles need, and the width that is left
 * for them.
 *
 * These are rendered pixel widths of real controls rather than guesses: seven
 * 28px chips, six 6px gaps and three ruled dividers, against the three speed
 * controls that never fold.
 *
 * `SCRUBBER_MIN` is not the width at which the scrubber row *breaks* — it is the
 * width at which it is still worth having. Its fixed furniture (two buttons, the
 * clock, the phase label, the gaps) is 220px, so a 264px budget leaves a 42px
 * track, and a 42px track is not something anyone can scrub a 4-second flight
 * on. At 320 the track keeps about 100px and the toggles fold a little earlier
 * instead.
 *
 * How much room there *is* has to be measured, because this bar is the sheet's
 * width and not the window's — a docked rail at `xl` takes 21rem out of it, and
 * a viewport breakpoint gets that case wrong in both directions.
 */
const SCRUBBER_MIN = 320
const TOGGLES_W = 268
const SPEED_W = 122
const BAR_PAD = 24

/**
 * Whether the scrubber is sharing this row — the `sm:` in the class list below,
 * asked in JavaScript.
 *
 * This one *is* a viewport question and must be answered as one. It was
 * originally inferred from the measured width, which was wrong at exactly the
 * width it mattered: the observer reports the content box, so a 640px viewport
 * measures 616 and read as "still two rows" — and the toggles stayed inline on
 * the one layout where the scrubber was already colliding with them.
 *
 * `useSyncExternalStore` rather than an effect, because
 * `react-hooks/set-state-in-effect` is enforced here and a media query is an
 * external store by definition. Both callbacks are module-level so the
 * subscription is not torn down and rebuilt on every render.
 */
const SPLIT_QUERY = '(min-width: 640px)'
const subscribeSplit = (onChange: () => void) => {
  const mq = window.matchMedia(SPLIT_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
const readSplit = () => window.matchMedia(SPLIT_QUERY).matches

/**
 * Transport and view controls.
 *
 * Two rows below `sm`, one above it. On a phone-width single row the scrubber
 * collapsed to nothing, the clock overlapped the phase label, and every toggle
 * sat well under the minimum touch target.
 *
 * The view controls fold into a popover when the bar cannot hold them. They used
 * to sit in an `overflow-x-auto` strip instead, which meant a second scrollbar
 * inside a shell that deliberately cannot scroll — and on an iPhone the last
 * control was over the edge of it, invisible and with nothing to say so.
 */
export function Transport({
  t,
  timeline,
  playing,
  speed,
  onSeek,
  onPlay,
  onPause,
  onReplay,
  onSpeed,
  cameraMode,
  onCameraMode,
  showDimensions,
  onShowDimensions,
  showAngles,
  onShowAngles,
  showGrid,
  onShowGrid,
  notes,
  onNotes,
  disabled,
}: Props) {
  const duration = timeline?.duration ?? 0
  const flying = timeline != null && isFlying(timeline, t)

  // A callback ref rather than a mount-only effect: this element is always the
  // same one, but the pattern is the one `SweepChart` settled on and the
  // cleanup is free.
  const [barWidth, setBarWidth] = useState(0)
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setBarWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const oneRow = useSyncExternalStore(subscribeSplit, readSplit)

  // Below `sm` each row carries its own 12px padding inside this box; at `sm`
  // and above the padding is on the box, which the observer has already taken
  // off — and only then does the scrubber share the row.
  const room = oneRow ? barWidth - SPEED_W - SCRUBBER_MIN - 12 : barWidth - BAR_PAD - SPEED_W
  // Zero width is the first paint, before the observer has reported. Laying the
  // controls out inline there and folding them a frame later is a visible jump;
  // folded-until-measured is not, because the popover button is narrower than
  // anything it could displace.
  const fold = barWidth === 0 || room < TOGGLES_W

  return (
    <div
      ref={measure}
      className="rule-t flex flex-col bg-ground sm:h-12 sm:flex-row sm:items-center sm:gap-3 sm:px-3"
    >
      {/* Row 1 — the shot itself */}
      <div className="flex h-12 min-w-0 items-center gap-3 px-3 sm:h-auto sm:flex-1 sm:px-0">
        <div className="flex shrink-0 items-center gap-1">
          <Tip text="Fire again from the cocked pose">
            <Button
              size="icon"
              variant="outline"
              className="tap-target relative size-8"
              disabled={disabled}
              onClick={onReplay}
              aria-label="Fire again from the start (R)"
            >
              <RotateCcw className="size-3.5" aria-hidden />
            </Button>
          </Tip>
          <Tip text={playing ? 'Pause' : 'Play the shot'}>
            <Button
              size="icon"
              className="tap-target relative size-8"
              disabled={disabled}
              onClick={playing ? onPause : onPlay}
              aria-label={playing ? 'Pause (Space)' : 'Play the shot (Space)'}
            >
              {playing ? (
                <Pause className="size-3.5" aria-hidden />
              ) : (
                <Play className="size-3.5" aria-hidden />
              )}
            </Button>
          </Tip>
        </div>

        <DraftSlider
          className="min-w-12 flex-1"
          label="Shot timeline"
          valueText={`${num(t, 3)} seconds, ${flying ? 'flight' : 'stroke'}`}
          value={[Math.min(t, duration)]}
          min={0}
          max={Math.max(duration, 0.001)}
          step={Math.max(duration, 0.001) / 600}
          disabled={disabled}
          onValueChange={([v]) => onSeek(v)}
        />

        <div className="tnum shrink-0 font-mono text-[11px] text-ink-2">
          {num(t, 2)}
          <span className="text-ink-3">/{num(duration, 2)}s</span>
        </div>
        <span
          className={cn('label w-11 shrink-0 text-right', flying ? 'text-quench' : 'text-ink-3')}
        >
          {flying ? 'Flight' : 'Stroke'}
        </span>
      </div>

      {/* Row 2 — how you are looking at it */}
      <div className="rule-t flex h-11 items-center gap-1.5 px-3 sm:h-auto sm:border-t-0 sm:px-0">
        {/* One tap slower or faster without opening the picker; the popover
            remains the way to a specific or custom speed. */}
        <SpeedStep dir={-1} speed={speed} onSpeed={onSpeed} />
        <SpeedControl speed={speed} onSpeed={onSpeed} />
        <SpeedStep dir={1} speed={speed} onSpeed={onSpeed} />

        <span className="mx-0.5 h-5 w-px shrink-0 bg-rule" aria-hidden />

        {fold ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="tap-target label relative h-7 shrink-0 gap-1.5"
              >
                <SlidersHorizontal className="size-3.5" aria-hidden />
                View
                <ChevronDown className="size-3 text-ink-3" aria-hidden />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              side="top"
              collisionPadding={12}
              /* Seven explained rows is taller than a landscape phone. The
                 panel scrolls inside itself rather than being pushed off the
                 top by the collision handler. */
              className="thin-scroll max-h-[min(34rem,72svh)] w-[min(20rem,calc(100vw-1.5rem))] gap-0 overflow-y-auto p-0"
            >
              <h3 className="stencil rule-b flex items-baseline gap-2 px-3 py-2 text-ink">
                <span className="h-px w-3 shrink-0 bg-verdigris" aria-hidden />
                Camera
              </h3>
              {CAMERAS.map((c) => (
                <ViewRow
                  key={c.mode}
                  on={cameraMode === c.mode}
                  onClick={() => onCameraMode(c.mode)}
                  name={c.name}
                  note={c.note}
                >
                  {c.icon}
                </ViewRow>
              ))}
              <h3 className="stencil rule-t rule-b flex items-baseline gap-2 px-3 py-2 text-ink">
                <span className="h-px w-3 shrink-0 bg-verdigris" aria-hidden />
                Annotations
              </h3>
              <ViewRow
                on={showDimensions}
                onClick={() => onShowDimensions(!showDimensions)}
                name="Dimensions"
                shortcut="D"
                note="The machine's own measurements, lettered onto the sheet. Rewinds to the cocked pose, where they are legible."
              >
                <Ruler className="size-3.5" aria-hidden />
              </ViewRow>
              <ViewRow
                on={showAngles}
                onClick={() => onShowAngles(!showAngles)}
                name="Angles"
                shortcut="A"
                note="Protractors on the pivot and the beam tip. The dashed radial is the pin angle you have bent."
              >
                <DraftingCompass className="size-3.5" aria-hidden />
              </ViewRow>
              <ViewRow
                on={showGrid}
                onClick={() => onShowGrid(!showGrid)}
                name="Grid"
                shortcut="G"
                note="A scale grid behind the drawing, stepped to a round number of metres or feet."
              >
                <Grid3x3 className="size-3.5" aria-hidden />
              </ViewRow>
              <ViewRow
                on={notes}
                onClick={() => onNotes(!notes)}
                name="Notes"
                shortcut="N"
                note="Prints the explanation under every field and reading in the rails."
              >
                <Info className="size-3.5" aria-hidden />
              </ViewRow>
            </PopoverContent>
          </Popover>
        ) : (
          <>
            {CAMERAS.map((c) => (
              <IconToggle
                key={c.mode}
                on={cameraMode === c.mode}
                onClick={() => onCameraMode(c.mode)}
                label={c.name}
                tip={c.note}
              >
                {c.icon}
              </IconToggle>
            ))}

            <span className="mx-0.5 h-5 w-px shrink-0 bg-rule" aria-hidden />

            <IconToggle
              on={showDimensions}
              onClick={() => onShowDimensions(!showDimensions)}
              label="Show dimensions (D)"
              tip="The machine's own measurements, drafted onto the sheet. Rewinds to the cocked pose, where they are legible."
            >
              <Ruler className="size-3.5" aria-hidden />
            </IconToggle>
            <IconToggle
              on={showAngles}
              onClick={() => onShowAngles(!showAngles)}
              label="Show angles (A)"
              tip="Protractors on the pivot and beam tip. The dashed radial is the pin you have bent — watch the sling close on it."
            >
              <DraftingCompass className="size-3.5" aria-hidden />
            </IconToggle>
            <IconToggle
              on={showGrid}
              onClick={() => onShowGrid(!showGrid)}
              label="Show grid (G)"
              tip="A scale grid behind the drawing, stepped to a round number of metres or feet."
            >
              <Grid3x3 className="size-3.5" aria-hidden />
            </IconToggle>

            <span className="mx-0.5 h-5 w-px shrink-0 bg-rule" aria-hidden />

            {/* The rails' annotations, one divider along from the sheet's. It is
                the same kind of control — a layer of explanation you switch on
                when you want it — and this row is already where the app keeps
                those. The top bar is not: it was full, and had been silently
                clipping its last control since before this one existed. */}
            <IconToggle
              on={notes}
              onClick={() => onNotes(!notes)}
              label="Show the notes beside each reading (N)"
              tip="Prints the explanation under every field and reading in the rails."
            >
              <Info className="size-3.5" aria-hidden />
            </IconToggle>
          </>
        )}
      </div>
    </div>
  )
}
