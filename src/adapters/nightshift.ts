import { AdapterError, baseUrl, jsonRequest, object, token, type Fetch } from './http.js';
export interface NightshiftOptions { baseUrl?: string; runtimeToken?: string; model?: string; app?: string; scope?: string; fetch?: Fetch }
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export function meterlessBase(raw = 'http://127.0.0.1:18088/v1'): string {
  const withScheme = /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
  const base = baseUrl(withScheme).replace(/\/(?:v1\/(?:models|chat\/completions)|healthz|v1)$/, '');
  return `${base}/v1`;
}
export class NightshiftAdapter {
  readonly provider = 'meterless-nightshift';
  private readonly base: string;
  private readonly fetcher: Fetch;
  constructor(private readonly options: NightshiftOptions = {}) {
    this.base = meterlessBase(options.baseUrl);
    this.fetcher = options.fetch ?? globalThis.fetch;
  }
  private headers() {
    const app = this.options.app ?? 'workshift-ai', scope = this.options.scope ?? 'user';
    if (!/^[a-z][a-z0-9-]*$/.test(app) || !/^[a-z][a-z0-9-]*$/.test(scope)) throw new Error('Invalid Meterless app/scope');
    return { Authorization: `Bearer ${token(this.options.runtimeToken, 'NIGHTSHIFT_API_KEY')}`, 'meterless-app': app, 'meterless-scope': scope, 'Content-Type': 'application/json' };
  }
  async models(): Promise<string[]> {
    const value = await jsonRequest(this.fetcher, `${this.base}/models`, { method: 'GET', headers: this.headers() }, 30_000);
    if (!object(value) || !Array.isArray(value.data) || !value.data.every(row => object(row) && typeof row.id === 'string')) throw new AdapterError('contract', 'Invalid model discovery response');
    const ids = value.data.map(row => (row as { id: string }).id).filter(id => id.startsWith('meterless/'));
    if (!ids.length) throw new AdapterError('contract', 'Discovery returned no Meterless modes');
    return [...new Set(ids)];
  }
  async chat(messages: ChatMessage[]) {
    if (!messages.length || !messages.every(m => ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string')) throw new Error('Expected nonempty text messages');
    const model = this.options.model ?? 'meterless/text';
    const value = await jsonRequest(this.fetcher, `${this.base}/chat/completions`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ model, messages, stream: false }),
    }, 180_000);
    if (!object(value) || value.error || !Array.isArray(value.choices)) throw new AdapterError('contract', 'Invalid chat completion');
    const first: unknown = value.choices[0];
    if (!object(first) || !object(first.message) || typeof first.message.content !== 'string') throw new AdapterError('contract', 'Expected plain text chat completion');
    return { provider: this.provider, model, text: stripReasoningPrefix(first.message.content), usage: object(value.usage) ? value.usage : undefined };
  }
}

/** Discard only an explicit reasoning prefix; never extract or repair JSON. */
export function stripReasoningPrefix(text: string): string {
  const end = text.lastIndexOf('</think>');
  const answer = (end < 0 ? text : text.slice(end + '</think>'.length)).trim();
  if (!answer || answer.includes('<think>')) throw new AdapterError('contract', 'Expected final text response');
  return answer;
}
