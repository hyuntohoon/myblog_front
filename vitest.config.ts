/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Aliases mirror tsconfig.json `paths` so tests import via the same `@lib/*` /
// `@components/*` specifiers the app uses. Keep in sync with tsconfig on change.
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@assets': r('./src/assets'),
      '@components': r('./src/components'),
      '@layouts': r('./src/layouts'),
      '@lib': r('./src/lib'),
      '@constants': r('./src/constants.ts'),
      '@utils': r('./src/utils.ts'),
      '@styles': r('./src/styles'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Astro exposes PUBLIC_* vars on import.meta.env at build time; the modules
    // under test read PUBLIC_BACKEND_API_URL / PUBLIC_API_URL at import, so seed
    // deterministic stand-ins (never the real hosts — tests must not hit prod).
    env: {
      PUBLIC_BACKEND_API_URL: 'https://backend.test',
      PUBLIC_API_URL: 'https://music.test',
    },
  },
})
