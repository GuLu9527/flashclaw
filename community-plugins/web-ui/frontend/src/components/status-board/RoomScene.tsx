import { Clock } from 'lucide-react';
import { ROLE_MAP, ROOM_ZONE_META, STATE_MAP } from './constants';
import LobsterAvatar from './LobsterAvatar';
import type { AgentRole, RoomAgent, ServiceStatus } from './types';

function RoomFurniture() {
  return (
    <>
      <div className="absolute left-[10%] top-[69%] h-10 w-16 rounded-lg border-2 border-pixel-border bg-green-900/30 shadow-inner" />
      <div className="absolute left-[13%] top-[73%] h-5 w-10 rounded border border-green-400/40 bg-green-400/10" />

      <div className="absolute left-[20%] top-[12%] h-12 w-14 rounded-lg border-2 border-pixel-border bg-purple-900/25" />
      <div className="absolute left-[18%] top-[16%] h-4 w-4 rounded-sm bg-purple-300/60" />
      <div className="absolute left-[30%] top-[16%] h-4 w-4 rounded-sm bg-purple-300/60" />

      <div className="absolute left-[51%] top-[15%] h-10 w-12 rounded-lg border-2 border-pixel-border bg-cyan-900/25" />
      <div className="absolute left-[53%] top-[17%] h-4 w-7 rounded border border-cyan-300/40 bg-cyan-300/20" />
      <div className="absolute left-[57%] top-[22%] h-2 w-5 rounded bg-cyan-200/40" />

      <div className="absolute left-[75%] top-[12%] h-14 w-18 rounded-lg border-2 border-pixel-border bg-gold/10" />
      <div className="absolute left-[77%] top-[14%] h-6 w-7 rounded border border-gold/50 bg-slate-900/70" />
      <div className="absolute left-[85%] top-[16%] h-4 w-4 rounded-sm bg-gold/30" />
      <div className="absolute left-[84%] top-[22%] h-5 w-6 rounded bg-gold/20" />

      <div className="absolute left-[41%] top-[63%] h-14 w-20 rounded-full border-2 border-pixel-border bg-sky-900/20" />
      <div className="absolute left-[45%] top-[58%] h-4 w-10 rounded border border-sky-300/35 bg-sky-300/12" />

      <div className="absolute left-[79%] top-[67%] h-12 w-12 rounded-lg border-2 border-pixel-border bg-red-900/25" />
      <div className="absolute left-[81%] top-[69%] h-3 w-8 rounded bg-red-400/50" />
      <div className="absolute left-[82%] top-[75%] h-2 w-6 rounded bg-orange-300/40" />
    </>
  );
}

function RoomZones({ activeRole }: { activeRole: AgentRole }) {
  return (
    <>
      {Object.entries(ROOM_ZONE_META).map(([key, zone]) => {
        const isActiveZone = ROLE_MAP[activeRole].zone === key;

        return (
          <div
            key={key}
            className={`room-zone-hover pointer-events-none absolute z-10 rounded-2xl border border-white/10 transition-all ${isActiveZone ? 'ring-1 ring-gold/50' : ''}`}
            style={{
              left: `${zone.x}%`,
              top: `${zone.y}%`,
              width: `${zone.w}%`,
              height: `${zone.h}%`,
              backgroundColor: zone.color,
            }}
          >
            <div className="px-2 py-1 text-[10px] font-pixel text-white/65">{zone.label}</div>
          </div>
        );
      })}
    </>
  );
}

function RoomAgentSprite({
  agent,
  highlight,
  focused,
  onClick,
}: {
  agent: RoomAgent;
  highlight: boolean;
  focused: boolean;
  onClick: (role: AgentRole) => void;
}) {
  const roleConfig = ROLE_MAP[agent.role];
  const stateConfig = STATE_MAP[agent.state];

  return (
    <button
      type="button"
      onClick={() => onClick(agent.role)}
      className="absolute z-30 cursor-pointer border-none bg-transparent p-0 text-left transition-all duration-1000 ease-in-out"
      style={{ left: `${agent.x}%`, top: `${agent.y}%`, transform: 'translate(-50%, -50%)' }}
      aria-label={`查看 ${roleConfig.label} 详情`}
    >
      <div
        className="absolute -top-11 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] shadow-lg"
        style={{
          backgroundColor: roleConfig.softAccent,
          color: roleConfig.accent,
          borderColor: roleConfig.accent,
          opacity: highlight || focused ? 1 : 0.82,
        }}
      >
        {agent.note}
        <div
          className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-b border-r"
          style={{ backgroundColor: roleConfig.softAccent, borderColor: roleConfig.accent }}
        />
      </div>

      <div className="text-center">
        <div className={focused ? 'room-agent-focused' : highlight ? 'room-agent-active' : ''}>
          <LobsterAvatar role={agent.role} state={agent.state} animated size={highlight || focused ? 140 : 110} />
        </div>
        <div className="mt-1 text-[10px] font-pixel" style={{ color: roleConfig.accent }}>
          {roleConfig.label} · {stateConfig.label}
        </div>
      </div>
    </button>
  );
}

export default function RoomScene({
  agents,
  activeRole,
  focusedAgent,
  status,
  onAgentClick,
}: {
  agents: RoomAgent[];
  activeRole: AgentRole;
  focusedAgent: AgentRole | null;
  status: ServiceStatus | null;
  onAgentClick: (role: AgentRole) => void;
}) {
  const agentState = agents.find((agent) => agent.role === activeRole)?.state ?? 'idle';

  return (
    <section className="relative mb-6 overflow-hidden rounded-2xl border-2 border-pixel-border bg-[#0f172a]" style={{ height: '460px' }}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(250,204,21,0.06),_transparent_35%),linear-gradient(180deg,_rgba(30,41,59,0.95),_rgba(15,23,42,1))]" />
      <div
        className="absolute inset-[18px] rounded-[22px] border border-white/10"
        style={{
          background:
            'linear-gradient(180deg, rgba(71,85,105,0.08), rgba(30,41,59,0.18)), linear-gradient(rgba(250,204,21,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(250,204,21,0.03) 1px, transparent 1px)',
          backgroundSize: 'auto, 22px 22px, 22px 22px',
        }}
      />
      <div className="absolute inset-[18px] rounded-[22px] border border-slate-400/10 shadow-[inset_0_0_40px_rgba(15,23,42,0.45)]" />

      <RoomZones activeRole={activeRole} />
      <RoomFurniture />

      <div className="pointer-events-none absolute left-[50%] top-[50%] z-10 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-gold/30 bg-gold/5" />

      {agents.map((agent) => (
        <RoomAgentSprite
          key={agent.role}
          agent={agent}
          highlight={agent.role === activeRole}
          focused={agent.role === focusedAgent}
          onClick={onAgentClick}
        />
      ))}

      <div className="pointer-events-none absolute left-4 top-4 z-40 rounded-full border border-white/10 bg-slate-900/70 px-3 py-1 text-xs text-pixel-muted backdrop-blur-sm">
        FlashClaw Room · Prototype
      </div>

      <div className="pointer-events-none absolute bottom-4 left-4 z-40 flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/70 px-3 py-1 text-[10px] text-pixel-muted backdrop-blur-sm">
        <div className={`h-2 w-2 rounded-full ${agentState === 'error' ? 'bg-red-400' : 'bg-green-400'} animate-pulse`} />
        {status?.provider || '-'} / {status?.model || '-'}
      </div>

      <div className="pointer-events-none absolute bottom-4 right-4 z-40 flex items-center gap-1 rounded-full border border-white/10 bg-slate-900/70 px-3 py-1 text-[10px] text-pixel-muted backdrop-blur-sm">
        <Clock className="h-3 w-3" />
        {status?.uptime || '-'}
      </div>
    </section>
  );
}
