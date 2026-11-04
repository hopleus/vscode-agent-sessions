import * as fs from 'fs';
import * as path from 'path';
import { LimitsResult } from './types';

const LOCK_STALE_MS = 30_000;

export interface SharedUsage {
  result: LimitsResult;
  fetchedAt: number;
  nextAt: number;
  backoffMs: number;
}

export function readSharedUsage(dir: string, name = 'claude'): SharedUsage | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, `${name}-usage.json`), 'utf8')) as Partial<SharedUsage> | null;
    const result = raw?.result;
    const valid = !!result && (result.kind === 'ok' || result.kind === 'unavailable')
      && typeof raw?.fetchedAt === 'number' && typeof raw.nextAt === 'number' && typeof raw.backoffMs === 'number';
    return valid ? raw as SharedUsage : undefined;
  } catch {
    return undefined;
  }
}

export function writeSharedUsage(dir: string, usage: SharedUsage, name = 'claude'): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `${name}-usage.json`);
    const temp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(usage), { mode: 0o600 });
    fs.renameSync(temp, target);
  } catch { /* the cache is an optimization */ }
}

export function acquireUsageLock(dir: string, now: number = Date.now(), name = 'claude'): (() => void) | undefined {
  const lock = path.join(dir, `${name}-usage.lock`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (now - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) { fs.rmSync(lock, { force: true }); }
  } catch { /* no lock yet */ }
  try {
    fs.closeSync(fs.openSync(lock, 'wx', 0o600));
    return () => { try { fs.rmSync(lock, { force: true }); } catch { /* already gone */ } };
  } catch {
    return undefined;
  }
}
