---
name: Trebuchator
description: A counterweight trebuchet calculator dressed as a setting-out drawing.
colors:
  ground: "#14110e"
  sheet: "#1c1815"
  raised: "#25201b"
  ink: "#ede7da"
  ink-2: "#a79c8b"
  ink-3: "#7a7161"
  rule: "#372f27"
  quench: "#ff6b2c"
  verdigris: "#3fd0bc"
  warn: "#d9b44a"
  bad: "#f0705f"
  oak: "#a97b4f"
  iron: "#99a0a6"
  ramp-1: "#cfc6b4"
  ramp-2: "#9a9080"
  ramp-3: "#6a6154"
typography:
  display:
    fontFamily: "Geist Mono Variable, ui-monospace, monospace"
    fontSize: "2.6rem"
    fontWeight: 500
    lineHeight: 1
    fontFeature: "tnum 1, zero 1"
  headline:
    fontFamily: "Geist Mono Variable, ui-monospace, monospace"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1
    fontFeature: "tnum 1, zero 1"
  title:
    fontFamily: "Instrument Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "0.1em"
  body:
    fontFamily: "Instrument Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.375
    letterSpacing: "normal"
  label:
    fontFamily: "Instrument Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.71rem"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "0.005em"
  micro:
    fontFamily: "Instrument Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.65rem"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "0.01em"
  numeric:
    fontFamily: "Geist Mono Variable, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.25
    fontFeature: "tnum 1, zero 1"
rounded:
  sm: "1px"
  md: "2px"
  lg: "2px"
  xl: "3px"
  3xl: "4px"
spacing:
  hair: "2px"
  tight: "4px"
  control: "6px"
  gutter: "12px"
  panel: "16px"
components:
  button-default:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    height: "28px"
    padding: "0 10px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-3}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    height: "28px"
    padding: "0 10px"
  field-box:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    typography: "{typography.numeric}"
    rounded: "{rounded.sm}"
    padding: "4px 6px"
    width: "86px"
  slider-thumb:
    backgroundColor: "transparent"
    textColor: "{colors.quench}"
    rounded: "0"
    width: "7px"
    height: "14px"
  icon-toggle:
    backgroundColor: "transparent"
    textColor: "{colors.ink-3}"
    rounded: "{rounded.sm}"
    size: "28px"
  icon-toggle-on:
    backgroundColor: "transparent"
    textColor: "{colors.verdigris}"
    rounded: "{rounded.sm}"
    size: "28px"
  section-head:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    padding: "12px 12px 4px"
---

# Design System: Trebuchator

## Overview

**Creative North Star: "The Setting-Out Floor"**

A setting-out floor is the full-size layout a master carpenter chalks onto the shop floor
before cutting a single timber. Every line is at true scale, every dimension is one you
can hold a tape against, and nothing is on the floor that you would not build from. That
is the whole brief for this interface. The range is not a statistic in a card — it is the
dimension line across the bottom of the sheet, drawn with witness lines, arrowheads and
the figure set into a gap in the rule, exactly as a draughtsman would carry it.

The register is exact, quiet and worked. Nothing raises its voice; precision is the entire
personality, and the design earns attention by being correct rather than by being loud.
It is also warm, aged and material — vellum and charred oak, hot iron and bronze patina.
The palette is never neutral grey, because the thing being drawn is timber and metal and
the ground it stands on should know that. Light mode is a diazo whiteprint: warm vellum
with dark ink. Dark mode, which is the default, is chalk on charred oak.

Two things it must never be mistaken for. **Not a dashboard** — no rounded cards, no drop
shadows, no KPI tiles; readings sit on ruled rows on a sheet, not in boxes. **Not
siege-engine kitsch** — no blackletter, no parchment texture, no stone or fire. The
medieval subject is treated as engineering, never as atmosphere. (The palette's own
origin decision, recorded in `index.css`, is related: the diazo whiteprint over the cyan
blueprint, which is an older process and a tireder look.)

**Key Characteristics:**

- Hairline rules and tonal layering do all the separating; there is effectively no shadow.
- Corners are 1–4px — square enough to read as drafted, radiused only enough to look deliberate.
- Sans names things, mono measures them, and the two never swap jobs.
- Exactly four signal hues, each with one job, on a warm ink-on-material ground.
- Full-viewport, no page scroll: the sheet is a surface, not a document.

## Colors

Warm and material throughout — every neutral carries a trace of brown or ochre, and the
two accents are named for what happens to metal. The frontmatter carries the dark values,
which are the default face of the product; each token has a light counterpart listed
beside it here.

### Primary

- **Quench** (dark `#ff6b2c` · light `#b8420c`): hot iron coming out of the slack tub. It
  belongs to the projectile and nothing else — the shot on the sheet, its trajectory, its
  whip inside the machine, the range figure, the slider cursor's centre line, and the
  payoff band of the energy budget. It is the only colour in the system allowed to mean
  "this is the thing you are throwing".

### Secondary

- **Verdigris** (dark `#3fd0bc` · light `#0d7c70`): bronze patina. It belongs to
  measurement — dimension lines, witness lines, protractors, graduations, the tick before
  every section head, focus rings, and the selected state of a segmented control. When
  verdigris appears, something is being measured or something is being aimed at.

The pair was validated with a colour-vision-deficiency checker against both surfaces
(deutan ΔE 16.1 dark, 12.9 light, contrast ≥ 3:1 on both). An earlier, softer teal failed
at ΔE 5.8 and was confusable with the neutral ink. Any change to either accent re-runs
that check.

### Tertiary

Status only. These are not expressive accents and never carry meaning outside a warning
or an error.

- **Warn** (dark `#d9b44a` · light `#8a6a00`): the solver has a reservation about this
  machine — the weight box grounds, the sling goes slack, the launch angle is far from
  optimal.
- **Bad** (dark `#f0705f` · light `#a32a1e`): this machine will not throw, or an action
  destroys something.

### Neutral

- **Ground** (dark `#14110e` · light `#e9e3d5`): the surface everything sits on. Warm
  near-black in dark, never `#0a0a0a`.
- **Sheet** (dark `#1c1815` · light `#f4f0e6`): the drawing surface and the rails.
- **Raised** (dark `#25201b` · light `#fbf8f1`): popovers and the one step up from sheet.
- **Ink** (dark `#ede7da` · light `#241f1a`): primary text and the heaviest drawn line.
- **Ink-2** (dark `#a79c8b` · light `#5b5347`): labels, secondary text, the sling.
- **Ink-3** (dark `#7a7161` · light `#8b8171`): units, hints, ground hatching, axis figures.
- **Rule** (dark `#372f27` · light `#c9c0ae`): every 1px separator, border and grid line.
- **Ramp 1 / 2 / 3** (dark `#cfc6b4` / `#9a9080` / `#6a6154`): a lightness ramp, not three
  hues, used for the graded overheads in the energy budget. They encode magnitude of
  loss, not identity, so they must stay a ramp.
- **Material — canvas only. Oak** (dark `#a97b4f` · light `#8a6440`) draws timber; **Iron**
  (dark `#99a0a6` · light `#6e7378`) draws hardware, rails and the counterweight hatching.

### Named Rules

**The Four Hues Rule.** Quench, verdigris, warn and bad are the complete signal palette
and it is closed. A fifth is never introduced, whatever the role seems to need. If
something requires distinguishing, the answer is a label, a weight, or a position — not
another colour.

**The One Job Rule.** Quench is the shot. Verdigris is measurement. Neither is ever
borrowed for emphasis, branding, hover states, or decoration, and they never appear
together on the same element.

**The Depiction Rule.** Oak and iron are not interface colours. They exist to draw timber
and metal on the canvas and in the wordmark, and they must never appear in a control, a
label, a border or a panel.

**The Two-Surface Rule.** Every colour exists in both `:root` and `.dark`, and a new one
is added to both in the same edit. The canvas reads its palette out of computed styles at
runtime and falls back to `#888` for a token it cannot find — so a half-added colour does
not error, it just quietly draws grey.

## Typography

**Display Font:** Geist Mono Variable (with `ui-monospace, monospace`)
**Body Font:** Instrument Sans Variable (with `ui-sans-serif, system-ui, sans-serif`)

**Character:** The contrast that carries the design is sans-for-names against
mono-for-numbers. Instrument Sans is neutral and unfussy at small sizes, which is what a
wall of parameter labels needs; Geist Mono gives every figure the same width so columns of
readings line up and a ticking number does not shuffle its neighbours. Drafting lettering
is *thin* — the type does not need help from letterforms, and an earlier pass that set
every label in condensed tracked capitals read as a wall rather than as a drawing.

### Hierarchy

- **Display** (mono, 500, 2.6rem / 41.6px, line-height 1, tabular): the range figure, and
  only the range figure. One per screen, set in quench.
- **Headline** (mono, 400, 1.5rem / 24px, line-height 1, tabular): the efficiency
  percentage. The second-largest number on the sheet and the only other one at this size.
- **Title** (sans, 500, 0.6875rem / 11px, 0.1em tracking, uppercase, line-height 1.15):
  `.stencil`. Section heads only — about eight on screen, not eighty.
- **Body** (sans, 400, 0.6875rem / 11px, line-height 1.375): explanatory notes, warnings,
  error text, the energy-bucket descriptions. Sentence case, always.
- **Label** (sans, 400, 0.71rem, 0.005em, line-height 1.25): `.label`. Field names, stat
  names, chips, captions — everything that names a thing. These appear in dozens and the
  reader is scanning them, not admiring them.
- **Micro** (sans, 400, 0.65rem, 0.01em, line-height 1.2): units, hints, secondary counts.
  Meta text that must recede.
- **Numeric** (mono, 400, 0.75rem, tabular): every value in a stat row, a field box, a
  chart axis or a legend.

### Named Rules

**The Sans-for-Names, Mono-for-Numbers Rule.** Instrument Sans names things; Geist Mono
measures them. A quantity never sets in the sans and a name never sets in the mono. This
one contrast carries the whole design and does not need reinforcing with weight or colour.

**The Tracked-Caps Rule.** Uppercase with 0.1em tracking survives only on `.stencil`,
where it is doing structural work — marking where one part of the sheet ends and the next
begins. Everything else is sentence case at 400. Do not reintroduce tracked capitals on
labels, buttons or chips.

**The Tabular Rule.** Any figure that can change sets `.tnum`
(`font-variant-numeric: tabular-nums`, `font-feature-settings: 'tnum' 1, 'zero' 1`). Every
number in this app is compared against another number and must never change width as it
ticks.

## Layout

**A full-viewport instrument, not a page.** The shell is `h-dvh` with
`overflow-hidden`; the document never scrolls and `overscroll-behavior: none` kills the
rubber band. Anything that overflows scrolls inside its own panel with `.thin-scroll` — a
thin scrollbar tinted to `rule`, because a heavy one breaks the sheet illusion.

**Five bands, top to bottom:** the top bar (identity, preset, actions, units, theme); the
body; the sensitivity drawer; and the transport. The body is three columns — the design
rail at `21rem`, the sheet taking the remaining width, and the readout rail at `20rem`.

**Rails dock at `xl` (1280px) and overlay below it.** Docked, a rail is a static column
separated by a 1px rule. Below `xl` it becomes an absolutely positioned overlay at
`z-20` with a shadow, and opening one closes the other — two overlapping full-height
panels on a phone is unusable. Three breakpoints are in play and each does one job:
`sm` (640px) splits the transport into two rows, `md` (768px) splits the top bar into two
rows, `xl` (1280px) docks the rails.

**Rhythm.** Sections are `12px` padded with a 1px bottom rule and no rule on the last.
Field rows are `6px` vertical. Control gaps are `8px`, tight groupings `4px`, and the
energy bands are separated by a `2px` hairline gap. The density is deliberate: rails are
packed with real readings, and the space between them is a ruled line rather than
whitespace.

### Named Rules

**The No-Page-Scroll Rule.** The viewport is the sheet. If content does not fit, a panel
scrolls inside its own bounds — the shell never does.

**The One Rail Rule.** Below `xl`, at most one rail is open. Opening the other closes it.

## Elevation & Depth

**This system is flat, with exactly one sanctioned exception.** Depth is carried by tonal
layering — `ground` behind everything, `sheet` for the drawing surface and the rails,
`raised` for popovers — and by 1px rules in `rule`. There is no ambient shadow vocabulary,
no elevation scale, and no surface that lifts on hover.

The one exception is a rail that has left the layout: below `xl` the design and readout
panels become overlays floating over the sheet, and they cast (`shadow-2xl`) for exactly
as long as they are not part of the column layout. At `xl` and above the shadow is removed
along with the overlay positioning.

One caveat, recorded honestly: the vendored shadcn popover ships `shadow-md` plus a
`ring-1`. That file is treated as generated — `shadcn add` overwrites it — so it is a
known deviation rather than a licence to add shadows elsewhere.

### Named Rules

**The Flat Sheet Rule.** Surfaces are flat and stay flat. Separation is a 1px rule or a
step in tone, never a shadow. A shadow appears only when an element has genuinely left the
layout and is floating over the sheet.

## Shapes

**Square, with the corners knocked off.** The radius scale runs `1px` / `2px` / `3px` /
`4px` and the default is `2px`. That is enough to stop a corner reading as an accident and
not nearly enough to read as soft. Nothing in this system is rounded for friendliness; a
pill is wrong here by definition, which is why the vendored slider was deleted rather than
restyled.

**Lines are hairlines.** Every separator, border, grid line, dimension line and slider
track is 1px, drawn in `rule` or an ink tone. The `.rule-t` / `.rule-b` / `.rule-l` /
`.rule-r` utilities exist so a divider is always a real border on a real edge rather than
a spacer element.

**The drawn geometry has its own vocabulary,** and it is drafting convention rather than
chart convention: witness lines that stop short of the point they measure, solid
arrowheads turned outward, the figure set into a gap broken in the dimension line, 45°
section hatching, graduated protractor arcs with every third tick major, and a centre mark
crossing the pivot.

### Named Rules

**The Square Corner Rule.** No radius above `4px`, anywhere, ever. If something needs to
feel softer, it is in the wrong system.

**The Hairline Rule.** Separation is 1px. Never 2px, never a coloured band, never a gap
where a rule belongs.

## Components

Controls read as **parts of a measuring instrument, not pieces of UI.** A slider is a
hairline track with a slide-rule cursor riding it; a field is a bordered number box with
its unit set beside the figure. That is the test for anything new.

### Buttons

- **Shape:** effectively square (`2px`, `--radius-lg`).
- **Default:** solid `ink` with `sheet` text — a light chip on the dark ground. `32px`
  high, `10px` horizontal padding, label typography at 500.
- **Outline:** transparent on a `rule` border, `ink` text; the workhorse for secondary
  actions like *Adopt best* and *Fire again*.
- **Ghost:** no border, `ink-3` text, background lifts to `muted` on hover; used for
  dismiss and collapse affordances.
- **Hover / Focus:** hover shifts background only. Focus is a 2px `verdigris` outline at
  `1px` offset, applied globally through `:focus-visible` — never a glow, never a shadow.
- **Press:** `translate-y-px`. A single pixel; the control moves the way a real one would.

### Chips and Toggles

- **Icon toggle** (`28px` square, `1px` radius): the view controls in the transport. Off is
  a `rule` border with `ink-3` glyph; on is a `verdigris` border with a `verdigris/10`
  wash and a `verdigris` glyph. State is carried by `aria-pressed`.
- **Segmented control:** a hairline-bordered row with no gaps between segments, the
  selected one taking `verdigris` text on a `verdigris/12` wash. Used for machine type,
  units, sweep mode and playback speed — always as a real `role="radiogroup"`.

### Cards / Containers

There are no cards. Grouping is done by **Section**: a `.stencil` heading preceded by a
12×1px `verdigris` tick, an optional note in body type, then the content, closed by a 1px
bottom rule. Panels are `sheet` on `ground`, separated by a rule on their inner edge.

### Inputs / Fields

- **Number box:** `86px` wide, `1px` radius, `rule` border, `ground` fill, right-aligned
  mono figure with the unit symbol in `ink-3` beside it. Focus moves the border to
  `verdigris` via `focus-within`.
- **Slider:** a 1px `rule` track with an `ink-3` filled range, and a 14×7px cursor drawn as
  two vertical `ink-2` edges with a single `quench` hairline down the centre — a slide-rule
  cursor. Hover darkens the edges to `ink`; focus turns both edges and the centre line
  `verdigris`.
- **Switch:** the vendored Radix pill, the one deliberately round object in the system,
  used only for true on/off parameters.

### Signature Components

**The Stat Row.** A label in `ink-2`, a leader rule at 60% opacity filling the space
between, then the value in tabular mono with its unit in `ink-3` micro type. This is the
readout rail's entire vocabulary, repeated about twenty times, and it is why the panel
scans as a table of measurements rather than a stack of cards.

**The Energy Bar.** One horizontal 100% bar, `24px` tall, bands separated by a `2px` gap
and cornered at `1px`. The payoff band takes `quench`; the graded overheads take the
lightness ramp; "never released" is drawn as a **dashed outlined void**, because it is not
a loss but unused capacity, and an empty slot reads that instantly. Hovering a band dims
the others to 45% and swaps in its explanation. Bands under 0.15% are dropped rather than
rendered as slivers.

**The Range Dimension.** The headline measurement is drawn on the canvas as a dimension
line across the bottom of the sheet — witness lines down from the pivot and the impact
point, arrowheads turned outward, the figure set into a broken gap, and `RANGE FROM PIVOT`
lettered beneath in tracked micro caps. When either end runs off the sheet, the figure
slides along its own dimension line rather than leaving with the arrowhead. A dimension
shorter than 52px is dropped entirely; a cluster of illegible figures is worse than a
missing one.

**The Protractor.** A graduated arc on a joint, filled at 6% opacity, ticked every 10°
with every third major, with a radial pointer on the live angle. The one at the beam tip
carries a dashed radial for the pin angle you have bent, which the live sling angle
visibly closes on through the throw. The figure sits inside the arc above a 44px radius
and outside it below; under 16px the protractor is not drawn at all.

## Do's and Don'ts

### Do:

- **Do** add every new colour to both `:root` and `.dark` in the same edit — the canvas
  falls back to `#888` and will not tell you.
- **Do** set every changing figure in tabular mono (`.tnum`) so columns never shuffle.
- **Do** separate with a 1px rule in `rule`, or a step in tone, before reaching for space.
- **Do** keep radii at `4px` or below, and default to `2px`.
- **Do** give focus the global 2px `verdigris` outline at `1px` offset.
- **Do** draw measurements in drafting convention — witness lines, outward arrowheads, the
  figure in a gap in the rule — wherever a measurement appears, canvas or DOM.
- **Do** drop an annotation that has become illegible (a dimension under 52px, a protractor
  under 16px, an energy band under 0.15%) rather than shrinking or overlapping it.
- **Do** state units next to figures in `ink-3` micro type, never inside the figure itself.

### Don't:

- **Don't** introduce a fifth signal hue. Four are sanctioned and the list is closed; use a
  label, a weight or a position instead.
- **Don't** use `quench` for anything but the projectile, or `verdigris` for anything but
  measurement, focus and selection.
- **Don't** put `oak` or `iron` in the interface. They draw timber and metal, nothing else.
- **Don't** add a shadow. The only one in the system belongs to a rail that has left the
  layout below `xl`.
- **Don't** build cards. Group with a Section — stencil head, verdigris tick, bottom rule.
- **Don't** set labels, buttons or chips in tracked capitals; that is `.stencil`'s job and
  `.stencil` is for section heads.
- **Don't** let the shell scroll. Panels scroll inside themselves; the viewport is the sheet.
- **Don't** reach for a pill, a rounded card or a soft corner — including on any control
  vendored from shadcn. `DraftSlider` exists because the stock slider's pill handle was the
  wrong language.
- **Don't** dress the medieval subject: no blackletter, no parchment texture, no stone, no
  fire. The machine is engineering.
