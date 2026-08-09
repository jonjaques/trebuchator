// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Field } from './Field.tsx'
import type { Dimension, UnitSystem } from '@/lib/format.ts'

afterEach(cleanup)

/** Wrapper that owns the SI value, the way the design rail does. */
function Harness({
  initial,
  dim = 'mass',
  units = 'metric',
  min = 0.5,
  max = 30000,
  onValue,
}: {
  initial: number
  dim?: Dimension
  units?: UnitSystem
  min?: number
  max?: number
  onValue?: (v: number) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <Field
      label="Mass"
      value={value}
      onChange={(v) => {
        setValue(v)
        onValue?.(v)
      }}
      min={min}
      max={max}
      dim={dim}
      units={units}
    />
  )
}

const box = () => screen.getByRole('textbox') as HTMLInputElement

describe('Field', () => {
  it('shows a round value without eating its zeros', () => {
    // Regression: trailing-zero trimming used to run on integers, so a 60 kg
    // counterweight rendered as "6" and quietly understated the machine by 10x.
    render(<Harness initial={60} />)
    expect(box().value).toBe('60')
  })

  it('keeps small values readable on a wide-range field', () => {
    render(<Harness initial={0.15} min={0} max={60} />)
    expect(box().value).toBe('0.15')
  })

  it('holds a half-typed number instead of reformatting mid-keystroke', async () => {
    const user = userEvent.setup()
    render(<Harness initial={60} />)
    await user.clear(box())
    await user.type(box(), '0.')
    expect(box().value).toBe('0.')
  })

  it('commits typed values in SI regardless of the display units', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<Harness initial={60} units="imperial" onValue={onValue} />)
    // 60 kg shows as 132.28 lb.
    expect(Number.parseFloat(box().value)).toBeCloseTo(132.28, 1)
    await user.clear(box())
    await user.type(box(), '220.46{Enter}')
    expect(onValue).toHaveBeenCalled()
    expect(onValue.mock.calls.at(-1)![0]).toBeCloseTo(100, 2)
  })

  it('clamps typed values into range rather than accepting nonsense', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<Harness initial={60} min={0.5} max={1000} onValue={onValue} />)
    await user.clear(box())
    await user.type(box(), '999999{Enter}')
    expect(onValue.mock.calls.at(-1)![0]).toBe(1000)
  })

  it('abandons the draft on Escape', async () => {
    const user = userEvent.setup()
    render(<Harness initial={60} />)
    await user.clear(box())
    await user.type(box(), '123{Escape}')
    expect(box().value).toBe('60')
  })

  it('gives the slider a log response over a wide range so it is usable at both ends', () => {
    render(<Harness initial={60} min={0.5} max={30000} />)
    const slider = screen.getByRole('slider')
    // 60 sits at log-position 0.43 of [0.5, 30000] but only 0.002 of it
    // linearly — a linear slider would move in 150 kg steps here.
    expect(Number(slider.getAttribute('aria-valuenow'))).toBeGreaterThan(0.3)
    expect(Number(slider.getAttribute('aria-valuenow'))).toBeLessThan(0.6)
    expect(slider.getAttribute('aria-valuetext')).toBe('60 kg')
  })

  it('uses a linear slider for a narrow range', () => {
    render(<Harness initial={0.5} dim="none" min={0} max={1} />)
    const slider = screen.getByRole('slider')
    expect(Number(slider.getAttribute('aria-valuenow'))).toBeCloseTo(0.5, 2)
  })

  it('labels the control for screen readers', () => {
    render(<Harness initial={60} />)
    expect(screen.getByRole('slider')).toHaveProperty('ariaLabel', 'Mass')
    expect(screen.getByLabelText('Mass', { selector: 'input' })).toBeTruthy()
  })
})
