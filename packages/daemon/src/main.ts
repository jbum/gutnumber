import { loadConfig, openDb } from '@gut/db';
import { loadPrivateHelpers } from '@gut/fetch';
import { Daemon } from './daemon.js';
import { SqliteStore } from './store.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const daemon = new Daemon({ config, store: new SqliteStore(db) });
const helpers = await loadPrivateHelpers(config.privateDir, (m) => daemon.log(m));
if (helpers.length) daemon.log('private helpers loaded', { helpers });
daemon.start();

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    if (stopping) process.exit(1);
    stopping = true;
    await daemon.stop();
    db.close();
    process.exit(0);
  });
}
