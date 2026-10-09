import { SessionRecord, SessionSource, WatchTarget } from './types';

export class SessionCatalog {
  constructor(private readonly sources: readonly SessionSource[]) {}

  async list(roots: readonly string[]): Promise<SessionRecord[]> {
    const perRoot = await Promise.all(roots.flatMap(root => this.sources.map(source => source.list(root))));
    return perRoot.flat().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  sourceFor(agentId: string): SessionSource | undefined {
    return this.sources.find(source => source.agentId === agentId);
  }

  watchTargets(roots: readonly string[]): WatchTarget[] {
    return roots.flatMap(root => this.sources.map(source => source.watchTarget(root)));
  }
}
