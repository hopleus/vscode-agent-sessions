import * as vscode from 'vscode';
import { VIEW_ID } from './constants';
import { parseWebviewMessage } from './protocol';
import { SessionService } from './sessionService';
import { buildWebviewHtml } from './webviewHtml';

export class SessionsView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private pushTicket = 0;
  private lastPosted = '';
  private readonly subscription: vscode.Disposable;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly service: SessionService,
  ) {
    this.subscription = service.onDidChange(() => void this.push());
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, 'media');
    this.view = view;
    this.lastPosted = '';
    view.webview.options = { enableScripts: true, localResourceRoots: [mediaRoot] };
    view.webview.html = buildWebviewHtml(view.webview, mediaRoot);
    view.webview.onDidReceiveMessage((raw: unknown) => this.handle(raw));
    view.onDidChangeVisibility(() => {
      this.service.setPolling(view.visible);
      if (view.visible) { void this.push(true); }
    });
    view.onDidDispose(() => this.service.setPolling(false));
    this.service.setPolling(view.visible);
  }

  dispose(): void {
    this.subscription.dispose();
  }

  refresh(): Thenable<void> {
    return this.pushWithProgress(REFRESH_FEEDBACK_MS);
  }

  private pushWithProgress(minDurationMs = 0, force = false): Thenable<void> {
    return vscode.window.withProgress({ location: { viewId: VIEW_ID } }, async () => {
      await delay(minDurationMs);
      await this.push(force);
    });
  }

  private async push(force = false): Promise<void> {
    const ticket = ++this.pushTicket;
    const state = await this.service.state();
    const serialized = JSON.stringify(state);
    if (ticket !== this.pushTicket || (!force && serialized === this.lastPosted)) { return; }
    this.lastPosted = serialized;
    void this.view?.webview.postMessage(state);
  }

  private async handle(raw: unknown): Promise<void> {
    const message = parseWebviewMessage(raw);
    if (!message) { return; }
    switch (message.type) {
      case 'ready':
        await this.pushWithProgress(0, true);
        break;
      case 'open':
        await this.service.open(message.id, message.agentId);
        break;
      case 'new':
        this.service.startNew(message.agentId);
        break;
      case 'pin':
        await this.service.setPinned(message.id, message.pinned);
        break;
      case 'rename':
        await this.promptRename(message.id, message.title);
        break;
    }
  }

  private async promptRename(id: string, currentTitle: string): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: 'Rename session',
      value: this.service.customName(id) ?? currentTitle,
    });
    if (name !== undefined) { await this.service.rename(id, name); }
  }
}

const REFRESH_FEEDBACK_MS = 300;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
