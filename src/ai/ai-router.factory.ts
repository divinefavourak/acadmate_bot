import { config } from '@/config';
import { scopedLogger } from '@/utils/logger';
import { AiRouter } from './ai-router';
import type { AiProvider } from './ai.types';
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider';
import { GeminiProvider } from './providers/gemini.provider';

const log = scopedLogger('ai-router-factory');

/**
 * Registry of known providers, keyed by the names used in AI_PROVIDER_ORDER.
 * Adding an OpenAI-compatible backend (OpenRouter, Cerebras, …) is a one-line
 * entry here — no new adapter needed.
 */
function buildProvider(name: string): AiProvider | null {
  switch (name) {
    case 'groq':
      return new OpenAiCompatibleProvider({
        name: 'groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKey: config.GROQ_API_KEY,
        model: config.GROQ_MODEL,
      });
    case 'gemini':
      return new GeminiProvider({ apiKey: config.GEMINI_API_KEY, model: config.GEMINI_MODEL });
    default:
      log.warn({ name }, 'unknown AI provider in AI_PROVIDER_ORDER, skipping');
      return null;
  }
}

/** Builds the router from AI_PROVIDER_ORDER, preserving priority order. */
export function buildAiRouter(): AiRouter {
  const providers = config.AI_PROVIDER_ORDER.map(buildProvider).filter(
    (p): p is AiProvider => p !== null,
  );

  const router = new AiRouter(providers, {
    cooldownMs: config.AI_PROVIDER_COOLDOWN_SECONDS * 1000,
    timeoutMs: config.AI_REQUEST_TIMEOUT_MS,
  });

  if (router.available) {
    log.info({ providers: router.providerNames }, 'AI router ready');
  } else {
    log.warn('no AI providers configured — AI features disabled');
  }
  return router;
}
