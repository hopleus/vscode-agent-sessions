import * as vscode from 'vscode';
import { ApiKeys } from './apiKeys';
import { REFRESH_COMMAND, REFRESH_LIMITS_COMMAND, SET_API_KEY_COMMANDS, VIEW_ID } from './constants';
import { LimitsFeature } from './limitsFeature';
import { PROVIDERS } from './providers';
import { SessionService } from './sessionService';
import { SessionsView } from './view';

export function activate(context: vscode.ExtensionContext): void {
  const keys = new ApiKeys(context.secrets);
  const service = new SessionService(context, keys);
  const view = new SessionsView(context.extensionUri, service);
  const limits = new LimitsFeature(service, context.globalState, context.globalStorageUri.fsPath, keys);
  context.subscriptions.push(
    service,
    view,
    limits,
    vscode.window.registerWebviewViewProvider(VIEW_ID, view),
    vscode.commands.registerCommand(REFRESH_COMMAND, () => view.refresh()),
    vscode.commands.registerCommand(REFRESH_LIMITS_COMMAND, () => limits.refresh()),
    ...view.registerSessionCommands(),
    ...PROVIDERS.map(provider => vscode.commands.registerCommand(SET_API_KEY_COMMANDS[provider.id], () => keys.prompt(provider))),
  );
  service.warmUp();
  void service.restore();
}

export function deactivate(): void {}
