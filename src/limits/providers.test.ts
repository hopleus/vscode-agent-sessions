import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { providerById, providerOfModel } from '../providers';
import { fetchDeepSeekBalance, parseBalance } from './deepseek';
import { fetchGlmQuota, parseQuota } from './glm';
import { statusSeverity, statusText, tooltipMarkdown } from './presentation';

const THRESHOLDS = { warning: 80, error: 95 };

function fakeFetch(response: Response, seen: { url?: unknown; headers?: unknown } = {}): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    seen.url = url;
    seen.headers = init?.headers;
    return response;
  }) as typeof fetch;
}

describe('providers', () => {
  it('recognizes GLM and DeepSeek models', () => {
    assert.equal(providerOfModel('glm-5.3'), 'glm');
    assert.equal(providerOfModel('GLM-5.3-Flash'), 'glm');
    assert.equal(providerOfModel('deepseek-v4-pro'), 'deepseek');
    assert.equal(providerOfModel('claude-opus-4-1'), undefined);
    assert.equal(providerOfModel(undefined), undefined);
  });

  it('passes the key to Claude Code through the environment', () => {
    assert.deepEqual(providerById('glm')?.env('k1'), {
      ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic', ANTHROPIC_AUTH_TOKEN: 'k1', API_TIMEOUT_MS: '3000000',
    });
    assert.deepEqual(providerById('deepseek')?.env('k2'), {
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic', ANTHROPIC_AUTH_TOKEN: 'k2',
    });
  });
});

describe('GLM quota', () => {
  const body = {
    code: 200, success: true,
    data: {
      level: 'pro',
      limits: [
        { type: 'TIME_LIMIT', unit: 5, number: 1, percentage: 12, usageDetails: [] },
        { type: 'CREDIT_LIMIT', unit: 6, number: 1, percentage: 41, nextResetTime: 2_000_000 },
        { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 7.5, nextResetTime: 1_000_000 },
      ],
    },
  };

  it('reads the 5-hour, weekly and MCP windows, shortest first', () => {
    const outcome = parseQuota(body, 5);
    assert.equal(outcome.result.kind, 'ok');
    if (outcome.result.kind !== 'ok') { return; }
    assert.deepEqual(outcome.result.limits.windows, [
      { label: '5-hour', usedPercent: 7.5, resetsAt: 1_000_000 },
      { label: '7-day', usedPercent: 41, resetsAt: 2_000_000 },
      { label: 'MCP 1-month', usedPercent: 12, resetsAt: undefined },
    ]);
    assert.deepEqual(outcome.result.limits.details, ['Plan: pro']);
  });

  it('reports errors from the envelope and empty quotas', () => {
    const failed = parseQuota({ success: false, msg: 'Invalid key' }, 0).result;
    assert.equal(failed.kind === 'unavailable' && failed.reason, 'Z.ai: Invalid key');
    assert.equal(parseQuota({ success: true, data: { limits: [] } }, 0).result.kind, 'unavailable');
  });

  it('sends the key as the plugin of Z.ai does and handles rate limiting', async () => {
    const seen: { url?: unknown; headers?: unknown } = {};
    const ok = await fetchGlmQuota('secret', { fetch: fakeFetch(new Response(JSON.stringify(body)), seen), now: () => 0 });
    assert.equal(ok.result.kind, 'ok');
    assert.equal(seen.url, 'https://api.z.ai/api/monitor/usage/quota/limit');
    assert.equal((seen.headers as Record<string, string>).Authorization, 'secret');
    const limited = await fetchGlmQuota('secret', {
      fetch: fakeFetch(new Response('', { status: 429, headers: { 'retry-after': '30' } })), now: () => 0,
    });
    assert.equal(limited.transient, true);
    assert.equal(limited.retryAfterMs, 30_000);
    const rejected = await fetchGlmQuota('secret', { fetch: fakeFetch(new Response('', { status: 401 })), now: () => 0 });
    assert.equal(rejected.transient, false);
  });
});

describe('DeepSeek balance', () => {
  const body = {
    is_available: true,
    balance_infos: [{ currency: 'USD', total_balance: '12.50', granted_balance: '2.50', topped_up_balance: '10.00' }],
  };

  it('reads the balance and shows it in the status bar', () => {
    const { result } = parseBalance(body, 0);
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') { return; }
    assert.deepEqual(result.limits.balances, [{ currency: 'USD', total: 12.5, granted: 2.5, toppedUp: 10 }]);
    assert.equal(statusText(result, 0), '$12.50');
    assert.equal(statusSeverity(result, THRESHOLDS), 'ok');
    const tooltip = tooltipMarkdown({
      agentId: 'deepseek', sessionTitle: undefined, result, claudeEnabled: false, thresholds: THRESHOLDS, now: 0, refreshCommand: 'x',
    });
    assert.match(tooltip, /\*\*DeepSeek Balance\*\*/);
    assert.match(tooltip, /Balance &nbsp;\|&nbsp; \*\*\$12\.50\*\*/);
    assert.match(tooltip, /_Topped up \$10\.00 · granted \$2\.50_/);
  });

  it('turns red when the balance is not enough for calls', () => {
    const { result } = parseBalance({ ...body, is_available: false }, 0);
    assert.equal(statusSeverity(result, THRESHOLDS), 'error');
  });

  it('ignores malformed balances and uses a bearer token', async () => {
    assert.equal(parseBalance({ balance_infos: [{ currency: 'usd', total_balance: 'x' }] }, 0).result.kind, 'unavailable');
    const seen: { url?: unknown; headers?: unknown } = {};
    await fetchDeepSeekBalance('secret', { fetch: fakeFetch(new Response(JSON.stringify(body)), seen), now: () => 0 });
    assert.equal(seen.url, 'https://api.deepseek.com/user/balance');
    assert.equal((seen.headers as Record<string, string>).Authorization, 'Bearer secret');
  });
});

describe('API key prompt in the tooltip', () => {
  it('links to the command that sets the key', () => {
    const tooltip = tooltipMarkdown({
      agentId: 'glm', sessionTitle: 'S', result: undefined, claudeEnabled: false, setKeyCommand: 'agentSessions.setApiKey.glm',
      thresholds: THRESHOLDS, now: 0, refreshCommand: 'x',
    });
    assert.match(tooltip, /\*\*GLM Usage\*\*/);
    assert.match(tooltip, /\[Set API key\]\(command:agentSessions\.setApiKey\.glm\)/);
  });
});
