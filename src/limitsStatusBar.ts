import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CLAUDE_AGENT_ID, CODEX_AGENT_ID, OPENCODE_AGENT_ID } from './limits/agents';
import { fetchClaudeUsage, readCredentials } from './limits/claude';
import { readCodexLimits } from './limits/codex';
import { readOpenCodeTokens } from './limits/opencode';
import { DEFAULT_THRESHOLDS, Thresholds } from './limits/format';
import { nextClaudeBackoff, refreshIntervalMs } from './limits/policy';
import { limitsOf, LimitsView, statusSeverity, statusText, tooltipMarkdown } from './limits/presentation';
import { acquireUsageLock, readSharedUsage, writeSharedUsage } from './limits/shared';
import { LimitsResult } from './limits/types';
import { CONFIG_SECTION, REFRESH_LIMITS_COMMAND } from './constants';
import { SessionService } from './sessionService';

const TICK_MS = 60_000;
const TICK_SLACK_MS = 1_000;
const MANUAL_REFRESH_COOLDOWN_MS = 5_000;
const CLAUDE_SETTING = 'limits.claude.enabled';
const INTERVAL_SETTING = 'limits.refreshMinutes';
const PROMPTED_KEY = 'agentSessions.limitsPrompted';
const TRUSTED_COMMANDS = ['workbench.action.openSettings', REFRESH_LIMITS_COMMAND];

export class LimitsStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  private readonly subscriptions: vscode.Disposable[] = [this.item];
  private codex: LimitsResult | undefined;
  private claude: LimitsResult | undefined;
  private claudeNextAt = 0;
  private claudeBackoffMs = refreshIntervalMs(undefined);
  private codexAt = 0;
  private claudeFetchedAt = 0;
  private lastManualAt = 0;
  private inFlight: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly service: SessionService,
    private readonly state: vscode.Memento,
    private readonly storageDir: string,
  ) {}

  start(): void {
    this.item.command = REFRESH_LIMITS_COMMAND;
    this.subscriptions.push(
      this.service.onDidChangeActiveSession(() => void this.render()),
      vscode.workspace.onDidChangeConfiguration(event => this.onConfigurationChanged(event)),
      vscode.window.onDidChangeWindowState(state => { if (state.focused) { void this.refresh(false); } }),
    );
    void this.refresh(true);
    void this.offerClaudeLimits();
    this.timer = setInterval(() => void this.refresh(false), TICK_MS);
  }

  dispose(): void {
    clearInterval(this.timer);
    this.subscriptions.forEach(subscription => subscription.dispose());
  }

  async refreshManually(): Promise<void> {
    const now = Date.now();
    if (now - this.lastManualAt < MANUAL_REFRESH_COOLDOWN_MS) { return; }
    this.lastManualAt = now;
    this.claudeNextAt = 0;
    await this.refresh(true);
  }

  private onConfigurationChanged(event: vscode.ConfigurationChangeEvent): void {
    if (event.affectsConfiguration(`${CONFIG_SECTION}.${CLAUDE_SETTING}`)) { void this.refresh(true); }
    if (event.affectsConfiguration(`${CONFIG_SECTION}.${INTERVAL_SETTING}`)) {
      this.claudeBackoffMs = this.intervalMs();
      this.claudeNextAt = 0;
      void this.refresh(true);
    }
    if (event.affectsConfiguration(`${CONFIG_SECTION}.limits.warningPercent`)
      || event.affectsConfiguration(`${CONFIG_SECTION}.limits.errorPercent`)) { void this.render(); }
  }

  private refresh(force: boolean): Promise<void> {
    this.inFlight ??= this.doRefresh(force).finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  private async doRefresh(force: boolean): Promise<void> {
    if (force || this.codexDue()) {
      this.codexAt = Date.now();
      this.codex = await readCodexLimits();
    }
    if (!this.claudeEnabled()) {
      this.claude = undefined;
    } else {
      await this.syncClaude(force);
    }
    await this.render();
  }

  private intervalMs(): number {
    return refreshIntervalMs(vscode.workspace.getConfiguration(CONFIG_SECTION).get<number>(INTERVAL_SETTING));
  }

  private codexDue(): boolean {
    return Date.now() - this.codexAt >= this.intervalMs() - TICK_SLACK_MS;
  }

  private shouldFetchClaude(force: boolean): boolean {
    const now = Date.now();
    if (!vscode.workspace.isTrusted) { return false; }
    if (force) { return now - this.claudeFetchedAt >= MANUAL_REFRESH_COOLDOWN_MS; }
    return vscode.window.state.focused && now >= this.claudeNextAt - TICK_SLACK_MS;
  }

  private adoptShared(): void {
    const shared = readSharedUsage(this.storageDir);
    if (!shared || shared.fetchedAt <= this.claudeFetchedAt) { return; }
    this.claude = shared.result;
    this.claudeFetchedAt = shared.fetchedAt;
    this.claudeNextAt = shared.nextAt;
    this.claudeBackoffMs = shared.backoffMs;
  }

  private async syncClaude(force: boolean): Promise<void> {
    this.adoptShared();
    if (!this.shouldFetchClaude(force)) { return; }
    const release = acquireUsageLock(this.storageDir);
    if (!release) { return; }
    try {
      this.adoptShared();
      if (!this.shouldFetchClaude(force)) { return; }
      await this.refreshClaude();
      writeSharedUsage(this.storageDir, {
        result: this.claude as LimitsResult,
        fetchedAt: this.claudeFetchedAt,
        nextAt: this.claudeNextAt,
        backoffMs: this.claudeBackoffMs,
      });
    } finally {
      release();
    }
  }

  private async refreshClaude(): Promise<void> {
    const outcome = await fetchClaudeUsage({ readCredentials, fetch, now: Date.now });
    if (!outcome.transient || this.claude?.kind !== 'ok' || outcome.result.kind === 'ok') {
      this.claude = outcome.result;
    }
    this.claudeBackoffMs = nextClaudeBackoff(this.claudeBackoffMs, {
      ok: outcome.result.kind === 'ok',
      retryAfterMs: outcome.retryAfterMs,
    }, this.intervalMs());
    this.claudeFetchedAt = Date.now();
    this.claudeNextAt = this.claudeFetchedAt + this.claudeBackoffMs;
  }

  private async currentView(): Promise<LimitsView> {
    const current = await this.service.currentSession();
    const agentId = current?.agentId ?? this.firstAvailableAgentId();
    return {
      agentId,
      sessionTitle: current?.title,
      result: this.resultOf(agentId),
      tokens: agentId === OPENCODE_AGENT_ID && current ? readOpenCodeTokens(current.id) : undefined,
      claudeEnabled: this.claudeEnabled(),
      thresholds: this.thresholds(),
      now: Date.now(),
      refreshCommand: REFRESH_LIMITS_COMMAND,
    };
  }

  private async render(): Promise<void> {
    const view = await this.currentView();
    this.item.text = view.agentId === OPENCODE_AGENT_ID
      ? (view.tokens ? statusText(view.result, view.now, view.tokens) : '–')
      : statusText(view.result, view.now);
    this.item.tooltip = this.markdown(tooltipMarkdown(view));
    this.item.backgroundColor = this.backgroundFor(statusSeverity(view.result, view.thresholds));
    this.item.show();
  }

  private markdown(content: string): vscode.MarkdownString {
    const markdown = new vscode.MarkdownString(content, true);
    markdown.isTrusted = { enabledCommands: TRUSTED_COMMANDS };
    markdown.supportHtml = false;
    return markdown;
  }

  private backgroundFor(severity: 'ok' | 'warning' | 'error'): vscode.ThemeColor | undefined {
    if (severity === 'error') { return new vscode.ThemeColor('statusBarItem.errorBackground'); }
    return severity === 'warning' ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
  }

  private resultOf(agentId: string | undefined): LimitsResult | undefined {
    if (agentId === CLAUDE_AGENT_ID) { return this.claude; }
    return agentId === CODEX_AGENT_ID ? this.codex : undefined;
  }

  private firstAvailableAgentId(): string | undefined {
    return [CLAUDE_AGENT_ID, CODEX_AGENT_ID].find(agentId => limitsOf(this.resultOf(agentId)));
  }

  private thresholds(): Thresholds {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const warning = config.get<number>('limits.warningPercent', DEFAULT_THRESHOLDS.warning);
    const error = config.get<number>('limits.errorPercent', DEFAULT_THRESHOLDS.error);
    return { warning: Math.min(warning, error), error: Math.max(warning, error) };
  }

  private claudeEnabled(): boolean {
    return vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>(CLAUDE_SETTING, false);
  }

  private async offerClaudeLimits(): Promise<void> {
    const inspected = vscode.workspace.getConfiguration(CONFIG_SECTION).inspect<boolean>(CLAUDE_SETTING);
    const alreadyDecided = inspected?.globalValue !== undefined || this.state.get<boolean>(PROMPTED_KEY, false);
    const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    if (alreadyDecided || !vscode.workspace.isTrusted || !fs.existsSync(claudeDir)) { return; }
    await this.state.update(PROMPTED_KEY, true);
    const choice = await vscode.window.showInformationMessage(
      'Show your Claude Code usage limits in the status bar? This reads your Claude Code login and asks api.anthropic.com for your usage. You can change this later in settings.',
      'Enable', 'No thanks',
    );
    if (choice === 'Enable') {
      await vscode.workspace.getConfiguration(CONFIG_SECTION)
        .update(CLAUDE_SETTING, true, vscode.ConfigurationTarget.Global);
    }
  }
}
