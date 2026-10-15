import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fetchClaudeUsage, parseCredentials, UsageDeps } from './claude';
import { readCodexLimits, windowLabel } from './codex';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-limits-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('windowLabel', () => {
  it('describes common windows', () => {
    assert.equal(windowLabel(10080), '7-day');
    assert.equal(windowLabel(300), '5-hour');
    assert.equal(windowLabel(45), '45-minute');
  });
});

describe('readCodexLimits', () => {
  function writeRollout(name: string, mtimeSec: number, ...events: object[]): void {
    const dir = path.join(root, 'sessions', '2026', '10', '09');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, events.map(e => JSON.stringify(e)).join('\n') + '\n');
    fs.utimesSync(file, mtimeSec, mtimeSec);
  }

  const tokenCount = (used: number, timestamp: string) => ({
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      rate_limits: {
        primary: { used_percent: used, window_minutes: 10080, resets_at: 1789805610 },
        secondary: null,
        plan_type: 'prolite',
      },
    },
  });

  it('uses the newest rate limit event of the most recently written session', async () => {
    writeRollout('rollout-old.jsonl', 1000, tokenCount(10, '2026-10-01T10:00:00Z'));
    writeRollout('rollout-new.jsonl', 2000, tokenCount(40, '2026-10-09T10:00:00Z'), tokenCount(51, '2026-10-09T11:00:00Z'));
    const result = await readCodexLimits(root);
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') { return; }
    assert.deepEqual(result.limits.windows, [{ label: '7-day', usedPercent: 51, resetsAt: 1789805610000 }]);
    assert.deepEqual(result.limits.details, ['Plan: prolite']);
    assert.equal(result.limits.observedAt, Date.parse('2026-10-09T11:00:00Z'));
  });

  it('falls back to older sessions when the newest has no rate limit data', async () => {
    writeRollout('rollout-a.jsonl', 1000, tokenCount(33, '2026-10-01T10:00:00Z'));
    writeRollout('rollout-b.jsonl', 2000, { type: 'event_msg', payload: { type: 'task_started' } });
    const result = await readCodexLimits(root);
    assert.equal(result.kind === 'ok' && result.limits.windows[0].usedPercent, 33);
  });

  it('reports unavailable when there is nothing to read', async () => {
    const result = await readCodexLimits(root);
    assert.equal(result.kind, 'unavailable');
  });
});

describe('Claude usage', () => {
  const NOW = 1_800_000_000_000;
  const TOKEN = 'sk-secret-token-value';

  function deps(overrides: Partial<UsageDeps> & { response?: Response; seen?: { headers?: unknown } } = {}): UsageDeps {
    return {
      readCredentials: async () => ({ accessToken: TOKEN, expiresAt: NOW + 3600_000, subscriptionType: 'max' }),
      fetch: (async (_url: unknown, init?: RequestInit) => {
        if (overrides.seen) { overrides.seen.headers = init?.headers; }
        return overrides.response ?? new Response('{}', { status: 200 });
      }) as typeof fetch,
      now: () => NOW,
      ...overrides,
    };
  }

  it('parses credentials JSON and rejects malformed input', () => {
    assert.deepEqual(parseCredentials(JSON.stringify({ claudeAiOauth: { accessToken: 'a', expiresAt: 5, subscriptionType: 'pro' } })),
      { accessToken: 'a', expiresAt: 5, subscriptionType: 'pro' });
    assert.equal(parseCredentials('not json'), undefined);
    assert.equal(parseCredentials(JSON.stringify({ claudeAiOauth: {} })), undefined);
  });

  it('reads the 5-hour, 7-day and extra usage windows', async () => {
    const seen: { headers?: unknown } = {};
    const body = {
      five_hour: { utilization: 23.5, resets_at: '2026-10-10T18:00:00Z' },
      seven_day: { utilization: 41, resets_at: '2026-10-14T00:00:00Z' },
      seven_day_sonnet: null,
      extra_usage: { is_enabled: true, utilization: 12.4 },
    };
    const outcome = await fetchClaudeUsage(deps({ response: new Response(JSON.stringify(body)), seen }));
    assert.equal(outcome.result.kind, 'ok');
    if (outcome.result.kind !== 'ok') { return; }
    assert.deepEqual(outcome.result.limits.windows.map(w => [w.label, w.usedPercent]),
      [['5-hour', 23.5], ['7-day', 41]]);
    assert.equal(outcome.result.limits.windows[0].resetsAt, Date.parse('2026-10-10T18:00:00Z'));
    assert.deepEqual(outcome.result.limits.details, ['Extra usage: 12% of the monthly limit', 'Plan: max']);
    const headers = seen.headers as Record<string, string>;
    assert.equal(headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(headers['User-Agent'], 'claude-code/2.1.131');
  });

  it('does not call the API when there is no login or it has expired', async () => {
    let called = false;
    const trackingFetch = (async () => { called = true; return new Response('{}'); }) as typeof fetch;
    const none = await fetchClaudeUsage(deps({ readCredentials: async () => undefined, fetch: trackingFetch }));
    const expired = await fetchClaudeUsage(deps({
      readCredentials: async () => ({ accessToken: TOKEN, expiresAt: NOW - 1 }),
      fetch: trackingFetch,
    }));
    assert.equal(none.result.kind, 'unavailable');
    assert.equal(expired.result.kind, 'unavailable');
    assert.equal(called, false);
  });

  it('maps HTTP failures to messages without leaking the token', async () => {
    const unauthorized = await fetchClaudeUsage(deps({ response: new Response('{}', { status: 401 }) }));
    const limited = await fetchClaudeUsage(deps({
      response: new Response('{}', { status: 429, headers: { 'retry-after': '120' } }),
    }));
    const failing = await fetchClaudeUsage(deps({ fetch: (async () => { throw new Error(`boom ${TOKEN}`); }) as typeof fetch }));
    for (const outcome of [unauthorized, limited, failing]) {
      assert.equal(outcome.result.kind, 'unavailable');
      assert.ok(!JSON.stringify(outcome).includes(TOKEN));
    }
    assert.equal(limited.retryAfterMs, 120_000);
  });
});

describe('formatting', () => {
  const now = 1_800_000_000_000;

  it('formats remaining time', async () => {
    const { formatRemaining } = await import('./format');
    assert.equal(formatRemaining(undefined, now), 'reset time unknown');
    assert.equal(formatRemaining(now - 1, now), 'already reset');
    assert.equal(formatRemaining(now + 90 * 60_000, now), 'resets in 1h 30m');
    assert.equal(formatRemaining(now + (3 * 24 + 4) * 3_600_000, now), 'resets in 3d 4h 0m');
    assert.equal(formatRemaining(now + 20_000, now), 'resets in 1m');
  });

  it('renders the progress bar image with threshold colors', async () => {
    const { progressBarImage } = await import('./format');
    const decode = (uri: string) => Buffer.from(uri.split(',')[1], 'base64').toString();
    assert.ok(progressBarImage(21).startsWith('data:image/svg+xml;base64,'));
    assert.ok(decode(progressBarImage(21)).includes('#3794ff'));
    assert.ok(decode(progressBarImage(85)).includes('#d4a72c'));
    assert.ok(decode(progressBarImage(97)).includes('#e5534b'));
    assert.ok(decode(progressBarImage(50, { warning: 40, error: 60 })).includes('#d4a72c'));
  });

  it('classifies usage against the thresholds', async () => {
    const { severityOf } = await import('./format');
    assert.equal(severityOf(79), 'ok');
    assert.equal(severityOf(80), 'warning');
    assert.equal(severityOf(95), 'error');
    assert.equal(severityOf(30, { warning: 20, error: 40 }), 'warning');
    assert.equal(severityOf(40, { warning: 20, error: 40 }), 'error');
  });

  it('formats age', async () => {
    const { formatAge } = await import('./format');
    assert.equal(formatAge(now - 30_000, now), 'just now');
    assert.equal(formatAge(now - 5 * 60_000, now), '5 min ago');
    assert.equal(formatAge(undefined, now), 'unknown time');
  });
});

describe('presentation', () => {
  const now = 1_800_000_000_000;
  const thresholds = { warning: 80, error: 95 };
  const baseView = { sessionTitle: 'My session', claudeEnabled: true, thresholds, now, refreshCommand: 'ext.refresh' };
  const okResult = (agentId: string, windows: { label: string; usedPercent: number; resetsAt?: number }[]) => ({
    kind: 'ok' as const,
    limits: { agentId, agentName: agentId, windows, details: [] },
  });

  it('shows the percentage with the time until the reset in the status text', async () => {
    const { statusText } = await import('./presentation');
    const window = (usedPercent: number, resetsAt?: number) => okResult('codex', [{ label: '7-day', usedPercent, resetsAt }]);
    assert.equal(statusText(window(41, now + 57 * 60_000), now), '41% - 57m');
    assert.equal(statusText(window(61.6, now + (3 * 24 + 3) * 3_600_000), now), '62% - 3d 3h 0m');
    assert.equal(statusText(window(30, now + (4 * 60 + 23) * 60_000), now), '30% - 4h 23m');
    assert.equal(statusText(window(50), now), '50%');
    assert.equal(statusText(window(50, now - 1), now), '50%');
    assert.equal(statusText(undefined, now), '–%');
    assert.equal(statusText({ kind: 'unavailable', agentId: 'claude', agentName: 'Claude', reason: 'x' }, now), '–%');
  });

  it('classifies the status bar severity by the window shown in the status bar', async () => {
    const { statusSeverity } = await import('./presentation');
    const result = okResult('claude', [{ label: 'a', usedPercent: 96 }, { label: 'b', usedPercent: 40 }]);
    assert.equal(statusSeverity(result, thresholds), 'error');
    const quiet = okResult('claude', [{ label: 'a', usedPercent: 0 }, { label: 'b', usedPercent: 82 }]);
    assert.equal(statusSeverity(quiet, thresholds), 'ok');
    assert.equal(statusSeverity(quiet, thresholds, 'highest'), 'warning');
    assert.equal(statusSeverity(okResult('claude', [{ label: 'a', usedPercent: 81 }]), thresholds), 'warning');
    assert.equal(statusSeverity(undefined, thresholds), 'ok');
  });

  it('builds the tooltip with bars, reset times and the footer', async () => {
    const { tooltipMarkdown } = await import('./presentation');
    const view = {
      ...baseView,
      agentId: 'codex',
      result: okResult('codex', [
        { label: '5-hour', usedPercent: 21, resetsAt: now + 4 * 3_600_000 },
        { label: '7-day', usedPercent: 62, resetsAt: now + 3_600_000 },
      ]),
    };
    const text = tooltipMarkdown(view);
    assert.ok(text.includes('**Codex Usage**'));
    assert.ok(text.includes('My session'));
    assert.ok(text.includes('5\\-hour &nbsp;|&nbsp; **21%**'));
    assert.ok(text.includes('7\\-day &nbsp;|&nbsp; **62%**'));
    assert.equal(text.match(/data:image\/svg\+xml;base64,/g)?.length, 2);
    assert.ok(text.includes('resets in 4h 0m') && text.includes('resets in 1h 0m'));

    assert.ok(text.includes('command:ext.refresh'));
    assert.ok(!text.includes('claude.ai'));
  });

  it('offers to enable Claude limits when they are off and links to claude.ai when on', async () => {
    const { tooltipMarkdown } = await import('./presentation');
    const off = tooltipMarkdown({ ...baseView, agentId: 'claude', claudeEnabled: false, result: undefined });
    assert.ok(off.includes('Enable in settings'));
    const on = tooltipMarkdown({ ...baseView, agentId: 'claude', result: okResult('claude', [{ label: '5-hour', usedPercent: 10 }]) });
    assert.ok(on.includes('https://claude.ai/settings/usage'));
  });

  it('explains agents without limits and unavailable data', async () => {
    const { tooltipMarkdown } = await import('./presentation');
    assert.ok(tooltipMarkdown({ ...baseView, agentId: 'custom', result: undefined }).includes('no usage limits'));
    assert.ok(tooltipMarkdown({ ...baseView, agentId: 'opencode', result: undefined }).includes('No token data'));
    const unavailable = { kind: 'unavailable' as const, agentId: 'codex', agentName: 'Codex', reason: 'No data yet.' };
    assert.ok(tooltipMarkdown({ ...baseView, agentId: 'codex', result: unavailable }).includes('No data yet'));
  });

  it('escapes markdown in session titles', async () => {
    const { escapeMarkdown } = await import('./presentation');
    assert.equal(escapeMarkdown('a_b *c* [d]'), 'a\\_b \\*c\\* \\[d\\]');
  });
});

describe('claude refresh policy', () => {
  it('keeps the normal interval after success and backs off after failures', async () => {
    const { nextClaudeBackoff, MAX_BACKOFF_MS, refreshIntervalMs } = await import('./policy');
    const CLAUDE_REFRESH_MS = refreshIntervalMs(1);
    assert.equal(nextClaudeBackoff(CLAUDE_REFRESH_MS * 4, { ok: true }, CLAUDE_REFRESH_MS), CLAUDE_REFRESH_MS);
    assert.equal(nextClaudeBackoff(CLAUDE_REFRESH_MS, { ok: false }, CLAUDE_REFRESH_MS), CLAUDE_REFRESH_MS * 2);
    assert.equal(nextClaudeBackoff(MAX_BACKOFF_MS, { ok: false }, CLAUDE_REFRESH_MS), MAX_BACKOFF_MS);
    assert.equal(nextClaudeBackoff(CLAUDE_REFRESH_MS, { ok: false, retryAfterMs: 20 * 60_000 }, CLAUDE_REFRESH_MS), 20 * 60_000);
    assert.equal(nextClaudeBackoff(CLAUDE_REFRESH_MS, { ok: false, retryAfterMs: 1_000 }, CLAUDE_REFRESH_MS), CLAUDE_REFRESH_MS);
    assert.equal(refreshIntervalMs(undefined), 60_000);
    assert.equal(refreshIntervalMs(0), 60_000);
    assert.equal(refreshIntervalMs(5), 5 * 60_000);
    assert.equal(refreshIntervalMs(999), 60 * 60_000);
  });
});

describe('OpenCode token usage', () => {
  let dir: string;
  const hasSqlite = (() => { try { require('node:sqlite'); return true; } catch { return false; } })();

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tokens-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads tokens and cost of one session', { skip: !hasSqlite && 'node:sqlite is not available' }, async () => {
    const { DatabaseSync } = require('node:sqlite');
    const { readOpenCodeTokens } = await import('./opencode');
    const file = path.join(dir, 'opencode.db');
    const db = new DatabaseSync(file);
    db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, cost REAL, tokens_input INTEGER, tokens_output INTEGER,
      tokens_reasoning INTEGER, tokens_cache_read INTEGER, tokens_cache_write INTEGER);`);
    db.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?)').run('ses_1', 0.0123, 8000, 4000, 345, 100, 50);
    db.close();
    assert.deepEqual(readOpenCodeTokens('ses_1', file),
      { input: 8000, output: 4000, reasoning: 345, cacheRead: 100, cacheWrite: 50, cost: 0.0123 });
    assert.equal(readOpenCodeTokens('missing', file), undefined);
    assert.equal(readOpenCodeTokens('ses_1', path.join(dir, 'nope.db')), undefined);
  });

  it('formats token counts compactly', async () => {
    const { formatTokens } = await import('./format');
    assert.equal(formatTokens(842), '842');
    assert.equal(formatTokens(12_345), '12.3k');
    assert.equal(formatTokens(12_000), '12k');
    assert.equal(formatTokens(1_250_000), '1.3M');
  });

  it('shows tokens instead of limits for OpenCode', async () => {
    const { statusText, tooltipMarkdown } = await import('./presentation');
    const tokens = { input: 8000, output: 4000, reasoning: 345, cacheRead: 100, cacheWrite: 50, cost: 0.0123 };
    assert.equal(statusText(undefined, 0, tokens), '12.3k tokens');
    const text = tooltipMarkdown({
      agentId: 'opencode', sessionTitle: 'S', result: undefined, tokens, claudeEnabled: true,
      thresholds: { warning: 80, error: 95 }, now: 0, refreshCommand: 'ext.refresh',
    });
    assert.ok(text.includes('**OpenCode Usage**'));
    assert.ok(text.includes('Tokens: **12,345**'));
    assert.ok(text.includes('Cost: $0.0123'));
    assert.ok(!text.includes('no usage limits'));
  });
});

describe('shared Claude usage cache', () => {
  let dir: string;

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-shared-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('round-trips and rejects broken files', async () => {
    const { readSharedUsage, writeSharedUsage } = await import('./shared');
    assert.equal(readSharedUsage(dir), undefined);
    const usage = {
      result: { kind: 'unavailable' as const, agentId: 'claude', agentName: 'Claude', reason: 'x' },
      fetchedAt: 10, nextAt: 20, backoffMs: 5,
    };
    writeSharedUsage(dir, usage);
    assert.deepEqual(readSharedUsage(dir), usage);
    fs.writeFileSync(path.join(dir, 'claude-usage.json'), '{"fetchedAt":"x"}');
    assert.equal(readSharedUsage(dir), undefined);
  });

  it('lets only one window fetch at a time and recovers a stale lock', async () => {
    const { acquireUsageLock } = await import('./shared');
    const first = acquireUsageLock(dir);
    assert.ok(first);
    assert.equal(acquireUsageLock(dir), undefined);
    assert.ok(acquireUsageLock(dir, Date.now() + 60_000));
    first();
  });
});
