import { defineConfig } from 'vitest/config'

// Standalone config: vitest must NOT pick up vite.config.ts, whose electron
// plugins try to build/launch the app.
export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        environment: 'node',
    },
})
