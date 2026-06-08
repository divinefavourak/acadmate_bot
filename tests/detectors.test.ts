import { describe, expect, it } from 'vitest';
import { SpamDetector } from '@/moderation/detectors/spam.detector';
import { ScamLinkDetector } from '@/moderation/detectors/scam-link.detector';
import { normalizeText, contentHash } from '@/utils/hash';
import type { InspectedMessage } from '@/types';

function msg(text: string, entities: InspectedMessage['entities'] = []): InspectedMessage {
  return { chatTelegramId: 1n, userTelegramId: 2n, messageId: 1, text, entities };
}

describe('SpamDetector', () => {
  const d = new SpamDetector();

  it('passes ordinary chatter', () => {
    expect(d.detect(msg('hey, are we meeting at 5?')).flagged).toBe(false);
  });

  it('flags Telegram invite + links combo', () => {
    const r = d.detect(msg('join now https://t.me/+abc123 and https://x.io and https://y.io'));
    expect(r.flagged).toBe(true);
    expect(r.reason).toBe('SPAM');
  });

  it('flags many mentions combined with multiple links', () => {
    // 5+ mentions → +2, 3+ links → +2 ⇒ score 4 ⇒ flagged.
    const r = d.detect(
      msg('@alice @bobby @carol @david @ellen https://a.io https://b.io https://c.io'),
    );
    expect(r.flagged).toBe(true);
  });
});

describe('ScamLinkDetector', () => {
  const d = new ScamLinkDetector();

  it('flags URL shorteners', () => {
    expect(d.detect(msg('check https://bit.ly/abcd')).flagged).toBe(true);
  });

  it('flags lure phrasing with an external link', () => {
    const r = d.detect(msg('free crypto airdrop, connect wallet at https://claim.example.io'));
    expect(r.flagged).toBe(true);
    expect(r.severity).toBe(2);
  });

  it('ignores a plain harmless link', () => {
    expect(d.detect(msg('docs here https://nodejs.org/en/docs')).flagged).toBe(false);
  });
});

describe('text normalization', () => {
  it('collapses case, whitespace and zero-width chars to one hash', () => {
    const a = contentHash('Free  MONEY');
    const b = contentHash('free money');
    expect(a).toBe(b);
  });

  it('strips zero-width evasion characters', () => {
    expect(normalizeText('spa​m')).toBe('spam');
  });
});
