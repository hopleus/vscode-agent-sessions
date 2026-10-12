export interface LimitWindow {
  label: string;
  usedPercent: number;
  resetsAt?: number;
}

export interface AgentLimits {
  agentId: string;
  agentName: string;
  windows: LimitWindow[];
  details: string[];
  observedAt?: number;
}

export type LimitsResult =
  | { kind: 'ok'; limits: AgentLimits }
  | { kind: 'unavailable'; agentId: string; agentName: string; reason: string };

export interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}
