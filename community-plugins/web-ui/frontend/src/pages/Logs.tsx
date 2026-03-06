import { useEffect, useState, useRef } from 'react';
import { ScrollText, Filter } from 'lucide-react';

interface LogLine {
  level: string;
  time: string;
  message: string;
}

const LEVEL_COLORS: Record<string, string> = {
  error: 'text-red-400',
  warn: 'text-yellow-400',
  info: 'text-pixel-text',
  debug: 'text-pixel-muted',
};

export default function Logs() {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  useEffect(() => {
    let evtSource: EventSource | null = null;
    let cancelled = false;
    const abort = new AbortController();

    (async () => {
      try {
        const res = await fetch('/api/status', { signal: abort.signal });
        const status = await res.json();
        if (!status.running || cancelled) return;
      } catch { return; }

      if (cancelled) return;

      // SSE for live logs
      evtSource = new EventSource('/sse/logs');
      evtSource.onmessage = (event) => {
        try {
          const html = event.data;
          // Parse the log line from SSE HTML format
          const levelMatch = html.match(/log-(\w+)/);
          const timeMatch = html.match(/\[([^\]]+)\]/);
          const msgMatch = html.match(/\]<\/span>\s*(.*)/);
          if (levelMatch && msgMatch) {
            const line: LogLine = {
              level: levelMatch[1],
              time: timeMatch?.[1] || '',
              message: msgMatch[1].replace(/<[^>]*>/g, ''),
            };
            setLogs(prev => [...prev.slice(-500), line]);
          }
        } catch { /* ignore */ }
      };
    })();

    return () => {
      cancelled = true;
      abort.abort();
      evtSource?.close();
    };
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (autoScrollRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 100;
  };

  const filtered = filter === 'all' ? logs : logs.filter(l => l.level === filter);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gold flex items-center gap-2">
          <ScrollText className="w-6 h-6" /> 实时日志
        </h1>
        <div className="flex gap-1">
          {['all', 'error', 'warn', 'info'].map(level => (
            <button
              key={level}
              onClick={() => setFilter(level)}
              className={`px-3 py-1 text-xs rounded border-2 transition-colors ${
                filter === level
                  ? 'border-gold text-gold bg-gold/10'
                  : 'border-pixel-border text-pixel-muted hover:text-pixel-text'
              }`}
            >
              {level === 'all' ? '全部' : level === 'error' ? '错误' : level === 'warn' ? '警告' : '信息'}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 bg-pixel-surface border-2 border-pixel-border rounded p-3 overflow-y-auto font-mono text-xs leading-5"
      >
        {filtered.length === 0 ? (
          <p className="text-pixel-muted text-center mt-10">暂无日志</p>
        ) : filtered.map((log, i) => (
          <div key={i} className={`${LEVEL_COLORS[log.level] || 'text-pixel-text'}`}>
            <span className="text-pixel-muted">[{log.time}]</span> {log.message}
          </div>
        ))}
      </div>

      <div className="flex gap-2 mt-3">
        <button
          onClick={() => setLogs([])}
          className="px-3 py-1.5 text-xs border-2 border-pixel-border text-pixel-muted hover:text-pixel-text rounded transition-colors"
        >
          清空显示
        </button>
        <button
          onClick={() => {
            autoScrollRef.current = true;
            containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });
          }}
          className="px-3 py-1.5 text-xs border-2 border-pixel-border text-pixel-muted hover:text-pixel-text rounded transition-colors"
        >
          滚动到底部
        </button>
      </div>
    </div>
  );
}
