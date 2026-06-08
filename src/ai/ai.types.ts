/** Provider-agnostic chat primitives. Adapters normalise to these. */
export type AiRole = 'system' | 'user' | 'assistant';

export interface AiMessage {
  role: AiRole;
  content: string;
}

export interface AiCompletionOptions {
  /** System / instruction prompt. */
  system?: string;
  messages: AiMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Request JSON-only output where the provider supports it. */
  json?: boolean;
  /** Caller-supplied cancellation (the router also applies its own timeout). */
  signal?: AbortSignal;
}

export interface AiResult {
  text: string;
  provider: string;
  model: string;
}

/**
 * One AI backend. Implementations MUST translate HTTP 429 into
 * `AiRateLimitError` and 5xx/network/timeout into `AiTransientError`, so the
 * router can decide whether to fail over without knowing provider internals.
 */
export interface AiProvider {
  readonly name: string;
  readonly model: string;
  /** False when no API key is set — such providers are skipped entirely. */
  isConfigured(): boolean;
  complete(opts: AiCompletionOptions): Promise<AiResult>;
}
