import path from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Separate from vite.config.ts on purpose. The app build runs the React
// Compiler through @rolldown/plugin-babel, which is slow and buys nothing in
// tests — the physics core is plain functions and the component tests do not
// care whether memoisation was inserted. Everything else (the "@/" alias above
// all) has to match vite.config.ts or imports resolve differently under test
// than they do in the browser.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    // Per-file environment: `// @vitest-environment jsdom` at the top of a file
    // opts that file into a DOM. Physics suites stay in node, which is faster.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test-setup.ts'],
    // Vitest's 5 s default is a web-app default and this suite is not a web app:
    // a Pareto search fires several hundred machines and the release-tuning check
    // fires two full sweeps, which take about a second here and five to eight on
    // a GitHub runner. Both had started failing on `main` for no reason but the
    // runner being slower than a laptop — a red build that says nothing about the
    // code is worse than no build at all. Raised globally rather than per test,
    // because the next honest multi-second solver test would hit exactly this and
    // the failure gives no hint that a timeout is what it is.
    testTimeout: 30_000,
  },
})
