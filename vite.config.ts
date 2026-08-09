import path from 'node:path'
import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // shadcn generates components that import from "@/..."; this has to stay in
      // sync with the `paths` entry in tsconfig.app.json or the build type-checks
      // clean and then fails to resolve at bundle time.
      // import.meta.dirname rather than __dirname — this is an ESM config file.
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
