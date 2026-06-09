import { describe, expect, it, vi } from 'vitest';
import { AiRouter } from '@/ai/ai-router';
import { AiRateLimitError } from '@/ai/ai.errors';
import type { AiProvider, AiResult } from '@/ai/ai.types';

function provider(name: string, impl: () => Promise<AiResult>): AiProvider {
  return { name, model: 'm', isConfigured: () => true, complete: impl };
}

const ok = (name: string): AiResult => ({ text: `from-${name}`, provider: name, model: 'm' });
const opts = { cooldownMs: 1000, timeoutMs: 1000 };

describe('AiRouter failover', () => {
  it('fails over to the next provider on rate-limit', async () => {
    const a = provider('a', vi.fn().mockRejectedValue(new AiRateLimitError('a')));
    const b = provider('b', vi.fn().mockResolvedValue(ok('b')));
    const router = new AiRouter([a, b], opts);

    const res = await router.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.provider).toBe('b');
  });

  it('puts a rate-limited provider on cooldown (skips it next call)', async () => {
    const aFn = vi.fn().mockRejectedValue(new AiRateLimitError('a'));
    const bFn = vi.fn().mockResolvedValue(ok('b'));
    const router = new AiRouter([provider('a', aFn), provider('b', bFn)], opts);

    await router.complete({ messages: [{ role: 'user', content: '1' }] });
    await router.complete({ messages: [{ role: 'user', content: '2' }] });

    // 'a' is only attempted on the first call, then skipped while cooling down.
    expect(aFn).toHaveBeenCalledTimes(1);
    expect(bFn).toHaveBeenCalledTimes(2);
  });

  it('throws AiUnavailableError when all providers are exhausted', async () => {
    const a = provider('a', vi.fn().mockRejectedValue(new AiRateLimitError('a')));
    const b = provider('b', vi.fn().mockRejectedValue(new AiRateLimitError('b')));
    const router = new AiRouter([a, b], opts);

    await expect(
      router.complete({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/All AI providers|provider\(s\) failed/);
  });

  it('reports unavailable when nothing is configured', () => {
    const a: AiProvider = { name: 'a', model: 'm', isConfigured: () => false, complete: vi.fn() };
    expect(new AiRouter([a], opts).available).toBe(false);
  });
});
