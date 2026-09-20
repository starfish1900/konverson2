import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { target: 'es2022', assetsInlineLimit: 0 },
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'], environment: 'node', pool: 'threads' },
});
