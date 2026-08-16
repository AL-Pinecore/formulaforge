import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { defineVitestProject } from '@nuxt/test-utils/config'

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: {
            '~': resolve('./app'),
            '@': resolve('./app'),
            '~~': resolve('.'),
            '@@': resolve('.'),
          },
        },
        test: {
          name: 'unit',
          include: ['test/unit/*.{test,spec}.ts'],
          environment: 'node',
        },
      },
      await defineVitestProject({
        test: {
          name: 'nuxt',
          include: ['test/nuxt/*.{test,spec}.ts'],
          environment: 'nuxt',
        },
      }),
    ],
  },
})
