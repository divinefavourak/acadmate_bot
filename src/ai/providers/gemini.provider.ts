import type { AiCompletionOptions, AiProvider, AiResult } from '../ai.types';
import { AiBadResponseError, AiRateLimitError, AiTransientError } from '../ai.errors';

export interface GeminiConfig {
  apiKey: string | undefined;
  model: string;
}

/**
 * Adapter for Google's Gemini API, which uses a different shape from OpenAI:
 *  - the system prompt goes in `systemInstruction`, not the message list
 *  - roles are `user` / `model` (we map `assistant` → `model`)
 *  - JSON mode is `responseMimeType: 'application/json'`
 *  - 429 surfaces as RESOURCE_EXHAUSTED
 */
export class GeminiProvider implements AiProvider {
  public readonly name = 'gemini';

  constructor(private readonly cfg: GeminiConfig) {}

  get model(): string {
    return this.cfg.model;
  }

  isConfigured(): boolean {
    return Boolean(this.cfg.apiKey);
  }

  async complete(opts: AiCompletionOptions): Promise<AiResult> {
    const contents = opts.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: opts.temperature ?? 0.4,
        maxOutputTokens: opts.maxTokens ?? 1024,
        ...(opts.json ? { responseMimeType: 'application/json' } : {}),
      },
    };
    if (opts.system) {
      body['systemInstruction'] = { parts: [{ text: opts.system }] };
    }

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${this.cfg.model}:generateContent?key=${this.cfg.apiKey}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: opts.signal,
      });
    } catch (err) {
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

    let data: { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    try {
      data = (await res.json()) as typeof data;
    } catch (err) {
      throw new AiBadResponseError(this.name, `invalid JSON: ${(err as Error).message}`);
    }
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
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
