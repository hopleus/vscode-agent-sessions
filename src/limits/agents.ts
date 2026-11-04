export const CLAUDE_AGENT_ID = 'claude';
export const CODEX_AGENT_ID = 'codex';
export const OPENCODE_AGENT_ID = 'opencode';
export const GLM_AGENT_ID = 'glm';
export const DEEPSEEK_AGENT_ID = 'deepseek';
export const DEEPSEEK_PLATFORM_PAGE = 'https://platform.deepseek.com';
export const CLAUDE_USAGE_PAGE = 'https://claude.ai/settings/usage';

const NAMES: Readonly<Record<string, string>> = {
  [CLAUDE_AGENT_ID]: 'Claude Code',
  [CODEX_AGENT_ID]: 'Codex',
  [OPENCODE_AGENT_ID]: 'OpenCode',
  [GLM_AGENT_ID]: 'GLM',
  [DEEPSEEK_AGENT_ID]: 'DeepSeek',
};

export function limitsAgentName(agentId: string | undefined): string | undefined {
  return agentId === undefined ? undefined : NAMES[agentId];
}
