import * as vscode from 'vscode';
import { CONFIG_SECTION } from './constants';

export interface Agent {
  id: string;
  name: string;
  command: string;
  enabled: boolean;
}

const BUILT_IN_AGENTS: readonly Agent[] = [
  { id: 'claude', name: 'Claude', command: 'claude', enabled: true },
  { id: 'codex', name: 'Codex', command: 'codex', enabled: true },
  { id: 'opencode', name: 'OpenCode', command: 'opencode', enabled: true },
];

export function allAgents(): Agent[] {
  const overrides = userOverrides();
  const builtIn = BUILT_IN_AGENTS.map(agent => ({ ...agent, ...overrides.find(o => o.id === agent.id) }));
  const custom = overrides
    .filter(isCompleteAgent)
    .filter(o => !BUILT_IN_AGENTS.some(agent => agent.id === o.id))
    .map(o => ({ ...o, enabled: o.enabled ?? true }));
  return [...builtIn, ...custom];
}

export function enabledAgents(): Agent[] {
  return allAgents().filter(agent => agent.enabled);
}

function userOverrides(): Partial<Agent>[] {
  const inspected = vscode.workspace.getConfiguration(CONFIG_SECTION).inspect<Partial<Agent>[]>('agents');
  return inspected?.globalValue ?? [];
}

function isCompleteAgent(candidate: Partial<Agent>): candidate is Agent {
  return !!candidate.id && !!candidate.name && !!candidate.command;
}
