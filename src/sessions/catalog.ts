import { SessionRecord, SessionSource, WatchTarget } from './types';

export class SessionCatalog {
  constructor(
    private readonly sources: readonly SessionSource[],
    private readonly aliases: Readonly<Record<string, string>> = {},
  ) {}

  async list(roots: readonly string[]): Promise<SessionRecord[]> {
    const perRoot = await Promise.all(roots.flatMap(root => this.sources.map(source => source.list(root))));
    return perRoot.flat().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  sourceFor(agentId: string): SessionSource | undefined {
    const sourceId = this.aliases[agentId] ?? agentId;
    return this.sources.find(source => source.agentId === sourceId);
  }

  pollIntervalMs(): number | undefined {
    const intervals = this.sources.flatMap(source => source.pollIntervalMs ?? []);
    return intervals.length ? Math.min(...intervals) : undefined;
  }

  watchTargets(roots: readonly string[]): WatchTarget[] {
    return roots.flatMap(root => this.sources.map(source => source.watchTarget(root)));
  }
}
