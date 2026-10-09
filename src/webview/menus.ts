import type { AgentDto, SessionDto } from '../protocol';
import { escapeHtml } from './format';
import { agentIcon } from './icons';

interface MenuItem {
  label: string;
  value: string;
}

interface ContextMenuElement extends HTMLElement {
  show: boolean;
  data: MenuItem[];
}

export interface SessionMenuActions {
  togglePin(session: SessionDto): void;
  rename(session: SessionDto): void;
}

const MENU_WIDTH = 180;

export class SessionMenu {
  private readonly element = document.createElement('vscode-context-menu') as ContextMenuElement;
  private onSelect: ((value: string) => void) | undefined;

  constructor(private readonly actions: SessionMenuActions) {
    this.element.style.position = 'fixed';
    this.element.style.zIndex = '10';
    document.body.appendChild(this.element);
    this.element.addEventListener('vsc-context-menu-select', event => {
      const handler = this.onSelect;
      this.close();
      handler?.((event as CustomEvent<{ value: string }>).detail.value);
    });
  }

  contains(target: Element): boolean {
    return !!target.closest('vscode-context-menu');
  }

  open(session: SessionDto, x: number, y: number): void {
    this.element.data = [
      { label: session.pinned ? 'Unpin' : 'Pin', value: 'pin' },
      { label: 'Rename', value: 'rename' },
    ];
    this.element.style.left = `${Math.min(x, window.innerWidth - MENU_WIDTH)}px`;
    this.element.style.top = `${y}px`;
    this.onSelect = value => {
      if (value === 'pin') { this.actions.togglePin(session); }
      if (value === 'rename') { this.actions.rename(session); }
    };
    this.element.show = true;
  }

  close(): void {
    this.element.show = false;
    this.onSelect = undefined;
  }
}

const AGENT_MENU_CLASS = 'agent-menu';

export class AgentMenu {
  contains(target: Element): boolean {
    return !!target.closest(`.${AGENT_MENU_CLASS}, [data-chev]`);
  }

  open(anchor: Element, agents: AgentDto[], currentId: string | undefined, onPick: (agent: AgentDto) => void): void {
    this.close();
    const menu = document.createElement('div');
    menu.className = AGENT_MENU_CLASS;
    for (const agent of agents) {
      menu.appendChild(this.createItem(agent, agent.id === currentId, onPick));
    }
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 2}px`;
    menu.style.minWidth = `${rect.width}px`;
    document.body.appendChild(menu);
  }

  close(): void {
    document.querySelectorAll(`.${AGENT_MENU_CLASS}`).forEach(menu => menu.remove());
  }

  private createItem(agent: AgentDto, isCurrent: boolean, onPick: (agent: AgentDto) => void): HTMLElement {
    const item = document.createElement('div');
    item.className = 'agent-item';
    item.innerHTML = `<span class="ico">${agentIcon(agent.id)}</span>` +
      `<span class="aname">${escapeHtml(agent.name)}</span>` +
      `<span class="check">${isCurrent ? '<span class="codicon codicon-check"></span>' : ''}</span>`;
    item.addEventListener('click', event => {
      event.stopPropagation();
      this.close();
      onPick(agent);
    });
    return item;
  }
}
