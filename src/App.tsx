import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Target } from 'lucide-react'
import { TopBar } from '@/components/TopBar.tsx'
import { Explain } from '@/components/Explain.tsx'
import { Tip } from '@/components/Tip.tsx'
import { SegmentedControl } from '@/components/SegmentedControl.tsx'
import { DesignRail } from '@/components/DesignRail.tsx'
import { ReadoutRail, type SavedShot } from '@/components/ReadoutRail.tsx'
import { Transport } from '@/components/Transport.tsx'
import { SweepChart } from '@/components/SweepChart.tsx'
import { Stage, type CameraMode } from '@/components/stage/Stage.tsx'
import { Button } from '@/components/ui/button.tsx'
import { useShot, useSimClient } from '@/lib/useSimulation.ts'
import { PRESETS, presetById, type Preset } from '@/lib/treb/presets.ts'
import { presetFromUrl, withMachine } from '@/lib/share.ts'
import {
  goalValue,
  sweepConflict,
  TUNABLES,
  type ParetoGoal,
  type ParetoPoint,
  type SweepMode,
  type SweepPoint,
  type TunableKey,
} from '@/lib/treb/optimize.ts'
import {
  loadMachines,
  loadMaterials,
  newMachine,
  saveMachines,
  saveMaterials,
  type CustomMaterial,
  type SavedMachine,
} from '@/lib/treb/library.ts'
import type { DimensionKey } from '@/components/stage/sheet.ts'
import type { TrebuchetParams } from '@/lib/treb/types.ts'
import { TIME_EPS } from '@/lib/treb/timeline.ts'
import {
  detectUnitSystem,
  num,
  show,
  toDisplay,
  unitSymbol,
  type Dimension,
  type UnitSystem,
} from '@/lib/format.ts'
import { NotesContext } from '@/lib/notes.ts'
import { PointAtContext } from '@/lib/pointing.ts'
import { throttle, track } from '@/lib/analytics.ts'
import { useAnalytics } from '@/lib/useAnalytics.ts'
import { cn } from '@/lib/utils.ts'

/** The dimensions the Pareto search varies. Masses stay the builder's own. */
const PARETO_KEYS: TunableKey[] = ['slingLength', 'cwHanger', 'initialBeamAngle', 'armShort']

/** The machine to open with: the one a shared link names, or the first preset. */
function openingPreset(): Preset {
  const id = presetFromUrl(window.location.href)
  return (id ? presetById(id) : null) ?? PRESETS[0]
}

export default function App() {
  const client = useSimClient()

  const [presetId, setPresetId] = useState<string | null>(() => openingPreset().id)
  const [params, setParams] = useState<TrebuchetParams>(() => ({ ...openingPreset().params }))
  const [units, setUnits] = useState<UnitSystem>(() => {
    const stored = localStorage.getItem('trebuchator:units')
    return stored === 'metric' || stored === 'imperial' ? stored : detectUnitSystem()
  })
  // On by default: the product's second job is teaching, and a builder meeting
  // "hanger length" for the first time should not have to discover a tooltip to
  // find out what it measures. One click folds them all away again.
  const [notes, setNotes] = useState(() => localStorage.getItem('trebuchator:notes') !== 'off')
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
  const [speed, setSpeed] = useState(1)

  const [cameraMode, setCameraMode] = useState<CameraMode>('auto')
  const [showDimensions, setShowDimensions] = useState(false)
  const [showAngles, setShowAngles] = useState(false)
  const [showGrid, setShowGrid] = useState(true)
  const [showDesign, setShowDesign] = useState(false)
  const [showResults, setShowResults] = useState(false)

  const [saved, setSaved] = useState<SavedShot[]>([])
  const [tuning, setTuning] = useState(false)
  const [pareto, setPareto] = useState<ParetoPoint[] | null>(null)
  const [goal, setGoal] = useState<ParetoGoal>('range')

  // The builder's own library. Read once at boot; every change writes it back.
  const [machines, setMachines] = useState<SavedMachine[]>(loadMachines)
  const [materials, setMaterials] = useState<CustomMaterial[]>(loadMaterials)

  // Which dimension a control is pointing at, and whether one is being worked.
  // Both drive the sheet: the first draws that measurement, the second brings
  // the camera back to the machine so the change is somewhere the reader is
  // looking.
  const [pointedAt, setPointedAt] = useState<DimensionKey | null>(null)
  const [editing, setEditing] = useState(false)
  const editTimer = useRef<number | undefined>(undefined)
  // What-if preview: the trajectory of whichever machine is being pointed at,
  // on the sweep chart or on the optimizer's frontier. One slot, because the
  // sheet draws one speculative line — and it carries its own label so the two
  // sources letter their own curve rather than the sheet guessing which chart
  // asked. The ref guards against a preview landing after the pointer has
  // already left, or moved on to another candidate.
  const [preview, setPreview] = useState<{
    id: string
    label: string
    trajectory: { x: number; y: number }[]
  } | null>(null)
  const previewIdRef = useRef<string | null>(null)

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

  // The two things no handler can see: the shape of the whole visit, and the
  // value a slider settled on after a drag that fired sixty times getting there.
  // Everything discrete is tracked at its own handler, where the intent is known.
  useAnalytics({ result, error, params, presetId, units, dark, notes })

  const patch = useCallback((next: Partial<TrebuchetParams>) => {
    setParams((prev) => ({ ...prev, ...next }))
    setPresetId(null)
    // A different machine invalidates both derived artefacts: the frontier was
    // searched around the old one, and a hovered preview belongs to its chart.
    setPareto(null)
    setPreview(null)
    previewIdRef.current = null
    // Hold the camera on the machine for a moment after the last change. A
    // timer rather than a pointer state because plenty of edits arrive from
    // controls that measure nothing on the sheet — a mass, a toggle, a material
    // — and those deserve the same look at what they did. It rides on the
    // trailing edge so a slider drag holds the framing for its whole length.
    setEditing(true)
    clearTimeout(editTimer.current)
    editTimer.current = window.setTimeout(() => setEditing(false), 1600)
  }, [])

  useEffect(() => () => clearTimeout(editTimer.current), [])

  // The address bar keeps naming what is on the sheet, so copying it shares the
  // right machine and reloading returns to it. `replaceState`, not `pushState`:
  // reading down the preset list is browsing a menu rather than navigating, and
  // a back button that stepped back through every machine you glanced at would
  // be a trap. `withMachine` drops the parameter for anything that is not a
  // preset, which is what stops an edited machine from being shared under the
  // name of the one it started from.
  useEffect(() => {
    window.history.replaceState(null, '', withMachine(window.location.href, presetId))
  }, [presetId])

  useEffect(() => {
    localStorage.setItem('trebuchator:units', units)
  }, [units])

  useEffect(() => {
    localStorage.setItem('trebuchator:notes', notes ? 'on' : 'off')
  }, [notes])

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

  // The transport's own controls leave `via` alone; the keyboard shortcuts pass
  // 'key'. Which of the two a reader reaches for is the only way to find out
  // whether the shortcuts printed in the view panel are worth their row.
  const replay = useCallback((via = 'button') => {
    track('playback', { action: 'replay', via })
    posRef.current = 0
    setCursor(0)
    setPlaying(true)
  }, [])

  const play = useCallback(
    (via = 'button') => {
      track('playback', { action: 'play', via })
      // Playing from the finished shot means firing again, not sitting on the end.
      const from = cursor == null || cursor >= duration - TIME_EPS ? 0 : cursor
      posRef.current = from
      setCursor(from)
      setPlaying(true)
    },
    [cursor, duration],
  )

  const pause = useCallback((via = 'button') => {
    track('playback', { action: 'pause', via })
    setPlaying(false)
  }, [])

  const seek = useCallback((to: number) => {
    // A scrub is one intent and a hundred pointer events; the leading edge of
    // each burst is the row worth keeping.
    throttle('seek', 4000, 'playback', { action: 'seek', via: 'scrubber' })
    posRef.current = to
    setCursor(to)
    setPlaying(false)
  }, [])

  // Turning the dimensions on while the shot is finished rewinds to the cocked
  // pose. Dimensions describe the machine as built, and every one of them is
  // legible at rest and folded on top of its neighbours at the end of a stroke.
  const toggleDimensions = useCallback(
    (next: boolean, via = 'button') => {
      track('annotation_set', { annotation: 'dimensions', on: next, via })
      setShowDimensions(next)
      if (next && !playing) seek(0)
    },
    [playing, seek],
  )

  // Angles are the opposite case: they are most interesting *during* the
  // stroke, where the sling closes on the pin, so enabling them leaves the
  // cursor alone.
  const toggleAngles = useCallback((next: boolean, via = 'button') => {
    track('annotation_set', { annotation: 'angles', on: next, via })
    setShowAngles(next)
  }, [])

  const toggleGrid = useCallback((next: boolean, via = 'button') => {
    track('annotation_set', { annotation: 'grid', on: next, via })
    setShowGrid(next)
  }, [])

  const toggleNotes = useCallback((next: boolean, via = 'button') => {
    track('annotation_set', { annotation: 'notes', on: next, via })
    setNotes(next)
  }, [])

  const changeCamera = useCallback((mode: CameraMode, via = 'button') => {
    // 'free' arrives from a pan or a pinch on the sheet rather than from a
    // control, and `Stage` reports the gesture itself — counting it here as a
    // camera choice would make the sheet look like the most-used control in the
    // app when nobody pressed anything.
    if (mode !== 'free') track('camera_set', { mode, via })
    setCameraMode(mode)
  }, [])

  // --- presets -------------------------------------------------------------
  const loadPreset = useCallback((id: string) => {
    const preset = presetById(id)
    if (!preset) return
    track('machine_loaded', { machine: id, era: preset.era, source: 'preset' })
    setParams({ ...preset.params })
    setPresetId(id)
    setPareto(null)
    setPreview(null)
    previewIdRef.current = null
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
      const startedAt = Date.now()
      cancel = client.sweep(params, sweepKey, sweepMin, sweepMax, 40, sweepMode, (update) => {
        if (update.kind === 'error') {
          track('solver_failed', { where: 'sweep', reason: update.message })
          setSweepError(update.message)
          setSweepBusy(false)
          return
        }
        setSweepPoints(update.points)
        if (update.done) {
          // Timed at the point it finishes rather than estimated: forty points
          // at `SWEEP_DT` is the longest wait in the app and the one most worth
          // knowing the real distribution of, across real machines and phones.
          track('sweep_run', {
            param: sweepKey,
            mode: sweepMode,
            count: update.points.length,
            seconds: (Date.now() - startedAt) / 1000,
          })
          setSweepBusy(false)
        }
      })
    }, 220)
    return () => {
      clearTimeout(timer)
      // Without this a superseded sweep keeps streaming into state for the rest
      // of its half-second, overwriting the one that replaced it.
      cancel?.()
    }
  }, [client, params, sweepKey, sweepMin, sweepMax, sweepMode, sweepOpen, sweepBlocked])

  // Which parameter and mode pairs readers actually ask for and cannot have.
  // The panel prints the reason where the chart would go; this is how often
  // anyone reads it.
  useEffect(() => {
    if (sweepOpen && sweepBlocked) track('sweep_blocked', { param: sweepKey, mode: sweepMode })
  }, [sweepOpen, sweepBlocked, sweepKey, sweepMode])

  // --- actions -------------------------------------------------------------
  const tunePin = useCallback(async () => {
    setTuning(true)
    setActionError(null)
    try {
      const angle = await client.tunePin(params)
      if (angle != null) {
        track('pin_tuned', { angle, machine_type: params.type })
        patch({ releaseAngle: angle, releaseMode: 'pin' })
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      track('solver_failed', { where: 'tune_pin', reason })
      setActionError(reason)
    } finally {
      setTuning(false)
    }
  }, [client, params, patch])

  // Takes the goal explicitly rather than closing over it, because the goal
  // switch has to search for the goal it is *moving to* — reading it from state
  // would run the search against the value being replaced.
  const runOptimize = useCallback(
    async (searchFor: ParetoGoal) => {
      setTuning(true)
      setActionError(null)
      const startedAt = Date.now()
      try {
        const frontier = await client.pareto(params, PARETO_KEYS, searchFor)
        // An empty frontier is a real and interesting answer — it is the panel
        // saying "no feasible builds near this machine", and how often that
        // happens is the measure of whether the search ranges are set right.
        track('frontier_searched', {
          goal: searchFor,
          count: frontier.length,
          seconds: (Date.now() - startedAt) / 1000,
        })
        setPareto(frontier)
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        track('solver_failed', { where: 'optimize', reason })
        setActionError(reason)
      } finally {
        setTuning(false)
      }
    },
    [client, params],
  )

  const optimize = useCallback(() => void runOptimize(goal), [runOptimize, goal])

  // Changing the goal re-searches rather than re-sorting what is held: the
  // non-dominated set for range is not the non-dominated set for efficiency,
  // and filtering the old frontier would quietly present a subset of the wrong
  // answer. The search has to be fired here — the panel only starts one when it
  // opens, so clearing the frontier alone left the goal switch showing "no
  // feasible builds" forever.
  const changeGoal = useCallback(
    (next: ParetoGoal) => {
      setGoal(next)
      setPareto(null)
      void runOptimize(next)
    },
    [runOptimize],
  )

  // --- the builder's library -------------------------------------------------
  const saveMachine = useCallback(
    (name: string) => {
      setMachines((prev) => {
        const next = [...prev, newMachine(name, params)]
        // The name is the builder's own words and never leaves the browser. Its
        // length is enough to answer the only question worth asking of it —
        // whether people name their machines or mash the keyboard past a dialog.
        track('machine_saved', { name_len: name.length, count: next.length })
        saveMachines(next)
        return next
      })
    },
    [params],
  )

  const loadMachine = useCallback(
    (id: string) => {
      const machine = machines.find((m) => m.id === id)
      if (!machine) return
      // The id names a row in this browser's storage and nothing on anyone
      // else's, so it is reported as the kind of thing it is rather than as
      // itself — a random id per machine per browser is cardinality with no
      // question attached to it.
      track('machine_loaded', { machine: 'saved', era: 'saved', source: 'library' })
      setParams({ ...machine.params })
      // Saved machines share the preset slot: both answer "what is loaded", and
      // two ids would mean every reader of that answer had to check both.
      setPresetId(id)
      setPareto(null)
      setPreview(null)
      previewIdRef.current = null
      posRef.current = 0
      setCursor(0)
      setPlaying(true)
    },
    [machines],
  )

  const deleteMachine = useCallback((id: string) => {
    setMachines((prev) => {
      const next = prev.filter((m) => m.id !== id)
      track('machine_deleted', { count: next.length })
      saveMachines(next)
      return next
    })
    // Deleting the machine that is loaded leaves its numbers in hand but no
    // longer under a name, which is what "Custom machine" says.
    setPresetId((current) => (current === id ? null : current))
  }, [])

  const changeMaterials = useCallback((next: CustomMaterial[]) => {
    setMaterials(next)
    saveMaterials(next)
  }, [])

  const applyPareto = useCallback(
    (point: ParetoPoint) => {
      // Measured against candidate zero — the machine as built, evaluated by the
      // same search at the same step — rather than against the held result. The
      // frontier is searched at `SWEEP_DT` and `simulateShot` runs finer, so
      // comparing across the two would report the step size as a gain.
      const current = pareto?.find((p) => p.isCurrent)
      const from = current ? goalValue(current, goal) : 0
      track('frontier_applied', {
        goal,
        gain_pct: from > 0 ? ((goalValue(point, goal) - from) / from) * 100 : 0,
        axle_load_kn: point.axleLoad / 1000,
      })
      setParams({ ...point.params })
      setPresetId(null)
      setPareto(null)
      setPreview(null)
      previewIdRef.current = null
      posRef.current = 0
      setCursor(0)
      setPlaying(true)
    },
    [pareto, goal],
  )

  const nextId = useRef(1)
  const saveShot = useCallback(() => {
    if (!result?.ok) return
    // Lettered in whichever units are showing when it is saved — a ghost
    // labelled "60 kg" on a sheet reading in pounds names a machine the reader
    // never built.
    const label = presetId
      ? PRESETS.find((p) => p.id === presetId)!.name
      : `${show(params.cwMass, 'mass', units, 0)} ${unitSymbol('mass', units)} · ${show(params.slingLength, 'length', units, 2)} ${unitSymbol('length', units)} sling`
    setSaved((prev) => {
      const next = [
        ...prev,
        {
          id: nextId.current++,
          label,
          range: result.range,
          trajectory: result.trajectory.map((p) => ({ x: p.x, y: p.y })),
          params: { ...params },
        },
      ].slice(-6)
      // How many ghosts a reader keeps on the sheet at once is the whole
      // question about the six-shot cap.
      track('ghost_saved', { count: next.length })
      return next
    })
  }, [result, params, presetId, units])

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

  /**
   * What adopting a value off the curve is worth, as a percentage.
   *
   * Measured against the point on the *same curve* nearest the value in hand,
   * not against the held result. Both are then fired at `SWEEP_DT`; comparing
   * across the two step sizes would report the coarser integration as part of
   * the gain, which is the one thing the panel already warns the reader about.
   */
  const sweepGain = useCallback(
    (range: number) => {
      const at = params[sweepKey]
      let nearest: SweepPoint | null = null
      for (const pt of sweepPoints) {
        if (!Number.isFinite(pt.range)) continue
        if (!nearest || Math.abs(pt.value - at) < Math.abs(nearest.value - at)) nearest = pt
      }
      return nearest && nearest.range > 0 ? ((range - nearest.range) / nearest.range) * 100 : 0
    },
    [params, sweepKey, sweepPoints],
  )

  // --- what-if preview -------------------------------------------------------
  // Hovering the chart fires the hovered machine as a real (coalesced) shot and
  // draws its trajectory on the sheet, so the curve and the drawing answer the
  // same question at the same moment.
  const flyPreview = useCallback(
    (id: string | null, machine: TrebuchetParams | null, label: string) => {
      previewIdRef.current = id
      if (id == null || machine == null) {
        setPreview(null)
        return
      }
      client.requestPreview(machine, {
        onResult: (r) => {
          if (previewIdRef.current !== id) return
          if (!r.ok) {
            setPreview(null)
            return
          }
          setPreview({ id, label, trajectory: r.trajectory.map((pt) => ({ x: pt.x, y: pt.y })) })
        },
        // A failed preview simply doesn't draw; the chart still shows its
        // figure, and errors about the *real* machine have their own channel.
        onError: () => {},
      })
    },
    [client],
  )

  const previewHover = useCallback(
    (value: number | null) => {
      if (value == null) return flyPreview(null, null, '')
      // A hover is a mousemove per pixel of chart. One row per few seconds says
      // the same thing — that the reader is reading the curve rather than
      // ignoring the panel — without being the loudest event in the property.
      throttle('sweep-preview', 5000, 'sweep_previewed', { param: sweepKey, mode: sweepMode })
      const dim: Dimension = sweepSpec.unit === 'ratio' ? 'none' : sweepSpec.unit
      flyPreview(
        `sweep:${value}`,
        { ...params, [sweepKey]: value },
        `${sweepSpec.label.toLowerCase()} ${num(toDisplay(value, dim, units), 2)}${unitSymbol(dim, units)}`,
      )
    },
    [flyPreview, params, sweepKey, sweepSpec, sweepMode, units],
  )

  const previewPareto = useCallback(
    (point: ParetoPoint | null) => {
      if (point == null) return flyPreview(null, null, '')
      throttle('pareto-preview', 5000, 'frontier_previewed', { goal })
      // Lettered with whatever the frontier was searched for, so the curve on
      // the sheet and the point under the pointer name the same quantity.
      const figure =
        goal === 'efficiency'
          ? `${num(point.efficiency * 100, 0)}% efficient`
          : goal === 'releaseSpeed'
            ? `${show(point.releaseSpeed, 'speed', units, 1)} ${unitSymbol('speed', units)} at release`
            : `${show(point.range, 'length', units, 1)} ${unitSymbol('length', units)}`
      flyPreview(`pareto:${point.axleLoad}`, point.params, figure)
    },
    [flyPreview, goal, units],
  )

  // --- keyboard ------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      // Anywhere a keystroke is already meaningful: a text box, the parameter
      // menu, an open popover. A bare letter belongs to that control, not to a
      // shortcut — pressing "a" in the sweep menu used to jump to a preset's
      // option *and* toggle the angle overlay behind it.
      if (el?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
      if (e.key === ' ') {
        // Space is how a focused button, switch or slider is worked. Swallowing
        // it globally meant no keyboard user could press Auto-tune, Save shot,
        // or any toggle in the app — the shortcut ate the activation.
        if (el?.closest('button, a[href], [role="switch"], [role="slider"]')) return
        e.preventDefault()
        if (playing) pause('key')
        else play('key')
      }
      if (e.key === 'r' || e.key === 'R') replay('key')
      if (e.key === 'd' || e.key === 'D') toggleDimensions(!showDimensions, 'key')
      if (e.key === 'a' || e.key === 'A') toggleAngles(!showAngles, 'key')
      if (e.key === 'g' || e.key === 'G') toggleGrid(!showGrid, 'key')
      if (e.key === 'n' || e.key === 'N') toggleNotes(!notes, 'key')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    replay,
    play,
    pause,
    playing,
    toggleDimensions,
    showDimensions,
    toggleAngles,
    showAngles,
    toggleGrid,
    showGrid,
    toggleNotes,
    notes,
  ])

  const ratio = params.armLong / Math.max(params.armShort, 1e-6)
  const massRatio = params.cwMass / Math.max(params.projectileMass, 1e-9)
  const machineName =
    params.type === 'hinged'
      ? 'Hinged counterweight'
      : params.type === 'fixed'
        ? 'Bolted counterweight'
        : 'Floating arm'

  return (
    <NotesContext value={notes}>
      <PointAtContext value={setPointedAt}>
        <div className="flex h-dvh w-full flex-col overflow-hidden bg-ground text-ink">
          <TopBar
            presetId={presetId}
            onPreset={loadPreset}
            units={units}
            onUnits={(next) => {
              track('units_set', { units: next })
              setUnits(next)
            }}
            dark={dark}
            onDark={(next) => {
              track('theme_set', { theme: next ? 'dark' : 'light' })
              setDark(next)
            }}
            onSave={saveShot}
            canSave={result?.ok ?? false}
            machines={machines}
            onSaveMachine={saveMachine}
            onLoadMachine={loadMachine}
            onDeleteMachine={deleteMachine}
            onOptimize={optimize}
            optimizing={tuning}
            pareto={pareto}
            goal={goal}
            onGoal={changeGoal}
            onApplyPareto={applyPareto}
            onPreviewPareto={previewPareto}
            busy={busy}
            showDesign={showDesign}
            showResults={showResults}
            onToggleDesign={() => {
              track('panel_toggled', { panel: 'design', on: !showDesign })
              setShowDesign((v) => !v)
              setShowResults(false)
            }}
            onToggleResults={() => {
              track('panel_toggled', { panel: 'results', on: !showResults })
              setShowResults((v) => !v)
              setShowDesign(false)
            }}
          />

          <div className="relative flex min-h-0 flex-1">
            {/* Below `xl` the rails float over the sheet; a tap on the sheet
              should put them away, the way every drawer behaves. The scrim
              only exists while a rail is open, so the sheet's own pan and zoom
              are untouched the rest of the time. */}
            {(showDesign || showResults) && (
              <div
                className="absolute inset-0 z-10 xl:hidden"
                onClick={() => {
                  setShowDesign(false)
                  setShowResults(false)
                }}
                aria-hidden
              />
            )}
            <aside
              /* The catch-all for the highlight. A control clears it on
               pointerleave, but a rail that closes — or a field that unmounts
               when the machine type changes — never fires one, and the sheet
               was left with a dimension lit for a control that is no longer on
               screen. */
              onPointerLeave={() => setPointedAt(null)}
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
                materials={materials}
                onMaterials={changeMaterials}
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
                  preview={preview}
                  highlight={pointedAt}
                  /* Pointing counts as editing. Without this the highlight is
                   invisible in the ordinary case: with playback parked at the
                   end of a flight the camera is framed on the whole field, the
                   machine is a few dozen pixels tall, and every dimension is
                   below `MIN_DIMENSION` and correctly dropped — so pointing at
                   a control lit nothing at all. Framing is what makes the
                   measurement legible enough to be worth drawing. */
                  editing={editing || pointedAt !== null}
                  mode={cameraMode}
                  onModeChange={(mode) => changeCamera(mode, 'sheet')}
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
                  {/* The collapse control leads the row rather than floating right
                    on an `ml-auto`. In a wrapping row that put it alone on a line
                    of its own once the buttons wrapped — and a disclosure belongs
                    next to the name of the thing it discloses anyway, which is
                    where the collapsed state already puts it. */}
                  {/* The controls share the row's width — the select takes the
                    slack — instead of clustering left and wrapping the last
                    button onto its own lonely line. */}
                  <div className="flex flex-wrap items-center gap-2 pb-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="tap-target relative -ml-1 size-7 shrink-0 text-ink-3"
                      onClick={() => {
                        track('sweep_panel_set', { on: false })
                        setSweepOpen(false)
                      }}
                      aria-expanded
                      aria-label="Hide the what-if panel"
                    >
                      <ChevronDown className="size-4" aria-hidden />
                    </Button>
                    <span className="stencil shrink-0 text-ink">What if</span>
                    <Explain title="What if" className="-ml-0.5">
                      <p>
                        One dimension swept across its whole useful span, with the machine fired at
                        every point on the curve. Hovering a point flies that machine on the sheet
                        above, so the curve and the drawing are answering the same question at the
                        same moment.
                      </p>
                      <p>
                        <strong className="text-ink">As built</strong> changes that one number and
                        nothing else — the honest answer to "what if I cut this longer", stale pin
                        and all. <strong className="text-ink">Best case</strong> re-cocks the beam
                        and releases at the ideal instant for every point, which is what the
                        dimension could give you if you tuned around it.
                      </p>
                      <p>
                        They are different questions and the gap between them is worth reading: it
                        is how much of the curve's shape is the dimension and how much is the pin
                        you happen to have bent.
                      </p>
                    </Explain>
                    {/* A native select for a 12-item list — the platform picker is
                      the right control on a phone — but with its own chrome off,
                      because a macOS select is rounder than anything else drawn
                      on this sheet. */}
                    <div className="relative min-w-[9rem] flex-1">
                      <select
                        value={sweepKey}
                        onChange={(e) => {
                          const next = e.target.value as TunableKey
                          track('sweep_key_set', { param: next })
                          setSweepKey(next)
                        }}
                        aria-label="Parameter to sweep"
                        className="label w-full appearance-none rounded-sm border border-rule bg-ground py-1 pl-2 pr-6 text-ink-2 focus-visible:border-verdigris"
                      >
                        {TUNABLES.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        className="pointer-events-none absolute right-1.5 top-1/2 size-3 -translate-y-1/2 text-ink-3"
                        aria-hidden
                      />
                    </div>

                    {/* Holding the pin angle while sweeping a dimension conflates
                      "this dimension is better" with "my pin happens to suit it",
                      which is the fastest way to make a curve untrustworthy.
                      Naming both readings, and letting you switch, is the fix. */}
                    <SegmentedControl
                      label="How each point is set up"
                      value={sweepMode}
                      onChange={(mode) => {
                        track('sweep_mode_set', { mode })
                        setSweepMode(mode)
                      }}
                      options={[
                        {
                          value: 'asBuilt',
                          label: 'As built',
                          title: 'Change this one number and nothing else.',
                        },
                        {
                          value: 'bestCase',
                          label: 'Best case',
                          title:
                            'Re-cock and re-time the release at every value — the best this dimension could do.',
                        },
                      ]}
                    />

                    <Tip text="Sets this parameter to the peak of the curve, then re-solves it at a finer step — so the range may land a little off the point you adopted.">
                      <Button
                        size="sm"
                        variant="outline"
                        className="label h-7 shrink-0 gap-1.5"
                        disabled={sweepBusy || !sweepBest || sweepBlocked != null}
                        onClick={() => {
                          if (!sweepBest) return
                          track('sweep_adopted', {
                            param: sweepKey,
                            mode: sweepMode,
                            via: 'button',
                            gain_pct: sweepGain(sweepBest.range),
                          })
                          patch({ [sweepKey]: sweepBest.value })
                        }}
                      >
                        <Target className="size-3" aria-hidden />
                        Adopt best
                      </Button>
                    </Tip>
                  </div>
                  {(sweepBlocked ?? sweepError) ? (
                    <p className="body mx-auto max-w-prose px-2 py-10 text-center text-ink-2">
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
                      onPick={(v) => {
                        const at = sweepPoints.find((p) => p.value === v)
                        track('sweep_adopted', {
                          param: sweepKey,
                          mode: sweepMode,
                          via: 'chart',
                          gain_pct: at ? sweepGain(at.range) : 0,
                        })
                        patch({ [sweepKey]: v })
                      }}
                      onHover={previewHover}
                    />
                  )}
                </div>
              )}

              {!sweepOpen && (
                <button
                  onClick={() => {
                    track('sweep_panel_set', { on: true })
                    setSweepOpen(true)
                  }}
                  aria-expanded={false}
                  className="rule-t label flex items-center justify-center gap-1.5 bg-sheet py-1.5 text-ink-3 hover:text-ink-2"
                >
                  <ChevronUp className="size-3.5" aria-hidden />
                  What if
                </button>
              )}

              <Transport
                t={t}
                timeline={timeline}
                playing={playing}
                speed={speed}
                onSeek={seek}
                onPlay={play}
                onPause={pause}
                onReplay={replay}
                onSpeed={(next) => {
                  track('speed_set', { speed: next, via: 'transport' })
                  setSpeed(next)
                }}
                cameraMode={cameraMode}
                onCameraMode={changeCamera}
                showDimensions={showDimensions}
                onShowDimensions={toggleDimensions}
                showAngles={showAngles}
                onShowAngles={toggleAngles}
                showGrid={showGrid}
                onShowGrid={toggleGrid}
                notes={notes}
                onNotes={toggleNotes}
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
                  track('ghost_recalled', {})
                  setParams({ ...s.params })
                  setPresetId(null)
                }}
                onDrop={(id) => {
                  track('ghost_dropped', {})
                  setSaved((prev) => prev.filter((s) => s.id !== id))
                }}
              />
            </aside>
          </div>
        </div>
      </PointAtContext>
    </NotesContext>
  )
}
