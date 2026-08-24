import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    // Upstream ships only `tests/**`. Our fork keeps its tests beside the code
    // they cover, so those paths must be included too or they silently never run.
    include: ['tests/**/*.test.ts', 'src/components/**/*.test.ts', 'src/lib/**/*.test.ts'],
    environment: 'node',
  },
});
