import { useState } from 'react';
import { Activity, Bot, ChevronDown, ChevronUp, MessageSquare, Sparkles, Wrench } from 'lucide-react';
import type { ActivityItem } from './types';

function getItemIcon(item: ActivityItem) {
  switch (item.type) {
    case 'message':
      return item.sender?.includes('FlashClaw') ? Bot : MessageSquare;
    case 'tool_use':
      return Wrench;
    case 'task':
      return Sparkles;
    case 'empty':
      return Activity;
    default:
      return Activity;
  }
}

function getItemColor(item: ActivityItem) {
  switch (item.type) {
    case 'message':
      return item.sender?.includes('FlashClaw') ? 'text-cyan-400' : 'text-green-400';
    case 'tool_use':
      return 'text-gold';
    case 'task':
      return 'text-purple-400';
    case 'status':
      return 'text-blue-400';
    case 'empty':
      return 'text-pixel-muted';
    default:
      return 'text-orange-400';
  }
}

function ActivityEntry({ item }: { item: ActivityItem }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = getItemIcon(item);
  const colorClass = getItemColor(item);
  const isExpandable = item.source !== 'placeholder' && item.detail && item.detail.length > 0;

  return (
    <div
      className={`timeline-item-enter flex gap-3 rounded border border-pixel-border/60 bg-pixel-bg/60 p-3 ${isExpandable ? 'cursor-pointer transition hover:border-pixel-border' : ''}`}
      onClick={isExpandable ? () => setExpanded(!expanded) : undefined}
    >
      <div className="relative flex flex-col items-center">
        <div className={`rounded-full border border-current/30 bg-slate-900/60 p-2 ${colorClass}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="mt-1 h-full min-h-6 w-px bg-pixel-border/70" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-pixel text-pixel-muted">{item.time}</span>
          <span className={`font-semibold ${colorClass}`}>{item.title}</span>
          {item.source !== 'placeholder' && (
            <span className="rounded-full border border-white/10 bg-slate-900/60 px-2 py-0.5 text-[10px] text-pixel-muted">
              {item.source === 'activity-html' ? '活动记录' : '状态推导'}
            </span>
          )}
          {isExpandable && (
            expanded
              ? <ChevronUp className="h-3 w-3 text-pixel-muted" />
              : <ChevronDown className="h-3 w-3 text-pixel-muted" />
          )}
        </div>
        {expanded && item.detail && (
          <div className="mt-2 rounded border border-pixel-border/40 bg-slate-900/40 p-2">
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-pixel-muted">{item.detail}</p>
            {item.sender && (
              <p className="mt-1 text-[10px] text-pixel-muted opacity-60">发送者: {item.sender}</p>
            )}
          </div>
        )}
        {!expanded && item.detail && (
          <p className="mt-1 truncate text-xs text-pixel-muted">{item.detail}</p>
        )}
      </div>
    </div>
  );
}

export default function ActivityTimeline({ items }: { items: ActivityItem[] }) {
  return (
    <section className="rounded border-2 border-pixel-border bg-pixel-surface p-4">
      <div className="mb-4 flex items-center gap-2 text-sm font-bold text-gold">
        <Activity className="h-4 w-4" /> 活动时间线
      </div>

      <div className="space-y-3">
        {items.map((item) => (
          <ActivityEntry key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
