import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentLimits, LimitsResult, LimitWindow } from './types';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const USER_AGENT = 'claude-code/2.1.131';
const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const OAUTH_BETA = 'oauth-2025-04-20';
const REQUEST_TIMEOUT_MS = 10_000;

export interface Credentials {
  accessToken: string;
  expiresAt?: number;
  subscriptionType?: string;
}

export interface UsageDeps {
  readCredentials(): Promise<Credentials | undefined>;
  fetch: typeof fetch;
  now(): number;
}

export interface ClaudeUsageOutcome {
  result: LimitsResult;
  retryAfterMs?: number;
  transient?: boolean;
}

export function parseCredentials(raw: string): Credentials | undefined {
  try {
    const oauth = JSON.parse(raw)?.claudeAiOauth;
    if (typeof oauth?.accessToken !== 'string' || !oauth.accessToken) { return undefined; }
    return {
      accessToken: oauth.accessToken,
      expiresAt: typeof oauth.expiresAt === 'number' ? oauth.expiresAt : undefined,
      subscriptionType: typeof oauth.subscriptionType === 'string' ? oauth.subscriptionType : undefined,
    };
  } catch {
    return undefined;
  }
}

export async function readCredentials(): Promise<Credentials | undefined> {
  if (process.platform === 'darwin') {
    const fromKeychain = await readKeychain();
    if (fromKeychain) { return fromKeychain; }
  }
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  try {
    return parseCredentials(await fs.promises.readFile(path.join(dir, '.credentials.json'), 'utf8'));
  } catch {
    return undefined;
  }
}

function readKeychain(): Promise<Credentials | undefined> {
  return new Promise(resolve => {
    execFile('/usr/bin/security', ['find-generic-password', '-w', '-s', KEYCHAIN_SERVICE],
      { timeout: REQUEST_TIMEOUT_MS }, (error, stdout) => {
        resolve(error ? undefined : parseCredentials(stdout.trim()));
      });
  });
}

export async function fetchClaudeUsage(deps: UsageDeps): Promise<ClaudeUsageOutcome> {
  const unavailable = (reason: string, retryAfterMs?: number, transient = false): ClaudeUsageOutcome => ({
    result: { kind: 'unavailable', agentId: 'claude', agentName: 'Claude', reason },
    retryAfterMs,
    transient,
  });
  const credentials = await deps.readCredentials();
  if (!credentials) {
    return unavailable('No Claude Code login found. Sign in to Claude Code with a Pro or Max subscription.');
  }
  if (credentials.expiresAt !== undefined && credentials.expiresAt <= deps.now()) {
    return unavailable('The Claude Code login has expired. Use Claude Code once to refresh it.');
  }
  let response: Response;
  try {
    response = await deps.fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'anthropic-beta': OAUTH_BETA,
        'User-Agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return unavailable('Could not reach api.anthropic.com.', undefined, true);
  }
  if (response.status === 401 || response.status === 403) {
    return unavailable('Claude rejected the stored login. Use Claude Code once to refresh it.');
  }
  if (response.status === 429) {
    return unavailable('Claude is rate limiting usage requests. Will retry later.', retryAfterOf(response), true);
  }
  if (!response.ok) { return unavailable(`Claude returned HTTP ${response.status}.`, undefined, true); }
  try {
    return { result: { kind: 'ok', limits: parseUsage((await response.json()) as UsageBody, credentials, deps.now()) } };
  } catch {
    return unavailable('Unexpected response from Claude.');
  }
}

interface UsageQuota {
  utilization?: unknown;
  resets_at?: unknown;
}

interface UsageBody {
  five_hour?: UsageQuota | null;
  seven_day?: UsageQuota | null;
  seven_day_sonnet?: UsageQuota | null;
  extra_usage?: { is_enabled?: unknown; utilization?: unknown } | null;
}

function parseUsage(body: UsageBody | null, credentials: Credentials, now: number): AgentLimits {
  const windows: LimitWindow[] = [];
  const add = (label: string, quota: UsageQuota | null | undefined) => {
    if (!quota || typeof quota.utilization !== 'number') { return; }
    const resets = typeof quota.resets_at === 'string' ? Date.parse(quota.resets_at) : NaN;
    windows.push({ label, usedPercent: quota.utilization, resetsAt: Number.isNaN(resets) ? undefined : resets });
  };
  add('5-hour', body?.five_hour);
  add('7-day', body?.seven_day);
  add('7-day Sonnet', body?.seven_day_sonnet);
  const details: string[] = [];
  const extra = body?.extra_usage;
  if (extra?.is_enabled && typeof extra.utilization === 'number') {
    details.push(`Extra usage: ${Math.round(extra.utilization)}% of the monthly limit`);
  }
  if (credentials.subscriptionType) { details.push(`Plan: ${credentials.subscriptionType}`); }
  return { agentId: 'claude', agentName: 'Claude', windows, details, observedAt: now };
}

function retryAfterOf(response: Response): number | undefined {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}
