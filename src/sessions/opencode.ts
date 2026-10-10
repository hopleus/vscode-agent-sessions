import type { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NewSessionPlan, SessionRecord, SessionSource, WatchTarget } from './types';

interface SessionRow {
  id: string;
  title: string;
  time_created: number;
  time_updated: number;
}

const NEW_SESSION_CLOCK_SKEW_MS = 2000;
const POLL_INTERVAL_MS = 3000;

const LIST_SESSIONS_SQL = `
  SELECT s.id, s.title, s.time_created, s.time_updated
  FROM session s
  WHERE s.directory = ?
    AND s.parent_id IS NULL
    AND s.time_archived IS NULL
    AND EXISTS (SELECT 1 FROM message m WHERE m.session_id = s.id)
  ORDER BY s.time_updated DESC`;

export function defaultOpenCodeDatabase(): string {
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(dataHome, 'opencode', process.env.OPENCODE_DB || 'opencode.db');
}

export class OpenCodeSource implements SessionSource {
  readonly agentId = 'opencode';
  readonly pollIntervalMs = POLL_INTERVAL_MS;

  constructor(private readonly databasePath: () => string = defaultOpenCodeDatabase) {}

  async list(cwd: string): Promise<SessionRecord[]> {
    return this.query(cwd).map(row => ({
      id: row.id,
      cwd,
      agentId: this.agentId,
      title: row.title,
      updatedAt: row.time_updated,
    }));
  }

  watchTarget(): WatchTarget {
    const database = this.databasePath();
    const watched = [path.basename(database), `${path.basename(database)}-wal`];
    return {
      path: path.dirname(database),
      recursive: false,
      accepts: file => watched.includes(path.basename(file)),
    };
  }

  resumeCommand(command: string, id: string): string {
    return `${command} --session ${id}`;
  }

  newSession(command: string): NewSessionPlan {
    return {
      kind: 'discovered',
      command,
      find: async (cwd, since, taken) => this.findNewSession(cwd, since, taken),
    };
  }

  private findNewSession(cwd: string, since: number, taken: ReadonlySet<string>): string | undefined {
    return this.query(cwd)
      .filter(row => row.time_created >= since - NEW_SESSION_CLOCK_SKEW_MS && !taken.has(row.id))
      .sort((a, b) => a.time_created - b.time_created)[0]?.id;
  }

  private query(cwd: string): SessionRow[] {
    const database = this.databasePath();
    if (!fs.existsSync(database)) { return []; }
    const sqlite = loadSqlite();
    if (!sqlite) { return []; }
    let db: DatabaseSync | undefined;
    try {
      db = new sqlite.DatabaseSync(database, { readOnly: true });
      return db.prepare(LIST_SESSIONS_SQL).all(cwd) as unknown as SessionRow[];
    } catch {
      return [];
    } finally {
      db?.close();
    }
  }
}

function loadSqlite(): typeof import('node:sqlite') | undefined {
  try {
    return require('node:sqlite');
  } catch {
    return undefined;
  }
}
