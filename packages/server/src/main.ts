import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { loadConfig, openDb, getSetting, now } from '@gut/db';
import { loadPrivateHelpers, pushover } from '@gut/fetch';
import { buildServer } from './app.js';

const config = loadConfig();
if (!config.dev && config.host !== '127.0.0.1' && config.host !== 'localhost') {
  // Auth is Apache basic auth (D11); binding elsewhere would bypass it.
  console.error(`refusing to listen on ${config.host}: set HOST=127.0.0.1 or GUTNUMBER_DEV=1`);
  process.exit(1);
}
const db = openDb(config.dbPath);
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
// Bundled: dist/server.js sits next to dist/client and dist/extension. Dev (tsx): look in the package dist dirs.
const pick = (...c: string[]) => c.find((p) => existsSync(p)) ?? null;
const clientDir = pick(here('./client'), here('../../client/dist'));
const extensionDir = pick(here('./extension'), here('../../extension/dist'));
await loadPrivateHelpers(config.privateDir, (m) => console.error(m));
const app = await buildServer({ config, db, clientDir, extensionDir, logger: true });

// Stale daemon alert (the daemon cannot report its own death).
let alerted = false;
setInterval(() => {
  const hb = Number(getSetting(db, 'daemon_heartbeat') ?? 0);
  const stale = !hb || now() - hb > 600;
  if (stale && !alerted) {
    alerted = true;
    void pushover(config, 'gutnumber daemon stale', hb ? `no heartbeat for ${Math.round((now() - hb) / 60)} min` : 'daemon has never run');
  } else if (!stale && alerted) {
    alerted = false;
    void pushover(config, 'gutnumber daemon back', 'heartbeat resumed');
  }
}, 5 * 60_000).unref();

await app.listen({ port: config.port, host: config.host });
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, async () => {
    await app.close();
    await app.gut.browser.close();
    db.close();
    process.exit(0);
  });
