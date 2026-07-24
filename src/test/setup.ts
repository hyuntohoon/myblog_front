// Vitest global setup: jest-dom matchers + automatic React tree cleanup so tests
// don't leak DOM/state into one another. Loaded via vitest.config.ts setupFiles.
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
