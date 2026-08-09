# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## State of the project

A working full-screen trebuchet calculator. `src/lib/treb/` is the solver and is the
part to be careful with; `src/components/` is the drawing and the panels.

## Commands

Package manager is **bun** (`bun.lock` is the lockfile — do not introduce npm/yarn/pnpm).

```bash
bun install
bun run dev        # Vite dev server with HMR
bun run build      # tsc -b (both tsconfig projects) then vite build
bun run preview    # serve the production build
bun run lint       # eslint .
bun run test       # vitest run
bunx tsc -b        # type-check only, without bundling

bunx --bun shadcn@latest add <component>   # vendor a component into src/components/ui
```

## The solver

`src/lib/treb/` is self-contained, SI throughout, and has no React in it. Read
`model.ts` before touching any of it.

**Kinematics are data, not derivations.** Every point on every machine is written as a
sum of terms `(cx·sin(s·q_k + w), cy·cos(s·q_k + w))`, each depending on exactly one
generalised coordinate. Jacobians and Hessians then come out analytically, the *cross*
second derivatives vanish identically, and one Lagrangian assembler in `solver.ts`
covers all three topologies. **Adding a machine type means adding a term list, not
deriving equations of motion.** Do not replace this with finite differences; the energy
audit closes to ~1e-9 because the derivatives are exact.

**The machine throws toward +x.** The long arm hangs down and behind the pivot at rest
and sweeps up over the top. Mirroring any of the sign conventions in `buildModel` is
silent and expensive — the machine still throws perfectly, just backwards, and every
range comes out negative. There is a test for exactly this.

**Liftoff is not a threshold.** During the ground stage the projectile is held to the
trough by a holonomic constraint solved as a KKT system, and the multiplier *is* the
normal force. Liftoff is where it passes through zero. Don't reintroduce a tuned
criterion.

**The shot owns its clock, and `ok` narrows.** `ShotResult` is discriminated on `ok`,
so a successful shot carries a non-null `release` and a `timeline` and a failed one
carries neither — the invariant is in the type rather than in a `!` at every call site.
`timeline.ts` owns `{liftoffT, releaseT, duration}` plus `phaseAt`, `isFlying`, `isDone`
and `strokeT`, and with them the single `TIME_EPS`. Ask it rather than recomputing
`release.t + flightTime`: that sum was previously rebuilt at five call sites with three
different epsilons, and the drawing and the transport could disagree about whether a
shot had landed. It also owns the two lookups that answer the same question about a
frame list — `frameIndexAt` and `sampleTrajectory`, which lived in `sheet.ts` until the
module that owns the clock could no longer describe itself without pointing at the
drawing. Both take the bare `{t}` / `{t,x,y}` shape they read rather than
`ShotResult['frames']`, because `types.ts` imports `ShotTimeline` from here and naming
those types would close an import cycle.

Coulomb friction lags the bearing loads by one step on purpose (the loads depend on the
accelerations which depend on the friction). At the step sizes used this is far below
the other modelling error, and it keeps the right-hand side a pure function.

`releaseMode: 'optimal'` is not a buildable machine — it releases at whichever instant
maximises range. Its value is that `release.gamma` then *is* the pin angle to build, so
`bestReleaseAngle()` is one simulation rather than a search.

**Follow-through is cosmetic by construction.** After release the stroke is integrated
a second time with the shot's mass off the sling (`phase: 'follow'` frames) so the
drawing shows the arm whip over and the weight swing out. Coarser step, no bearing
feedback, capped at 8 s, skipped for lightweight shots — nothing numerical may read a
follow frame, and the whip on the sheet clamps at `releaseT` because the "projectile"
point in those frames is the empty pouch.

**The optimizer is a Pareto frontier, not a hill-climb.** `paretoSearch` samples the
tunable ranges (deterministic LCG — the same machine must always yield the same
frontier), rejects candidates that fail `validateGeometry` or
`geometryImpossibilities`, and keeps the non-dominated set of range against peak axle
load. The coordinate-descent auto-tuner it replaced chased range alone and walked into
geometry that cannot exist. Material impossibilities (a box denser than lead) are
deliberately *not* filtered: they do not vary with the searched keys, so filtering on
them would empty the frontier without offering a candidate that fixes them.

### Validation — don't regress it

`physics.test.ts` checks the solver against an instrumented machine from
[arXiv:2502.19442] (geometry and masses in Table 1, ranges and release times in
Table 2). The `lab` preset is frictionless, so it must reproduce the paper's own
*ab initio* frictionless range of 42.8 m (Table 3), not the field-measured
34.4 ± 1.5 m — the gap between the two is the real machine's friction and drag.
Available energy matches the printed 204 J to 0.1 %.

The suite also asserts emergent behaviour rather than just numbers: efficiency against
counterweight mass peaks at a 100:1 weight ratio, and the vacuum launch optimum is 45°.
If a change breaks those, the change is wrong, not the test.

Sources: [arXiv:2502.19442] (Horsdal, Johansen and Rasmussen) for the
swinging-counterweight experiments and ranges; [arXiv:2510.18789] (Horsdal) is its
theory-only companion on internal forces — the model behind the bearing-load
readouts, not a source of experimental data; Siano's *Trebuchet Mechanics* for the
3.75:1 arm and sling-equals-long-arm rules of thumb; virtualtrebuchet.com for the
parameter definitions this app's inputs mirror.

[arXiv:2502.19442]: https://arxiv.org/abs/2502.19442
[arXiv:2510.18789]: https://arxiv.org/abs/2510.18789

## Reading the what-if chart

The sweep panel is labelled **What if** in the UI; the code keeps the sweep
vocabulary. Hovering the chart fires the hovered machine through a second
latest-wins queue (`requestPreview`) and draws its trajectory on the sheet —
a separate queue because sharing the main one would let hover bursts supersede a
real parameter change.

Sweeping one parameter with the pin angle held conflates "this dimension is
better" with "the pin I happen to have bent suits this dimension" — lengthen the
arm and the stale pin fires at the wrong moment, so the curve falls off for a
reason that has nothing to do with the arm. That is why `SweepMode` exists:
`asBuilt` changes one number and nothing else, `bestCase` re-cocks the beam and
releases ideally at every point. Both are legitimate; conflating them is not.

`bestCase` cannot honour every key, and the two failures are handled differently.
Re-cocking would overwrite a swept **cocked angle**, so `stage()` leaves the swept
value alone in that one case. Releasing ideally makes a swept **pin angle** inert,
which has no honest reading at all, so `sweepConflict()` refuses that pair and the app
prints the reason where the chart would go. Both used to draw a flat line the reader
had no way to interpret.

Sweeps run at `SWEEP_DT` (4e-4), coarser than `simulateShot`'s own default, because
forty points at the finer step doubles a wait already over half a second. Every
`SweepPoint` therefore carries the `dt` it was fired at — adopt a value off the curve
and the panel re-solves it slightly differently, and that should be visible rather than
assumed. The grid comes from `sweepValues()`; the worker chunks *that array* rather
than re-deriving the interpolation, which is what used to divide by zero on a chunk of
one.

The chart's y-axis starts at zero deliberately. Sensitivity curves are about
relative differences and a truncated axis turns a 2% spread into a cliff.

`SweepChart` measures its own width rather than stretching a viewBox:
`preserveAspectRatio="none"` scales the text along with the coordinates, and on a
phone the axis labels came out squashed to a third of their width. The observer
goes on a plain wrapper via a **callback ref** — the component swaps which
element carries the ref between its placeholder and its plot, and a mount-only
effect goes on observing the detached node forever.

## The drawing

**Three modules: `draft.ts` holds the drafting vocabulary, `sheet.ts` composes a machine
out of it, `paint.ts` puts the result on a canvas.** `layout()` returns plain
`Instruction` objects in screen pixels and `paint()` walks them. The canvas split exists
because every rule worth arguing about — when a dimension is too short to letter
(`MIN_DIMENSION`), when a protractor's figure goes inside its arc
(`LABEL_INSIDE_RADIUS`), what a grid step rounds to — used to sit in a private function
behind a single `void` export whose only entry point was a `CanvasRenderingContext2D`.
jsdom has no canvas, so none of it could be reached from a test at all.

`draft.ts` splits off for the same reason one step further in. Those rules were public
on `sheet.ts` purely so a test could reach them: eight exports no caller used, and a
suite that mostly asserted on the sheet's internals. Now each half is tested through an
interface something actually calls — `draft.test.ts` against the drafting rules,
`sheet.test.ts` against `layout()`. **`draft.ts` must not learn what a trebuchet is**;
that is the line that keeps it testable without a machine. Add drafting rules there,
machine composition to `sheet.ts`, *canvas* concerns to `paint.ts`.

Two things stay on the canvas side deliberately. Clipping is a `clip` polygon on an
instruction rather than trimmed geometry — working out where a hatch line crosses a
rotated weight box is what a canvas is for, and the rule worth testing is the spacing
and the angle. Text measurement is an injected `MeasureText`, an internal seam: the
adapter passes `ctx.measureText`, a test passes an estimator, and only the dimension
figure needs it.

`SHEET_MARGIN` is exported from `sheet.ts` and used by `Stage.tsx` for its camera inset.
It has to clear the sheet's own furniture — the range dimension 40 px below the ground
line, its caption 22 below that, the 12 px hatch band — and framing used to pick that
number independently of the module that draws the thing it must clear.

## Testing

**Vitest**, configured in `vitest.config.ts` — deliberately separate from
`vite.config.ts` so tests skip the React Compiler babel pass, which is slow and buys
nothing here. The `@/` alias must stay in sync between the two files.

Environment is `node` by default; a file opts into a DOM with `// @vitest-environment
jsdom` on its first line. `src/test-setup.ts` stubs `ResizeObserver` and the
pointer-capture methods, without which every Radix component test dies in a layout
effect before it can assert anything.

## Application architecture

**The solver runs in a Web Worker** (`sim.worker.ts`). A full shot is 20–45 ms and a
40-point sweep is over half a second — far too long to sit between a slider's mousemove
events. The worker is a module singleton, because StrictMode's mount/unmount/remount
would otherwise either tear down or leak one per mount.

**Nothing above `simulator.ts` knows the worker exists.** `Simulator` is the interface —
`shot`, `tunePin`, `autotune`, `sweep` — with two adapters: `workerSimulator.ts` for the
browser and `directSimulator.ts` for tests, which is what makes the seam real rather
than hypothetical. Do not import the direct one from the app; it pulls the solver core
into whatever bundle it lands in, and the worker chunk exists precisely to keep it out.

Both wire shapes are *derived* from the `SimOps` table in `simulator.ts`, so an
operation is one entry rather than parallel edits to a request union, a response union
and a client method. That drift is how an `optimize` operation came to exist on the wire
for months with no caller.

`coalesceShots()` is policy over the interface, not part of it: a drag fires faster than
the solver runs, so only the newest request survives and a superseded answer is dropped.
It is tested against a stub that settles when the test says so — the point of putting it
above the seam rather than inside the worker client.

**Errors have somewhere to go.** A worker throw rejects the promise; `useShot` surfaces
it, `ReadoutRail` renders it as "the solver stopped" (distinct from a machine that will
not throw), and sweeps report it through their own `SweepUpdate`. The old client turned
every failure into `null`, dropped it, and left `busy` true for the rest of the session.
`Simulator.sweep` returns a cancel function and callers must call it — an uncancelled
superseded sweep keeps streaming into state that has already moved on.

**`react-hooks/set-state-in-effect` is enforced** by the React Compiler's lint rules and
is not suppressed anywhere. Derived state is derived: `busy` compares the held result's
params against the current ones, and the playback cursor stores "at the end" as `null`
rather than as a number, so a re-solve that changes the flight time cannot strand it.

The shadcn CLI **blocks on an interactive preset prompt even with `--yes`**; `init` needed
`--base radix --preset nova` passed explicitly. `add` is fine non-interactively, but redirect
`< /dev/null` if a call ever appears to hang.

## Build and TypeScript configuration

**React Compiler is on.** It is wired through Babel rather than the React plugin's own option:
`vite.config.ts` runs `@vitejs/plugin-react` and then `@rolldown/plugin-babel` with
`reactCompilerPreset()`. Consequences: manual `useMemo`/`useCallback`/`React.memo` are usually
redundant and should not be added reflexively, and both dev and build are slower than a plain
React template. Removing the babel plugin silently disables compilation — the build still
succeeds, so nothing will tell you.

**Two TypeScript projects, referenced from the root `tsconfig.json`:**
`tsconfig.app.json` covers `src/` (DOM libs, `vite/client` types) and `tsconfig.node.json`
covers `vite.config.ts` alone (Node types, `nodenext` resolution). `tsc -b` builds both; a
change to build tooling belongs under the node project, not the app one.

Compiler flags that turn ordinary-looking code into build failures:

- `noUnusedLocals` / `noUnusedParameters` — an unused import or arg fails `bun run build`, not just lint.
- `verbatimModuleSyntax` — type-only imports must be written `import type { X } from ...`.
- `erasableSyntaxOnly` — no `enum`, no constructor parameter properties, no `namespace`.
- `allowImportingTsExtensions` — local imports carry the extension (`./App.tsx`), as in `src/main.tsx`.
- **No `baseUrl`.** TypeScript 6 deprecates it and `tsc -b` fails with TS5101 if it comes back —
  which matters because most shadcn setup guides still tell you to add it. `paths` resolves
  relative to the tsconfig on its own, and the shadcn CLI resolves the alias fine without it.

**The `@/*` alias is declared in three places** and all three must agree: `tsconfig.app.json`
(what `tsc` checks), `vite.config.ts` `resolve.alias` (what actually bundles), and the root
`tsconfig.json` (which exists *only* so the shadcn CLI can find it — the CLI reads the root
tsconfig, not the referenced projects, and `tsc` ignores those options because `files` is empty).
Miss the Vite one and the build type-checks clean, then fails to resolve at bundle time.

## Styling

**Tailwind v4 through its Vite plugin** (`@tailwindcss/vite`) — there is no `tailwind.config.js`
and no PostCSS config; v4 is configured in CSS. All of it lives in `src/index.css`: the
`@import`s, an `@theme inline` block mapping Tailwind color/radius utilities onto CSS custom
properties, and the `:root` / `.dark` palettes in oklch. Add design tokens there, not in a JS config.

**shadcn/ui components are vendored, not a dependency.** `bunx --bun shadcn@latest add <name>`
copies source into `src/components/ui/`. Settings live in `components.json`: Radix primitives
(via the single `radix-ui` package, not per-component `@radix-ui/*`), the `radix-nova` style,
Lucide icons. Treat those files as **generated** — `shadcn add` overwrites them, so
local edits are lost. `eslint.config.js` turns off `react-refresh/only-export-components` for
that directory for exactly this reason (the files export a `cva` variants object next to the
component); don't "fix" them to satisfy lint.

When a vendored component blocks something it cannot express, replace it locally rather
than editing it. `DraftSlider.tsx` exists because the shadcn slider renders its thumbs
internally, so there was no way to give the `role="slider"` element an accessible name —
and a rounded pill handle was the wrong language for this sheet anyway. The vendored
`slider.tsx` was deleted rather than left as a decoy.

**Dark mode is class-based**, via `@custom-variant dark (&:is(.dark *))`. The `.dark` class must
go on `<html>`, not on `#root` — Radix portals render outside the React root and would keep the
light palette otherwise. `App.tsx` owns that toggle and persists it to
`localStorage` under `trebuchator:theme`, defaulting to dark.

**The canvas reads its colours from the same tokens.** `Stage.tsx` pulls the palette out
of `getComputedStyle(document.documentElement)` and re-reads it under a `MutationObserver`
on the root class, so the drawing follows the theme instead of caching a stale palette.
Add a colour to `:root` *and* `.dark` or the drawing will silently use `#888` for it.

**Type is Instrument Sans against Geist Mono**, and the contrast that carries the
design is sans-for-names against mono-for-numbers. It does not need help from
letterforms: an earlier pass set every label in condensed uppercase at 500 with
0.16em tracking and read as a wall rather than as a drawing. Uppercase and
tracked survives only on `.stencil` (section heads, doing structural work);
`.label` is sentence case at 400 and carries everything else.

**Two accents, one job each, and never anything else:** `--quench` is the projectile and
its trajectory, `--verdigris` is measurement — dimension lines and annotations. The pair
was checked with a CVD validator against both surfaces (deutan dE 16.1 dark / 12.9 light);
an earlier softer teal failed at dE 5.8 against the neutral ink. If a third accent seems
necessary, the answer is a label. The energy-budget bar follows from this: one accent for
the payoff, a lightness ramp (`--ramp-1..3`) for the graded overheads, and an outlined
void for "never released", which is unused capacity rather than a loss.

Merge class names with `cn()` from `@/lib/utils` (clsx + tailwind-merge) rather than template
strings, so conflicting utilities resolve last-wins.

**Focus has to be declared twice, and the second one is unlayered.** `@layer base` carries
the 2px verdigris outline for the controls this app draws. The vendored shadcn files ship
`outline-none` plus a 3px `ring` on `:focus-visible`, both of which land in Tailwind's
`utilities` layer — and cascade layers are resolved *before* specificity, so no layered rule
can outrank them however it is written. The `[data-slot]:focus-visible` block at the bottom
of `index.css` sits outside every layer for exactly that reason; move it into one and every
Button silently goes back to wearing a glow the design system has no vocabulary for.

**Explanations are a layer, not a tooltip.** `lib/notes.ts` holds one boolean in context;
`Field`, `ToggleField` and `ReadoutRail`'s `Stat` read it to decide whether their hint is
painted in `body` type or `sr-only`. It is never conditionally *rendered* — the text is
always in the DOM and wired with `aria-describedby` where it describes a control, so
folding the layer away is a visual choice and not a loss of content. The toggle lives in
the transport's annotation row beside dimensions/angles/grid, with `n` for a shortcut.

**`SegmentedControl` owns the radiogroup keyboard contract.** Machine type, units, sweep
mode and playback speed were four hand-rolled copies, each declaring `role="radiogroup"`
and none of them implementing it — one tab stop per option and no arrow keys. Add a choice
from a short fixed list by adding an options array, not another copy.
