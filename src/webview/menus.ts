import type { AgentDto } from '../protocol';
import { escapeHtml } from './format';
import { agentIcon } from './icons';

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
