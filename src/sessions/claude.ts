import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileInfo, FileStamp, JsonEntry, lastValue, readEdges, sameStamp, statFile, summarize } from './jsonl';
import { NewSessionPlan, SessionRecord, SessionSource, WatchTarget } from './types';

interface CachedTitle extends FileStamp {
  title: string;
}

export class ClaudeSource implements SessionSource {
  readonly agentId = 'claude';
  private readonly titles = new Map<string, CachedTitle>();

  constructor(private readonly customRoot: () => string) {}

  async list(cwd: string): Promise<SessionRecord[]> {
    const dir = this.projectDir(cwd);
    const files = await this.sessionFiles(dir);
    const records = await Promise.all(files.map(file => this.toRecord(cwd, path.join(dir, file))));
    return records.flat().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  watchTarget(cwd: string): WatchTarget {
    return { path: this.projectDir(cwd), recursive: false };
  }

  resumeCommand(command: string, id: string): string {
    return `${command} --resume ${id}`;
  }

  newSession(command: string): NewSessionPlan {
    const id = crypto.randomUUID();
    return { kind: 'assigned', id, command: `${command} --session-id ${id}` };
  }

  private projectDir(cwd: string): string {
    const root = this.customRoot() || path.join(os.homedir(), '.claude', 'projects');
    return path.join(root, cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  }

  private async sessionFiles(dir: string): Promise<string[]> {
    try {
      const names = await fs.promises.readdir(dir);
      return names.filter(name => /^[A-Za-z0-9-]+\.jsonl$/.test(name));
    } catch {
      return [];
    }
  }

  private async toRecord(cwd: string, file: string): Promise<SessionRecord[]> {
    try {
      const stamp = await statFile(file);
      const title = await this.titleOf(file, stamp);
      if (!title) { return []; }
      return [{ id: path.basename(file, '.jsonl'), cwd, agentId: this.agentId, title, updatedAt: stamp.mtime }];
    } catch {
      return [];
    }
  }

  private async titleOf(file: string, stamp: FileInfo): Promise<string> {
    const cached = this.titles.get(file);
    if (cached && sameStamp(cached, stamp)) { return cached.title; }
    const title = await readTitle(file, stamp.size);
    this.titles.set(file, { mtime: stamp.mtime, size: stamp.size, title });
    return title;
  }
}

async function readTitle(file: string, size: number): Promise<string> {
  const { head, tail } = await readEdges(file, size);
  if (head.some(entry => entry.isSidechain === true)) { return ''; }
  return lastValue(tail, 'custom-title', 'customTitle')
    ?? lastValue(head, 'custom-title', 'customTitle')
    ?? lastValue(tail, 'ai-title', 'aiTitle')
    ?? lastValue(head, 'ai-title', 'aiTitle')
    ?? summarizeOptional(lastValue(tail, 'last-prompt', 'lastPrompt'))
    ?? lastValue(tail, 'summary', 'summary')
    ?? firstPrompt(head);
}

function summarizeOptional(text: string | undefined): string | undefined {
  return text ? summarize(text) : undefined;
}

function firstPrompt(entries: readonly JsonEntry[]): string {
  const prompt = entries.find(entry => isUserPrompt(entry) && promptText(entry));
  return prompt ? promptText(prompt) : '';
}

function isUserPrompt(entry: JsonEntry): boolean {
  return entry.type === 'user' && !entry.isMeta && !entry.isSidechain;
}

function promptText(entry: JsonEntry): string {
  const content = entry.message?.content;
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content) ? (content.find(part => part?.type === 'text')?.text ?? '') : '';
  return text.trim().startsWith('<') ? '' : summarize(text);
}
