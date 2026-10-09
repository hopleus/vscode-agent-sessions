import * as vscode from 'vscode';
import { REFRESH_COMMAND, VIEW_ID } from './constants';
import { SessionService } from './sessionService';
import { SessionsView } from './view';

export function activate(context: vscode.ExtensionContext): void {
  const service = new SessionService(context);
  const view = new SessionsView(context.extensionUri, service);
  context.subscriptions.push(
    service,
    view,
    vscode.window.registerWebviewViewProvider(VIEW_ID, view),
    vscode.commands.registerCommand(REFRESH_COMMAND, () => view.refresh()),
  );
  service.warmUp();
  void service.restore();
}

export function deactivate(): void {}
