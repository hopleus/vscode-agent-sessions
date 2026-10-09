import * as fs from 'fs';
import * as vscode from 'vscode';
import { WatchTarget } from './types';

const DEBOUNCE_MS = 400;

export class DebouncedWatcher implements vscode.Disposable {
  private watchers: fs.FSWatcher[] = [];
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly onChange: () => void) {}

  watch(targets: readonly WatchTarget[]): void {
    this.closeWatchers();
    for (const group of groupByPath(targets)) {
      try {
        this.watchers.push(fs.watch(group.path, { recursive: group.recursive }, (_event, file) => {
          if (!file || group.accepts.some(accepts => accepts(file.toString()))) { this.schedule(); }
        }));
      } catch { /* directory does not exist yet */ }
    }
  }

  dispose(): void {
    this.closeWatchers();
    clearTimeout(this.timer);
  }

  private closeWatchers(): void {
    this.watchers.forEach(watcher => watcher.close());
    this.watchers = [];
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(this.onChange, DEBOUNCE_MS);
  }
}

interface WatchGroup {
  path: string;
  recursive: boolean;
  accepts: ((relativePath: string) => boolean)[];
}

function groupByPath(targets: readonly WatchTarget[]): WatchGroup[] {
  const groups = new Map<string, WatchGroup>();
  for (const target of targets) {
    const key = `${target.path}|${target.recursive}`;
    const group = groups.get(key) ?? { path: target.path, recursive: target.recursive, accepts: [] };
    group.accepts.push(target.accepts ?? (() => true));
    groups.set(key, group);
  }
  return [...groups.values()];
}
