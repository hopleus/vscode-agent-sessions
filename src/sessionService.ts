import * as vscode from 'vscode';
import { Agent, allAgents, enabledAgents } from './agents';
import { ApiKeys } from './apiKeys';
import { ensureSupportedPlatform, isSupportedPlatform } from './platform';
import { CONFIG_SECTION } from './constants';
import { SessionDto, StateMessage } from './protocol';
import { SessionCatalog } from './sessions/catalog';
import { ClaudeSource, usesChrome, withChrome } from './sessions/claude';
import { CodexSource } from './sessions/codex';
import { KimiSource } from './sessions/kimi';
import { OpenCodeSource } from './sessions/opencode';
import { providerById, providerOfModel, PROVIDERS } from './providers';
import { isSafeId, SessionRecord } from './sessions/types';
import { DebouncedWatcher } from './sessions/watcher';
import { OpenSessionsStore, PrefsStore } from './storage';
import { TerminalManager } from './terminals';
import { delay } from './util/delay';
import { activeRoot, workspaceRoots } from './workspace';

const RESTORE_STAGGER_MS = 400;
const CLAUDE_AGENT_ID = 'claude';

export interface CurrentSession {
  id: string;
  agentId: string;
  title: string;
}

export class SessionService implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly activeChanged = new vscode.EventEmitter<void>();
  private readonly opening = new Set<string>();
  readonly onDidChange = this.changed.event;
  readonly onDidChangeActiveSession = this.activeChanged.event;

  private readonly catalog: SessionCatalog;
  private readonly prefs: PrefsStore;
  private readonly openSessions: OpenSessionsStore;
  private readonly terminals: TerminalManager;
  private readonly watcher: DebouncedWatcher;
  private readonly subscriptions: vscode.Disposable[];
  private pollTimer: NodeJS.Timeout | undefined;
  private lastActiveId: string | undefined;

  constructor(context: vscode.ExtensionContext, private readonly keys: ApiKeys) {
    this.catalog = new SessionCatalog([
      new ClaudeSource(() => vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>('claudeProjectsPath', '')),
      new CodexSource(),
      new OpenCodeSource(),
      new KimiSource(),
    ], Object.fromEntries(PROVIDERS.map(provider => [provider.id, CLAUDE_AGENT_ID])));
    this.prefs = new PrefsStore(context.workspaceState);
    this.openSessions = new OpenSessionsStore(context.workspaceState);
    this.terminals = new TerminalManager(context.extensionUri, this.openSessions);
    this.watcher = new DebouncedWatcher(() => this.changed.fire());
    this.subscriptions = [
      this.changed,
      this.activeChanged,
      this.terminals,
      this.watcher,
      this.terminals.onDidChange(() => {
        this.changed.fire();
        this.notifyActiveChanged();
      }),
      vscode.window.onDidChangeActiveTerminal(() => {
        void this.renameActiveTab();
        this.notifyActiveChanged();
      }),
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
    const records = await this.records();
    void this.renameActiveTab(records);
    return {
      type: 'state',
      hasFolder: roots.length > 0,
      agents: enabledAgents().map(({ id, name }) => ({ id, name })),
      sessions: records.map(session => this.toDto(session)),
    };
  }

  async currentSession(): Promise<CurrentSession | undefined> {
    const id = this.terminals.activeSessionId() ?? this.lastActiveId;
    if (!id) { return undefined; }
    const record = (await this.records()).find(candidate => candidate.id === id);
    const agentId = record?.agentId ?? this.openSessions.list().find(session => session.id === id)?.agentId;
    const title = this.prefs.get(id).name || record?.title;
    return agentId && title ? { id, agentId, title } : undefined;
  }

  warmUp(): void {
    void this.catalog.list(workspaceRoots());
  }

  refresh(): void {
    this.changed.fire();
  }

  async restore(): Promise<void> {
    const stored = this.openSessions.list();
    if (stored.length === 0 || !isSupportedPlatform()) { return; }
    await this.terminals.waitUntilReady();
    const records = await this.records();
    const running = this.terminals.adoptRunning(stored);
    for (const { agentId, id } of stored.filter(session => !running.has(session.id))) {
      await this.openWith(id, agentId, records, false);
      await delay(RESTORE_STAGGER_MS);
    }
  }

  async open(id: string, agentId: string): Promise<void> {
    if (this.terminals.show(id) || this.opening.has(id) || !ensureSupportedPlatform()) { return; }
    this.opening.add(id);
    try {
      await this.openWith(id, agentId, await this.records());
    } finally {
      this.opening.delete(id);
    }
  }

  async startNew(agentId?: string): Promise<void> {
    if (!ensureSupportedPlatform()) { return; }
    const cwd = this.usableRoot();
    const agents = enabledAgents();
    const agent = agents.find(a => a.id === agentId) ?? agents[0];
    if (!cwd || !agent) { return; }
    const env = await this.envFor(agent);
    if (!env) { return; }
    const plan = this.catalog.sourceFor(agent.id)?.newSession(agent.command);
    if (!plan) {
      this.terminals.startUntracked(agent.name, agent.id, agent.command, cwd, env);
    } else if (plan.kind === 'assigned') {
      if (agent.provider) { await this.prefs.update(plan.id, { provider: agent.provider }); }
      this.terminals.startAssigned(agent.id, plan.id, plan.command, cwd, env);
    } else {
      this.terminals.startDiscovered(agent.id, plan.command, plan.find, cwd, env);
    }
  }

  async deleteSession(id: string): Promise<void> {
    const record = (await this.records()).find(candidate => candidate.id === id);
    const source = record && this.catalog.sourceFor(record.agentId);
    const command = record && this.agentCommand(record.agentId);
    if (!record || !source || !command || !isSafeId(id)) { throw new Error('The session was not found.'); }
    await this.terminals.close(id);
    this.openSessions.remove(id);
    try {
      await source.delete(id, record.cwd, command);
      await this.prefs.remove(id);
    } finally {
      this.changed.fire();
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

  async reopenWithChrome(id: string, enabled: boolean): Promise<void> {
    if (!isSafeId(id) || !ensureSupportedPlatform()) { return; }
    await this.prefs.update(id, { chrome: enabled });
    this.opening.add(id);
    try {
      await this.terminals.close(id);
      await this.openWith(id, CLAUDE_AGENT_ID, await this.records());
    } finally {
      this.opening.delete(id);
    }
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
      chrome: session.agentId === CLAUDE_AGENT_ID ? this.chromeEnabled(session.id) : undefined,
    };
  }

  private chromeEnabled(id: string): boolean {
    return this.prefs.get(id).chrome ?? usesChrome(this.agentCommand(CLAUDE_AGENT_ID) ?? '');
  }

  private agentCommand(agentId: string): string | undefined {
    return allAgents().find(agent => agent.id === agentId)?.command;
  }

  private async openWith(id: string, agentId: string, records: SessionRecord[], askForKey = true): Promise<void> {
    const record = records.find(candidate => candidate.id === id);
    const cwd = record?.cwd ?? this.usableRoot();
    const source = this.catalog.sourceFor(agentId);
    const agent = allAgents().find(candidate => candidate.id === agentId);
    const command = agent && agentId === CLAUDE_AGENT_ID ? withChrome(agent.command, this.prefs.get(id).chrome) : agent?.command;
    if (!agent || !cwd || !vscode.workspace.isTrusted || !source || !command || !isSafeId(id) || this.terminals.show(id)) { return; }
    const env = await this.envFor(agent, askForKey);
    if (!env || this.terminals.show(id)) { return; }
    const title = this.prefs.get(id).name || record?.title;
    this.terminals.openExisting(agentId, id, title, source.resumeCommand(command, id), cwd, env);
  }

  private async envFor(agent: Agent, askForKey = true): Promise<Record<string, string> | undefined> {
    const provider = providerById(agent.provider);
    if (!provider) { return {}; }
    const key = askForKey ? await this.keys.ensure(provider) : await this.keys.get(provider.id);
    return key ? provider.env(key) : undefined;
  }

  private async records(): Promise<SessionRecord[]> {
    const records = await this.catalog.list(workspaceRoots());
    return records.map(record => {
      if (record.agentId !== CLAUDE_AGENT_ID) { return record; }
      const provider = this.prefs.get(record.id).provider ?? providerOfModel(record.model);
      return provider ? { ...record, agentId: provider } : record;
    });
  }

  private usableRoot(): string | undefined {
    return vscode.workspace.isTrusted ? activeRoot() : undefined;
  }

  private async renameActiveTab(known?: SessionRecord[]): Promise<void> {
    const id = this.terminals.activeSessionId();
    if (!id) { return; }
    const records = known ?? await this.records();
    const title = this.prefs.get(id).name || records.find(record => record.id === id)?.title;
    if (title) { this.terminals.renameActive(title); }
  }

  private notifyActiveChanged(): void {
    this.lastActiveId = this.terminals.activeSessionId() ?? this.lastActiveId;
    this.activeChanged.fire();
  }

  private reload(): void {
    this.watchWorkspace();
    this.changed.fire();
  }

  private watchWorkspace(): void {
    this.watcher.watch(this.catalog.watchTargets(workspaceRoots()));
  }
}
