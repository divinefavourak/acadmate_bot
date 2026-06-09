/** Base class for all AI-layer failures. */
export class AiError extends Error {
  constructor(
    message: string,
    public readonly provider?: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * The provider returned HTTP 429. The router puts the provider on cooldown and
 * fails over to the next one. `retryAfterMs` comes from the Retry-After header
 * when present.
 */
export class AiRateLimitError extends AiError {
  constructor(
    provider: string,
    public readonly retryAfterMs?: number,
  ) {
    super(`${provider} rate-limited (429)`, provider);
  }
}

/** 5xx, network error, or timeout — worth failing over, shorter cooldown. */
export class AiTransientError extends AiError {
  constructor(provider: string, detail: string) {
    super(`${provider} transient error: ${detail}`, provider);
  }
}

/** A definitive provider error (bad request, auth) — do not retry elsewhere blindly. */
export class AiBadResponseError extends AiError {
  constructor(provider: string, detail: string) {
    super(`${provider} bad response: ${detail}`, provider);
  }
}

/** No provider could satisfy the request (none configured or all on cooldown). */
export class AiUnavailableError extends AiError {
  constructor(message = 'No AI provider available') {
    super(message);
  }
}
