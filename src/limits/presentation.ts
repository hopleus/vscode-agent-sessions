import { CLAUDE_AGENT_ID, CLAUDE_USAGE_PAGE, CODEX_AGENT_ID, limitsAgentName, OPENCODE_AGENT_ID } from './agents';
import { formatAge, formatMoney, formatRemaining, formatRemainingShort, formatTokens, progressBarImage, severityOf, Thresholds } from './format';
import { AgentLimits, ExtraUsage, LimitsResult, LimitWindow, TokenUsage } from './types';

export const ENABLE_CLAUDE_LINK =
  'command:workbench.action.openSettings?%5B%22agentSessions.limits.claude.enabled%22%5D';

export interface LimitsView {
  agentId: string | undefined;
  sessionTitle: string | undefined;
  result: LimitsResult | undefined;
  tokens?: TokenUsage;
  claudeEnabled: boolean;
  thresholds: Thresholds;
  now: number;
  refreshCommand: string;
}

export function limitsOf(result: LimitsResult | undefined): AgentLimits | undefined {
  return result?.kind === 'ok' ? result.limits : undefined;
}

export function totalTokens(tokens: TokenUsage): number {
  return tokens.input + tokens.output + tokens.reasoning;
}

export type StatusWindowMode = 'first' | 'highest';

export function statusWindow(result: LimitsResult | undefined, mode: StatusWindowMode = 'first'): LimitWindow | undefined {
  const windows = limitsOf(result)?.windows ?? [];
  if (mode === 'first') { return windows[0]; }
  return windows.reduce<LimitWindow | undefined>((best, window) =>
    !best || window.usedPercent > best.usedPercent ? window : best, undefined);
}

export function statusText(result: LimitsResult | undefined, now: number, tokens?: TokenUsage, mode: StatusWindowMode = 'first'): string {
  if (tokens) { return `${formatTokens(totalTokens(tokens))} tokens`; }
  const primary = statusWindow(result, mode);
  if (!primary) { return '–%'; }
  const percent = `${Math.round(primary.usedPercent)}%`;
  const remaining = formatRemainingShort(primary.resetsAt, now);
  return remaining ? `${percent} - ${remaining}` : percent;
}

export function statusSeverity(result: LimitsResult | undefined, thresholds: Thresholds, mode: StatusWindowMode = 'first'): 'ok' | 'warning' | 'error' {
  const primary = statusWindow(result, mode);
  return severityOf(primary?.usedPercent ?? 0, thresholds);
}

export function tooltipMarkdown(view: LimitsView): string {
  const name = limitsAgentName(view.agentId);
  const lines: string[] = [`**${name ?? 'Agent'} Usage**`];
  if (view.sessionTitle) { lines.push(`_${escapeMarkdown(view.sessionTitle)}_`); }
  lines.push(...bodyLines(view, name));
  lines.push(footer(view));
  return lines.join('\n\n');
}

function tokenLines(tokens: TokenUsage): string[] {
  const lines = [
    `Tokens: **${totalTokens(tokens).toLocaleString('en-US')}**`,
    `Input ${formatTokens(tokens.input)} · Output ${formatTokens(tokens.output)} · Reasoning ${formatTokens(tokens.reasoning)}`,
  ];
  if (tokens.cacheRead + tokens.cacheWrite > 0) {
    lines.push(`Cache read ${formatTokens(tokens.cacheRead)} · write ${formatTokens(tokens.cacheWrite)}`);
  }
  if (tokens.cost > 0) { lines.push(`Cost: $${tokens.cost.toFixed(4)}`); }
  return lines;
}

function bodyLines(view: LimitsView, name: string | undefined): string[] {
  if (view.agentId === OPENCODE_AGENT_ID) {
    return view.tokens ? tokenLines(view.tokens) : ['No token data for this session yet.'];
  }
  if (!name) { return ['This agent has no usage limits to show.']; }
  if (view.agentId === CLAUDE_AGENT_ID && !view.claudeEnabled) {
    return [`Off. [Enable in settings](${ENABLE_CLAUDE_LINK}) (reads your Claude Code login to ask Anthropic for usage).`];
  }
  if (!view.result) { return ['Loading…']; }
  if (view.result.kind === 'unavailable') { return [escapeMarkdown(view.result.reason)]; }
  return limitLines(view.result.limits, view);
}

function limitLines(limits: AgentLimits, view: LimitsView): string[] {
  const lines: string[] = [];
  for (const window of limits.windows) {
    const percent = Math.round(window.usedPercent);
    lines.push(`${escapeMarkdown(window.label)} &nbsp;|&nbsp; **${percent}%**`);
    lines.push(`![${percent}%](${progressBarImage(percent, view.thresholds)})`);
    lines.push(`_${formatRemaining(window.resetsAt, view.now)}_`);
  }
  if (limits.extraUsage) { lines.push(...extraUsageLines(limits.extraUsage, view)); }
  limits.details.forEach(detail => lines.push(escapeMarkdown(detail)));
  return lines;
}

function extraUsageLines(extra: ExtraUsage, view: LimitsView): string[] {
  const percent = Math.round(extra.usedPercent);
  const lines = [
    `Extra usage &nbsp;|&nbsp; **${percent}%**`,
    `![${percent}%](${progressBarImage(percent, view.thresholds)})`,
  ];
  if (extra.used !== undefined) {
    const used = formatMoney(extra.used, extra.currency);
    lines.push(`_${extra.limit ? `${used} of ${formatMoney(extra.limit, extra.currency)} spent` : `${used} spent`}_`);
  }
  return lines;
}

function footer(view: LimitsView): string {
  const parts: string[] = [];
  if (view.agentId === CLAUDE_AGENT_ID) { parts.push(`[View on claude.ai](${CLAUDE_USAGE_PAGE})`); }
  const observed = view.agentId === CODEX_AGENT_ID ? limitsOf(view.result)?.observedAt : undefined;
  parts.push(observed !== undefined
    ? `Last seen ${formatAge(observed, view.now)}`
    : new Date(view.now).toLocaleTimeString([], { hour12: false }));
  parts.push(`[Refresh](command:${view.refreshCommand})`);
  return `---\n\n${parts.join(' &nbsp;·&nbsp; ')}`;
}

export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!|<>])/g, '\\$1');
}
