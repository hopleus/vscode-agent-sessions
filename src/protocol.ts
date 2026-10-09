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
  | { type: 'new'; agentId?: string }
  | { type: 'pin'; id: string; pinned: boolean }
  | { type: 'rename'; id: string; title: string };

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
    case 'pin':
      return isString(message.id) && typeof message.pinned === 'boolean'
        ? { type: 'pin', id: message.id, pinned: message.pinned }
        : undefined;
    case 'rename':
      return isString(message.id) && isString(message.title)
        ? { type: 'rename', id: message.id, title: message.title }
        : undefined;
    default:
      return undefined;
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
