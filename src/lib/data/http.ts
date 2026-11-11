/** fetch + JSON with a timeout, an upper size bound and caller cancellation. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface FetchJsonOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  init?: RequestInit;
}

export async function fetchJson(url: string, opts: FetchJsonOptions = {}): Promise<unknown> {
  const { signal, timeoutMs = 12_000, maxBytes = 3_000_000, init } = opts;
  const ctl = new AbortController();
  const onAbort = () => ctl.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctl.abort(new HttpError(`Timed out after ${timeoutMs} ms`, url)), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal, headers: { accept: 'application/json', ...init?.headers } });
    if (!res.ok) throw new HttpError(`HTTP ${res.status}`, url, res.status);
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > maxBytes) throw new HttpError('Response too large', url, res.status);
    const text = await res.text();
    if (text.length > maxBytes) throw new HttpError('Response too large', url, res.status);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new HttpError('Response is not valid JSON', url, res.status);
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (ctl.signal.aborted && ctl.signal.reason instanceof HttpError) throw ctl.signal.reason;
    if (signal?.aborted) throw e;
    throw new HttpError(e instanceof Error ? e.message : 'Network error', url);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
/** Finite number or null. Never coerces strings, so "0" from a broken API is not read as zero. */
export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const str = (v: unknown, max = 120): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
