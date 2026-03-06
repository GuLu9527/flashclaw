import { Globe, MessageCircleMore, RadioTower, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { PluginInfo } from './types';

interface ChannelCardView {
  key: string;
  label: string;
  summary: string;
  detail: string;
  color: string;
  Icon: LucideIcon;
}

function pickChannelIcon(name: string): LucideIcon {
  const normalized = name.toLowerCase();

  if (normalized.includes('feishu')) {
    return MessageCircleMore;
  }

  if (normalized.includes('telegram')) {
    return RadioTower;
  }

  return Wrench;
}

function formatChannelLabel(name: string) {
  return name
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildChannelCard(plugin: PluginInfo): ChannelCardView {
  if (plugin.enabled) {
    return {
      key: plugin.name,
      label: formatChannelLabel(plugin.name),
      summary: '已启用',
      detail: '插件已启用，当前暂无真实连接状态接口。',
      color: 'text-green-400',
      Icon: pickChannelIcon(plugin.name),
    };
  }

  return {
    key: plugin.name,
    label: formatChannelLabel(plugin.name),
    summary: '未启用',
    detail: '插件已安装，但当前配置未启用。',
    color: 'text-orange-400',
    Icon: pickChannelIcon(plugin.name),
  };
}

export default function ChannelStatusCards({ plugins }: { plugins: PluginInfo[] }) {
  const channelPlugins = plugins
    .filter((plugin) => plugin.type === 'channel')
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

  const cards: ChannelCardView[] = [
    {
      key: 'web-ui',
      label: 'Web UI',
      summary: '当前页面可访问',
      detail: '你已打开状态看板页面，因此 Web UI 当前可访问。',
      color: 'text-cyan-400',
      Icon: Globe,
    },
    ...channelPlugins.map(buildChannelCard),
  ];

  if (channelPlugins.length === 0) {
    cards.push({
      key: 'channel-empty',
      label: '渠道插件',
      summary: '未发现插件',
      detail: '当前插件列表中未发现任何 channel 类型插件。',
      color: 'text-pixel-muted',
      Icon: Wrench,
    });
  }

  return (
    <section className="rounded border-2 border-pixel-border bg-pixel-surface p-4">
      <h3 className="mb-4 text-sm font-bold text-gold">渠道状态</h3>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ key, label, summary, detail, color, Icon }) => (
          <div key={key} className="rounded border border-pixel-border bg-pixel-bg/70 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Icon className={`h-4 w-4 ${color}`} />
              <span className="text-sm font-semibold text-pixel-text">{label}</span>
            </div>
            <div className={`text-sm font-bold ${color}`}>{summary}</div>
            <p className="mt-1 text-xs leading-relaxed text-pixel-muted">{detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
