import * as vscode from 'vscode';
import { REFRESH_COMMAND, REFRESH_LIMITS_COMMAND, VIEW_ID } from './constants';
import { LimitsFeature } from './limitsFeature';
import { SessionService } from './sessionService';
import { SessionsView } from './view';

export function activate(context: vscode.ExtensionContext): void {
  const service = new SessionService(context);
  const view = new SessionsView(context.extensionUri, service);
  const limits = new LimitsFeature(service, context.globalState, context.globalStorageUri.fsPath);
  context.subscriptions.push(
    service,
    view,
    limits,
    vscode.window.registerWebviewViewProvider(VIEW_ID, view),
    vscode.commands.registerCommand(REFRESH_COMMAND, () => view.refresh()),
    vscode.commands.registerCommand(REFRESH_LIMITS_COMMAND, () => limits.refresh()),
  );
  service.warmUp();
  void service.restore();
}

export function deactivate(): void {}
