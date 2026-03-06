import { MapPin, MessageSquare, ShieldCheck, X, Zap } from 'lucide-react';
import { getAgentStateForRole, ROLE_MAP, ROOM_ZONE_META, STATE_MAP } from './constants';
import LobsterAvatar from './LobsterAvatar';
import type { AgentRole, AgentState, ServiceStatus } from './types';

export default function AgentDetailCard({
  role,
  activeRole,
  agentState,
  status,
  onClose,
}: {
  role: AgentRole;
  activeRole: AgentRole;
  agentState: AgentState;
  status: ServiceStatus | null;
  onClose: () => void;
}) {
  const roleConfig = ROLE_MAP[role];
  const currentState = getAgentStateForRole(role, activeRole, agentState);
  const stateConfig = STATE_MAP[currentState];
  const zone = ROOM_ZONE_META[roleConfig.zone];

  return (
    <section className="detail-slide-in rounded-2xl border-2 border-pixel-border bg-slate-950/95 p-4 shadow-2xl backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-3">
            <LobsterAvatar role={role} state={currentState} animated size={88} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-bold text-gold">{roleConfig.label}</h3>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${stateConfig.color}`} style={{ borderColor: roleConfig.accent }}>
                {stateConfig.label}
              </span>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-pixel-muted">{roleConfig.summary}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-pixel-muted">
              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-slate-900/60 px-2 py-1">
                <MapPin className="h-3.5 w-3.5" /> {zone.label}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-slate-900/60 px-2 py-1">
                <Zap className="h-3.5 w-3.5" /> {stateConfig.bubble}
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="rounded border border-white/10 bg-slate-900/70 p-2 text-pixel-muted transition hover:text-pixel-text"
          aria-label="关闭角色详情"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded border border-pixel-border bg-pixel-bg/60 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gold">
            <ShieldCheck className="h-4 w-4" /> 当前观察
          </div>
          <p className="text-xs leading-relaxed text-pixel-muted">
            当前详情卡只使用前端现有可得信息。角色状态随系统推导变化，但点击聚焦不会改写系统当前活跃角色。
          </p>
        </div>

        <div className="rounded border border-pixel-border bg-pixel-bg/60 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gold">
            <MessageSquare className="h-4 w-4" /> 全局服务统计
          </div>
          <ul className="space-y-1 text-xs text-pixel-muted">
            <li>消息数：{status?.messageCount ?? 0}</li>
            <li>活跃会话：{status?.activeSessions ?? 0}</li>
            <li>活跃任务：{status?.activeTaskCount ?? 0}</li>
            <li>运行时间：{status?.uptime ?? '-'}</li>
          </ul>
        </div>

        <div className="rounded border border-pixel-border bg-pixel-bg/60 p-3">
          <div className="mb-2 text-sm font-semibold text-gold">说明</div>
          <p className="text-xs leading-relaxed text-pixel-muted">
            以上统计当前为全局服务统计，后续如接入角色级后端接口，再细分到单角色数据视图。
          </p>
        </div>
      </div>
    </section>
  );
}
