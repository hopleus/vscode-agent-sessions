import * as fs from 'fs';

export interface FileStamp {
  mtime: number;
  size: number;
}

export interface FileInfo extends FileStamp {
  birthtime: number;
}

export async function statFile(file: string): Promise<FileInfo> {
  const stat = await fs.promises.stat(file);
  return { mtime: stat.mtimeMs, size: stat.size, birthtime: stat.birthtimeMs };
}

export function sameStamp(a: FileStamp, b: FileStamp): boolean {
  return a.mtime === b.mtime && a.size === b.size;
}

export type JsonEntry = Record<string, any>;

export interface FileEdges {
  head: JsonEntry[];
  tail: JsonEntry[];
}

const DEFAULT_EDGE_BYTES = 64 * 1024;

export async function readJsonLines(file: string): Promise<JsonEntry[]> {
  return parseLines((await fs.promises.readFile(file, 'utf8')).split('\n'));
}

export async function readEdges(file: string, size: number, edgeBytes = DEFAULT_EDGE_BYTES): Promise<FileEdges> {
  if (size <= edgeBytes * 2) {
    const all = await readJsonLines(file);
    return { head: all, tail: all };
  }
  const handle = await fs.promises.open(file, 'r');
  try {
    const [head, tail] = await Promise.all([
      readRange(handle, 0, edgeBytes),
      readRange(handle, size - edgeBytes, edgeBytes),
    ]);
    return {
      head: parseLines(head.split('\n').slice(0, -1)),
      tail: parseLines(tail.split('\n').slice(1)),
    };
  } finally {
    await handle.close();
  }
}

export function lastValue(entries: readonly JsonEntry[], type: string, field: string): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const value = entries[i].type === type ? entries[i][field] : undefined;
    if (typeof value === 'string' && value) { return value; }
  }
  return undefined;
}

async function readRange(handle: fs.promises.FileHandle, position: number, length: number): Promise<string> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead).toString('utf8');
}

function parseLines(lines: readonly string[]): JsonEntry[] {
  const entries: JsonEntry[] = [];
  for (const line of lines) {
    if (!line) { continue; }
    try { entries.push(JSON.parse(line)); } catch { /* skip malformed or truncated line */ }
  }
  return entries;
}

export async function readFirstLine(file: string, maxBytes = 4 * 1024 * 1024): Promise<string> {
  const handle = await fs.promises.open(file, 'r');
  try {
    const chunk = Buffer.alloc(64 * 1024);
    const parts: Buffer[] = [];
    let offset = 0;
    while (offset < maxBytes) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
      if (bytesRead <= 0) { break; }
      const data = Buffer.from(chunk.subarray(0, bytesRead));
      const newline = data.indexOf(10);
      if (newline >= 0) { parts.push(data.subarray(0, newline)); break; }
      parts.push(data);
      offset += bytesRead;
    }
    return Buffer.concat(parts).toString('utf8');
  } finally {
    await handle.close();
  }
}

export function summarize(text: string, maxLength = 80): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
