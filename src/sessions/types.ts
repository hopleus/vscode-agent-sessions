export interface SessionRecord {
  id: string;
  cwd: string;
  agentId: string;
  title: string;
  updatedAt: number;
}

export interface WatchTarget {
  path: string;
  recursive: boolean;
  accepts?: (relativePath: string) => boolean;
}

export type NewSessionPlan =
  | { kind: 'assigned'; id: string; command: string }
  | { kind: 'discovered'; command: string; find: SessionFinder };

export type SessionFinder = (cwd: string, since: number, taken: ReadonlySet<string>) => Promise<string | undefined>;

export interface SessionSource {
  readonly agentId: string;
  readonly pollIntervalMs?: number;
  list(cwd: string): Promise<SessionRecord[]>;
  watchTarget(cwd: string): WatchTarget;
  resumeCommand(command: string, id: string): string;
  newSession(command: string): NewSessionPlan;
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function isSafeId(id: string): boolean {
  return SAFE_ID.test(id);
}
