import * as fs from 'fs';
import * as path from 'path';
import { codexHome } from '../sessions/codex';
import { JsonEntry, readEdges, statFile } from '../sessions/jsonl';
import { AgentLimits, LimitsResult, LimitWindow } from './types';

const RECENT_FILES = 5;
const TAIL_BYTES = 256 * 1024;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

export async function readCodexLimits(home: string = codexHome()): Promise<LimitsResult> {
  const unavailable = (reason: string): LimitsResult =>
    ({ kind: 'unavailable', agentId: 'codex', agentName: 'Codex', reason });
  const files = await recentRollouts(path.join(home, 'sessions'));
  for (const file of files) {
    const entry = await lastRateLimits(file);
    if (entry) { return { kind: 'ok', limits: toLimits(entry) }; }
  }
  return unavailable('No rate limit data in recent Codex sessions yet.');
}

export function windowLabel(minutes: number): string {
  if (minutes % MINUTES_PER_DAY === 0) { return `${minutes / MINUTES_PER_DAY}-day`; }
  if (minutes % MINUTES_PER_HOUR === 0) { return `${minutes / MINUTES_PER_HOUR}-hour`; }
  return `${minutes}-minute`;
}

async function recentRollouts(sessionsDir: string): Promise<string[]> {
  const all = await listRollouts(sessionsDir);
  const stamped = await Promise.all(all.map(async file => {
    try { return { file, mtime: (await statFile(file)).mtime }; } catch { return undefined; }
  }));
  return stamped
    .filter((item): item is { file: string; mtime: number } => !!item)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, RECENT_FILES)
    .map(item => item.file);
}

async function listRollouts(dir: string): Promise<string[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(entries.map(async entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { return listRollouts(full); }
    return entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl') ? [full] : [];
  }));
  return nested.flat();
}

async function lastRateLimits(file: string): Promise<JsonEntry | undefined> {
  try {
    const { size } = await statFile(file);
    const { tail } = await readEdges(file, size, TAIL_BYTES);
    for (let i = tail.length - 1; i >= 0; i--) {
      if (tail[i].payload?.rate_limits?.primary) { return tail[i]; }
    }
  } catch { /* unreadable file */ }
  return undefined;
}

function toLimits(entry: JsonEntry): AgentLimits {
  const rateLimits = entry.payload.rate_limits;
  const windows = [rateLimits.primary, rateLimits.secondary]
    .filter(Boolean)
    .map((raw): LimitWindow => ({
      label: windowLabel(Number(raw.window_minutes)),
      usedPercent: Number(raw.used_percent),
      resetsAt: typeof raw.resets_at === 'number' ? raw.resets_at * 1000 : undefined,
    }));
  const details: string[] = [];
  if (rateLimits.plan_type) { details.push(`Plan: ${rateLimits.plan_type}`); }
  const observed = Date.parse(entry.timestamp);
  return {
    agentId: 'codex',
    agentName: 'Codex',
    windows,
    details,
    observedAt: Number.isNaN(observed) ? undefined : observed,
  };
}
