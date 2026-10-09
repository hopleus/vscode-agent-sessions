import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileInfo, FileStamp, readEdges, readFirstLine, readJsonLines, sameStamp, statFile, summarize } from './jsonl';
import { NewSessionPlan, SessionRecord, SessionSource, WatchTarget } from './types';

interface Rollout extends FileStamp {
  id: string;
  cwd: string;
  createdAt: number;
  firstPrompt: string;
}

interface CachedRollout extends FileStamp {
  rollout: Rollout | undefined;
}

const NEW_SESSION_CLOCK_SKEW_MS = 2000;
const PROMPT_SEARCH_BYTES = 512 * 1024;

export class CodexSource implements SessionSource {
  readonly agentId = 'codex';
  private readonly cache = new Map<string, CachedRollout>();

  async list(cwd: string): Promise<SessionRecord[]> {
    const [rollouts, indexTitles] = await Promise.all([this.rolloutsIn(cwd), readIndexTitles(this.home())]);
    return rollouts
      .flatMap(rollout => {
        const title = indexTitles.get(rollout.id) || rollout.firstPrompt;
        return title ? [{ id: rollout.id, cwd, agentId: this.agentId, title, updatedAt: rollout.mtime }] : [];
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  watchTarget(cwd: string): WatchTarget {
    return { path: this.sessionsDir(), recursive: true, accepts: file => this.mayAffect(cwd, file) };
  }

  resumeCommand(command: string, id: string): string {
    return `${command} resume ${id}`;
  }

  newSession(command: string): NewSessionPlan {
    return {
      kind: 'discovered',
      command,
      find: (cwd, since, taken) => this.findNewSession(cwd, since, taken),
    };
  }

  private async findNewSession(cwd: string, since: number, taken: ReadonlySet<string>): Promise<string | undefined> {
    const rollouts = await this.rolloutsIn(cwd);
    return rollouts
      .filter(r => r.createdAt >= since - NEW_SESSION_CLOCK_SKEW_MS && !taken.has(r.id))
      .sort((a, b) => a.createdAt - b.createdAt)[0]?.id;
  }

  private mayAffect(cwd: string, relativePath: string): boolean {
    const known = this.cache.get(path.join(this.sessionsDir(), relativePath))?.rollout;
    return !known || known.cwd === cwd;
  }

  private home(): string {
    return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  }

  private sessionsDir(): string {
    return path.join(this.home(), 'sessions');
  }

  private async rolloutsIn(cwd: string): Promise<Rollout[]> {
    const files = await findRolloutFiles(this.sessionsDir());
    const rollouts = await Promise.all(files.map(file => this.rolloutOf(file)));
    return rollouts.filter((rollout): rollout is Rollout => rollout?.cwd === cwd);
  }

  private async rolloutOf(file: string): Promise<Rollout | undefined> {
    try {
      const info = await statFile(file);
      const cached = this.cache.get(file);
      if (cached && sameStamp(cached, info)) { return cached.rollout; }
      const rollout = await readRollout(file, info, cached?.rollout);
      this.cache.set(file, { mtime: info.mtime, size: info.size, rollout });
      return rollout;
    } catch {
      return undefined;
    }
  }
}

async function findRolloutFiles(dir: string): Promise<string[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(entries.map(async entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { return findRolloutFiles(full); }
    return entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl') ? [full] : [];
  }));
  return nested.flat();
}

async function readRollout(file: string, info: FileInfo, previous?: Rollout): Promise<Rollout | undefined> {
  const meta = parseMeta(await readFirstLine(file));
  if (!meta) { return undefined; }
  const reusablePrompt = previous?.id === meta.id ? previous.firstPrompt : '';
  return {
    id: meta.id,
    cwd: meta.cwd,
    createdAt: meta.createdAt || info.birthtime,
    mtime: info.mtime,
    size: info.size,
    firstPrompt: reusablePrompt || await readFirstPrompt(file, info.size),
  };
}

function parseMeta(line: string): { id: string; cwd: string; createdAt: number } | undefined {
  try {
    const entry = JSON.parse(line);
    const payload = entry.payload;
    if (entry.type !== 'session_meta' || !payload?.id || !payload?.cwd) { return undefined; }
    return { id: payload.id, cwd: payload.cwd, createdAt: Date.parse(payload.timestamp) };
  } catch {
    return undefined;
  }
}

async function readFirstPrompt(file: string, size: number): Promise<string> {
  const { head } = await readEdges(file, size, PROMPT_SEARCH_BYTES);
  for (const entry of head) {
    if (entry.payload?.role !== 'user') { continue; }
    const text = firstInputText(entry.payload.content).trim();
    if (text && !text.startsWith('<')) { return summarize(text); }
  }
  return '';
}

function firstInputText(content: unknown): string {
  if (!Array.isArray(content)) { return ''; }
  return content.find(part => part?.type === 'input_text')?.text ?? '';
}

async function readIndexTitles(home: string): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  try {
    for (const entry of await readJsonLines(path.join(home, 'session_index.jsonl'))) {
      if (entry.id && entry.thread_name) { titles.set(entry.id, entry.thread_name); }
    }
  } catch { /* index is optional */ }
  return titles;
}
