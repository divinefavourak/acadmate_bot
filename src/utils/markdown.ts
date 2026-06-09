/**
 * Escapes user-controlled text for Telegram legacy `Markdown` parse mode.
 * Without this, a username or chat topic containing `_ * [ ` ` can break the
 * message formatting or inject entities. Escapes the legacy special chars.
 *
 * NB: `[` needs no backslash inside a character class (ESLint no-useless-escape),
 * so it is listed literally here while still being a matched/escaped output char.
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/([_*`[])/g, '\\$1');
}
