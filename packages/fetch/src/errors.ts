import type { ErrorClass } from '@gut/shared';

export class FetchError extends Error {
  constructor(
    public errorClass: ErrorClass,
    message: string,
    public httpStatus?: number,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

export function asFetchError(e: unknown): FetchError {
  if (e instanceof FetchError) return e;
  const err = e as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  const msg = err?.message ?? String(e);
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || /timeout|timed out/i.test(msg)) return new FetchError('timeout', msg);
  const cause = err?.cause?.code ?? err?.cause?.message;
  return new FetchError('network', cause ? `${msg} (${cause})` : msg);
}
