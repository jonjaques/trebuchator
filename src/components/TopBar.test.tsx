// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TopBar } from './TopBar.tsx'

const noop = () => {}

/**
 * The source link, and specifically the rule that keeps it off a phone.
 *
 * `hidden sm:inline-flex` is doing load-bearing work that nothing else would
 * report if it were dropped: the identity row is full at 360px, so a link laid
 * out there does not clip, it wraps the settings cluster onto a second line and
 * takes a row of sheet with it. The classes have to survive tailwind-merge
 * against the button variants' own `inline-flex` and `size-8`, which is the part
 * that is easy to break by editing either end.
 */
test('the source link composes through both Radix slots and points at the repo', () => {
  render(
    <TopBar
      presetId={null}
      onPreset={noop}
      units="metric"
      onUnits={noop}
      dark
      onDark={noop}
      onSave={noop}
      canSave={false}
      machines={[]}
      onSaveMachine={noop}
      onLoadMachine={noop}
      onDeleteMachine={noop}
      onOptimize={noop}
      optimizing={false}
      pareto={null}
      goal="range"
      onGoal={noop}
      onApplyPareto={noop}
      onPreviewPareto={noop}
      busy={false}
      showDesign={false}
      showResults={false}
      onToggleDesign={noop}
      onToggleResults={noop}
    />,
  )

  const links = screen.getAllByRole('link', { name: /source on GitHub/i })
  expect(links).toHaveLength(2) // the mobile cluster's copy and the desktop one
  for (const link of links) {
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('https://github.com/jonjaques/trebuchator')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noreferrer')
    // The Tip's own slot wins the attribute, as it does on every other tipped
    // button in this bar — and `[data-slot]:focus-visible` in index.css is
    // generic, so the verdigris outline still lands.
    expect(link.getAttribute('data-slot')).toBe('tooltip-trigger')
    // Hidden below `sm`, restored above it — the whole point of the placement.
    // The bare `inline-flex` and `size-8` off the button variants must have lost
    // to these, or the link would be laid out on a phone after all.
    const classes = [...link.classList]
    expect(classes).toContain('hidden')
    expect(classes).toContain('sm:inline-flex')
    expect(classes).toContain('size-7')
    expect(classes).toContain('lg:size-8')
    expect(classes).not.toContain('inline-flex')
    expect(classes).not.toContain('size-8')
  }
})
