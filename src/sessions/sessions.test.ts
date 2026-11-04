import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ClaudeSource, usesChrome, withChrome } from './claude';
import { CodexSource } from './codex';
import { KimiSource, kimiWorkDirKey } from './kimi';
import { lastValue, readEdges } from './jsonl';
import { isSafeId } from './types';

const CWD = '/work/project';
const ID_A = '11111111-1111-1111-1111-111111111111';
const ID_B = '22222222-2222-2222-2222-222222222222';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sessions-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function jsonl(...entries: object[]): string {
  return entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
}

function userEntry(text: string, extra: object = {}): object {
  return { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] }, ...extra };
}

describe('ClaudeSource', () => {
  let projectDir: string;
  let source: ClaudeSource;

  beforeEach(() => {
    projectDir = path.join(root, CWD.replace(/[^a-zA-Z0-9]/g, '-'));
    fs.mkdirSync(projectDir, { recursive: true });
    source = new ClaudeSource(() => root);
  });

  function write(id: string, content: string): void {
    fs.writeFileSync(path.join(projectDir, `${id}.jsonl`), content);
  }

  it('prefers custom title over ai title over first prompt', async () => {
    write(ID_A, jsonl(userEntry('hello'), { type: 'ai-title', aiTitle: 'AI' }, { type: 'custom-title', customTitle: 'Mine' }));
    write(ID_B, jsonl(userEntry('hello'), { type: 'ai-title', aiTitle: 'AI' }));
    const titles = Object.fromEntries((await source.list(CWD)).map(s => [s.id, s.title]));
    assert.deepEqual(titles, { [ID_A]: 'Mine', [ID_B]: 'AI' });
  });

  it('falls back to the first real user prompt and skips meta and tag-like prompts', async () => {
    write(ID_A, jsonl(
      userEntry('<command-name>/clear</command-name>'),
      userEntry('meta', { isMeta: true }),
      userEntry('real   prompt\nhere'),
    ));
    assert.equal((await source.list(CWD))[0].title, 'real prompt here');
  });

  it('skips sidechain sessions and sessions without a title', async () => {
    write(ID_A, jsonl(userEntry('sub agent', { isSidechain: true })));
    write(ID_B, jsonl({ type: 'mode', mode: 'normal' }));
    assert.deepEqual(await source.list(CWD), []);
  });

  it('ignores files whose names are not safe ids', async () => {
    write('bad name', jsonl(userEntry('x')));
    assert.deepEqual(await source.list(CWD), []);
  });

  it('finds the latest title in the tail of a large file', async () => {
    const filler = Array.from({ length: 4000 }, (_, i) => ({ type: 'assistant', text: `line ${i} `.repeat(10) }));
    write(ID_A, jsonl(userEntry('first'), ...filler, { type: 'ai-title', aiTitle: 'Late title' }));
    assert.ok(fs.statSync(path.join(projectDir, `${ID_A}.jsonl`)).size > 256 * 1024);
    assert.equal((await source.list(CWD))[0].title, 'Late title');
  });

  it('refreshes the cached title when the file changes', async () => {
    write(ID_A, jsonl(userEntry('first')));
    assert.equal((await source.list(CWD))[0].title, 'first');
    write(ID_A, jsonl(userEntry('first'), { type: 'custom-title', customTitle: 'Renamed' }));
    assert.equal((await source.list(CWD))[0].title, 'Renamed');
  });

  it('reads the model of the last answer', async () => {
    write(ID_A, jsonl(userEntry('hi'), { type: 'assistant', message: { model: 'glm-5.3' } }, { type: 'assistant', message: { model: '<synthetic>' } }));
    assert.equal((await source.list(CWD))[0].model, 'glm-5.3');
  });

  it('deletes the session file and its folder', async () => {
    write(ID_A, jsonl(userEntry('first')));
    fs.mkdirSync(path.join(projectDir, ID_A, 'subagents'), { recursive: true });
    write(ID_B, jsonl(userEntry('second')));
    await source.delete(ID_A, CWD);
    assert.deepEqual((await source.list(CWD)).map(s => s.id), [ID_B]);
    assert.equal(fs.existsSync(path.join(projectDir, ID_A)), false);
    await assert.rejects(source.delete(ID_A, CWD));
  });

  it('builds resume and new session commands', () => {
    assert.equal(source.resumeCommand('claude', ID_A), `claude --resume ${ID_A}`);
    const plan = source.newSession('claude');
    assert.equal(plan.kind, 'assigned');
    if (plan.kind === 'assigned') {
      assert.ok(isSafeId(plan.id));
      assert.equal(plan.command, `claude --session-id ${plan.id}`);
    }
  });
});

describe('CodexSource', () => {
  let source: CodexSource;
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = root;
    source = new CodexSource();
  });

  afterEach(() => {
    if (previousHome === undefined) { delete process.env.CODEX_HOME; } else { process.env.CODEX_HOME = previousHome; }
  });

  function writeRollout(id: string, cwd: string, timestamp: string, ...rest: object[]): void {
    const dir = path.join(root, 'sessions', '2026', '10', '09');
    fs.mkdirSync(dir, { recursive: true });
    const meta = { type: 'session_meta', payload: { id, cwd, timestamp } };
    fs.writeFileSync(path.join(dir, `rollout-${id}.jsonl`), jsonl(meta, ...rest));
  }

  function userMessage(text: string): object {
    return { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } };
  }

  it('lists only sessions of the workspace and uses the index title first', async () => {
    writeRollout(ID_A, CWD, '2026-10-09T10:00:00Z', userMessage('from prompt'));
    writeRollout(ID_B, '/other', '2026-10-09T10:00:00Z', userMessage('other project'));
    fs.writeFileSync(path.join(root, 'session_index.jsonl'), jsonl(
      { id: ID_A, thread_name: 'old name' },
      { id: ID_A, thread_name: 'Index name' },
    ));
    const sessions = await source.list(CWD);
    assert.deepEqual(sessions.map(s => [s.id, s.title]), [[ID_A, 'Index name']]);
  });

  it('falls back to the first user prompt and skips environment context', async () => {
    writeRollout(ID_A, CWD, '2026-10-09T10:00:00Z', userMessage('<environment_context>x</environment_context>'), userMessage('Real question'));
    assert.equal((await source.list(CWD))[0].title, 'Real question');
  });

  it('finds the new session created after the launch and honours taken ids', async () => {
    writeRollout(ID_A, CWD, '2026-10-09T10:00:00Z', userMessage('old'));
    writeRollout(ID_B, CWD, '2026-10-09T12:00:00Z', userMessage('new'));
    const plan = source.newSession('codex');
    assert.equal(plan.kind, 'discovered');
    if (plan.kind !== 'discovered') { return; }
    const since = Date.parse('2026-10-09T11:00:00Z');
    assert.equal(await plan.find(CWD, since, new Set()), ID_B);
    assert.equal(await plan.find(CWD, since, new Set([ID_B])), undefined);
    assert.equal(await plan.find('/other', since, new Set()), undefined);
  });

  it('builds the resume command', () => {
    assert.equal(source.resumeCommand('codex', ID_A), `codex resume ${ID_A}`);
  });

  it('deletes only the rollout of the session in this workspace', async () => {
    writeRollout(ID_A, CWD, '2026-10-09T10:00:00Z', userMessage('mine'));
    writeRollout(ID_B, '/other', '2026-10-09T10:00:00Z', userMessage('other'));
    await assert.rejects(source.delete(ID_B, CWD));
    await source.delete(ID_A, CWD);
    assert.deepEqual(await source.list(CWD), []);
    assert.equal((await source.list('/other')).length, 1);
  });
});

describe('KimiSource', () => {
  const KIMI_A = 'session_11111111-1111-4111-8111-111111111111';
  const KIMI_B = 'session_22222222-2222-4222-8222-222222222222';
  let source: KimiSource;

  beforeEach(() => {
    source = new KimiSource(() => root);
  });

  function writeSession(id: string, state: object, nested = false): string {
    const dir = path.join(root, 'sessions', kimiWorkDirKey(CWD), id);
    const stateDir = nested ? path.join(dir, 'session-meta') : dir;
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'state.json'), JSON.stringify(state));
    return dir;
  }

  it('derives the work dir key like Kimi Code', () => {
    assert.equal(kimiWorkDirKey('/Users/me/My Project/'), 'wd_my-project_1aad139b5205');
    assert.match(kimiWorkDirKey('/'), /^wd_workspace_[0-9a-f]{12}$/);
  });

  it('lists titled sessions and skips archived and imported ones', async () => {
    writeSession(KIMI_A, { title: 'Fix login', createdAt: 1000, updatedAt: '2026-10-09T10:00:00Z' });
    writeSession(KIMI_B, { lastPrompt: 'why   is it\nslow', createdAt: 2000, updatedAt: 3000 }, true);
    writeSession('session_33333333-3333-4333-8333-333333333333', { title: 'Old', archived: true });
    writeSession('session_44444444-4444-4444-8444-444444444444', { title: 'Imported', custom: { imported_from_kimi_cli: true } });
    writeSession('session_55555555-5555-4555-8555-555555555555', { createdAt: 4000 });
    const sessions = await source.list(CWD);
    assert.deepEqual(sessions.map(s => [s.id, s.title, s.updatedAt]), [
      [KIMI_A, 'Fix login', Date.parse('2026-10-09T10:00:00Z')],
      [KIMI_B, 'why is it slow', 3000],
    ]);
    assert.deepEqual(await source.list('/other'), []);
  });

  it('finds a new session even before it has a title', async () => {
    writeSession(KIMI_A, { title: 'Old', createdAt: 1000 });
    writeSession(KIMI_B, { createdAt: 50_000 });
    const plan = source.newSession('kimi');
    assert.equal(plan.kind, 'discovered');
    if (plan.kind !== 'discovered') { return; }
    assert.equal(await plan.find(CWD, 40_000, new Set()), KIMI_B);
    assert.equal(await plan.find(CWD, 40_000, new Set([KIMI_B])), undefined);
  });

  it('builds the resume command and deletes the session folder', async () => {
    assert.equal(source.resumeCommand('kimi', KIMI_A), `kimi --session ${KIMI_A}`);
    const dir = writeSession(KIMI_A, { title: 'Fix login' });
    await source.delete(KIMI_A, CWD);
    assert.equal(fs.existsSync(dir), false);
    await assert.rejects(source.delete(KIMI_A, CWD));
  });
});

describe('jsonl helpers', () => {
  it('drops truncated lines at the edges of a large file', async () => {
    const file = path.join(root, 'big.jsonl');
    const lines = Array.from({ length: 3000 }, (_, i) => JSON.stringify({ type: 'n', i }));
    fs.writeFileSync(file, lines.join('\n') + '\n');
    const { head, tail } = await readEdges(file, fs.statSync(file).size, 1024);
    assert.ok(head.length > 0 && tail.length > 0);
    assert.equal(head[0].i, 0);
    assert.equal(tail[tail.length - 1].i, 2999);
  });

  it('returns the last non-empty value of a type', () => {
    const entries = [{ type: 't', v: 'a' }, { type: 't', v: '' }, { type: 'x', v: 'z' }];
    assert.equal(lastValue(entries, 't', 'v'), 'a');
    assert.equal(lastValue(entries, 'missing', 'v'), undefined);
  });
});

describe('isSafeId', () => {
  it('accepts uuids and rejects shell metacharacters', () => {
    assert.ok(isSafeId(ID_A));
    assert.ok(isSafeId('ses_eded7e3e3ffeLRNS3gZzNEriyT'));
    assert.ok(!isSafeId('abc; rm -rf /'));
    assert.ok(!isSafeId(''));
  });
});

describe('CodexSource watch filter', () => {
  it('ignores changes of rollouts that belong to other workspaces', async () => {
    const previousHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = root;
    try {
      const source = new CodexSource();
      const dir = path.join(root, 'sessions', '2026', '10', '09');
      fs.mkdirSync(dir, { recursive: true });
      const rollout = (id: string, cwd: string) => jsonl(
        { type: 'session_meta', payload: { id, cwd, timestamp: '2026-10-09T10:00:00Z' } },
        { type: 'response_item', payload: { role: 'user', content: [{ type: 'input_text', text: 'hi' }] } },
      );
      fs.writeFileSync(path.join(dir, `rollout-${ID_A}.jsonl`), rollout(ID_A, CWD));
      fs.writeFileSync(path.join(dir, `rollout-${ID_B}.jsonl`), rollout(ID_B, '/other'));
      await source.list(CWD);
      await source.list('/other');
      const target = source.watchTarget(CWD);
      assert.ok(target.accepts?.(`2026/10/09/rollout-${ID_A}.jsonl`));
      assert.ok(!target.accepts?.(`2026/10/09/rollout-${ID_B}.jsonl`));
      assert.ok(target.accepts?.('2026/10/09/rollout-brand-new.jsonl'));
    } finally {
      if (previousHome === undefined) { delete process.env.CODEX_HOME; } else { process.env.CODEX_HOME = previousHome; }
    }
  });
});

describe('Claude in Chrome flag', () => {
  it('detects and replaces the flag in the agent command', () => {
    assert.equal(usesChrome('claude --chrome'), true);
    assert.equal(usesChrome('claude --no-chrome'), false);
    assert.equal(usesChrome('claude'), false);
    assert.equal(withChrome('claude', undefined), 'claude');
    assert.equal(withChrome('claude', true), 'claude --chrome');
    assert.equal(withChrome('claude --chrome --model opus', false), 'claude --model opus --no-chrome');
    assert.equal(withChrome('claude --no-chrome', true), 'claude --chrome');
  });
});
