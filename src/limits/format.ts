const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const BAR_SVG_HEIGHT = 8;

export function formatRemaining(resetsAt: number | undefined, now: number): string {
  if (resetsAt === undefined) { return 'reset time unknown'; }
  const left = resetsAt - now;
  if (left <= 0) { return 'already reset'; }
  if (left >= DAY_MS) {
    return `resets in ${Math.floor(left / DAY_MS)}d ${Math.floor((left % DAY_MS) / HOUR_MS)}h`;
  }
  if (left >= HOUR_MS) {
    return `resets in ${Math.floor(left / HOUR_MS)}h ${Math.floor((left % HOUR_MS) / MINUTE_MS)}m`;
  }
  return `resets in ${Math.max(1, Math.ceil(left / MINUTE_MS))}m`;
}

export function formatRemainingShort(resetsAt: number | undefined, now: number): string | undefined {
  if (resetsAt === undefined || resetsAt <= now) { return undefined; }
  const left = resetsAt - now;
  if (left >= DAY_MS) { return `${Math.floor(left / DAY_MS)}d ${Math.floor((left % DAY_MS) / HOUR_MS)}h`; }
  if (left >= HOUR_MS) { return `${Math.floor(left / HOUR_MS)}h ${Math.floor((left % HOUR_MS) / MINUTE_MS)}m`; }
  return `${Math.max(1, Math.ceil(left / MINUTE_MS))}m`;
}

export function msUntilDisplayChange(resetsAt: number | undefined, now: number): number | undefined {
  if (resetsAt === undefined || resetsAt <= now) { return undefined; }
  const left = resetsAt - now;
  const unit = left >= DAY_MS ? HOUR_MS : MINUTE_MS;
  const toBoundary = left % unit === 0 ? unit : left % unit;
  return Math.min(left + 1, toBoundary + 1);
}

export function formatAge(timestamp: number | undefined, now: number): string {
  if (timestamp === undefined) { return 'unknown time'; }
  const age = Math.max(0, now - timestamp);
  if (age < MINUTE_MS) { return 'just now'; }
  if (age < HOUR_MS) { return `${Math.floor(age / MINUTE_MS)} min ago`; }
  if (age < DAY_MS) { return `${Math.floor(age / HOUR_MS)} h ago`; }
  return `${Math.floor(age / DAY_MS)} d ago`;
}

export interface Thresholds {
  warning: number;
  error: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { warning: 80, error: 95 };

export function severityOf(percent: number, thresholds: Thresholds = DEFAULT_THRESHOLDS): 'ok' | 'warning' | 'error' {
  if (percent >= thresholds.error) { return 'error'; }
  return percent >= thresholds.warning ? 'warning' : 'ok';
}


const BAR_WIDTH = 240;

export function progressBarImage(percent: number, thresholds: Thresholds = DEFAULT_THRESHOLDS): string {
  const clamped = Math.min(100, Math.max(0, percent));
  const colors = { ok: '#3794ff', warning: '#d4a72c', error: '#e5534b' };
  const fill = colors[severityOf(clamped, thresholds)];
  const filled = Math.round((clamped / 100) * BAR_WIDTH);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${BAR_WIDTH}" height="${BAR_SVG_HEIGHT}">` +
    `<rect width="${BAR_WIDTH}" height="${BAR_SVG_HEIGHT}" rx="4" fill="#808080" fill-opacity="0.35"/>` +
    (filled > 0 ? `<rect width="${Math.max(filled, BAR_SVG_HEIGHT)}" height="${BAR_SVG_HEIGHT}" rx="4" fill="${fill}"/>` : '') +
    '</svg>';
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const THOUSAND = 1_000;
const MILLION = 1_000_000;

export function formatTokens(count: number): string {
  if (count < THOUSAND) { return String(count); }
  const compact = (value: number, suffix: string) => `${value.toFixed(1).replace(/\.0$/, '')}${suffix}`;
  return count < MILLION ? compact(count / THOUSAND, 'k') : compact(count / MILLION, 'M');
}
