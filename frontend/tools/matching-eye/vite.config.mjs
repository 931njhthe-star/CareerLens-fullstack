import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  build: {
    // Flask serves this checked-in bundle. Teammates do not need Node at runtime.
    outDir: '../../src/features/analysis',
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    lib: {
      entry: fileURLToPath(new URL('./src/component.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'matching-eye.js',
    },
    rolldownOptions: {
      output: { codeSplitting: false },
    },
  },
});
