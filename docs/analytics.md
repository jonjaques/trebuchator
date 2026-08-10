# Measurement

Trebuchator sends usage events to a Google Analytics 4 property (`G-9868T5M25F`)
so that changes to the product can be argued from what people do rather than from
what we imagine they do. This file is the catalogue: what is collected, what is
deliberately not, and what has to be registered in GA before any of it appears in
a report.

## Where it lives

| | |
|---|---|
| `index.html` | The tag, and the one rule about *whether* to measure |
| `src/lib/analytics.ts` | The sink. Typed event table, coalescing, no React |
| `src/lib/useAnalytics.ts` | The React wiring — visit shape and settled parameter edits |
| everywhere else | `track(...)` at the handler that knows the intent |

Nothing above `analytics.ts` knows that Google Analytics is on the other end.
That is the same seam `simulator.ts` draws around the solver worker, for the same
reason: the call sites are spread through every component, so a vendor that leaks
past them is a vendor nobody can ever change.

**The table is the interface.** An event is one entry in the `Events` interface
and its parameters are that entry's type, so naming an event that does not exist
— or passing a parameter that does not belong to it — is a build failure.
Untyped analytics fails the other way round: the call compiles, the row never
appears, and nobody notices for a month.

## What is never sent

- **Anything a person typed.** Machine names, material names, free text of any
  kind. What goes out is their *shape*: `name_len` rather than the name,
  `kind` rather than the material, `custom: true` rather than what it was called.
- **Saved-machine ids.** They name a row in one browser's `localStorage` and
  nothing on anyone else's, so a saved machine is reported as `machine: 'saved'`.
- **Anything from the address bar** beyond whether a `?m=` preset link was
  followed.

The one string that travels as itself is a preset id, which is a value from a
list in this repository.

## Volume

A slider drag is sixty parameter changes a second and a solved shot chases every
one of them. Three mechanisms keep that from being the entire property:

| | |
|---|---|
| `settled(key, ms, …)` | Trailing edge. The value the reader *stopped* on |
| `throttle(key, ms, …)` | Leading edge. The first of a gesture burst |
| `once(key, …)` | Once per visit. For facts, not for acts |

`param_changed`, `shot_solved`, `machine_rejected` and `shot_warning` are
coalesced at 900 ms. Chart hovers and sheet gestures are throttled at 4–5 s.
Everything else is a discrete act and is sent as it happens.

## The events

### Lifecycle

| Event | Parameters | The question it answers |
|---|---|---|
| `app_ready` | `preset` `machine_type` `units` `theme` `notes` `from_link` `viewport` `reduced_motion` | What does a session start as? Is anyone arriving on a shared link? |
| `visit_summary` | `seconds` `shots` `edits` `sweeps` `searches` `machines` `best_range` `preset` `machine_type` | How deep does a visit go? Fired on the tab going hidden, throttled to once a minute, counters cumulative |
| `solver_failed` | `where` `reason` | The solver itself threw. Distinct from a machine that will not throw |

### The machine

| Event | Parameters | |
|---|---|---|
| `machine_loaded` | `machine` `era` `source` | Which presets get opened, and whether the library is used |
| `machine_type_set` | `machine_type` `from` | Do people compare topologies, or stay on the one they arrived at? |
| `param_changed` | `param` `value` `value_text` `machine_type` `edits` | Which dimensions get worked, and to what. `edits` is how many changes coalesced into this one row |
| `param_input` | `field` `control` | Slider or number box. If nobody types, the ranges are what to spend effort on |
| `machine_saved` | `name_len` `count` | |
| `machine_deleted` | `count` | |
| `link_copied` | `machine` `ok` | The clipboard is refused often enough that "copied" and "pressed" are different numbers |

### What came out of it

| Event | Parameters | |
|---|---|---|
| `shot_solved` | `machine_type` `preset` `range_m` `range_band` `efficiency_pct` `release_speed` `axle_load_kn` `flight_s` | The outcome distribution. One row per settled machine |
| `machine_rejected` | `machine_type` `reason` | Which impossible geometries people actually build, in their own words from the solver |
| `shot_warning` | `warning` | |
| `boulder_thrown` | `range_m` `reduced_motion` | How many readers ever find the easter egg |

### Tools

| Event | Parameters | |
|---|---|---|
| `pin_tuned` | `angle` `machine_type` | |
| `frontier_searched` | `goal` `count` `seconds` | A `count` of zero is the panel saying "no feasible builds" — the measure of whether the search ranges are set right |
| `frontier_previewed` | `goal` | Throttled. Is the frontier read, or only opened? |
| `frontier_applied` | `goal` `gain_pct` `axle_load_kn` | `gain_pct` is against candidate zero, at the same step size |
| `sweep_run` | `param` `mode` `count` `seconds` | The longest wait in the app, timed on real machines |
| `sweep_key_set` | `param` | |
| `sweep_mode_set` | `mode` | Is *best case* understood well enough to be switched to? |
| `sweep_previewed` | `param` `mode` | Throttled |
| `sweep_adopted` | `param` `mode` `via` `gain_pct` | `via` is `chart` or `button` |
| `sweep_blocked` | `param` `mode` | The pairs with no honest reading, and how often anyone asks for one |

### Looking at it

| Event | Parameters | |
|---|---|---|
| `playback` | `action` `via` | `play` `pause` `replay` `seek`; `via` is `button`, `key` or `scrubber` — which is how the keyboard shortcuts justify their row in the view panel |
| `speed_set` | `speed` `via` | |
| `camera_set` | `mode` `via` | |
| `annotation_set` | `annotation` `on` `via` | `dimensions` `angles` `grid` `notes` |
| `sheet_gesture` | `gesture` | `pan` `zoom` `pinch`, throttled. Does anyone explore the drawing? |
| `panel_toggled` | `panel` `on` | Below `xl`, where the rails are drawers |
| `sweep_panel_set` | `on` | |
| `section_toggled` | `section` `on` | Which sections of the rails get folded away |
| `explain_opened` | `topic` | The teaching layer. The only measure of whether the product's second job lands |

### The library and settings

`material_picked` (`kind` `custom`), `material_added` (`kind`),
`material_deleted` (`kind`), `ghost_saved` (`count`), `ghost_recalled`,
`ghost_dropped`, `units_set` (`units`), `theme_set` (`theme`).

### User properties

`units`, `theme`, `viewport`, `notes` — re-set whenever they change, so a reader
who switches to imperial in their first minute counts as an imperial reader for
the rest of the visit. These qualify *every* event, which is how "do imperial
readers get shorter sessions" is answerable at all.

## Registering the custom dimensions

**A custom parameter is collected but does not appear in any GA report until it
is registered, and registration is not retroactive.** Admin → Data display →
Custom definitions. A property has 50 event-scoped dimension slots and 50 metric
slots for its lifetime, which is why the parameter names above are reused across
events rather than being spelled differently on each one.

Register as **dimensions** (event-scoped, parameter name identical to the
column): `machine_type`, `preset`, `machine`, `era`, `source`, `param`,
`value_text`, `range_band`, `goal`, `mode`, `action`, `via`, `annotation`,
`gesture`, `panel`, `section`, `topic`, `field`, `control`, `kind`, `warning`,
`reason`, `where`, `viewport`, `theme`, `units`, `from`, `on`, `ok`, `custom`,
`notes`, `reduced_motion`, `from_link`.

Register as **metrics**: `range_m`, `efficiency_pct`, `release_speed`,
`axle_load_kn`, `flight_s`, `value`, `edits`, `count`, `seconds`, `gain_pct`,
`angle`, `speed`, `name_len`, `shots`, `sweeps`, `searches`, `machines`,
`best_range`.

Register as **user properties**: `units`, `theme`, `viewport`, `notes`.

## Working on it

Development sends nothing. Dev traffic in the production property would be
indistinguishable from a real reader's after the fact, so the tag is only loaded
on a page served over **HTTPS** from a **non-loopback host** — two conditions
because either alone has a hole. The hostname test alone misses `vite --host`,
which serves the dev build on a LAN address so a phone can reach it; the scheme
test alone would quietly start measuring if a dev server were ever given a
certificate. `.localhost` and `.local` are matched as suffixes (`app.localhost`
resolves to loopback per RFC 6761; `.local` is what mDNS hands out).

Where the tag is not loaded, `analytics.ts` logs to the console instead:

```
[analytics] shot_solved {machine_type: 'hinged', preset: 'backyard', range_m: 70.6, …}
```

Filter the console on `[analytics]` while working a control, and what you see is
exactly what production would send.

Any *deployed* host does measure, including a Cloudflare preview deployment —
those are separable afterwards by GA's own Hostname dimension, whereas hardcoding
the production domain into the guard would go silently dead the day it changes
and nothing would tell you.

GA4's limits are load-bearing on the shape of all this: event and parameter names
are capped at 40 characters, a parameter value at 100, and an event carries at
most 25 of them. `clean()` enforces the value cap and drops non-finite numbers
(a `NaN` range is a real outcome of a broken machine, and GA stores it as null,
which poisons every average taken over the column). `src/lib/analytics.test.ts`
covers all of that through the interface the app actually calls.

## Adding an event

1. Add the entry to `Events` in `src/lib/analytics.ts`. Reuse existing parameter
   names wherever the meaning is the same.
2. Call `track` — or `settled`/`throttle`/`once` if it can fire in a burst — from
   the handler that knows *why* it happened, not from an effect watching the
   state it changed.
3. Add the row to the tables above.
4. Register any new parameter in GA, or the column will never appear.
