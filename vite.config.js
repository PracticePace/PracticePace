import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import svgr from 'vite-plugin-svgr'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Build number: `${pkg.version}.${git commit count}` — e.g. "2.0.0.245".
// pkg.version is bumped intentionally per commit type (major = breaking,
// minor = feature, patch = fix). The last segment auto-increments from
// `git rev-list --count HEAD` so every push has a distinct build number
// that Matt can compare against the Settings-page indicator.
// Falls back to 'dev' when git isn't available (fresh checkout without
// history / shallow clone / Docker builds); local dev still works.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))
let commitCount = 'dev'
try {
  commitCount = execSync('git rev-list --count HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev'
} catch {
  commitCount = 'dev'
}
const BUILD_NUMBER = `${pkg.version}.${commitCount}`

export default defineConfig({
  plugins: [svgr(), react(), tailwindcss()],
  define: {
    // Replaced at build time with a JSON string literal. Read at runtime
    // via bare `__BUILD_NUMBER__` — appears on the Settings footer.
    __BUILD_NUMBER__: JSON.stringify(BUILD_NUMBER),
  },
})
