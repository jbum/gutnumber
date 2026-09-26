import { defineConfig } from 'vitest/config';
import { alias } from '../vitest.config';

export default defineConfig({
  resolve: { alias },
  test: { include: ['e2e/**/*.e2e.ts'], testTimeout: 90_000, hookTimeout: 60_000, fileParallelism: false },
});
