import * as vscode from 'vscode';
import { allAgents, enabledAgents } from './agents';
import { ensureSupportedPlatform } from './platform';
import { CONFIG_SECTION } from './constants';
import { SessionDto, StateMessage } from './protocol';
import { SessionCatalog } from './sessions/catalog';
import { ClaudeSource } from './sessions/claude';
import { CodexSource } from './sessions/codex';
import { OpenCodeSource } from './sessions/opencode';
import { isSafeId, SessionRecord } from './sessions/types';
import { DebouncedWatcher } from './sessions/watcher';
import { OpenSessionsStore, PrefsStore } from './storage';
import { TerminalManager } from './terminals';
import { activeRoot, workspaceRoots } from './workspace';

const RESTORE_STAGGER_MS = 400;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class SessionService implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly opening = new Set<string>();
  readonly onDidChange = this.changed.event;

  private readonly catalog: SessionCatalog;
  private readonly prefs: PrefsStore;
  private readonly openSessions: OpenSessionsStore;
  private readonly terminals: TerminalManager;
  private readonly watcher: DebouncedWatcher;
  private readonly subscriptions: vscode.Disposable[];
  private pollTimer: NodeJS.Timeout | undefined;

  constructor(context: vscode.ExtensionContext) {
    this.catalog = new SessionCatalog([
      new ClaudeSource(() => vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>('claudeProjectsPath', '')),
      new CodexSource(),
      new OpenCodeSource(),
    ]);
    this.prefs = new PrefsStore(context.workspaceState);
    this.openSessions = new OpenSessionsStore(context.workspaceState);
    this.terminals = new TerminalManager(context.extensionUri, this.openSessions);
    this.watcher = new DebouncedWatcher(() => this.changed.fire());
    this.subscriptions = [
      this.changed,
      this.terminals,
      this.watcher,
      this.terminals.onDidChange(() => this.changed.fire()),
      vscode.window.onDidChangeActiveTerminal(() => void this.renameActiveTab()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.reload()),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration(CONFIG_SECTION)) { this.reload(); }
      }),
    ];
    this.watchWorkspace();
  }

  dispose(): void {
    this.setPolling(false);
    this.subscriptions.forEach(s => s.dispose());
  }

  setPolling(active: boolean): void {
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    const interval = this.catalog.pollIntervalMs();
    if (active && interval) { this.pollTimer = setInterval(() => this.changed.fire(), interval); }
  }

  async state(): Promise<StateMessage> {
    const roots = workspaceRoots();
    await this.terminals.bindDiscovered();
    const records = await this.catalog.list(roots);
    void this.renameActiveTab(records);
    return {
      type: 'state',
      hasFolder: roots.length > 0,
      agents: enabledAgents().map(({ id, name }) => ({ id, name })),
      sessions: records.map(session => this.toDto(session)),
    };
  }

  warmUp(): void {
    void this.catalog.list(workspaceRoots());
  }

  refresh(): void {
    this.changed.fire();
  }

  async restore(): Promise<void> {
    const stored = this.openSessions.list();
    if (stored.length === 0 || process.platform === 'win32') { return; }
    await this.terminals.waitUntilReady();
    const records = await this.catalog.list(workspaceRoots());
    for (const { agentId, id } of stored) {
      this.openWith(id, agentId, records);
      await delay(RESTORE_STAGGER_MS);
    }
  }

  async open(id: string, agentId: string): Promise<void> {
    if (this.terminals.show(id) || this.opening.has(id) || !ensureSupportedPlatform()) { return; }
    this.opening.add(id);
    try {
      this.openWith(id, agentId, await this.catalog.list(workspaceRoots()));
    } finally {
      this.opening.delete(id);
    }
  }

  startNew(agentId?: string): void {
    if (!ensureSupportedPlatform()) { return; }
    const cwd = this.usableRoot();
    const agents = enabledAgents();
    const agent = agents.find(a => a.id === agentId) ?? agents[0];
    if (!cwd || !agent) { return; }
    const plan = this.catalog.sourceFor(agent.id)?.newSession(agent.command);
    if (!plan) {
      this.terminals.startUntracked(agent.name, agent.id, agent.command, cwd);
    } else if (plan.kind === 'assigned') {
      this.terminals.startAssigned(agent.id, plan.id, plan.command, cwd);
    } else {
      this.terminals.startDiscovered(agent.id, plan.command, plan.find, cwd);
    }
  }

  async setPinned(id: string, pinned: boolean): Promise<void> {
    await this.prefs.update(id, { pinned });
    this.changed.fire();
  }

  customName(id: string): string | undefined {
    return this.prefs.get(id).name;
  }

  async rename(id: string, name: string): Promise<void> {
    await this.prefs.update(id, { name: name.trim() });
    this.changed.fire();
  }

  private toDto(session: SessionRecord): SessionDto {
    const prefs = this.prefs.get(session.id);
    return {
      id: session.id,
      agentId: session.agentId,
      title: prefs.name || session.title,
      updatedAt: session.updatedAt,
      pinned: !!prefs.pinned,
    };
  }

  private openWith(id: string, agentId: string, records: SessionRecord[]): void {
    const record = records.find(candidate => candidate.id === id);
    const cwd = record?.cwd ?? this.usableRoot();
    const source = this.catalog.sourceFor(agentId);
    const command = allAgents().find(agent => agent.id === agentId)?.command;
    if (!cwd || !vscode.workspace.isTrusted || !source || !command || !isSafeId(id) || this.terminals.show(id)) { return; }
    const title = this.prefs.get(id).name || record?.title;
    this.terminals.openExisting(agentId, id, title, source.resumeCommand(command, id), cwd);
  }

  private usableRoot(): string | undefined {
    return vscode.workspace.isTrusted ? activeRoot() : undefined;
  }

  private async renameActiveTab(known?: SessionRecord[]): Promise<void> {
    const id = this.terminals.activeSessionId();
    if (!id) { return; }
    const records = known ?? await this.catalog.list(workspaceRoots());
    const title = this.prefs.get(id).name || records.find(record => record.id === id)?.title;
    if (title) { this.terminals.renameActive(title); }
  }

  private reload(): void {
    this.watchWorkspace();
    this.changed.fire();
  }

  private watchWorkspace(): void {
    this.watcher.watch(this.catalog.watchTargets(workspaceRoots()));
  }
}
