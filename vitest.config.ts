import { availableParallelism } from 'node:os'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

/**
 * Cap the fork pool: Vitest defaults to one fork per core, and jsdom + Vue SFC
 * transforms in dozens of parallel forks thrash the CPU badly enough that hooks
 * and tests hit their timeouts. Fewer forks is measurably faster here.
 */
const maxForks = Math.max(1, Math.min(8, availableParallelism()))

export default defineConfig({
  plugins: [vue()],
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    poolOptions: {
      forks: { maxForks, minForks: 1 },
    },
  },
})
