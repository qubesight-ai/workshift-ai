import { AdapterError, jsonRequest, object, token, type Fetch } from './http.js';
import type { ChatMessage } from './nightshift.js';

export interface GroqOptions {
  apiKey?: string;
  model?: string;
  fetch?: Fetch;
}

export class GroqAdapter {
  readonly provider = 'groq';
  private readonly fetcher: Fetch;

  constructor(private readonly options: GroqOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  async chat(messages: ChatMessage[]) {
    if (!messages.length || !messages.every(
      m => ['system', 'user', 'assistant'].includes(m.role) &&
      typeof m.content === 'string'
    )) {
      throw new Error('Expected nonempty text messages');
    }

    const model = this.options.model ?? 'openai/gpt-oss-120b';

    const value = await jsonRequest(
      this.fetcher,
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token(this.options.apiKey, 'GROQ_API_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          max_completion_tokens: 2048,
          stream: false,
        }),
      },
      90_000
    );

    if (!object(value) || value.error || !Array.isArray(value.choices)) {
      throw new AdapterError('contract', 'Invalid Groq chat completion');
    }

    const first: unknown = value.choices[0];

    if (!object(first) || !object(first.message) ||
        typeof first.message.content !== 'string') {
      throw new AdapterError('contract', 'Expected plain text Groq response');
    }

    return {
      provider: this.provider,
      model,
      text: first.message.content,
      usage: object(value.usage) ? value.usage : undefined,
    };
  }
}
