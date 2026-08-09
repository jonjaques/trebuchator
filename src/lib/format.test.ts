import { describe, expect, it } from 'vitest'
import { fromDisplay, num, scaled, toDisplay, unitSymbol } from './format.ts'

describe('unit conversion', () => {
  it('round-trips every dimension through both systems', () => {
    const dims = ['length', 'mass', 'speed', 'energy', 'force', 'moment', 'density'] as const
    for (const dim of dims) {
      for (const system of ['metric', 'imperial'] as const) {
        for (const v of [0.001, 1, 47.5, 12000]) {
          expect(fromDisplay(toDisplay(v, dim, system), dim, system), `${dim}/${system}`).toBeCloseTo(
            v,
            9,
          )
        }
      }
    }
  })

  it('leaves SI values untouched in metric', () => {
    expect(toDisplay(9.81, 'length', 'metric')).toBe(9.81)
    expect(fromDisplay(9.81, 'mass', 'metric')).toBe(9.81)
  })

  it('converts to the customary units builders actually use', () => {
    expect(toDisplay(1, 'length', 'imperial')).toBeCloseTo(3.2808, 3)
    expect(toDisplay(1, 'mass', 'imperial')).toBeCloseTo(2.2046, 3)
    expect(toDisplay(1, 'speed', 'imperial')).toBeCloseTo(2.2369, 3)
    expect(unitSymbol('moment', 'imperial')).toBe('lbf·ft')
  })
})

describe('number formatting', () => {
  it('never turns a round number into a smaller one', () => {
    // Guards the bug where trailing-zero trimming ran on integers and rendered
    // a 60 kg counterweight as "6". The property that matters is that the text
    // parses back to the number it came from.
    for (const v of [6, 60, 600, 1200, 12000, 0.5, 0.05]) {
      expect(Number.parseFloat(num(v).replace(/,/g, '')), `num(${v})`).toBe(v)
    }
  })

  it('keeps precision where it matters and drops it where it does not', () => {
    expect(num(0.15)).toBe('0.150')
    expect(num(2.4)).toBe('2.40')
    expect(num(70.68)).toBe('70.68')
    expect(num(544.1)).toBe('544.1')
    expect(num(12000)).toBe('12,000')
  })

  it('never emits floating-point noise', () => {
    expect(num(0.1 + 0.2)).not.toContain('0000')
  })

  it('adds a magnitude prefix to large forces and energies', () => {
    expect(scaled(412000, 'force', 'metric')).toEqual({ text: '412.00', unit: 'kN' })
    expect(scaled(1.5e6, 'energy', 'metric').unit).toBe('MJ')
    expect(scaled(250, 'force', 'metric').unit).toBe('N')
  })
})
