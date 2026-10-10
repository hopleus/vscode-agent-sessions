import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { OpenCodeSource } from './opencode';

const CWD = '/work/project';

function loadSqlite(): typeof import('node:sqlite') | undefined {
  try { return require('node:sqlite'); } catch { return undefined; }
}

const sqlite = loadSqlite();

interface SessionSeed {
  id: string;
  directory?: string;
  title?: string;
  parentId?: string;
  archived?: number;
  created?: number;
  updated?: number;
  messages?: number;
}

describe('OpenCodeSource', { skip: !sqlite && 'node:sqlite is not available' }, () => {
  let dir: string;
  let database: string;
  let source: OpenCodeSource;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sessions-oc-'));
    database = path.join(dir, 'opencode.db');
    source = new OpenCodeSource(() => database);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function seed(...sessions: SessionSeed[]): void {
    const db = new sqlite!.DatabaseSync(database);
    db.exec(`
      CREATE TABLE IF NOT EXISTS session (
        id TEXT PRIMARY KEY, directory TEXT NOT NULL, title TEXT NOT NULL, parent_id TEXT,
        time_archived INTEGER, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL);`);
    for (const s of sessions) {
      db.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        s.id, s.directory ?? CWD, s.title ?? s.id, s.parentId ?? null, s.archived ?? null, s.created ?? 1000, s.updated ?? 1000,
      );
      for (let i = 0; i < (s.messages ?? 1); i++) {
        db.prepare('INSERT INTO message VALUES (?, ?)').run(`${s.id}-m${i}`, s.id);
      }
    }
    db.close();
  }

  it('returns nothing when the database does not exist', async () => {
    assert.deepEqual(await source.list(CWD), []);
  });

  it('lists the sessions of the workspace, newest first', async () => {
    seed(
      { id: 'ses_old', title: 'Old', updated: 1000 },
      { id: 'ses_new', title: 'New', updated: 3000 },
      { id: 'ses_other', directory: '/other', title: 'Other project' },
    );
    const sessions = await source.list(CWD);
    assert.deepEqual(sessions.map(s => [s.id, s.title, s.updatedAt, s.cwd, s.agentId]), [
      ['ses_new', 'New', 3000, CWD, 'opencode'],
      ['ses_old', 'Old', 1000, CWD, 'opencode'],
    ]);
  });

  it('skips child, archived and empty sessions', async () => {
    seed(
      { id: 'ses_ok' },
      { id: 'ses_child', parentId: 'ses_ok' },
      { id: 'ses_archived', archived: 5000 },
      { id: 'ses_empty', messages: 0 },
    );
    assert.deepEqual((await source.list(CWD)).map(s => s.id), ['ses_ok']);
  });

  it('reads the database while a writer keeps it open in WAL mode', async () => {
    seed({ id: 'ses_1' });
    const writer = new sqlite!.DatabaseSync(database);
    writer.exec('PRAGMA journal_mode=WAL');
    writer.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?)').run('ses_2', CWD, 'Two', null, null, 2000, 2000);
    writer.prepare('INSERT INTO message VALUES (?, ?)').run('m2', 'ses_2');
    try {
      assert.deepEqual((await source.list(CWD)).map(s => s.id).sort(), ['ses_1', 'ses_2']);
    } finally {
      writer.close();
    }
  });

  it('finds a session created after the launch and honours taken ids', async () => {
    seed({ id: 'ses_before', created: 1000 }, { id: 'ses_after', created: 9000 });
    const plan = source.newSession('opencode');
    assert.equal(plan.kind, 'discovered');
    if (plan.kind !== 'discovered') { return; }
    assert.equal(await plan.find(CWD, 5000, new Set()), 'ses_after');
    assert.equal(await plan.find(CWD, 5000, new Set(['ses_after'])), undefined);
    assert.equal(await plan.find('/other', 5000, new Set()), undefined);
  });

  it('watches the database and its WAL, but not the shared-memory index it touches on every read', () => {
    const target = source.watchTarget();
    assert.equal(target.path, dir);
    assert.ok(target.accepts?.('opencode.db'));
    assert.ok(target.accepts?.('opencode.db-wal'));
    assert.ok(!target.accepts?.('opencode.db-shm'));
    assert.ok(!target.accepts?.('log'));
  });

  it('asks to be polled because file events for SQLite writes are unreliable', () => {
    assert.ok((source.pollIntervalMs ?? 0) > 0);
  });

  it('builds the resume command', () => {
    assert.equal(source.resumeCommand('opencode', 'ses_1'), 'opencode --session ses_1');
  });
});
