import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  // No source maps in the package: src/ is not published, so they would only add
  // weight. The output is unminified, so it stays readable in node_modules.
  sourcemap: false,
  clean: true,
  target: 'es2020',
  external: ['react', 'react-dom', 'react/jsx-runtime', 'pdfjs-dist'],
  // Keep the "use client" banner so the components work in Next.js app router.
  banner: { js: '"use client";' },
});
