import { LimitsResult, UsageOutcome } from './types';

export interface RemoteDeps {
  fetch: typeof fetch;
  now(): number;
}

export const REQUEST_TIMEOUT_MS = 10_000;

export function unavailable(agentId: string, agentName: string, reason: string, retryAfterMs?: number, transient = false): UsageOutcome {
  const result: LimitsResult = { kind: 'unavailable', agentId, agentName, reason };
  return { result, retryAfterMs, transient };
}

export function retryAfterOf(response: Response): number | undefined {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}
