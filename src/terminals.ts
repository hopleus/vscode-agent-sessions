import * as vscode from 'vscode';
import { OpenSessionsStore } from './storage';
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

const TAB_ICON_AGENTS: readonly string[] = ['claude', 'codex'];
const DEFAULT_TAB_TITLE = 'New Session';
const FALLBACK_SHELL = '/bin/bash';

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

  renameActive(title: string, force = false): void {
    const active = vscode.window.activeTerminal;
    if (active && (force || active.name !== title)) {
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
