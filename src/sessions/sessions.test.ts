import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ClaudeSource } from './claude';
import { CodexSource } from './codex';
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
