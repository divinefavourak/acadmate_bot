import type { AiCompletionOptions, AiProvider, AiResult } from './ai.types';
import {
  AiBadResponseError,
  AiRateLimitError,
  AiTransientError,
  AiUnavailableError,
} from './ai.errors';
import { scopedLogger } from '@/utils/logger';

const log = scopedLogger('ai-router');

export interface AiRouterOptions {
  cooldownMs: number;
  timeoutMs: number;
}

/**
 * Tries configured providers in priority order, failing over the instant one
 * is rate-limited or transiently failing. A per-provider cooldown means a
 * depleted provider is skipped (not retried) until it recovers.
 *
 * If every provider is unconfigured or cooling down, `complete` throws
 * `AiUnavailableError` and `available` returns false — callers degrade safely.
 */
export interface AiProviderStatus {
  name: string;
  model: string;
  configured: boolean;
  /** Seconds remaining on cooldown (0 = ready). */
  coolingDownSeconds: number;
}

export interface AiRouterStatus {
  providers: AiProviderStatus[];
  /** Provider that will be tried first for the next request, if any. */
  next: string | null;
  /** Provider that served the most recent successful request. */
  last: string | null;
}

export class AiRouter {
  /** providerName → epoch ms until which it is skipped. */
  private readonly cooldownUntil = new Map<string, number>();
  /** Name of the provider that served the most recent successful request. */
  private lastProvider: string | null = null;

  constructor(
    private readonly providers: AiProvider[],
    private readonly opts: AiRouterOptions,
  ) {}

  /** True if at least one provider has a key configured. */
  get available(): boolean {
    return this.providers.some((p) => p.isConfigured());
  }

  /** Names of providers in play, for diagnostics. */
  get providerNames(): string[] {
    return this.providers.filter((p) => p.isConfigured()).map((p) => p.name);
  }

  /** Live snapshot of provider health, for the /aistatus command. */
  status(): AiRouterStatus {
    const now = Date.now();
    const providers = this.providers.map((p) => ({
      name: p.name,
      model: p.model,
      configured: p.isConfigured(),
      coolingDownSeconds: Math.max(0, Math.ceil(((this.cooldownUntil.get(p.name) ?? 0) - now) / 1000)),
    }));
    const next =
      providers.find((p) => p.configured && p.coolingDownSeconds === 0)?.name ?? null;
    return { providers, next, last: this.lastProvider };
  }

  async complete(opts: AiCompletionOptions): Promise<AiResult> {
    const now = Date.now();
    const usable = this.providers.filter(
      (p) => p.isConfigured() && (this.cooldownUntil.get(p.name) ?? 0) <= now,
    );

    if (usable.length === 0) {
      throw new AiUnavailableError(
        this.available ? 'All AI providers are cooling down' : 'No AI provider configured',
      );
    }

    let lastError: unknown;
    for (const provider of usable) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
      // Chain the caller's signal so upstream cancellation still aborts the
      // request, in addition to the router's own per-attempt timeout.
      const onAbort = (): void => controller.abort();
      if (opts.signal) {
        if (opts.signal.aborted) controller.abort();
        else opts.signal.addEventListener('abort', onAbort, { once: true });
      }
      try {
        const result = await provider.complete({ ...opts, signal: controller.signal });
        if (this.lastProvider !== provider.name) {
          log.info({ provider: provider.name, model: provider.model }, 'AI request served by provider');
        }
        this.lastProvider = provider.name;
        return result;
      } catch (err) {
        lastError = err;
        this.handleFailure(provider.name, err);
        // Fall through to the next provider.
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      }
    }

    throw new AiUnavailableError(
      `All ${usable.length} provider(s) failed; last: ${(lastError as Error)?.message ?? 'unknown'}`,
    );
  }

  private handleFailure(name: string, err: unknown): void {
    if (err instanceof AiRateLimitError) {
      const until = Date.now() + (err.retryAfterMs ?? this.opts.cooldownMs);
      this.cooldownUntil.set(name, until);
      log.warn({ provider: name, cooldownMs: until - Date.now() }, 'provider rate-limited, cooling down');
      return;
    }
    if (err instanceof AiTransientError) {
      // Shorter cooldown for transient blips so we recover quickly.
      this.cooldownUntil.set(name, Date.now() + Math.min(this.opts.cooldownMs, 10_000));
      log.warn({ provider: name, err: err.message }, 'provider transient failure');
      return;
    }
    if (err instanceof AiBadResponseError) {
      // Likely a config/auth/model error specific to this provider; skip it
      // for a full cooldown but keep trying others.
      this.cooldownUntil.set(name, Date.now() + this.opts.cooldownMs);
      log.error({ provider: name, err: err.message }, 'provider bad response');
      return;
    }
    log.error({ provider: name, err }, 'provider unexpected error');
  }
}
