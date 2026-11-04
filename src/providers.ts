export type ProviderId = 'glm' | 'deepseek';

export interface Provider {
  id: ProviderId;
  name: string;
  keyName: string;
  keyPrompt: string;
  modelPrefix: string;
  env(key: string): Record<string, string>;
}

export const PROVIDERS: readonly Provider[] = [
  {
    id: 'glm',
    name: 'GLM (Claude Code)',
    keyName: 'Z.ai API key',
    keyPrompt: 'Z.ai API key of your GLM Coding Plan. It is kept in VS Code secret storage and passed to Claude Code when a GLM session starts.',
    modelPrefix: 'glm',
    env: key => ({
      ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
      ANTHROPIC_AUTH_TOKEN: key,
      API_TIMEOUT_MS: '3000000',
    }),
  },
  {
    id: 'deepseek',
    name: 'DeepSeek (Claude Code)',
    keyName: 'DeepSeek API key',
    keyPrompt: 'DeepSeek API key. It is kept in VS Code secret storage and passed to Claude Code when a DeepSeek session starts.',
    modelPrefix: 'deepseek',
    env: key => ({
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      ANTHROPIC_AUTH_TOKEN: key,
    }),
  },
];

export function providerById(id: string | undefined): Provider | undefined {
  return PROVIDERS.find(provider => provider.id === id);
}

export function providerOfModel(model: string | undefined): ProviderId | undefined {
  const normalized = model?.toLowerCase();
  return normalized ? PROVIDERS.find(provider => normalized.startsWith(provider.modelPrefix))?.id : undefined;
}
