export const CONFIG_SECTION = 'agentSessions';
export const VIEW_ID = 'agentSessions.view';
export const REFRESH_COMMAND = 'agentSessions.refresh';
export const REFRESH_LIMITS_COMMAND = 'agentSessions.refreshLimits';

export const SESSION_COMMANDS = {
  pin: 'agentSessions.session.pin',
  unpin: 'agentSessions.session.unpin',
  rename: 'agentSessions.session.rename',
  reopenWithChrome: 'agentSessions.session.reopenWithChrome',
  reopenWithoutChrome: 'agentSessions.session.reopenWithoutChrome',
  delete: 'agentSessions.session.delete',
} as const;

export const SET_API_KEY_COMMANDS = {
  glm: 'agentSessions.setApiKey.glm',
  deepseek: 'agentSessions.setApiKey.deepseek',
} as const;
