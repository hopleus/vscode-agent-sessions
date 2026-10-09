import * as vscode from 'vscode';

export interface SessionPrefs {
  name?: string;
  pinned?: boolean;
}

export interface OpenSession {
  agentId: string;
  id: string;
}

const PREFS_KEY = 'agentSessions.meta';
const OPEN_KEY = 'agentSessions.open';
const LEGACY_AGENT_ID = 'claude';

export class PrefsStore {
  constructor(private readonly state: vscode.Memento) {}

  get(id: string): SessionPrefs {
    return this.all()[id] ?? {};
  }

  async update(id: string, patch: SessionPrefs): Promise<void> {
    await this.state.update(PREFS_KEY, { ...this.all(), [id]: { ...this.get(id), ...patch } });
  }

  private all(): Record<string, SessionPrefs> {
    return this.state.get<Record<string, SessionPrefs>>(PREFS_KEY, {});
  }
}

export class OpenSessionsStore {
  constructor(private readonly state: vscode.Memento) {}

  list(): OpenSession[] {
    return this.state.get<string[]>(OPEN_KEY, []).map(parseEntry);
  }

  add(session: OpenSession): void {
    if (this.list().some(s => s.id === session.id)) { return; }
    this.save([...this.list(), session]);
  }

  remove(id: string): void {
    this.save(this.list().filter(s => s.id !== id));
  }

  private save(sessions: OpenSession[]): void {
    void this.state.update(OPEN_KEY, sessions.map(s => `${s.agentId}:${s.id}`));
  }
}

function parseEntry(entry: string): OpenSession {
  const separator = entry.indexOf(':');
  return separator < 0
    ? { agentId: LEGACY_AGENT_ID, id: entry }
    : { agentId: entry.slice(0, separator), id: entry.slice(separator + 1) };
}
