import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import svgr from 'vite-plugin-svgr'
import { readFileSync } from 'node:fs'

// Build number: `${pkg.version}.${pkg.buildCount}` — e.g. "2.0.0.247".
// pkg.version is bumped intentionally per commit type (major = breaking,
// minor = feature, patch = fix). pkg.buildCount is bumped on EVERY commit
// so each push has a distinct build number. Both live in package.json so
// they get committed to git and are available at build time WITHOUT any
// git commands — Vercel's shallow clones broke the earlier `git rev-list
// --count HEAD` approach, and even `git fetch --unshallow` in the Vercel
// buildCommand didn't reliably deepen the checkout. Reading a committed
// file is bulletproof: whatever gets deployed is exactly what was
// committed.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))
const BUILD_NUMBER = `${pkg.version}.${pkg.buildCount ?? 'dev'}`

export default defineConfig({
  plugins: [svgr(), react(), tailwindcss()],
  define: {
    // Replaced at build time with a JSON string literal. Read at runtime
    // via bare `__BUILD_NUMBER__` — appears on the Settings footer.
    __BUILD_NUMBER__: JSON.stringify(BUILD_NUMBER),
  },
})
