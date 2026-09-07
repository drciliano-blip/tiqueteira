import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // E2E é Playwright, roda por fora.
    exclude: ['tests/e2e/**', 'node_modules/**'],
    setupFiles: ['tests/setup.ts'],
    // Teste de concorrência de estoque não pode competir com outro teste
    // pelo mesmo banco.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/domain/**', 'src/lib/**'],
      reporter: ['text', 'html'],
    },
  },
});
