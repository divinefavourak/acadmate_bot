import { createHash } from 'node:crypto';

/** Zero-width / bidi control chars commonly used to evade text filters. */
// ZWSP, ZWNJ, ZWJ, LRM, RLM (200B-200F); bidi embeddings/overrides (202A-202E); BOM (FEFF).
const INVISIBLE_CHARS = /[\u200B-\u200F\u202A-\u202E\uFEFF]/g;

/**
 * Normalises text before hashing so that trivial variations
 * (case, whitespace, zero-width chars) collapse to the same hash.
 * This is what makes duplicate detection robust against lazy evasion.
 */
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKC')
    .replace(INVISIBLE_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Stable content hash used for duplicate detection. */
export function contentHash(input: string): string {
  return createHash('sha256').update(normalizeText(input)).digest('hex');
}
