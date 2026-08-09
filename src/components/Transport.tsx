import {
  Crosshair,
  DraftingCompass,
  Frame,
  Grid3x3,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Ruler,
} from 'lucide-react'
import { Button } from '@/components/ui/button.tsx'
import { DraftSlider } from './DraftSlider.tsx'
import { SpeedControl } from './SpeedControl.tsx'
import { cn } from '@/lib/utils.ts'
import { num } from '@/lib/format.ts'
import type { CameraMode } from './stage/Stage.tsx'

interface Props {
  t: number
  duration: number
  releaseT: number
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
  disabled: boolean
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
        'flex size-7 shrink-0 items-center justify-center rounded-sm border transition-colors',
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
  duration,
  releaseT,
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
  disabled,
}: Props) {
  const phase = t < releaseT ? 'Stroke' : 'Flight'

  return (
    <div className="rule-t flex flex-col bg-ground sm:h-12 sm:flex-row sm:items-center sm:gap-3 sm:px-3">
      {/* Row 1 — the shot itself */}
      <div className="flex h-12 min-w-0 items-center gap-3 px-3 sm:h-auto sm:flex-1 sm:px-0">
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon"
            variant="outline"
            className="size-8"
            disabled={disabled}
            onClick={onReplay}
            aria-label="Fire again from the start"
            title="Fire again"
          >
            <RotateCcw className="size-3.5" aria-hidden />
          </Button>
          <Button
            size="icon"
            className="size-8"
            disabled={disabled}
            onClick={playing ? onPause : onPlay}
            aria-label={playing ? 'Pause' : 'Play the shot'}
            title={playing ? 'Pause' : 'Play'}
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
          valueText={`${num(t, 3)} seconds, ${t < releaseT ? 'stroke' : 'flight'}`}
          value={[Math.min(t, duration)]}
          min={0}
          max={Math.max(duration, 0.001)}
          step={duration / 600}
          disabled={disabled}
          onValueChange={([v]) => onSeek(v)}
        />

        <div className="tnum shrink-0 font-mono text-[11px] text-ink-2">
          {num(t, 2)}
          <span className="text-ink-3">/{num(duration, 2)}s</span>
        </div>
        <span
          className={cn('label w-11 shrink-0 text-right', t < releaseT ? 'text-ink-3' : 'text-quench')}
        >
          {phase}
        </span>
      </div>

      {/* Row 2 — how you are looking at it */}
      <div className="rule-t thin-scroll flex h-11 items-center gap-1.5 overflow-x-auto px-3 sm:h-auto sm:border-t-0 sm:px-0">
        <SpeedControl speed={speed} onSpeed={onSpeed} />

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
          label="Show dimensions"
        >
          <Ruler className="size-3.5" aria-hidden />
        </IconToggle>
        <IconToggle on={showAngles} onClick={() => onShowAngles(!showAngles)} label="Show angles">
          <DraftingCompass className="size-3.5" aria-hidden />
        </IconToggle>
        <IconToggle on={showGrid} onClick={() => onShowGrid(!showGrid)} label="Show grid">
          <Grid3x3 className="size-3.5" aria-hidden />
        </IconToggle>
      </div>
    </div>
  )
}
