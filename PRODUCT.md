# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: someone who is actually building a counterweight trebuchet.** A weekend
builder or a competition team, working out dimensions, masses and the pin angle before
cutting timber or bending steel. They arrive with a machine in mind — or one already
half-built — and leave with numbers they will hold a tape measure against.

Understanding is a success condition for that same person rather than a separate
audience: a builder who gets a correct number but no sense of *why* has only been half
served. Learners and enthusiasts are welcome and well served by the same surface, but
they do not drive decisions when the two conflict.

## Product Purpose

Model a counterweight trebuchet end to end and report what it would actually do.

Success has two halves, both confirmed, and the product needs both:

1. **Trusted for real builds.** Someone bends a spigot to the angle it reports, fires,
   and the shot lands where the sheet said. Being right is the whole product.
2. **Teaches the mechanics.** They come away understanding the machine — the whip, the
   energy budget, why the historical 100:1 weight ratio exists.

## Positioning

It is a solved multibody model, not a range formula, and the difference is visible in
what it can report.

- Three counterweight topologies — hinged, bolted, floating arm — through one Lagrangian
  assembler, so they are the same physics rather than three approximations.
- The projectile is held to the trough by a holonomic constraint solved as a KKT system,
  and the Lagrange multiplier *is* the trough normal force. Liftoff is where it passes
  through zero: it falls out of the solve rather than being a tuned threshold.
- Coulomb friction at the axle and hinge scaled by real bearing reactions, aerodynamic
  drag on the shot *during* the stroke, sling and pouch mass as parasitic load, and a
  complete energy audit that has to close.
- Beyond range it reports peak sling tension, peak frame reaction and beam bending
  moment at the pivot — the numbers needed to size an axle rather than guess one.

A neighbouring calculator could copy the input fields. It could not truthfully claim the
structural loads or the closing energy audit without doing the same modelling.

## Operating Context

- Used before and during a physical build. Outputs get checked against a tape measure, a
  bench, and eventually a machine in a field.
- Runs entirely in a browser, phone included — which is where a builder actually is.
  Units follow the locale on first run and are remembered thereafter.
- Presets span the real range of machines people build: a weekend build, a competition
  floating arm, a pumpkin hurler, a 13th-century siege engine, and Edward I's Warwolf.
- Comparison is part of the work, not a feature bolted on: saved shots stay on the sheet
  as lettered ghosts, and the what-if sweep answers "what would this dimension give me"
  in two explicitly named readings — as built, and best case — with the hovered
  machine's trajectory previewed live on the sheet.

## Capabilities and Constraints

**Confirmed constraints — binding on future work:**

- **Fully client-side.** No backend, no accounts, no telemetry. The solver runs in a Web
  Worker in the browser and the whole product deploys as static files (currently
  Cloudflare Pages).
- **Familiar parameters.** The input vocabulary keeps mirroring virtualtrebuchet.com, so
  someone arriving from there recognises every field without relearning the domain.

**Capabilities as shipped:** three machine types; pin or ideal release; "Find best pin"
(one simulation, not a search); a Pareto-frontier optimizer over range and peak axle
load, feasibility-filtered so it never proposes a machine that cannot exist;
single-parameter what-if sweeps with live trajectory preview; material pickers that
derive parameters from real densities and bearing frictions; plausibility warnings for
inputs beyond the buildable world; saved shots; playback with a scrubber, variable
speed and the arm's full follow-through; dimension, angle and grid overlays; metric
and imperial.

**Terminology** the product and its users share: machine, shot, stroke, sweep, sheet,
pin angle (spigot), sling, pouch, hanger, counterweight, trough, cocked angle, liftoff,
release, carry, range.

## Brand Commitments

- **Name:** Trebuchator. The wordmark ships with the descriptor "Counterweight siege
  engine calculator".
- **Voice, as shipped** (incumbent practice, observed in the codebase rather than
  separately confirmed by the user): dry, exact and builder-facing. It names things the
  way a workshop would, explains *why* the obvious thing does not work, and never
  markets. Worth confirming or revising before any copy-led work.

## Evidence on Hand

Real, in the repository, and safe to cite:

- **Validation against a published instrumented machine** — Bernaola, Fernández and
  Gómez, *The swinging counterweight trebuchet* (arXiv:2502.19442), who recorded beam,
  counterweight and sling angles through real shots with rotation sensors. Available
  potential energy 204 J published against 203.8 J modelled; release times 0.593 s and
  0.533 s against 0.575 s and 0.514 s; frictionless range 42.8 m against 42.8 m. All
  asserted in `src/lib/treb/physics.test.ts`.
- **Design rules reproduced without being told them:** efficiency against counterweight
  mass peaks at a 100:1 weight ratio, and the vacuum launch optimum is exactly 45°.
- **97 passing tests** across physics, conservation, ballistics, the drawing and UI.
- **Secondary sources:** arXiv:2510.18789; Siano, *Trebuchet Mechanics*;
  virtualtrebuchet.com for the parameter definitions.

Absences that future work must not paper over: there are **no users, no testimonials, no
traffic or download figures, no institutional endorsement, and no record of a machine
built from this tool and measured in a field.** The arXiv comparison validates the
solver against someone else's published machine — it is not evidence that anyone has
built anything from Trebuchator.

Keeping that validation visible was offered as a binding constraint and not taken, so it
is present evidence rather than a standing commitment.

## Product Principles

1. **Being right outranks being impressive.** A number someone will cut timber to has to
   be defensible before it is elegant.
2. **Every number must be actionable at the bench.** If a reading cannot change what
   someone does with a saw or a tape measure, it is decoration.
3. **Show the mechanism, not just the answer.** Understanding is a deliverable, not a
   side effect — a builder who cannot see *why* cannot adapt when their machine differs.
4. **No server, no account, no barrier.** The whole product is a page that works.
5. **Speak the vocabulary builders already have.** Familiarity is a feature; renaming the
   domain to suit the software is not.

## Accessibility & Inclusion

No formal standard has been adopted. WCAG 2.2 AA was offered as a hard floor and not
taken, so the existing care in the codebase — a colour-vision-deficiency-validated accent
pair, visible focus rings, reduced-motion handling, labelled controls — is deliberate
practice rather than a commitment future work must meet. Treat it as the current bar, not
as a contract.
