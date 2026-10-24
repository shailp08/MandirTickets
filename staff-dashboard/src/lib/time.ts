/** "just now" / "2 min ago" / "1 hr ago" from an epoch-ms timestamp. */
export function relativeTime(epochMs: number | null): string {
  if (epochMs == null) return 'never';
  const secs = Math.floor((Date.now() - epochMs) / 1000);
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} d ago`;
}
