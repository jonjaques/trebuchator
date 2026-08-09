import { Crosshair, Frame, Grid3x3, Maximize2, Pause, Play, RotateCcw, Ruler } from 'lucide-react'
import { Button } from '@/components/ui/button.tsx'
import { DraftSlider } from './DraftSlider.tsx'
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
  showGrid: boolean
  onShowGrid: (v: boolean) => void
  disabled: boolean
}

const SPEEDS = [0.05, 0.15, 0.5, 1]

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
        'flex size-7 items-center justify-center rounded-sm border transition-colors',
        on
          ? 'border-verdigris bg-verdigris/10 text-verdigris'
          : 'border-rule text-ink-3 hover:border-ink-3 hover:text-ink-2',
      )}
    >
      {children}
    </button>
  )
}

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
  showGrid,
  onShowGrid,
  disabled,
}: Props) {
  const phase = t < releaseT ? 'Stroke' : 'Flight'
  return (
    <div className="rule-t flex h-12 items-center gap-3 bg-ground px-3">
      <div className="flex items-center gap-1">
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
          {playing ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
        </Button>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-3">
        <DraftSlider
          className="min-w-16 flex-1"
          label="Shot timeline"
          valueText={`${num(t, 3)} seconds, ${t < releaseT ? 'stroke' : 'flight'}`}
          value={[Math.min(t, duration)]}
          min={0}
          max={Math.max(duration, 0.001)}
          step={duration / 600}
          disabled={disabled}
          onValueChange={([v]) => onSeek(v)}
        />
        <div className="tnum w-28 shrink-0 font-mono text-[11px] text-ink-2">
          {num(t, 3)}
          <span className="text-ink-3">/{num(duration, 2)} s</span>
        </div>
        <span
          className={cn(
            'stencil-sm w-12 shrink-0',
            t < releaseT ? 'text-ink-3' : 'text-quench',
          )}
        >
          {phase}
        </span>
      </div>

      <div className="hidden items-center gap-1 sm:flex">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => onSpeed(s)}
            aria-pressed={speed === s}
            className={cn(
              'tnum rounded-sm border px-1.5 py-1 font-mono text-[10px] transition-colors',
              speed === s
                ? 'border-verdigris bg-verdigris/10 text-verdigris'
                : 'border-rule text-ink-3 hover:border-ink-3 hover:text-ink-2',
            )}
            title={`Play at ${s}× real time`}
          >
            {s}×
          </button>
        ))}
      </div>

      <div className="rule-l flex items-center gap-1 pl-3">
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
        <span className="mx-1 h-5 w-px bg-rule" aria-hidden />
        <IconToggle
          on={showDimensions}
          onClick={() => onShowDimensions(!showDimensions)}
          label="Show dimensions"
        >
          <Ruler className="size-3.5" aria-hidden />
        </IconToggle>
        <IconToggle on={showGrid} onClick={() => onShowGrid(!showGrid)} label="Show grid">
          <Grid3x3 className="size-3.5" aria-hidden />
        </IconToggle>
      </div>
    </div>
  )
}
