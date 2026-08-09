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
  },
})
