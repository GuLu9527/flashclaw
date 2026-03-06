import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, MessageSquare, ListTodo, Puzzle, ScrollText, Zap, Monitor } from 'lucide-react';

const NAV_ITEMS = [
  { to: '/', label: '仪表盘', icon: LayoutDashboard },
  { to: '/status', label: '状态看板', icon: Monitor },
  { to: '/chat', label: '对话', icon: MessageSquare },
  { to: '/tasks', label: '任务', icon: ListTodo },
  { to: '/plugins', label: '插件', icon: Puzzle },
  { to: '/logs', label: '日志', icon: ScrollText },
];

export default function Layout() {
  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-56 bg-pixel-surface border-r-4 border-pixel-border flex flex-col">
        {/* Brand */}
        <div className="p-4 border-b-4 border-pixel-border">
          <div className="flex items-center gap-2">
            <Zap className="w-6 h-6 text-gold" />
            <span className="font-pixel text-gold text-xs">FlashClaw</span>
          </div>
          <p className="text-[10px] text-pixel-muted mt-1 font-pixel">Web UI</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-2 space-y-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded transition-colors text-sm ${
                  isActive
                    ? 'bg-gold/20 text-gold border-2 border-gold/40'
                    : 'text-pixel-muted hover:text-pixel-text hover:bg-pixel-bg border-2 border-transparent'
                }`
              }
            >
              <Icon className="w-4 h-4" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t-4 border-pixel-border text-[10px] text-pixel-muted font-pixel">
          v1.8.0
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
