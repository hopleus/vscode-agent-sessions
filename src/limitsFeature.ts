import * as vscode from 'vscode';
import { CONFIG_SECTION } from './constants';
import { LimitsStatusBar } from './limitsStatusBar';
import { SessionService } from './sessionService';

const ENABLED_SETTING = 'limits.enabled';

export class LimitsFeature implements vscode.Disposable {
  private bar: LimitsStatusBar | undefined;
  private readonly subscription: vscode.Disposable;

  constructor(
    private readonly service: SessionService,
    private readonly state: vscode.Memento,
    private readonly storageDir: string,
  ) {
    this.subscription = vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(`${CONFIG_SECTION}.${ENABLED_SETTING}`)) { this.apply(); }
    });
    this.apply();
  }

  async refresh(): Promise<void> {
    await this.bar?.refreshManually();
  }

  dispose(): void {
    this.subscription.dispose();
    this.stop();
  }

  private apply(): void {
    const enabled = vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>(ENABLED_SETTING, true);
    if (enabled && !this.bar) {
      this.bar = new LimitsStatusBar(this.service, this.state, this.storageDir);
      this.bar.start();
    } else if (!enabled) {
      this.stop();
    }
  }

  private stop(): void {
    this.bar?.dispose();
    this.bar = undefined;
  }
}
