export type Fetch = typeof globalThis.fetch;
export function baseUrl(raw: string): string {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Expected HTTP(S) base URL without credentials, query or fragment');
  return url.toString().replace(/\/+$/, '');
}
export class AdapterError extends Error {
  constructor(readonly code: 'unauthorized' | 'offline' | 'http' | 'contract' | 'invalid_json', message: string, readonly status?: number) { super(message); }
}
export async function jsonRequest(fetcher: Fetch, url: string, init: RequestInit, timeout: number): Promise<unknown> {
  let response: Response;
  try { response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeout) }); }
  catch { throw new AdapterError('offline', 'Provider unreachable or request timed out'); }
  // Do not echo untrusted provider bodies: they may contain credentials or SQL.
  if (response.status === 401 || response.status === 403) throw new AdapterError('unauthorized', 'Provider rejected credentials', response.status);
  if (!response.ok) throw new AdapterError('http', `Provider HTTP ${response.status}`, response.status);
  if (!response.headers.get('content-type')?.includes('application/json')) throw new AdapterError('contract', 'Expected application/json');
  try { return await response.json(); } catch { throw new AdapterError('invalid_json', 'Invalid JSON response'); }
}
export function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function token(value: string | undefined, name: string): string {
  if (!value?.trim() || /\s/.test(value) || value === 'rt-local') throw new Error(`${name} requires a real token; no request sent`);
  return value;
}
