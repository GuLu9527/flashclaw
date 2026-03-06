import { useEffect, useState } from 'react';
import { Puzzle, ToggleLeft, ToggleRight } from 'lucide-react';

interface PluginInfo {
  name: string;
  version: string;
  type: string;
  description: string;
  enabled: boolean;
  isBuiltin: boolean;
}

export default function Plugins() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);

  const fetchPlugins = async () => {
    try {
      const res = await fetch('/api/plugins');
      setPlugins(await res.json());
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchPlugins(); }, []);

  const togglePlugin = async (name: string) => {
    await fetch(`/api/plugins/${name}/toggle`, { method: 'POST' });
    fetchPlugins();
  };

  const typeColor = (t: string) => {
    if (t === 'channel') return 'text-cyan-400';
    if (t === 'tool') return 'text-green-400';
    if (t === 'provider') return 'text-purple-400';
    return 'text-pixel-muted';
  };

  return (
    <div>
      <h1 className="text-xl font-bold text-gold mb-6 flex items-center gap-2">
        <Puzzle className="w-6 h-6" /> 插件管理
      </h1>

      <div className="bg-pixel-surface border-2 border-pixel-border rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-pixel-border">
              <th className="text-left px-4 py-3 text-pixel-muted font-normal">名称</th>
              <th className="text-left px-4 py-3 text-pixel-muted font-normal hidden md:table-cell">描述</th>
              <th className="text-left px-4 py-3 text-pixel-muted font-normal">类型</th>
              <th className="text-left px-4 py-3 text-pixel-muted font-normal">版本</th>
              <th className="text-left px-4 py-3 text-pixel-muted font-normal">状态</th>
            </tr>
          </thead>
          <tbody>
            {plugins.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-pixel-muted">暂无插件</td></tr>
            ) : plugins.map(plugin => (
              <tr key={plugin.name} className="border-b border-pixel-border/50 hover:bg-pixel-bg/50">
                <td className="px-4 py-3">
                  <span className="font-bold">{plugin.name}</span>
                  {plugin.isBuiltin && <span className="text-[10px] text-pixel-muted ml-1">(内置)</span>}
                </td>
                <td className="px-4 py-3 text-pixel-muted hidden md:table-cell">{plugin.description || '-'}</td>
                <td className="px-4 py-3">
                  <span className={typeColor(plugin.type)}>{plugin.type}</span>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{plugin.version}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => togglePlugin(plugin.name)}
                    className="flex items-center gap-1 text-xs hover:opacity-80 transition-opacity"
                    title={plugin.enabled ? '点击禁用' : '点击启用'}
                  >
                    {plugin.enabled ? (
                      <><ToggleRight className="w-5 h-5 text-green-400" /><span className="text-green-400">启用</span></>
                    ) : (
                      <><ToggleLeft className="w-5 h-5 text-pixel-muted" /><span className="text-pixel-muted">禁用</span></>
                    )}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-pixel-muted mt-3">提示：插件状态变更需要重启服务后生效</p>
    </div>
  );
}
