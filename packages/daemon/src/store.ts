import { claimDue, recordPoll, previousValue, setSetting, getSetting, releaseClaims, type DB, type PollRecord, type RecordOutcome } from '@gut/db';
import type { Gutnumber } from '@gut/shared';

/**
 * What the scheduler needs from storage (D6). v1 talks to SQLite directly;
 * an HTTP implementation against the server API would let the poller run elsewhere.
 */
export interface Store {
  claimDue(now: number, limit: number): Gutnumber[];
  record(g: Gutnumber, rec: PollRecord, nextDueAt: number): RecordOutcome;
  previousValue(id: number): number | null;
  heartbeat(now: number): void;
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
  releaseClaims(): void;
}

export class SqliteStore implements Store {
  constructor(public db: DB) {}
  claimDue(now: number, limit: number) {
    return claimDue(this.db, now, limit);
  }
  record(g: Gutnumber, rec: PollRecord, nextDueAt: number) {
    return recordPoll(this.db, g, rec, nextDueAt);
  }
  previousValue(id: number) {
    return previousValue(this.db, id);
  }
  heartbeat(now: number) {
    setSetting(this.db, 'daemon_heartbeat', String(now));
  }
  getSetting(key: string) {
    return getSetting(this.db, key);
  }
  setSetting(key: string, value: string) {
    setSetting(this.db, key, value);
  }
  releaseClaims() {
    releaseClaims(this.db);
  }
}
