/** Convert minutes to a future Date. */
export function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

/** Convert seconds to a future Date. */
export function secondsFromNow(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

/** Telegram requires `until_date` as a Unix timestamp in seconds. */
export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/** Human-friendly duration formatting for log/notice text. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) return rem ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
