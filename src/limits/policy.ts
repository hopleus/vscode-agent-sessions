export const CLAUDE_REFRESH_MS = 5 * 60_000;
export const MAX_BACKOFF_MS = 60 * 60_000;

export interface RefreshOutcome {
  ok: boolean;
  retryAfterMs?: number;
}

export function nextClaudeBackoff(currentMs: number, outcome: RefreshOutcome): number {
  if (outcome.retryAfterMs !== undefined) {
    return Math.min(MAX_BACKOFF_MS, Math.max(outcome.retryAfterMs, currentMs));
  }
  return outcome.ok ? CLAUDE_REFRESH_MS : Math.min(MAX_BACKOFF_MS, currentMs * 2);
}
