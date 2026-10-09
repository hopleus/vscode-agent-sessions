import '@vscode-elements/elements/dist/bundled.js';
import type { AgentDto, SessionDto, StateMessage } from '../protocol';
import { AgentMenu, SessionMenu } from './menus';
import { renderApp } from './render';
import { vscode } from './vscodeApi';

const CLOCK_REFRESH_MS = 60_000;

const app = document.getElementById('app') as HTMLElement;
let state: StateMessage | undefined;
let selectedId: string | undefined;
let expanded = false;
const collapsedGroups = new Set<string>();
let chosenAgentId = vscode.getState()?.agentId;

const sessionMenu = new SessionMenu({
  togglePin: session => vscode.postMessage({ type: 'pin', id: session.id, pinned: !session.pinned }),
  rename: session => vscode.postMessage({ type: 'rename', id: session.id, title: session.title }),
});
const agentMenu = new AgentMenu();

function currentAgent(): AgentDto | undefined {
  const agents = state?.agents ?? [];
  return agents.find(agent => agent.id === chosenAgentId) ?? agents[0];
}

function rememberCollapsedGroups(): void {
  app.querySelectorAll<HTMLElement & { open: boolean }>('vscode-tree-item[data-group]').forEach(group => {
    const name = group.dataset.group as string;
    if (group.open) { collapsedGroups.delete(name); } else { collapsedGroups.add(name); }
  });
}

function render(): void {
  if (!state) { return; }
  rememberCollapsedGroups();
  app.innerHTML = renderApp({ state, currentAgent: currentAgent(), selectedId, expanded, collapsedGroups });
}

function sessionRowOf(event: Event): HTMLElement | undefined {
  return event.composedPath().find(
    (node): node is HTMLElement => node instanceof HTMLElement && node.matches('vscode-tree-item[data-id]'),
  );
}

function sessionById(id: string | undefined): SessionDto | undefined {
  return state?.sessions.find(session => session.id === id);
}

function closeMenus(): void {
  sessionMenu.close();
  agentMenu.close();
}

function openSession(session: SessionDto): void {
  selectedId = session.id;
  vscode.postMessage({ type: 'open', id: session.id, agentId: session.agentId });
}

function chooseAgent(agent: AgentDto): void {
  chosenAgentId = agent.id;
  vscode.setState({ agentId: agent.id });
  render();
}

app.addEventListener('click', event => {
  const target = event.target as Element;
  closeMenus();

  const group = target.closest('[data-chev]') && target.closest('vscode-button-group');
  if (group) {
    event.stopPropagation();
    agentMenu.open(group, state?.agents ?? [], currentAgent()?.id, chooseAgent);
    return;
  }
  if (target.closest('[data-more]')) {
    expanded = !expanded;
    render();
    return;
  }
  if (target.closest('[data-new]')) {
    vscode.postMessage({ type: 'new', agentId: currentAgent()?.id });
    return;
  }
  const row = sessionRowOf(event);
  const session = sessionById(row?.dataset.id);
  if (session) { openSession(session); }
}, true);

app.addEventListener('keydown', event => {
  if (event.key !== 'Enter') { return; }
  const focused = document.activeElement as HTMLElement | null;
  const session = focused?.matches('vscode-tree-item[data-id]') ? sessionById(focused.dataset.id) : undefined;
  if (session) { openSession(session); }
});

app.addEventListener('contextmenu', event => {
  const session = sessionById(sessionRowOf(event)?.dataset.id);
  if (!session) { return; }
  event.preventDefault();
  sessionMenu.open(session, event.clientX, event.clientY);
}, true);

document.addEventListener('click', event => {
  const target = event.target as Element;
  if (!sessionMenu.contains(target)) { sessionMenu.close(); }
  if (!agentMenu.contains(target)) { agentMenu.close(); }
});
window.addEventListener('blur', closeMenus);

window.addEventListener('message', event => {
  if (event.data?.type !== 'state') { return; }
  state = event.data as StateMessage;
  render();
});

setInterval(render, CLOCK_REFRESH_MS);
vscode.postMessage({ type: 'ready' });
