import { useEffect, useState } from 'react';
import { ListTodo, Pause, Play, Trash2 } from 'lucide-react';

interface TaskInfo {
  id: string;
  prompt: string;
  scheduleType: string;
  nextRun: string | null;
  status: string;
}

export default function Tasks() {
  const [tasks, setTasks] = useState<TaskInfo[]>([]);

  const fetchTasks = async () => {
    try {
      const res = await fetch('/api/tasks');
      setTasks(await res.json());
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchTasks(); }, []);

  const pauseTask = async (id: string) => {
    await fetch(`/api/tasks/${id}/pause`, { method: 'POST' });
    fetchTasks();
  };

  const resumeTask = async (id: string) => {
    await fetch(`/api/tasks/${id}/resume`, { method: 'POST' });
    fetchTasks();
  };

  const deleteTask = async (id: string) => {
    if (!confirm('确定要删除这个任务吗？')) return;
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    fetchTasks();
  };

  const statusColor = (s: string) => {
    if (s === 'active') return 'text-green-400';
    if (s === 'paused') return 'text-yellow-400';
    if (s === 'failed') return 'text-red-400';
    return 'text-pixel-muted';
  };

  return (
    <div>
      <h1 className="text-xl font-bold text-gold mb-6 flex items-center gap-2">
        <ListTodo className="w-6 h-6" /> 定时任务
      </h1>

      <div className="bg-pixel-surface border-2 border-pixel-border rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-pixel-border">
              <th className="text-left px-4 py-3 text-pixel-muted font-normal">ID</th>
              <th className="text-left px-4 py-3 text-pixel-muted font-normal hidden md:table-cell">描述</th>
              <th className="text-left px-4 py-3 text-pixel-muted font-normal">类型</th>
              <th className="text-left px-4 py-3 text-pixel-muted font-normal">下次执行</th>
              <th className="text-left px-4 py-3 text-pixel-muted font-normal">状态</th>
              <th className="text-left px-4 py-3 text-pixel-muted font-normal">操作</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-pixel-muted">暂无任务</td></tr>
            ) : tasks.map(task => (
              <tr key={task.id} className="border-b border-pixel-border/50 hover:bg-pixel-bg/50">
                <td className="px-4 py-3 font-mono text-xs">{task.id.slice(0, 8)}</td>
                <td className="px-4 py-3 hidden md:table-cell" title={task.prompt}>
                  {task.prompt.slice(0, 30)}{task.prompt.length > 30 ? '...' : ''}
                </td>
                <td className="px-4 py-3">{task.scheduleType}</td>
                <td className="px-4 py-3 text-xs">
                  {task.nextRun ? new Date(task.nextRun).toLocaleString('zh-CN') : '-'}
                </td>
                <td className="px-4 py-3">
                  <span className={`font-bold ${statusColor(task.status)}`}>{task.status}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    {task.status === 'active' ? (
                      <button onClick={() => pauseTask(task.id)} className="p-1 text-pixel-muted hover:text-yellow-400" title="暂停">
                        <Pause className="w-4 h-4" />
                      </button>
                    ) : (
                      <button onClick={() => resumeTask(task.id)} className="p-1 text-pixel-muted hover:text-green-400" title="恢复">
                        <Play className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => deleteTask(task.id)} className="p-1 text-pixel-muted hover:text-red-400" title="删除">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
