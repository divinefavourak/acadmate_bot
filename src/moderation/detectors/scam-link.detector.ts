import { DetectionReason, type ChatSettings } from '@prisma/client';
import type { DetectionResult, InspectedMessage } from '@/types';
import { PASS, type Detector } from '../detector.interface';

/**
 * Flags messages that contain links matching known scam/phishing heuristics:
 *  - URL shorteners commonly used to mask phishing destinations
 *  - Crypto/airdrop/giveaway lures
 *  - Look-alike domains impersonating Telegram
 *  - Raw IP-address URLs
 *
 * These are heuristics, not a definitive blocklist — they intentionally err
 * toward flagging for human review rather than silent auto-bans on first hit.
 */
export class ScamLinkDetector implements Detector {
  public readonly name = 'scam-link';
  public readonly reason = DetectionReason.SCAM_LINK;

  private readonly shorteners = new Set([
    'bit.ly',
    'tinyurl.com',
    'goo.gl',
    'ow.ly',
    't.co',
    'is.gd',
    'cutt.ly',
    'rb.gy',
    'shorturl.at',
  ]);

  private readonly lureKeywords = [
    'free crypto',
    'airdrop',
    'double your',
    'giveaway',
    'claim your',
    'connect wallet',
    'elon',
    'investment opportunity',
    'guaranteed profit',
  ];

  // Domains that impersonate Telegram-ish brand to phish logins.
  private readonly impersonationPattern =
    /\b(?:t-?elegram|tele-?gram|telegrarn|telegran)\.(?!org\b|me\b)[a-z]{2,}\b/i;

  isEnabled(settings: ChatSettings): boolean {
    return settings.scamLinkDetection;
  }

  detect(message: InspectedMessage): DetectionResult {
    const text = message.text ?? '';
    const urls = extractUrls(text, message.entities);
    if (urls.length === 0 && !this.lureKeywords.some((k) => text.toLowerCase().includes(k))) {
      return PASS;
    }

    const lowered = text.toLowerCase();
    const hasLure = this.lureKeywords.some((k) => lowered.includes(k));

    for (const url of urls) {
      const host = safeHost(url);
      if (!host) continue;

      if (this.shorteners.has(host)) {
        return flag(`URL shortener masking destination: ${host}`);
      }
      if (this.impersonationPattern.test(host)) {
        return flag(`Telegram look-alike domain: ${host}`);
      }
      if (isRawIpUrl(host)) {
        return flag(`Raw IP-address link: ${host}`);
      }
      if (hasLure) {
        return flag(`Lure phrase combined with external link: ${host}`);
      }
    }

    // Lure phrase plus a wallet/crypto link even without a known-bad host.
    if (hasLure && urls.length > 0) {
      return flag('Scam lure phrasing with external link');
    }

    return PASS;
  }
}

function flag(details: string): DetectionResult {
  return { flagged: true, reason: DetectionReason.SCAM_LINK, details, severity: 2 };
}

/** Pull URLs from both raw text and Telegram message entities. */
function extractUrls(text: string, entities: InspectedMessage['entities']): string[] {
  const fromEntities = entities
    .filter((e) => e.type === 'url' || e.type === 'text_link')
    .map((e) => e.url)
    .filter((u): u is string => Boolean(u));

  const urlRegex = /https?:\/\/[^\s<>"']+/gi;
  const fromText = text.match(urlRegex) ?? [];
  return Array.from(new Set([...fromEntities, ...fromText]));
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function isRawIpUrl(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}
