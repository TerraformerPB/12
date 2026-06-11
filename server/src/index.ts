import { createServer } from 'node:http';
import { createApp } from './app.js';
import { JsonStore } from './storage.js';

/**
 * Burgspiel backend entry point.
 *
 * Environment:
 *   PORT                      — listen port (default 8787)
 *   BURGSPIEL_DATA            — data file (default ./server-data/burgspiel.json)
 *   BURGSPIEL_CORS            — Access-Control-Allow-Origin (default *)
 *   BURGSPIEL_ADMIN_USER      — seed admin account on first start
 *   BURGSPIEL_ADMIN_PASSWORD
 *
 * Without the seed variables, the FIRST registered account becomes admin.
 */

const port = Number(process.env.PORT) || 8787;
const dataFile = process.env.BURGSPIEL_DATA ?? './server-data/burgspiel.json';

const store = new JsonStore(dataFile);
const server = createServer(createApp(store));

server.listen(port, () => {
  console.log(`Burgspiel-Backend läuft auf http://localhost:${port}`);
  console.log(`Admin-Dashboard:        http://localhost:${port}/admin`);
  console.log(`Daten:                  ${dataFile}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    store.flushNow();
    server.close(() => process.exit(0));
  });
}
