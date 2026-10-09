import type { AgentDto, SessionDto, StateMessage } from '../protocol';
import { escapeHtml, timeAgo } from './format';
import { agentIcon } from './icons';

export interface ViewModel {
  state: StateMessage;
  currentAgent: AgentDto | undefined;
  selectedId: string | undefined;
  expanded: boolean;
  collapsedGroups: ReadonlySet<string>;
}

export const SESSION_LIMIT = 10;

export function renderApp({ state, currentAgent, selectedId, expanded, collapsedGroups }: ViewModel): string {
  const pinned = state.sessions.filter(session => session.pinned);
  const unpinned = state.sessions.filter(session => !session.pinned);
  const visible = expanded ? unpinned : unpinned.slice(0, SESSION_LIMIT);
  const disabled = state.hasFolder ? '' : ' disabled';
  const tree = `<vscode-tree indent-guides="none" indent="8">` +
    `${renderGroup('Pinned', pinned, selectedId, collapsedGroups)}` +
    `${renderGroup('Sessions', visible, selectedId, collapsedGroups)}</vscode-tree>`;
  const body = state.sessions.length
    ? tree + renderToggle(unpinned.length, expanded)
    : `<div class="empty">${emptyMessage(state.hasFolder)}</div>`;
  return `<div class="scroll">${renderToolbar(currentAgent, disabled)}${body}</div>`;
}

function renderToolbar(agent: AgentDto | undefined, disabled: string): string {
  return '<div class="toolbar"><vscode-button-group>' +
    `<vscode-button data-new${disabled}>` +
    `<span slot="content-before" class="ico">${agentIcon(agent?.id, true)}</span>New Session</vscode-button>` +
    `<vscode-button icon="chevron-down" title="Choose agent" data-chev${disabled}></vscode-button>` +
    '</vscode-button-group></div>';
}

function renderGroup(
  name: string,
  sessions: SessionDto[],
  selectedId: string | undefined,
  collapsedGroups: ReadonlySet<string>,
): string {
  if (!sessions.length) { return ''; }
  const count = `${sessions.length} session${sessions.length > 1 ? 's' : ''}`;
  const open = collapsedGroups.has(name) ? '' : ' open';
  return `<vscode-tree-item data-group="${name}"${open}><span class="gname">${name}</span>` +
    `<span slot="description">${count}</span>` +
    sessions.map(session => renderSession(session, selectedId)).join('') +
    '</vscode-tree-item>';
}

function renderSession(session: SessionDto, selectedId: string | undefined): string {
  const selected = session.id === selectedId ? ' selected' : '';
  return `<vscode-tree-item data-id="${escapeHtml(session.id)}"${selected}>` +
    `<span slot="icon-leaf" class="ico">${agentIcon(session.agentId)}</span>` +
    `<span class="title">${escapeHtml(session.title)}</span>` +
    `<span slot="decoration" class="time">${timeAgo(session.updatedAt)}</span>` +
    '</vscode-tree-item>';
}

function renderToggle(unpinnedCount: number, expanded: boolean): string {
  if (unpinnedCount <= SESSION_LIMIT) { return ''; }
  return `<div class="more" data-more>${expanded ? 'Show less' : 'Show more…'}</div>`;
}

function emptyMessage(hasFolder: boolean): string {
  return hasFolder ? 'No sessions in this workspace' : 'Open a folder to start agent sessions';
}
