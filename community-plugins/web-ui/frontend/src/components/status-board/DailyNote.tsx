import { useEffect, useState } from 'react';
import { BookOpen, CalendarDays, ChevronDown, ChevronUp } from 'lucide-react';

interface DailyNoteData {
  today: string | null;
  yesterday: string | null;
  todayDate?: string;
  yesterdayDate?: string;
}

export default function DailyNote() {
  const [data, setData] = useState<DailyNoteData>({ today: null, yesterday: null });
  const [showYesterday, setShowYesterday] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/daily-note');
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch { /* ignore */ }
    };
    load();
    const timer = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const hasContent = data.today || data.yesterday;

  return (
    <div className="rounded border-2 border-pixel-border bg-pixel-surface p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-gold">
        <BookOpen className="h-4 w-4" /> 每日小记
      </h3>

      {data.today ? (
        <div className="mb-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs text-pixel-muted">
            <CalendarDays className="h-3 w-3" /> 今日 {data.todayDate || ''}
          </div>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-pixel-muted">{data.today}</p>
        </div>
      ) : (
        <p className="mb-3 text-xs italic text-pixel-muted">今日暂无记录</p>
      )}

      {data.yesterday && (
        <div>
          <button
            onClick={() => setShowYesterday(!showYesterday)}
            className="flex items-center gap-1 border-none bg-transparent p-0 text-xs text-pixel-muted transition hover:text-pixel-text"
          >
            {showYesterday ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            昨日 {data.yesterdayDate || ''}
          </button>
          {showYesterday && (
            <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-pixel-muted opacity-75">{data.yesterday}</p>
          )}
        </div>
      )}

      {!hasContent && (
        <p className="text-xs italic text-pixel-muted">暂无日志记录。使用 memory log 命令可添加每日记录。</p>
      )}
    </div>
  );
}
