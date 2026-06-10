import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build can be deployed to any nginx subdirectory.
  base: './',
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
