import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const p = (s: string) => fileURLToPath(new URL(s, import.meta.url));

export const alias = {
  '@gut/shared/': p('./packages/shared/src/'),
  '@gut/shared': p('./packages/shared/src/index.ts'),
  '@gut/db': p('./packages/db/src/index.ts'),
  '@gut/fetch': p('./packages/fetch/src/index.ts'),
  '@gut/daemon': p('./packages/daemon/src/index.ts'),
  '@gut/server': p('./packages/server/src/index.ts'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'packages/*/test/**/*.test.tsx'],
    environment: 'node',
    testTimeout: 20000,
  },
});
