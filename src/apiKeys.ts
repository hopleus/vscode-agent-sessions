import * as vscode from 'vscode';
import { Provider, ProviderId } from './providers';

const SECRET_PREFIX = 'agentSessions.apiKey.';

export class ApiKeys {
  readonly onDidChange: vscode.Event<vscode.SecretStorageChangeEvent>;

  constructor(private readonly secrets: vscode.SecretStorage) {
    this.onDidChange = secrets.onDidChange;
  }

  get(id: ProviderId): Thenable<string | undefined> {
    return this.secrets.get(SECRET_PREFIX + id);
  }

  async ensure(provider: Provider): Promise<string | undefined> {
    return await this.get(provider.id) ?? this.prompt(provider);
  }

  async prompt(provider: Provider): Promise<string | undefined> {
    const value = await vscode.window.showInputBox({
      title: `Set ${provider.keyName}`,
      prompt: `${provider.keyPrompt} Leave empty to remove the saved key.`,
      password: true,
      ignoreFocusOut: true,
    });
    if (value === undefined) { return undefined; }
    const key = value.trim();
    if (key) {
      await this.secrets.store(SECRET_PREFIX + provider.id, key);
      return key;
    }
    await this.secrets.delete(SECRET_PREFIX + provider.id);
    void vscode.window.showInformationMessage(`The ${provider.keyName} was removed.`);
    return undefined;
  }

  isKey(event: vscode.SecretStorageChangeEvent): boolean {
    return event.key.startsWith(SECRET_PREFIX);
  }
}
