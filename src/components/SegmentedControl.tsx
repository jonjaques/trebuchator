import { useRef } from 'react'
import { cn } from '@/lib/utils.ts'

/**
 * One choice from a short, fixed list.
 *
 * This exists because there were five hand-rolled copies of it — machine type,
 * units, sweep mode, playback speed — each a `role="radiogroup"` of buttons that
 * every one of them was a tab stop and none of them answered an arrow key. A
 * radiogroup that behaves like a row of buttons is a radiogroup a screen-reader
 * user is told to arrow through and then cannot. The keyboard contract lives
 * here now, once: one tab stop for the group, arrows and Home/End inside it.
 *
 * Two shapes, because the sheet genuinely uses two. `joined` is a single
 * hairline-bordered strip with no gaps — the segmented control proper. `boxed`
 * is separate cells the caller lays out in a grid, for when the options need
 * room to be read rather than scanned.
 */

export interface SegmentedOption<T extends string | number> {
  value: T
  label: React.ReactNode
  /** Shown on hover. The visible label still has to name the choice on its own. */
  title?: string
}

interface Props<T extends string | number> {
  /** Names the group for assistive tech. Not rendered. */
  label: string
  value: T
  onChange: (value: T) => void
  options: SegmentedOption<T>[]
  variant?: 'joined' | 'boxed'
  /** Goes on the group. `boxed` needs its grid here. */
  className?: string
  /** Goes on every cell. For the one caller whose figures are mono. */
  cellClassName?: string
}

const WRAP: Record<'joined' | 'boxed', string> = {
  joined: 'flex shrink-0 overflow-hidden rounded-sm border border-rule',
  boxed: 'grid gap-1',
}

const CELL: Record<'joined' | 'boxed', string> = {
  joined: 'label px-2 py-1.5 transition-colors',
  boxed: 'label rounded-sm border px-1 py-2 transition-colors',
}

const ON: Record<'joined' | 'boxed', string> = {
  joined: 'bg-verdigris/12 text-verdigris',
  boxed: 'border-verdigris bg-verdigris/10 text-verdigris',
}

const OFF: Record<'joined' | 'boxed', string> = {
  joined: 'text-ink-3 hover:text-ink-2',
  boxed: 'border-rule text-ink-3 hover:border-ink-3 hover:text-ink-2',
}

export function SegmentedControl<T extends string | number>({
  label,
  value,
  onChange,
  options,
  variant = 'joined',
  className,
  cellClassName,
}: Props<T>) {
  const cells = useRef<(HTMLButtonElement | null)[]>([])
  const selected = options.findIndex((o) => o.value === value)
  // A radiogroup holds exactly one tab stop. When the value is not on the list —
  // the speed box takes any number a reader types — that would be no stop at
  // all and the group would fall out of the tab order, so the first cell keeps
  // it instead.
  const tabStop = selected < 0 ? 0 : selected

  const goTo = (index: number) => {
    const i = (index + options.length) % options.length
    onChange(options[i].value)
    cells.current[i]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(WRAP[variant], className)}
      onKeyDown={(e) => {
        const from = tabStop
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goTo(from + 1)
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') goTo(from - 1)
        else if (e.key === 'Home') goTo(0)
        else if (e.key === 'End') goTo(options.length - 1)
        else return
        e.preventDefault()
      }}
    >
      {options.map((o, i) => {
        const on = i === selected
        return (
          <button
            key={o.value}
            ref={(el) => {
              cells.current[i] = el
            }}
            role="radio"
            aria-checked={on}
            tabIndex={i === tabStop ? 0 : -1}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(CELL[variant], on ? ON[variant] : OFF[variant], cellClassName)}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
