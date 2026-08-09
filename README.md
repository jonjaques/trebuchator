# Trebuchator

A full-screen counterweight trebuchet calculator. Model every dimension, mass and
material property of a machine — medieval or modern — fire it, and watch where the
shot lands.

[![Healthcheck](https://img.shields.io/github/actions/workflow/status/jonjaques/trebuchator/healthcheck.yml?branch=main&style=flat-square&label=healthcheck)](https://github.com/jonjaques/trebuchator/actions/workflows/healthcheck.yml)
[![License](https://img.shields.io/github/license/jonjaques/trebuchator?style=flat-square&color=3fd0bc)](./LICENSE)
[![Contributors](https://img.shields.io/github/contributors/jonjaques/trebuchator?style=flat-square&color=3fd0bc)](https://github.com/jonjaques/trebuchator/graphs/contributors)
[![Live](https://img.shields.io/badge/live-trebuchator.jonjaques.com-ff6b2c?style=flat-square)](https://trebuchator.jonjaques.com)

**Live Site: [trebuchator.jonjaques.com](https://trebuchator.jonjaques.com)**

<!-- Widths chosen so both images land on a common height of ~316 px: desktop is
     1456×823 and mobile is 869×1371, so a shared height is the only way a
     landscape and a portrait shot read as one row. GitHub's stylesheet caps
     images at max-width:100%, so on a narrow screen these wrap and shrink
     rather than overflowing. -->
<p>
  <img src="docs/desktop.jpg" width="560" alt="The Trebuchator sheet: a hinged counterweight trebuchet at the end of its shot, the projectile's trajectory arcing across the drawing in orange, and the range carried on a dimension line beneath the hatched ground">
  <img src="docs/mobile.jpg" width="200" alt="Trebuchator on a narrow screen: the drawing fills the top of the display with the shot's trajectory and range dimension, the what-if chart below it, and the transport controls along the bottom">
</p>

```bash
bun install
bun run dev
```

## What it actually models

Three counterweight topologies, all solved by the same Lagrangian assembler:

| | Weight | Degrees of freedom |
|---|---|---|
| **Hinged** | Hangs on its own axle and swings as a second pendulum | beam, hanger, sling |
| **Bolted** | Rigid on the short arm, dragged through an arc | beam, sling |
| **Floating arm** | Falls straight down a channel while the axle rolls on rails | beam, sling |

A shot runs in three stages. The projectile is first **dragged along the trough**
under a holonomic constraint, and the Lagrange multiplier on that constraint *is*
the trough normal force — liftoff is the instant it passes through zero, which
falls out of the solve rather than being a tuned threshold. It then **swings free**
on the sling until the loop slips the release pin. Finally it **flies** under
quadratic drag with wind and a target elevation offset.

Also modelled: Coulomb friction at the main axle and the counterweight hinge
(scaled by the real bearing reactions), aerodynamic drag on the shot *during* the
stroke, sling and pouch mass as parasitic load, non-uniform beams, and a complete
energy audit that has to close.

Beyond range it reports peak sling tension, peak frame reaction, and beam bending
moment at the pivot — the numbers you need to size an axle rather than guess one.

## Validation

The solver is checked against a published, instrumented machine: Bernaola,
Fernández and Gómez, *The swinging counterweight trebuchet* ([arXiv:2502.19442]),
who recorded beam, counterweight and sling angles through real shots with rotation
sensors.

| | Published | Trebuchator |
|---|---|---|
| Available potential energy | 204 J | 203.8 J |
| Release time, 717 g shot | 0.593 s | 0.575 s |
| Release time, 68.5 g shot | 0.533 s | 0.514 s |
| Range, 717 g, no losses | 42.8 m¹ | 42.8 m |

¹ The paper measures 36.6 m and reports 68.8 % experimental efficiency against
80.4 % for the same machine with no mechanical losses. Scaling its measured range
by that ratio gives the frictionless figure this solver should produce.

Independently, the solver reproduces the design rules of thumb without being told
them: efficiency against counterweight mass peaks at a **100 : 1 weight ratio**,
and the optimal launch angle is exactly 45° in vacuum and lower with drag. Both
are asserted in the test suite.

```bash
bun run test        # physics, conservation, ballistics, the drawing, UI
bun run test:watch
```

## Using it

- **Presets** cover a weekend build, a competition floating arm, a pumpkin hurler,
  a 13th-century siege engine, and Edward I's Warwolf.
- **Find best pin** reports the spigot angle to bend, by running the swing once
  with an ideal-release solver and reading back the angle it chose.
- **Optimize** searches sling length, hanger, cocked angle and short arm and
  returns the Pareto frontier of your chosen goal against peak axle load — feasible
  builds only, none better than another on both counts. Pick the trade you would
  actually build; the pin comes bent to the angle each build wants.
- **What if** sweeps any one parameter and plots range against it, with the
  range your machine gets now and the gain on offer spelled out. *As built*
  changes one number and nothing else; *best case* re-cocks and re-releases at
  every point, which is the honest way to ask what a dimension could give you.
  Hovering the chart draws that machine's trajectory on the sheet; click to
  adopt a value, or hit **Adopt best**.
- **Angles** (`A`) puts protractors on the joints. The one at the beam tip shows
  the sling closing on your pin angle, which is the whole of tuning in one arc.
- **Save shot** keeps a trajectory on the sheet as a dashed ghost to compare against.
- Keys: `space` play/pause, `R` fire again, `D` dimensions, `A` angles, `G` grid,
  `N` explanations. Drag and scroll the sheet to pan and zoom.
- Units follow your locale on first run (`Intl`, falling back to feet and
  pounds) and remember whatever you pick after that.

## How it's put together

React 19 and TypeScript on Vite, Tailwind v4, drawn to a plain 2D canvas. The solver
in `src/lib/treb/` is self-contained, SI throughout, and has no React in it — it runs
in a Web Worker, because a full shot is 20–45 ms and a 40-point parameter sweep is
over half a second, which is far too long to sit between a slider's mousemove events.

[`CLAUDE.md`](./CLAUDE.md) is the architecture document: what each module owns, which
decisions are load-bearing, and which apparently-reasonable changes are silently
wrong. It is worth reading before changing anything under `src/lib/treb/`.

## Contributing

Bug reports, physics corrections and new machine topologies are all welcome. See
[CONTRIBUTING.md](./CONTRIBUTING.md) — the short version is that `bun run healthcheck`
runs everything CI runs, so a green run locally is a green pull request.

## License

[MIT](./LICENSE) © Jon Jaques

Sources for the historical figures and the design rules are listed in `CLAUDE.md`.

[arXiv:2502.19442]: https://arxiv.org/abs/2502.19442
