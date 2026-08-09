# Trebuchator

A full-screen counterweight trebuchet calculator. Model every dimension, mass and
material property of a machine — medieval or modern — fire it, and watch where the
shot lands.

The whole interface is dressed as a setting-out drawing: hatched ground, a
hairline grid, timber drawn to scale, and measurements carried on proper
dimension lines. The range is not a number in a card, it is the dimension across
the bottom of the sheet.

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
bun run test        # 97 tests: physics, conservation, ballistics, the drawing, UI
bun run test:watch
```

## Using it

- **Presets** cover a weekend build, a competition floating arm, a pumpkin hurler,
  a 13th-century siege engine, and Edward I's Warwolf.
- **Find best pin** reports the spigot angle to bend, by running the swing once
  with an ideal-release solver and reading back the angle it chose.
- **Auto-tune** searches sling length, hanger, cocked angle and short arm, re-tuning
  the pin after every move.
- **Sensitivity** sweeps any one parameter and plots range against it, with the
  range your machine gets now and the gain on offer spelled out. *As built*
  changes one number and nothing else; *best case* re-cocks and re-releases at
  every point, which is the honest way to ask what a dimension could give you.
  Click the chart to adopt a value, or hit **Adopt best**.
- **Angles** (`A`) puts protractors on the joints. The one at the beam tip shows
  the sling closing on your pin angle, which is the whole of tuning in one arc.
- **Save shot** keeps a trajectory on the sheet as a dashed ghost to compare against.
- Keys: `space` play/pause, `R` fire again, `D` dimensions, `A` angles, `G` grid.
  Drag and scroll the sheet to pan and zoom.
- Units follow your locale on first run (`Intl`, falling back to feet and
  pounds) and remember whatever you pick after that.

Sources for the historical figures and the design rules are listed in `CLAUDE.md`.

[arXiv:2502.19442]: https://arxiv.org/abs/2502.19442
