import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base: der Build läuft in jedem Unterverzeichnis (nginx etc.).
  base: './',
  // Eigene Ports, damit das Cockpit nicht mit anderen Vite-Projekten
  // (Burgspiel nutzt 5273/4273) kollidiert.
  server: {
    port: 5274,
    strictPort: true,
    host: true,
  },
  preview: {
    port: 4274,
    strictPort: true,
    host: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
