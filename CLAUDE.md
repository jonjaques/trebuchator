# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## State of the project

A working full-screen trebuchet calculator. `src/lib/treb/` is the solver and is the
part to be careful with; `src/components/` is the drawing and the panels.

The directory is **not a git repository** — `git init` before assuming any VCS command works.

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

Coulomb friction lags the bearing loads by one step on purpose (the loads depend on the
accelerations which depend on the friction). At the step sizes used this is far below
the other modelling error, and it keeps the right-hand side a pure function.

`releaseMode: 'optimal'` is not a buildable machine — it releases at whichever instant
maximises range. Its value is that `release.gamma` then *is* the pin angle to build, so
`bestReleaseAngle()` is one simulation rather than a search.

### Validation — don't regress it

`physics.test.ts` checks the solver against an instrumented machine from
[arXiv:2502.19442] (geometry and masses in Table 1, ranges and release times in
Table 2). The `lab` preset is frictionless, so it reproduces their *ab initio* figures;
their measured 36.6 m relates to it by the loss factor the paper itself reports
(68.8 % experimental against 80.4 % ideal). Available energy matches to 0.1 %.

The suite also asserts emergent behaviour rather than just numbers: efficiency against
counterweight mass peaks at a 100:1 weight ratio, and the vacuum launch optimum is 45°.
If a change breaks those, the change is wrong, not the test.

Sources: [arXiv:2502.19442] and [arXiv:2510.18789] for the swinging-counterweight
model and experimental data; Siano's *Trebuchet Mechanics* for the 3.75:1 arm and
sling-equals-long-arm rules of thumb; virtualtrebuchet.com for the parameter
definitions this app's inputs mirror.

[arXiv:2502.19442]: https://arxiv.org/abs/2502.19442
[arXiv:2510.18789]: https://arxiv.org/abs/2510.18789

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
events. `SimClient` in `useSimulation.ts` coalesces shot requests so a drag never builds
a backlog, and streams sweeps in chunks so the chart draws itself left to right. The
worker is a module singleton, because StrictMode's mount/unmount/remount would otherwise
either tear down or leak one per mount.

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

**Two accents, one job each, and never anything else:** `--quench` is the projectile and
its trajectory, `--verdigris` is measurement — dimension lines and annotations. The pair
was checked with a CVD validator against both surfaces (deutan dE 16.1 dark / 12.9 light);
an earlier softer teal failed at dE 5.8 against the neutral ink. If a third accent seems
necessary, the answer is a label. The energy-budget bar follows from this: one accent for
the payoff, a lightness ramp (`--ramp-1..3`) for the graded overheads, and an outlined
void for "never released", which is unused capacity rather than a loss.

Merge class names with `cn()` from `@/lib/utils` (clsx + tailwind-merge) rather than template
strings, so conflicting utilities resolve last-wins.
