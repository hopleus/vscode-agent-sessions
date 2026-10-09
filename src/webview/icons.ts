import claudeColor from '../../node_modules/@lobehub/icons-static-svg/icons/claude-color.svg';
import claudeMono from '../../node_modules/@lobehub/icons-static-svg/icons/claude.svg';
import openAiMono from '../../node_modules/@lobehub/icons-static-svg/icons/openai.svg';

const FALLBACK_ICON = '<span class="codicon codicon-hubot"></span>';

const COLOR_ICONS: Record<string, string> = {
  claude: clean(claudeColor),
  codex: clean(openAiMono),
};

const MONO_ICONS: Record<string, string> = {
  claude: clean(claudeMono),
  codex: clean(openAiMono),
};

export function agentIcon(agentId: string | undefined, mono = false): string {
  const icons = mono ? MONO_ICONS : COLOR_ICONS;
  return (agentId && icons[agentId]) || FALLBACK_ICON;
}

function clean(svg: string): string {
  return svg.replace(/<title>.*?<\/title>/, '').replace(/ style="[^"]*"/, '');
}
