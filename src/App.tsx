import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Target } from 'lucide-react'
import { TopBar } from '@/components/TopBar.tsx'
import { DesignRail } from '@/components/DesignRail.tsx'
import { ReadoutRail, type SavedShot } from '@/components/ReadoutRail.tsx'
import { Transport } from '@/components/Transport.tsx'
import { SweepChart } from '@/components/SweepChart.tsx'
import { Stage, type CameraMode } from '@/components/stage/Stage.tsx'
import { Button } from '@/components/ui/button.tsx'
import { useShot, useSimClient } from '@/lib/useSimulation.ts'
import { PRESETS, presetById } from '@/lib/treb/presets.ts'
import {
  sweepConflict,
  TUNABLES,
  type SweepMode,
  type SweepPoint,
  type TunableKey,
} from '@/lib/treb/optimize.ts'
import type { TrebuchetParams } from '@/lib/treb/types.ts'
import { TIME_EPS } from '@/lib/treb/timeline.ts'
import { detectUnitSystem, num, type UnitSystem } from '@/lib/format.ts'
import { cn } from '@/lib/utils.ts'

const AUTOTUNE_KEYS: TunableKey[] = ['slingLength', 'cwHanger', 'initialBeamAngle', 'armShort']

export default function App() {
  const client = useSimClient()

  const [presetId, setPresetId] = useState<string | null>('backyard')
  const [params, setParams] = useState<TrebuchetParams>(() => ({ ...PRESETS[0].params }))
  const [units, setUnits] = useState<UnitSystem>(() => {
    const stored = localStorage.getItem('trebuchator:units')
    return stored === 'metric' || stored === 'imperial' ? stored : detectUnitSystem()
  })
  const [dark, setDark] = useState(
    () =>
      localStorage.getItem('trebuchator:theme') !== 'light' &&
      !(
        localStorage.getItem('trebuchator:theme') == null &&
        window.matchMedia('(prefers-color-scheme: light)').matches
      ),
  )

  // The playback cursor is "somewhere in the shot" or "at the end". Storing the
  // end as `null` rather than as a number means a re-solve that changes the
  // flight time cannot strand the cursor past the end of the new shot, and the
  // sheet always settles on the finished trajectory without an effect to nudge
  // it there.
  const [cursor, setCursor] = useState<number | null>(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(0.15)

  const [cameraMode, setCameraMode] = useState<CameraMode>('auto')
  const [showDimensions, setShowDimensions] = useState(false)
  const [showAngles, setShowAngles] = useState(false)
  const [showGrid, setShowGrid] = useState(true)
  const [showDesign, setShowDesign] = useState(false)
  const [showResults, setShowResults] = useState(false)

  const [saved, setSaved] = useState<SavedShot[]>([])
  const [tuning, setTuning] = useState(false)

  const [sweepOpen, setSweepOpen] = useState(true)
  const [sweepKey, setSweepKey] = useState<TunableKey>('slingLength')
  const [sweepMode, setSweepMode] = useState<SweepMode>('asBuilt')
  const [sweepPoints, setSweepPoints] = useState<SweepPoint[]>([])
  const [sweepBusy, setSweepBusy] = useState(false)
  const [sweepError, setSweepError] = useState<string | null>(null)
  // A solver failure during a button-driven action. Shot failures arrive on
  // their own channel; these have no other way back to the reader.
  const [actionError, setActionError] = useState<string | null>(null)

  const { result, busy, error } = useShot(client, params)
  const timeline = result?.ok ? result.timeline : null
  const duration = timeline?.duration ?? 0
  const t = cursor ?? duration

  const patch = useCallback((next: Partial<TrebuchetParams>) => {
    setParams((prev) => ({ ...prev, ...next }))
    setPresetId(null)
  }, [])

  useEffect(() => {
    localStorage.setItem('trebuchator:units', units)
  }, [units])

  // --- theme ---------------------------------------------------------------
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('trebuchator:theme', dark ? 'dark' : 'light')
  }, [dark])

  // --- playback ------------------------------------------------------------
  const posRef = useRef(0)
  useEffect(() => {
    if (!playing || duration <= 0) return
    let raf = 0
    let last = performance.now()
    const step = (now: number) => {
      // Clamped so a backgrounded tab does not resume by teleporting the shot
      // to the end of its flight.
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      posRef.current += dt * speed
      if (posRef.current >= duration) {
        setCursor(null)
        setPlaying(false)
        return
      }
      setCursor(posRef.current)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, duration])

  const replay = useCallback(() => {
    posRef.current = 0
    setCursor(0)
    setPlaying(true)
  }, [])

  const play = useCallback(() => {
    // Playing from the finished shot means firing again, not sitting on the end.
    const from = cursor == null || cursor >= duration - TIME_EPS ? 0 : cursor
    posRef.current = from
    setCursor(from)
    setPlaying(true)
  }, [cursor, duration])

  const seek = useCallback((to: number) => {
    posRef.current = to
    setCursor(to)
    setPlaying(false)
  }, [])

  // Turning the dimensions on while the shot is finished rewinds to the cocked
  // pose. Dimensions describe the machine as built, and every one of them is
  // legible at rest and folded on top of its neighbours at the end of a stroke.
  const toggleDimensions = useCallback(
    (next: boolean) => {
      setShowDimensions(next)
      if (next && !playing) seek(0)
    },
    [playing, seek],
  )

  // Angles are the opposite case: they are most interesting *during* the
  // stroke, where the sling closes on the pin, so enabling them leaves the
  // cursor alone.
  const toggleAngles = useCallback((next: boolean) => setShowAngles(next), [])

  // --- presets -------------------------------------------------------------
  const loadPreset = useCallback((id: string) => {
    const preset = presetById(id)
    if (!preset) return
    setParams({ ...preset.params })
    setPresetId(id)
    posRef.current = 0
    setCursor(0)
    setPlaying(true)
  }, [])

  // --- sweep ---------------------------------------------------------------
  const sweepSpec = TUNABLES.find((s) => s.key === sweepKey)!
  const [sweepMin, sweepMax] = sweepSpec.range(params)
  // Some parameter/mode pairs have no honest reading — asking the solver for
  // one gets a flat line the reader cannot interpret. Say so instead.
  const sweepBlocked = sweepConflict(sweepKey, sweepMode)

  useEffect(() => {
    if (!sweepOpen || sweepBlocked) return
    // Let a drag settle before spending half a second of worker time on a
    // sweep that is about to be superseded.
    let cancel: (() => void) | null = null
    const timer = setTimeout(() => {
      setSweepBusy(true)
      setSweepPoints([])
      setSweepError(null)
      cancel = client.sweep(params, sweepKey, sweepMin, sweepMax, 40, sweepMode, (update) => {
        if (update.kind === 'error') {
          setSweepError(update.message)
          setSweepBusy(false)
          return
        }
        setSweepPoints(update.points)
        if (update.done) setSweepBusy(false)
      })
    }, 220)
    return () => {
      clearTimeout(timer)
      // Without this a superseded sweep keeps streaming into state for the rest
      // of its half-second, overwriting the one that replaced it.
      cancel?.()
    }
  }, [client, params, sweepKey, sweepMin, sweepMax, sweepMode, sweepOpen, sweepBlocked])

  // --- actions -------------------------------------------------------------
  const tunePin = useCallback(async () => {
    setTuning(true)
    setActionError(null)
    try {
      const angle = await client.tunePin(params)
      if (angle != null) patch({ releaseAngle: angle, releaseMode: 'pin' })
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setTuning(false)
    }
  }, [client, params, patch])

  const autoTune = useCallback(async () => {
    setTuning(true)
    setActionError(null)
    try {
      const tuned = await client.autotune(params, AUTOTUNE_KEYS)
      setParams(tuned)
      setPresetId(null)
      posRef.current = 0
      setCursor(0)
      setPlaying(true)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setTuning(false)
    }
  }, [client, params])

  const nextId = useRef(1)
  const saveShot = useCallback(() => {
    if (!result?.ok) return
    const label = presetId
      ? PRESETS.find((p) => p.id === presetId)!.name
      : `${num(params.cwMass, 0)} kg · ${num(params.slingLength, 2)} m sling`
    setSaved((prev) =>
      [
        ...prev,
        {
          id: nextId.current++,
          label,
          range: result.range,
          trajectory: result.trajectory.map((p) => ({ x: p.x, y: p.y })),
          params: { ...params },
        },
      ].slice(-6),
    )
  }, [result, params, presetId])

  const ghosts = useMemo(
    () => saved.map((s) => ({ trajectory: s.trajectory, label: s.label })),
    [saved],
  )

  const sweepBest = useMemo(() => {
    let best: SweepPoint | null = null
    for (const pt of sweepPoints) {
      if (!Number.isFinite(pt.range)) continue
      if (!best || pt.range > best.range) best = pt
    }
    return best
  }, [sweepPoints])

  // --- keyboard ------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (e.key === ' ') {
        e.preventDefault()
        if (playing) setPlaying(false)
        else play()
      }
      if (e.key === 'r' || e.key === 'R') replay()
      if (e.key === 'd' || e.key === 'D') toggleDimensions(!showDimensions)
      if (e.key === 'a' || e.key === 'A') setShowAngles((v) => !v)
      if (e.key === 'g' || e.key === 'G') setShowGrid((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [replay, play, playing, toggleDimensions, showDimensions])

  const ratio = params.armLong / Math.max(params.armShort, 1e-6)
  const massRatio = params.cwMass / Math.max(params.projectileMass, 1e-9)
  const machineName =
    params.type === 'hinged' ? 'Hinged counterweight' : params.type === 'fixed' ? 'Bolted counterweight' : 'Floating arm'

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-ground text-ink">
      <TopBar
        presetId={presetId}
        onPreset={loadPreset}
        units={units}
        onUnits={setUnits}
        dark={dark}
        onDark={setDark}
        onSave={saveShot}
        onAutoTune={autoTune}
        tuning={tuning}
        busy={busy}
        showDesign={showDesign}
        showResults={showResults}
        onToggleDesign={() => {
          setShowDesign((v) => !v)
          setShowResults(false)
        }}
        onToggleResults={() => {
          setShowResults((v) => !v)
          setShowDesign(false)
        }}
      />

      <div className="relative flex min-h-0 flex-1">
        <aside
          className={cn(
            'rule-r w-[21rem] shrink-0 bg-sheet xl:block',
            showDesign
              ? 'absolute inset-y-0 left-0 z-20 block shadow-2xl xl:relative xl:shadow-none'
              : 'hidden',
          )}
        >
          <DesignRail
            params={params}
            patch={patch}
            units={units}
            onTunePin={tunePin}
            tuning={tuning}
          />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <Stage
              result={result}
              params={params}
              t={t}
              units={units}
              showDimensions={showDimensions}
              showAngles={showAngles}
              showGrid={showGrid}
              ghosts={ghosts}
              mode={cameraMode}
              onModeChange={setCameraMode}
            />

            {/* Title block, the way a drawing carries its own identification.
                Top right rather than the traditional bottom corner, because the
                bottom of the sheet belongs to the range dimension. Everything in
                it is derived from the machine, not decorative. */}
            <div className="pointer-events-none absolute right-3 top-3 hidden border border-rule bg-sheet/85 backdrop-blur-[2px] sm:block">
              <div className="label rule-b px-2.5 py-1.5 text-ink-2">{machineName}</div>
              <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 px-2.5 py-2">
                <dt className="label text-ink-3">Arm ratio</dt>
                <dd className="tnum text-right font-mono text-[11px] text-ink">
                  {num(ratio, 2)} : 1
                </dd>
                <dt className="label text-ink-3">Weight ratio</dt>
                <dd className="tnum text-right font-mono text-[11px] text-ink">
                  {num(massRatio, 0)} : 1
                </dd>
                <dt className="label text-ink-3">Sling</dt>
                <dd className="tnum text-right font-mono text-[11px] text-ink">
                  {num((params.slingLength / params.armLong) * 100, 0)}% of arm
                </dd>
              </dl>
            </div>
          </div>

          {sweepOpen && (
            <div className="rule-t bg-sheet px-3 pb-2 pt-2">
              <div className="flex flex-wrap items-center gap-2 pb-1">
                <span className="stencil shrink-0 text-ink">Sensitivity</span>
                <select
                  value={sweepKey}
                  onChange={(e) => setSweepKey(e.target.value as TunableKey)}
                  aria-label="Parameter to sweep"
                  className="label rounded-sm border border-rule bg-ground px-2 py-1 text-ink-2 focus-visible:border-verdigris"
                >
                  {TUNABLES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>

                {/* Holding the pin angle while sweeping a dimension conflates
                    "this dimension is better" with "my pin happens to suit it",
                    which is the fastest way to make a curve untrustworthy.
                    Naming both readings, and letting you switch, is the fix. */}
                <div
                  role="radiogroup"
                  aria-label="How each point is set up"
                  className="flex shrink-0 overflow-hidden rounded-sm border border-rule"
                >
                  {(
                    [
                      ['asBuilt', 'As built', 'Change this one number and nothing else.'],
                      [
                        'bestCase',
                        'Best case',
                        'Re-cock the beam and release at the ideal instant for every value — what this dimension could give you if you tuned around it.',
                      ],
                    ] as const
                  ).map(([m, label, hint]) => (
                    <button
                      key={m}
                      role="radio"
                      aria-checked={sweepMode === m}
                      title={hint}
                      onClick={() => setSweepMode(m)}
                      className={cn(
                        'label px-2 py-1.5 transition-colors',
                        sweepMode === m
                          ? 'bg-verdigris/12 text-verdigris'
                          : 'text-ink-3 hover:text-ink-2',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="label h-7 shrink-0 gap-1.5"
                  disabled={sweepBusy || !sweepBest || sweepBlocked != null}
                  onClick={() => sweepBest && patch({ [sweepKey]: sweepBest.value })}
                  title="Set this parameter to the value that throws furthest"
                >
                  <Target className="size-3" aria-hidden />
                  Adopt best
                </Button>

                <Button
                  size="icon"
                  variant="ghost"
                  className="ml-auto size-7 shrink-0 text-ink-3"
                  onClick={() => setSweepOpen(false)}
                  aria-label="Hide the sensitivity chart"
                >
                  <ChevronDown className="size-4" aria-hidden />
                </Button>
              </div>
              {(sweepBlocked ?? sweepError) ? (
                <p className="label mx-auto max-w-prose px-2 py-10 text-center leading-relaxed text-ink-3">
                  {sweepBlocked ?? sweepError}
                </p>
              ) : (
                <SweepChart
                  points={sweepPoints}
                  paramKey={sweepKey}
                  current={params[sweepKey]}
                  units={units}
                  loading={sweepBusy}
                  mode={sweepMode}
                  onPick={(v) => patch({ [sweepKey]: v })}
                />
              )}
            </div>
          )}

          {!sweepOpen && (
            <button
              onClick={() => setSweepOpen(true)}
              className="rule-t label flex items-center justify-center gap-1.5 bg-sheet py-1.5 text-ink-3 hover:text-ink-2"
            >
              <ChevronUp className="size-3.5" aria-hidden />
              Sensitivity
            </button>
          )}

          <Transport
            t={t}
            timeline={timeline}
            playing={playing}
            speed={speed}
            onSeek={seek}
            onPlay={play}
            onPause={() => setPlaying(false)}
            onReplay={replay}
            onSpeed={setSpeed}
            cameraMode={cameraMode}
            onCameraMode={setCameraMode}
            showDimensions={showDimensions}
            onShowDimensions={toggleDimensions}
            showAngles={showAngles}
            onShowAngles={toggleAngles}
            showGrid={showGrid}
            onShowGrid={setShowGrid}
            disabled={!result?.ok}
          />
        </main>

        <aside
          className={cn(
            'rule-l w-[20rem] shrink-0 bg-sheet xl:block',
            showResults
              ? 'absolute inset-y-0 right-0 z-20 block shadow-2xl xl:relative xl:shadow-none'
              : 'hidden',
          )}
        >
          <ReadoutRail
            result={result}
            error={error ?? actionError}
            params={params}
            units={units}
            saved={saved}
            onRecall={(s) => {
              setParams({ ...s.params })
              setPresetId(null)
            }}
            onDrop={(id) => setSaved((prev) => prev.filter((s) => s.id !== id))}
          />
        </aside>
      </div>
    </div>
  )
}
