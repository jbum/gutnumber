import type { FastifyRequest } from 'fastify';
import { HttpError } from './app.js';

export const idParam = (req: FastifyRequest, key = 'id'): number => {
  const v = Number((req.params as Record<string, string>)[key]);
  if (!Number.isInteger(v) || v <= 0) throw new HttpError(400, 'bad_id', `invalid ${key}`);
  return v;
};

export const q = (req: FastifyRequest) => req.query as Record<string, string | undefined>;

export const numQ = (v: string | undefined): number | undefined => {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, 'bad_query', `not a number: ${v}`);
  return n;
};

export const isoToTs = (v: string | undefined): number | undefined => {
  if (!v) return undefined;
  if (/^\d+$/.test(v)) return Number(v);
  const t = Date.parse(v);
  if (!Number.isFinite(t)) throw new HttpError(400, 'bad_query', `not a date: ${v}`);
  return Math.floor(t / 1000);
};

/** Tiny fixed-window rate limiter (previews cost proxy bandwidth). */
export class RateLimit {
  private hits: number[] = [];
  constructor(private max: number, private windowMs: number) {}
  take(): boolean {
    const now = Date.now();
    this.hits = this.hits.filter((t) => now - t < this.windowMs);
    if (this.hits.length >= this.max) return false;
    this.hits.push(now);
    return true;
  }
}
