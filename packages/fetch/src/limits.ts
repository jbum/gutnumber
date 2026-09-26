/** Concurrency and politeness shared across daemon ticks. */

export class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;
  constructor(private max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
  get busy() {
    return this.active;
  }
}

/** Minimum gap between request starts to the same host (ARCHITECTURE §6.3). */
export class HostGate {
  private next = new Map<string, number>();
  constructor(private gapFor: (host: string) => number = defaultGap) {}
  async wait(url: string): Promise<void> {
    let host = '';
    try {
      host = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return;
    }
    const now = Date.now();
    const at = Math.max(now, this.next.get(host) ?? 0);
    this.next.set(host, at + this.gapFor(host));
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }
}

export function defaultGap(host: string): number {
  if (/(^|\.)amazon\./.test(host)) return 15_000;
  if (/(^|\.)(googleapis\.com|algolia\.com|clicky\.com)$/.test(host)) return 250;
  return 5_000;
}

export interface Limits {
  http: Semaphore;
  browser: Semaphore;
  gate: HostGate;
}

export function makeLimits(httpConcurrency: number, browserConcurrency: number, gate = new HostGate()): Limits {
  return { http: new Semaphore(Math.max(1, httpConcurrency)), browser: new Semaphore(Math.max(1, browserConcurrency)), gate };
}
