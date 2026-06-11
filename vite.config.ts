import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build can be deployed to any nginx subdirectory.
  base: './',
  // Dedicated ports so Burgspiel never collides with other Vite projects
  // (default 5173). strictPort: fail loudly instead of silently switching.
  server: {
    port: 5273,
    strictPort: true,
    host: true, // also expose on the LAN for phone testing
  },
  preview: {
    port: 4273,
    strictPort: true,
    host: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
