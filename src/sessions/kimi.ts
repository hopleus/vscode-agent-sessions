import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileStamp, sameStamp, statFile, summarize } from './jsonl';
import { isSafeId, NewSessionPlan, SessionRecord, SessionSource, WatchTarget } from './types';

interface KimiSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  hidden: boolean;
}

interface CachedSession extends FileStamp {
  session: KimiSession | undefined;
}

const NEW_SESSION_CLOCK_SKEW_MS = 2000;
const SLUG_LENGTH = 40;
const HASH_LENGTH = 12;
const STATE_FILES = ['state.json', path.join('session-meta', 'state.json')];

export function kimiHome(): string {
  return process.env.KIMI_CODE_HOME || path.join(os.homedir(), '.kimi-code');
}

export function kimiWorkDirKey(workDir: string): string {
  const normalized = workDir.replaceAll('\\', '/').replace(/\/+$/, '');
  const base = normalized.split('/').pop() ?? normalized;
  const slug = base.toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, SLUG_LENGTH)
    .replaceAll(/^-+|-+$/g, '');
  const safeSlug = slug === '' || slug === '.' || slug === '..' ? 'workspace' : slug;
  const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, HASH_LENGTH);
  return `wd_${safeSlug}_${hash}`;
}

export class KimiSource implements SessionSource {
  readonly agentId = 'kimi';
  private readonly cache = new Map<string, CachedSession>();

  constructor(private readonly home: () => string = kimiHome) {}

  async list(cwd: string): Promise<SessionRecord[]> {
    const sessions = await this.sessionsIn(cwd);
    return sessions
      .filter(session => !session.hidden && session.title)
      .map(session => ({ id: session.id, cwd, agentId: this.agentId, title: session.title, updatedAt: session.updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  watchTarget(cwd: string): WatchTarget {
    const keys = this.keysOf(cwd);
    return {
      path: this.sessionsDir(),
      recursive: true,
      accepts: file => keys.some(key => file === key || file.startsWith(`${key}${path.sep}`)),
    };
  }

  resumeCommand(command: string, id: string): string {
    return `${command} --session ${id}`;
  }

  newSession(command: string): NewSessionPlan {
    return {
      kind: 'discovered',
      command,
      find: (cwd, since, taken) => this.findNewSession(cwd, since, taken),
    };
  }

  async delete(id: string, cwd: string): Promise<void> {
    const dir = (await this.sessionDirsIn(cwd)).find(candidate => path.basename(candidate) === id);
    if (!dir) { throw new Error('The Kimi session folder was not found.'); }
    await fs.promises.rm(dir, { recursive: true });
    for (const file of STATE_FILES) { this.cache.delete(path.join(dir, file)); }
  }

  private async findNewSession(cwd: string, since: number, taken: ReadonlySet<string>): Promise<string | undefined> {
    const sessions = await this.sessionsIn(cwd);
    return sessions
      .filter(session => !session.hidden && session.createdAt >= since - NEW_SESSION_CLOCK_SKEW_MS && !taken.has(session.id))
      .sort((a, b) => a.createdAt - b.createdAt)[0]?.id;
  }

  private sessionsDir(): string {
    return path.join(this.home(), 'sessions');
  }

  private keysOf(cwd: string): string[] {
    const keys = new Set([kimiWorkDirKey(cwd)]);
    try { keys.add(kimiWorkDirKey(fs.realpathSync(cwd))); } catch { /* missing folder */ }
    return [...keys];
  }

  private async sessionDirsIn(cwd: string): Promise<string[]> {
    const nested = await Promise.all(this.keysOf(cwd).map(async key => {
      const bucket = path.join(this.sessionsDir(), key);
      try {
        const entries = await fs.promises.readdir(bucket, { withFileTypes: true });
        return entries
          .filter(entry => entry.isDirectory() && entry.name.startsWith('session_') && isSafeId(entry.name))
          .map(entry => path.join(bucket, entry.name));
      } catch {
        return [];
      }
    }));
    return nested.flat();
  }

  private async sessionsIn(cwd: string): Promise<KimiSession[]> {
    const sessions = await Promise.all((await this.sessionDirsIn(cwd)).map(dir => this.sessionOf(dir)));
    return sessions.filter((session): session is KimiSession => !!session);
  }

  private async sessionOf(dir: string): Promise<KimiSession | undefined> {
    for (const name of STATE_FILES) {
      const file = path.join(dir, name);
      try {
        const info = await statFile(file);
        const cached = this.cache.get(file);
        if (cached && sameStamp(cached, info)) { return cached.session; }
        const session = parseState(path.basename(dir), await fs.promises.readFile(file, 'utf8'), info.mtime);
        this.cache.set(file, { mtime: info.mtime, size: info.size, session });
        return session;
      } catch {
        continue;
      }
    }
    return undefined;
  }
}

export function parseState(id: string, raw: string, mtime: number): KimiSession | undefined {
  try {
    const state = JSON.parse(raw) as Record<string, unknown>;
    const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
    const custom = state.custom as Record<string, unknown> | undefined;
    const title = text(state.title) || summarize(text(state.lastPrompt));
    return {
      id,
      title,
      createdAt: parseTime(state.createdAt) || mtime,
      updatedAt: parseTime(state.updatedAt) || mtime,
      hidden: state.archived === true || custom?.imported_from_kimi_cli === true,
    };
  } catch {
    return undefined;
  }
}

function parseTime(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) { return value; }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}
