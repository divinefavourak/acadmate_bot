import type { AiCompletionOptions, AiProvider, AiResult } from '../ai.types';
import { AiBadResponseError, AiRateLimitError, AiTransientError } from '../ai.errors';

export interface OpenAiCompatibleConfig {
  /** Display name used in logs/cooldown keys, e.g. "groq". */
  name: string;
  /** Base URL up to and including `/v1` (no trailing `/chat/completions`). */
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
}

/**
 * Adapter for any OpenAI-compatible `/chat/completions` endpoint. Groq,
 * OpenRouter, Cerebras, Together, Mistral, GitHub Models, etc. all work by
 * passing a different `baseUrl` + `model` — no new code per provider.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  public readonly name: string;
  public readonly model: string;

  constructor(private readonly cfg: OpenAiCompatibleConfig) {
    this.name = cfg.name;
    this.model = cfg.model;
  }

  isConfigured(): boolean {
    return Boolean(this.cfg.apiKey);
  }

  async complete(opts: AiCompletionOptions): Promise<AiResult> {
    const messages = [
      ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
      ...opts.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 1024,
    };
    if (opts.json) body['response_format'] = { type: 'json_object' };

    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: opts.signal,
      });
    } catch (err) {
      // Network failure or aborted (timeout) → worth failing over.
      throw new AiTransientError(this.name, (err as Error).message);
    }

    if (res.status === 429) {
      throw new AiRateLimitError(this.name, parseRetryAfter(res.headers.get('retry-after')));
    }
    if (res.status >= 500) {
      throw new AiTransientError(this.name, `HTTP ${res.status}`);
    }
    if (!res.ok) {
      throw new AiBadResponseError(this.name, `HTTP ${res.status}: ${await safeText(res)}`);
    }

    let data: { choices?: { message?: { content?: string } }[] };
    try {
      data = (await res.json()) as typeof data;
    } catch (err) {
      throw new AiBadResponseError(this.name, `invalid JSON: ${(err as Error).message}`);
    }
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new AiBadResponseError(this.name, 'empty completion');

    return { text, provider: this.name, model: this.cfg.model };
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return '';
  }
}
