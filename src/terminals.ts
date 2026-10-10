import * as vscode from 'vscode';
import { OpenSession, OpenSessionsStore } from './storage';
import { SessionFinder } from './sessions/types';

interface PendingTerminal {
  terminal: vscode.Terminal;
  agentId: string;
  cwd: string;
  startedAt: number;
  find: SessionFinder;
}

interface LaunchOptions {
  name: string;
  command: string;
  agentId: string;
  cwd: string;
}

const TAB_ICON_AGENTS: readonly string[] = ['claude', 'codex', 'opencode'];
const DEFAULT_TAB_TITLE = 'New Session';
const FALLBACK_SHELL = '/bin/bash';
const READY_TIMEOUT_MS = 15000;

export class TerminalManager implements vscode.Disposable {
  private readonly terminals = new Map<string, vscode.Terminal>();
  private pending: PendingTerminal[] = [];
  private binding = false;
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly subscriptions: vscode.Disposable[];
  readonly onDidChange = this.changed.event;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly openSessions: OpenSessionsStore,
  ) {
    this.subscriptions = [
      this.changed,
      vscode.window.onDidCloseTerminal(terminal => this.handleClosed(terminal)),
    ];
  }

  dispose(): void {
    this.subscriptions.forEach(s => s.dispose());
  }

  async waitUntilReady(timeoutMs = READY_TIMEOUT_MS): Promise<void> {
    const probe = vscode.window.createTerminal({
      name: 'agent-sessions-probe',
      hideFromUser: true,
      isTransient: true,
      shellPath: '/bin/sh',
      shellArgs: ['-c', 'sleep 5'],
    });
    try {
      await Promise.race([probe.processId, new Promise(resolve => setTimeout(resolve, timeoutMs))]);
    } finally {
      probe.dispose();
    }
  }

  adoptRunning(sessions: readonly OpenSession[]): Set<string> {
    const adopted = new Set<string>();
    const tracked = new Set(this.terminals.values());
    for (const terminal of vscode.window.terminals) {
      if (tracked.has(terminal)) { continue; }
      const tokens = launchCommandOf(terminal).split(/\s+/);
      const match = sessions.find(session => !adopted.has(session.id) && tokens.includes(session.id));
      if (!match) { continue; }
      adopted.add(match.id);
      this.track(match.agentId, match.id, terminal);
    }
    return adopted;
  }

  show(id: string): boolean {
    const terminal = this.terminals.get(id);
    terminal?.show();
    return !!terminal;
  }

  openExisting(agentId: string, id: string, title: string | undefined, command: string, cwd: string): void {
    const terminal = this.launch({ name: title || DEFAULT_TAB_TITLE, command, agentId, cwd });
    this.track(agentId, id, terminal);
  }

  startAssigned(agentId: string, id: string, command: string, cwd: string): void {
    const terminal = this.launch({ name: DEFAULT_TAB_TITLE, command, agentId, cwd });
    this.track(agentId, id, terminal);
  }

  startDiscovered(agentId: string, command: string, find: SessionFinder, cwd: string): void {
    const terminal = this.launch({ name: DEFAULT_TAB_TITLE, command, agentId, cwd });
    this.pending.push({ terminal, agentId, cwd, startedAt: Date.now(), find });
  }

  startUntracked(name: string, agentId: string, command: string, cwd: string): void {
    this.launch({ name, command, agentId, cwd });
  }

  async bindDiscovered(): Promise<void> {
    if (this.binding) { return; }
    this.binding = true;
    try {
      const taken = new Set(this.terminals.keys());
      for (const entry of [...this.pending]) {
        const id = await entry.find(entry.cwd, entry.startedAt, taken);
        if (!id || !this.pending.includes(entry)) { continue; }
        taken.add(id);
        this.pending = this.pending.filter(p => p !== entry);
        this.track(entry.agentId, id, entry.terminal);
      }
    } finally {
      this.binding = false;
    }
  }

  activeSessionId(): string | undefined {
    const active = vscode.window.activeTerminal;
    return [...this.terminals].find(([, terminal]) => terminal === active)?.[0];
  }

  renameActive(title: string): void {
    const active = vscode.window.activeTerminal;
    if (active && active.name !== title) {
      void vscode.commands.executeCommand('workbench.action.terminal.renameWithArg', { name: title });
    }
  }

  private track(agentId: string, id: string, terminal: vscode.Terminal): void {
    this.terminals.set(id, terminal);
    this.openSessions.add({ agentId, id });
    this.changed.fire();
  }

  private handleClosed(terminal: vscode.Terminal): void {
    this.pending = this.pending.filter(p => p.terminal !== terminal);
    const closedByUser = isDeliberateExit(terminal.exitStatus?.reason);
    for (const [id, tracked] of this.terminals) {
      if (tracked !== terminal) { continue; }
      this.terminals.delete(id);
      if (closedByUser) { this.openSessions.remove(id); }
    }
    this.changed.fire();
  }

  private launch({ name, command, agentId, cwd }: LaunchOptions): vscode.Terminal {
    const terminal = vscode.window.createTerminal({
      name,
      cwd,
      shellPath: process.env.SHELL || FALLBACK_SHELL,
      shellArgs: ['-l', '-i', '-c', command],
      location: { viewColumn: vscode.ViewColumn.Active },
      isTransient: true,
      iconPath: this.tabIcon(agentId),
    });
    terminal.show();
    return terminal;
  }

  private tabIcon(agentId: string): vscode.IconPath {
    if (!TAB_ICON_AGENTS.includes(agentId)) { return new vscode.ThemeIcon('hubot'); }
    const icon = (theme: string) => vscode.Uri.joinPath(this.extensionUri, 'media', 'icons', `${agentId}-${theme}.svg`);
    return { light: icon('light'), dark: icon('dark') };
  }
}

function isDeliberateExit(reason: vscode.TerminalExitReason | undefined): boolean {
  return reason === vscode.TerminalExitReason.User || reason === vscode.TerminalExitReason.Process;
}

function launchCommandOf(terminal: vscode.Terminal): string {
  const args = (terminal.creationOptions as vscode.TerminalOptions).shellArgs;
  if (Array.isArray(args)) { return args.join(' '); }
  return typeof args === 'string' ? args : '';
}
