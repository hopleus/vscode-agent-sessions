import { DEEPSEEK_AGENT_ID } from './agents';
import { REQUEST_TIMEOUT_MS, RemoteDeps, retryAfterOf, unavailable } from './remote';
import { Balance, UsageOutcome } from './types';

const BALANCE_URL = 'https://api.deepseek.com/user/balance';
const NAME = 'DeepSeek';

interface BalanceInfo {
  currency?: unknown;
  total_balance?: unknown;
  granted_balance?: unknown;
  topped_up_balance?: unknown;
}

interface BalanceBody {
  is_available?: unknown;
  balance_infos?: unknown;
}

export async function fetchDeepSeekBalance(key: string, deps: RemoteDeps): Promise<UsageOutcome> {
  let response: Response;
  try {
    response = await deps.fetch(BALANCE_URL, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return unavailable(DEEPSEEK_AGENT_ID, NAME, 'Could not reach api.deepseek.com.', undefined, true);
  }
  if (response.status === 401 || response.status === 403) {
    return unavailable(DEEPSEEK_AGENT_ID, NAME, 'DeepSeek rejected the API key.');
  }
  if (response.status === 429) {
    return unavailable(DEEPSEEK_AGENT_ID, NAME, 'DeepSeek is rate limiting balance requests. Will retry later.', retryAfterOf(response), true);
  }
  if (!response.ok) { return unavailable(DEEPSEEK_AGENT_ID, NAME, `DeepSeek returned HTTP ${response.status}.`, undefined, true); }
  try {
    return parseBalance((await response.json()) as BalanceBody, deps.now());
  } catch {
    return unavailable(DEEPSEEK_AGENT_ID, NAME, 'Unexpected response from DeepSeek.');
  }
}

export function parseBalance(body: BalanceBody | null, now: number): UsageOutcome {
  const infos = Array.isArray(body?.balance_infos) ? body.balance_infos as BalanceInfo[] : [];
  const balances = infos.flatMap(toBalance);
  if (balances.length === 0) { return unavailable(DEEPSEEK_AGENT_ID, NAME, 'DeepSeek returned no balance.'); }
  const available = body?.is_available !== false;
  return {
    result: {
      kind: 'ok',
      limits: { agentId: DEEPSEEK_AGENT_ID, agentName: NAME, windows: [], balances, available, details: [], observedAt: now },
    },
  };
}

function toBalance(info: BalanceInfo): Balance[] {
  const amount = (value: unknown) => {
    const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const total = amount(info.total_balance);
  const currency = typeof info.currency === 'string' && /^[A-Z]{3}$/.test(info.currency) ? info.currency : undefined;
  if (total === undefined || !currency) { return []; }
  return [{ currency, total, granted: amount(info.granted_balance) ?? 0, toppedUp: amount(info.topped_up_balance) ?? 0 }];
}
