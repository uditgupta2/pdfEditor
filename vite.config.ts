/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The root index.html is the development playground, not part of the package.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'playground-dist' },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
