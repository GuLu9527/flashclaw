import { useEffect, useState } from 'react';
import { Zap, Clock, MessageSquare, Users, ListTodo, Activity } from 'lucide-react';

interface ServiceStatus {
  running: boolean;
  pid: number | null;
  uptime: string | null;
  messageCount: number;
  activeSessions: number;
  activeTaskCount: number;
  totalTaskCount: number;
  provider: string | null;
  model: string | null;
}

export default function Dashboard() {
  const [status, setStatus] = useState<ServiceStatus | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/status');
        setStatus(await res.json());
      } catch { /* ignore */ }
    };
    fetchStatus();
    const timer = setInterval(fetchStatus, 5000);
    return () => clearInterval(timer);
  }, []);

  const stats = [
    { label: '状态', value: status?.running ? '运行中' : '已停止', icon: Activity, color: status?.running ? 'text-green-400' : 'text-red-400' },
    { label: 'PID', value: status?.pid ?? '-', icon: Zap, color: 'text-gold' },
    { label: '运行时间', value: status?.uptime ?? '-', icon: Clock, color: 'text-blue-400' },
    { label: '消息数', value: status?.messageCount ?? 0, icon: MessageSquare, color: 'text-purple-400' },
    { label: '活跃会话', value: status?.activeSessions ?? 0, icon: Users, color: 'text-cyan-400' },
    { label: '活跃任务', value: `${status?.activeTaskCount ?? 0}/${status?.totalTaskCount ?? 0}`, icon: ListTodo, color: 'text-orange-400' },
  ];

  return (
    <div>
      <h1 className="text-xl font-bold text-gold mb-6 flex items-center gap-2">
        <Activity className="w-6 h-6" /> 仪表盘
      </h1>

      {/* Status cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-pixel-surface border-2 border-pixel-border rounded p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`w-4 h-4 ${color}`} />
              <span className="text-xs text-pixel-muted">{label}</span>
            </div>
            <div className={`text-lg font-bold ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Model info */}
      {status?.provider && (
        <div className="bg-pixel-surface border-2 border-pixel-border rounded p-4">
          <h2 className="text-sm font-bold text-gold mb-2">AI Provider</h2>
          <p className="text-pixel-muted text-sm">
            {status.provider} / {status.model || '-'}
          </p>
        </div>
      )}
    </div>
  );
}
