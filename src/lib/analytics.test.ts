// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The sink, tested through the interface the app actually calls.
 *
 * `ON` is read once at module scope — that is what makes a dev server's traffic
 * impossible to leak into the production property by accident — so every test
 * loads a fresh copy of the module with the flag already set. `vi.resetModules`
 * is doing real work here: the dedupe and throttle state is module-level, and a
 * shared instance would make each test depend on the ones before it.
 */
async function load() {
  vi.resetModules()
  window.__trebAnalytics = true
  const sent: { name: string; params: Record<string, unknown> }[] = []
  const properties: Record<string, unknown>[] = []
  window.gtag = (...args: unknown[]) => {
    if (args[0] === 'event') sent.push({ name: args[1] as string, params: args[2] as never })
    if (args[0] === 'set') properties.push(args[2] as never)
  }
  return { ...(await import('./analytics.ts')), sent, properties }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('track', () => {
  it('sends the event name and its parameters', async () => {
    const { track, sent } = await load()
    track('units_set', { units: 'metric' })
    expect(sent).toEqual([{ name: 'units_set', params: { units: 'metric' } }])
  })

  it('rounds numbers and drops the ones GA cannot hold', async () => {
    const { track, sent } = await load()
    track('shot_solved', {
      machine_type: 'hinged',
      preset: 'backyard',
      range_m: 42.123456789,
      range_band: '25–50m',
      efficiency_pct: 61.5,
      release_speed: 30,
      axle_load_kn: 12,
      // A machine that will not throw really does produce this, and GA stores it
      // as null — which then poisons every average taken over the column.
      flight_s: NaN,
    })
    expect(sent[0].params.range_m).toBe(42.1235)
    expect(sent[0].params).not.toHaveProperty('flight_s')
  })

  it('clips a value to the 100 characters GA keeps', async () => {
    const { track, sent } = await load()
    track('shot_warning', { warning: 'x'.repeat(400) })
    expect((sent[0].params.warning as string).length).toBe(100)
  })

  it('drops an absent parameter rather than sending it as null', async () => {
    const { track, sent } = await load()
    track('param_changed', {
      param: 'releaseMode',
      value_text: 'optimal',
      machine_type: 'hinged',
      edits: 1,
    })
    expect(sent[0].params).not.toHaveProperty('value')
    expect(sent[0].params.value_text).toBe('optimal')
  })

  it('survives a tag that throws', async () => {
    const { track } = await load()
    // What a tracking-protection extension leaves behind. A handler that was in
    // the middle of doing something the reader asked for must not die of it.
    window.gtag = () => {
      throw new Error('blocked')
    }
    expect(() => track('theme_set', { theme: 'dark' })).not.toThrow()
  })

  it('counts what it has sent, for the visit summary', async () => {
    const { track, tally } = await load()
    track('ghost_recalled', {})
    track('ghost_recalled', {})
    expect(tally().ghost_recalled).toBe(2)
  })
})

describe('once', () => {
  it('sends the first and swallows the rest', async () => {
    const { once, sent } = await load()
    once('boulder', 'boulder_thrown', { range_m: 80, reduced_motion: false })
    once('boulder', 'boulder_thrown', { range_m: 90, reduced_motion: false })
    expect(sent).toHaveLength(1)
    expect(sent[0].params.range_m).toBe(80)
  })
})

describe('throttle', () => {
  it('sends the leading edge and drops the burst behind it', async () => {
    vi.useFakeTimers()
    const { throttle, sent } = await load()
    for (let i = 0; i < 50; i++) throttle('pan', 4000, 'sheet_gesture', { gesture: 'pan' })
    expect(sent).toHaveLength(1)
    vi.advanceTimersByTime(4001)
    throttle('pan', 4000, 'sheet_gesture', { gesture: 'pan' })
    expect(sent).toHaveLength(2)
  })

  it('keeps separate keys apart', async () => {
    const { throttle, sent } = await load()
    throttle('pan', 4000, 'sheet_gesture', { gesture: 'pan' })
    throttle('zoom', 4000, 'sheet_gesture', { gesture: 'zoom' })
    expect(sent.map((e) => e.params.gesture)).toEqual(['pan', 'zoom'])
  })
})

describe('settled', () => {
  it('sends once, after the quiet, with what the value settled on', async () => {
    vi.useFakeTimers()
    const { settled, sent } = await load()
    // A slider drag: the interesting number is the one it stopped on, and every
    // value before it is a frame nobody looked at.
    for (const armLong of [2.4, 3.1, 4.0, 5.2]) {
      settled('param:armLong', 900, 'param_changed', () => ({
        param: 'armLong',
        value: armLong,
        machine_type: 'hinged',
        edits: 1,
      }))
      vi.advanceTimersByTime(100)
    }
    expect(sent).toHaveLength(0)
    vi.advanceTimersByTime(900)
    expect(sent).toHaveLength(1)
    expect(sent[0].params.value).toBe(5.2)
  })

  it('sends nothing when the thunk declines', async () => {
    vi.useFakeTimers()
    const { settled, sent } = await load()
    settled('shot', 900, 'shot_warning', () => null)
    vi.advanceTimersByTime(1000)
    expect(sent).toHaveLength(0)
  })
})

describe('profile', () => {
  it('sets user properties rather than sending an event', async () => {
    const { profile, properties, sent } = await load()
    profile({ units: 'imperial', viewport: 'phone' })
    expect(properties).toEqual([{ units: 'imperial', viewport: 'phone' }])
    expect(sent).toHaveLength(0)
  })
})

describe('band', () => {
  it('names the range in bands a report can be read by', async () => {
    const { band } = await load()
    expect(band(3)).toBe('<5m')
    expect(band(5)).toBe('5–10m')
    expect(band(42)).toBe('25–50m')
    expect(band(1200)).toBe('800m+')
  })

  it('has a name for a machine that did not throw', async () => {
    const { band } = await load()
    expect(band(NaN)).toBe('none')
  })
})

describe('viewport', () => {
  it('reports the app’s own layout rather than a device guess', async () => {
    const { viewport } = await load()
    // The three layouts are genuinely different products — at `xl` both rails
    // are docked, below it they are drawers, below `sm` the transport is two
    // rows — and pooling their numbers would hide all three.
    for (const [width, name] of [
      [390, 'phone'],
      [820, 'tablet'],
      [1100, 'desktop'],
      [1600, 'wide'],
    ] as const) {
      window.innerWidth = width
      expect(viewport()).toBe(name)
    }
  })
})

describe('the loopback guard', () => {
  it('sends nothing when the tag was never loaded', async () => {
    vi.resetModules()
    // What `index.html` leaves behind on localhost: a `gtag` stub queueing into
    // `dataLayer`, no library, and no flag.
    window.__trebAnalytics = undefined
    const sent: unknown[] = []
    window.gtag = (...args: unknown[]) => sent.push(args)
    const { track } = await import('./analytics.ts')
    track('units_set', { units: 'metric' })
    expect(sent).toHaveLength(0)
  })
})
