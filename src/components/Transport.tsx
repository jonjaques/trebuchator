import {
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
} from 'lucide-react'
import { Button } from '@/components/ui/button.tsx'
import { DraftSlider } from './DraftSlider.tsx'
import { SpeedControl } from './SpeedControl.tsx'
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
    <button
      onClick={() => next != null && onSpeed(next)}
      disabled={next == null}
      aria-label={dir < 0 ? 'Slower playback' : 'Faster playback'}
      title={dir < 0 ? 'Slower' : 'Faster'}
      className="tap-target relative flex size-7 shrink-0 items-center justify-center rounded-sm border border-rule text-ink-3 transition-colors hover:border-ink-3 hover:text-ink-2 disabled:opacity-40 disabled:hover:border-rule disabled:hover:text-ink-3"
    >
      {dir < 0 ? <Minus className="size-3" aria-hidden /> : <Plus className="size-3" aria-hidden />}
    </button>
  )
}

function IconToggle({
  on,
  onClick,
  label,
  children,
}: {
  on: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      title={label}
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
  )
}

/**
 * Transport and view controls.
 *
 * Two rows below `sm`, one above it. On a phone-width single row the scrubber
 * collapsed to nothing, the clock overlapped the phase label, and every toggle
 * sat well under the minimum touch target.
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

  return (
    <div className="rule-t flex flex-col bg-ground sm:h-12 sm:flex-row sm:items-center sm:gap-3 sm:px-3">
      {/* Row 1 — the shot itself */}
      <div className="flex h-12 min-w-0 items-center gap-3 px-3 sm:h-auto sm:flex-1 sm:px-0">
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon"
            variant="outline"
            className="tap-target relative size-8"
            disabled={disabled}
            onClick={onReplay}
            aria-label="Fire again from the start (R)"
            title="Fire again (R)"
          >
            <RotateCcw className="size-3.5" aria-hidden />
          </Button>
          <Button
            size="icon"
            className="tap-target relative size-8"
            disabled={disabled}
            onClick={playing ? onPause : onPlay}
            aria-label={playing ? 'Pause (Space)' : 'Play the shot (Space)'}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
          >
            {playing ? (
              <Pause className="size-3.5" aria-hidden />
            ) : (
              <Play className="size-3.5" aria-hidden />
            )}
          </Button>
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
      <div className="rule-t thin-scroll flex h-11 items-center gap-1.5 overflow-x-auto px-3 sm:h-auto sm:border-t-0 sm:px-0">
        {/* One tap slower or faster without opening the picker; the popover
            remains the way to a specific or custom speed. */}
        <SpeedStep dir={-1} speed={speed} onSpeed={onSpeed} />
        <SpeedControl speed={speed} onSpeed={onSpeed} />
        <SpeedStep dir={1} speed={speed} onSpeed={onSpeed} />

        <span className="mx-0.5 h-5 w-px shrink-0 bg-rule" aria-hidden />

        <IconToggle
          on={cameraMode === 'auto'}
          onClick={() => onCameraMode('auto')}
          label="Follow the shot"
        >
          <Crosshair className="size-3.5" aria-hidden />
        </IconToggle>
        <IconToggle
          on={cameraMode === 'machine'}
          onClick={() => onCameraMode('machine')}
          label="Frame the machine"
        >
          <Frame className="size-3.5" aria-hidden />
        </IconToggle>
        <IconToggle
          on={cameraMode === 'field'}
          onClick={() => onCameraMode('field')}
          label="Frame the whole field"
        >
          <Maximize2 className="size-3.5" aria-hidden />
        </IconToggle>

        <span className="mx-0.5 h-5 w-px shrink-0 bg-rule" aria-hidden />

        <IconToggle
          on={showDimensions}
          onClick={() => onShowDimensions(!showDimensions)}
          label="Show dimensions (D)"
        >
          <Ruler className="size-3.5" aria-hidden />
        </IconToggle>
        <IconToggle on={showAngles} onClick={() => onShowAngles(!showAngles)} label="Show angles (A)">
          <DraftingCompass className="size-3.5" aria-hidden />
        </IconToggle>
        <IconToggle on={showGrid} onClick={() => onShowGrid(!showGrid)} label="Show grid (G)">
          <Grid3x3 className="size-3.5" aria-hidden />
        </IconToggle>

        <span className="mx-0.5 h-5 w-px shrink-0 bg-rule" aria-hidden />

        {/* The rails' annotations, one divider along from the sheet's. It is the
            same kind of control — a layer of explanation you switch on when you
            want it — and this row is already where the app keeps those. The top
            bar is not: it was full, and had been silently clipping its last
            control since before this one existed. */}
        <IconToggle
          on={notes}
          onClick={() => onNotes(!notes)}
          label="Show the notes beside each reading (N)"
        >
          <Info className="size-3.5" aria-hidden />
        </IconToggle>
      </div>
    </div>
  )
}
