import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        // Injected at build time by vite.config.js's `define` block.
        // Declared here so `no-undef` doesn't flag its use in JSX.
        __BUILD_NUMBER__: 'readonly',
      },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    // api/ is server code (Vercel Edge + Node functions), not browser code.
    // Without node globals declared, every `process.env` read and every
    // `Buffer` use in these files trips no-undef — stripe-webhook.js alone
    // carried five such errors before this block existed. Scoped to api/ so
    // the browser bundle keeps its stricter global list.
    files: ['api/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
])
