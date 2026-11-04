import { nextClaudeBackoff } from './policy';
import { acquireUsageLock, readSharedUsage, writeSharedUsage } from './shared';
import { LimitsResult, UsageOutcome } from './types';

const TICK_SLACK_MS = 1_000;
const MANUAL_REFRESH_COOLDOWN_MS = 5_000;

export interface SyncOptions {
  force: boolean;
  focused: boolean;
}

export class RemoteLimits {
  result: LimitsResult | undefined;
  private fetchedAt = 0;
  private nextAt = 0;
  private backoffMs: number;

  constructor(
    private readonly name: string,
    private readonly storageDir: string,
    private readonly intervalMs: () => number,
  ) {
    this.backoffMs = intervalMs();
  }

  reset(): void {
    this.backoffMs = this.intervalMs();
    this.nextAt = 0;
  }

  clear(): void {
    this.result = undefined;
  }

  async sync(fetchUsage: () => Promise<UsageOutcome>, options: SyncOptions): Promise<void> {
    this.adoptShared();
    if (!this.due(options)) { return; }
    const release = acquireUsageLock(this.storageDir, Date.now(), this.name);
    if (!release) { return; }
    try {
      this.adoptShared();
      if (!this.due(options)) { return; }
      await this.fetch(fetchUsage);
      writeSharedUsage(this.storageDir, {
        result: this.result as LimitsResult,
        fetchedAt: this.fetchedAt,
        nextAt: this.nextAt,
        backoffMs: this.backoffMs,
      }, this.name);
    } finally {
      release();
    }
  }

  private due({ force, focused }: SyncOptions): boolean {
    const now = Date.now();
    if (force) { return now - this.fetchedAt >= MANUAL_REFRESH_COOLDOWN_MS; }
    return focused && now >= this.nextAt - TICK_SLACK_MS;
  }

  private adoptShared(): void {
    const shared = readSharedUsage(this.storageDir, this.name);
    if (!shared || shared.fetchedAt <= this.fetchedAt) { return; }
    this.result = shared.result;
    this.fetchedAt = shared.fetchedAt;
    this.nextAt = shared.nextAt;
    this.backoffMs = shared.backoffMs;
  }

  private async fetch(fetchUsage: () => Promise<UsageOutcome>): Promise<void> {
    const outcome = await fetchUsage();
    if (!outcome.transient || this.result?.kind !== 'ok' || outcome.result.kind === 'ok') {
      this.result = outcome.result;
    }
    this.backoffMs = nextClaudeBackoff(this.backoffMs, {
      ok: outcome.result.kind === 'ok',
      retryAfterMs: outcome.retryAfterMs,
    }, this.intervalMs());
    this.fetchedAt = Date.now();
    this.nextAt = this.fetchedAt + this.backoffMs;
  }
}
