import { GLM_AGENT_ID } from './agents';
import { REQUEST_TIMEOUT_MS, RemoteDeps, retryAfterOf, unavailable } from './remote';
import { LimitWindow, UsageOutcome } from './types';

const QUOTA_URL = 'https://api.z.ai/api/monitor/usage/quota/limit';
const NAME = 'GLM';
const UNIT_HOURS = 3;
const UNIT_MONTHS = 5;
const UNIT_WEEKS = 6;
const HOURS_PER_WEEK = 168;
const HOURS_PER_MONTH = 720;
const DAYS_PER_WEEK = 7;

interface QuotaLimit {
  type?: unknown;
  unit?: unknown;
  number?: unknown;
  percentage?: unknown;
  nextResetTime?: unknown;
  usageDetails?: unknown;
}

interface QuotaBody {
  success?: unknown;
  msg?: unknown;
  data?: { limits?: unknown; level?: unknown } | null;
}

interface RankedWindow extends LimitWindow {
  rank: number;
}

export async function fetchGlmQuota(key: string, deps: RemoteDeps): Promise<UsageOutcome> {
  let response: Response;
  try {
    response = await deps.fetch(QUOTA_URL, {
      headers: { Authorization: key, Accept: 'application/json', 'Accept-Language': 'en-US,en' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return unavailable(GLM_AGENT_ID, NAME, 'Could not reach api.z.ai.', undefined, true);
  }
  if (response.status === 401 || response.status === 403) {
    return unavailable(GLM_AGENT_ID, NAME, 'Z.ai rejected the API key. Use the key of your GLM Coding Plan.');
  }
  if (response.status === 429) {
    return unavailable(GLM_AGENT_ID, NAME, 'Z.ai is rate limiting usage requests. Will retry later.', retryAfterOf(response), true);
  }
  if (!response.ok) { return unavailable(GLM_AGENT_ID, NAME, `Z.ai returned HTTP ${response.status}.`, undefined, true); }
  try {
    return parseQuota((await response.json()) as QuotaBody, deps.now());
  } catch {
    return unavailable(GLM_AGENT_ID, NAME, 'Unexpected response from Z.ai.');
  }
}

export function parseQuota(body: QuotaBody | null, now: number): UsageOutcome {
  if (body?.success === false) {
    return unavailable(GLM_AGENT_ID, NAME, typeof body.msg === 'string' && body.msg ? `Z.ai: ${body.msg}` : 'Z.ai returned an error.');
  }
  const limits = Array.isArray(body?.data?.limits) ? body.data.limits as QuotaLimit[] : [];
  const windows = limits.flatMap(toWindow).sort((a, b) => a.rank - b.rank).map(({ rank: _rank, ...window }) => window);
  if (windows.length === 0) {
    return unavailable(GLM_AGENT_ID, NAME, 'No GLM Coding Plan quota found for this API key.');
  }
  const level = body?.data?.level;
  const details = typeof level === 'string' && level && level !== 'unknown' ? [`Plan: ${level}`] : [];
  return { result: { kind: 'ok', limits: { agentId: GLM_AGENT_ID, agentName: NAME, windows, details, observedAt: now } } };
}

function toWindow(limit: QuotaLimit): RankedWindow[] {
  if (typeof limit.percentage !== 'number' || !Number.isFinite(limit.percentage)) { return []; }
  const count = typeof limit.number === 'number' && limit.number > 0 ? limit.number : 1;
  const { label, hours } = period(limit.unit, count);
  const isTool = limit.type === 'TIME_LIMIT' && limit.usageDetails !== undefined;
  const resetsAt = typeof limit.nextResetTime === 'number' && limit.nextResetTime > 0 ? limit.nextResetTime : undefined;
  return [{
    label: isTool ? `MCP ${label}` : label,
    usedPercent: limit.percentage,
    resetsAt,
    rank: isTool ? Number.MAX_SAFE_INTEGER : hours,
  }];
}

function period(unit: unknown, count: number): { label: string; hours: number } {
  if (unit === UNIT_HOURS) { return { label: `${count}-hour`, hours: count }; }
  if (unit === UNIT_WEEKS) { return { label: `${count * DAYS_PER_WEEK}-day`, hours: count * HOURS_PER_WEEK }; }
  if (unit === UNIT_MONTHS) { return { label: `${count}-month`, hours: count * HOURS_PER_MONTH }; }
  return { label: 'Usage', hours: Number.MAX_SAFE_INTEGER - 1 };
}
