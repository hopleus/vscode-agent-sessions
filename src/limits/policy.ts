export const MIN_REFRESH_MINUTES = 1;
export const MAX_REFRESH_MINUTES = 60;
export const DEFAULT_REFRESH_MINUTES = 1;
export const MAX_BACKOFF_MS = 60 * 60_000;

export interface RefreshOutcome {
  ok: boolean;
  retryAfterMs?: number;
}

export function refreshIntervalMs(minutes: number | undefined): number {
  const value = typeof minutes === 'number' && Number.isFinite(minutes) ? minutes : DEFAULT_REFRESH_MINUTES;
  return Math.min(MAX_REFRESH_MINUTES, Math.max(MIN_REFRESH_MINUTES, value)) * 60_000;
}

export function nextClaudeBackoff(currentMs: number, outcome: RefreshOutcome, baseMs: number): number {
  if (outcome.retryAfterMs !== undefined) {
    return Math.min(MAX_BACKOFF_MS, Math.max(outcome.retryAfterMs, currentMs, baseMs));
  }
  return outcome.ok ? baseMs : Math.min(MAX_BACKOFF_MS, Math.max(baseMs, currentMs * 2));
}
