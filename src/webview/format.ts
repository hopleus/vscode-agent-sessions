const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

const MINUTE_MS = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, char => HTML_ESCAPES[char]);
}

export function timeAgo(timestamp: number, now = Date.now()): string {
  const minutes = Math.floor((now - timestamp) / MINUTE_MS);
  if (minutes < 1) { return 'now'; }
  if (minutes < MINUTES_PER_HOUR) { return `${minutes}m`; }
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) { return `${hours}h`; }
  const days = Math.floor(hours / HOURS_PER_DAY);
  if (days < DAYS_PER_WEEK) { return `${days}d`; }
  return `${Math.floor(days / DAYS_PER_WEEK)}w`;
}
