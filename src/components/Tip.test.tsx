// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Tip } from './Tip.tsx'

describe('Tip', () => {
  afterEach(cleanup)

  // Radix throws without a `TooltipProvider`, so a `Tip` that expected one from
  // the root would take down any test that rendered a labelled control — which
  // is most of them. It carries its own; this is the assertion that says so.
  it('renders without a provider around it', () => {
    render(
      <Tip text="what this does">
        <button>Fire</button>
      </Tip>,
    )
    expect(screen.getByRole('button', { name: 'Fire' })).toBeTruthy()
  })

  // Callers wrap unconditionally and pass `undefined` when the notes layer is
  // already printing the same sentence. Nothing may be added to the tree then —
  // not a wrapper, and not a second copy of the text.
  it('is transparent with no text', () => {
    render(
      <Tip>
        <button>Fire</button>
      </Tip>,
    )
    const button = screen.getByRole('button', { name: 'Fire' })
    expect(button.getAttribute('data-slot')).toBe(null)
  })

  it('describes rather than renames the control it wraps', () => {
    render(
      <Tip text="what this does">
        <button aria-label="Fire again">
          <span aria-hidden>↺</span>
        </button>
      </Tip>,
    )
    expect(screen.getByRole('button', { name: 'Fire again' })).toBeTruthy()
  })
})
