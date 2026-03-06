import { useEffect, useState } from 'react';
import { Brain, Globe, User } from 'lucide-react';

interface MemoryEntry {
  key: string;
  value: string;
  scope: string;
}

export default function MemoryTimeline() {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/memories?limit=15');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.entries) setEntries(data.entries);
      } catch { /* ignore */ }
    };
    load();
    const timer = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  if (entries.length === 0) {
    return (
      <div className="rounded border-2 border-pixel-border bg-pixel-surface p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-gold">
          <Brain className="h-4 w-4" /> 记忆库
        </h3>
        <p className="text-xs italic text-pixel-muted">暂无记忆条目。使用 memory remember 可保存信息。</p>
      </div>
    );
  }

  return (
    <div className="rounded border-2 border-pixel-border bg-pixel-surface p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-gold">
        <Brain className="h-4 w-4" /> 记忆库
        <span className="rounded-full border border-pixel-border bg-pixel-bg px-2 py-0.5 text-[10px] text-pixel-muted">
          {entries.length} 条
        </span>
      </h3>
      <div className="space-y-2">
        {entries.map((entry, i) => {
          const isUser = entry.scope.startsWith('user:');
          return (
            <div key={`${entry.scope}-${entry.key}-${i}`} className="flex items-start gap-2 rounded border border-pixel-border/50 bg-pixel-bg/50 p-2">
              <div className={`mt-0.5 rounded-full p-1 ${isUser ? 'bg-cyan-400/10 text-cyan-400' : 'bg-gold/10 text-gold'}`}>
                {isUser ? <User className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-pixel-text">{entry.key}</span>
                  <span className="text-[10px] text-pixel-muted">
                    {isUser ? entry.scope.replace('user:', '') : '全局'}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-pixel-muted">{entry.value}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
