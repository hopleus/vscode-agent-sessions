export interface AgentDto {
  id: string;
  name: string;
}

export interface SessionDto {
  id: string;
  agentId: string;
  title: string;
  updatedAt: number;
  pinned: boolean;
  chrome?: boolean;
}

export interface StateMessage {
  type: 'state';
  hasFolder: boolean;
  agents: AgentDto[];
  sessions: SessionDto[];
}

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'open'; id: string; agentId: string }
  | { type: 'new'; agentId?: string };

export const SESSION_SECTION = 'agentSessions.session';

export interface SessionContext {
  webviewSection: typeof SESSION_SECTION;
  sessionId: string;
  sessionAgent: string;
  sessionTitle: string;
  sessionPinned: boolean;
  sessionChrome: boolean;
  preventDefaultContextMenuItems: true;
}

export function parseWebviewMessage(raw: unknown): WebviewMessage | undefined {
  if (typeof raw !== 'object' || raw === null) { return undefined; }
  const message = raw as Record<string, unknown>;
  switch (message.type) {
    case 'ready':
      return { type: 'ready' };
    case 'open':
      return isString(message.id) && isString(message.agentId)
        ? { type: 'open', id: message.id, agentId: message.agentId }
        : undefined;
    case 'new':
      return message.agentId === undefined || isString(message.agentId)
        ? { type: 'new', agentId: message.agentId }
        : undefined;
    default:
      return undefined;
  }
}

export function parseSessionContext(raw: unknown): SessionContext | undefined {
  if (typeof raw !== 'object' || raw === null) { return undefined; }
  const context = raw as Record<string, unknown>;
  const valid = context.webviewSection === SESSION_SECTION && isString(context.sessionId) && isString(context.sessionAgent)
    && typeof context.sessionTitle === 'string';
  return valid ? context as unknown as SessionContext : undefined;
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
