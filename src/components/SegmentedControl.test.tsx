// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SegmentedControl } from './SegmentedControl.tsx'

afterEach(cleanup)

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo' },
  { value: 'c', label: 'Charlie' },
]

function Harness({ initial = 'a' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <button>before</button>
      <SegmentedControl label="Letters" value={value} onChange={setValue} options={OPTIONS} />
      <button>after</button>
    </>
  )
}

const cells = () => screen.getAllByRole('radio')
const checked = () => cells().find((c) => c.getAttribute('aria-checked') === 'true')

describe('SegmentedControl', () => {
  it('spends one tab stop on the whole group, not one per option', async () => {
    // This is the contract that makes `role="radiogroup"` honest. Three of these
    // on a phone used to cost eleven tab stops to walk past.
    const user = userEvent.setup()
    render(<Harness />)
    await user.tab()
    expect(document.activeElement).toBe(screen.getByText('before'))
    await user.tab()
    expect(document.activeElement).toBe(cells()[0])
    await user.tab()
    expect(document.activeElement).toBe(screen.getByText('after'))
  })

  it('moves the selection with the arrow keys and takes focus along', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    cells()[0].focus()
    await user.keyboard('{ArrowRight}')
    expect(checked()).toHaveProperty('textContent', 'Bravo')
    expect(document.activeElement).toBe(cells()[1])
    await user.keyboard('{ArrowDown}')
    expect(checked()).toHaveProperty('textContent', 'Charlie')
  })

  it('wraps at both ends', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    cells()[0].focus()
    await user.keyboard('{ArrowLeft}')
    expect(checked()).toHaveProperty('textContent', 'Charlie')
    await user.keyboard('{ArrowRight}')
    expect(checked()).toHaveProperty('textContent', 'Alpha')
  })

  it('answers Home and End', async () => {
    const user = userEvent.setup()
    render(<Harness initial="b" />)
    cells()[1].focus()
    await user.keyboard('{End}')
    expect(checked()).toHaveProperty('textContent', 'Charlie')
    await user.keyboard('{Home}')
    expect(checked()).toHaveProperty('textContent', 'Alpha')
  })

  it('keeps a tab stop when the value is on none of the cells', async () => {
    // The playback speed box takes any number, so no chip is lit — and a group
    // where every cell is tabIndex -1 drops out of the tab order entirely.
    const user = userEvent.setup()
    render(<Harness initial="off-list" />)
    expect(cells().some((c) => c.getAttribute('aria-checked') === 'true')).toBe(false)
    await user.tab()
    await user.tab()
    expect(document.activeElement).toBe(cells()[0])
  })
})
