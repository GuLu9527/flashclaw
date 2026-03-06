import { AlertTriangle, Brain, Coffee, MessageSquare, Wrench } from 'lucide-react';
import type {
  AgentRole,
  AgentState,
  RoleConfig,
  RoomAgent,
  RoomZone,
  RoomZoneMeta,
  ServiceStatus,
  StateConfig,
} from './types';

export const STATE_MAP: Record<AgentState, StateConfig> = {
  idle: {
    label: '待命中',
    icon: Coffee,
    color: 'text-green-400',
    bgColor: 'bg-green-400/10',
    bubble: '☕ 等待指令...',
  },
  thinking: {
    label: '思考中',
    icon: Brain,
    color: 'text-purple-400',
    bgColor: 'bg-purple-400/10',
    bubble: '🧠 让我想想...',
  },
  tool_use: {
    label: '执行中',
    icon: Wrench,
    color: 'text-gold',
    bgColor: 'bg-gold/10',
    bubble: '🔧 正在使用工具...',
  },
  responding: {
    label: '回复中',
    icon: MessageSquare,
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-400/10',
    bubble: '💬 正在输出...',
  },
  error: {
    label: '异常',
    icon: AlertTriangle,
    color: 'text-red-400',
    bgColor: 'bg-red-400/10',
    bubble: '❌ 出了点问题...',
  },
};

export const ROLE_MAP: Record<AgentRole, RoleConfig> = {
  main: {
    label: 'Main',
    summary: '主吉祥物，负责待命与支援。',
    accent: '#60A5FA',
    softAccent: 'rgba(96, 165, 250, 0.18)',
    zone: 'lounge',
    home: { x: 16, y: 74 },
  },
  coordinator: {
    label: 'Coordinator',
    summary: '负责调度、协调与对外回复。',
    accent: '#F59E0B',
    softAccent: 'rgba(245, 158, 11, 0.18)',
    zone: 'meeting',
    home: { x: 50, y: 71 },
  },
  builder: {
    label: 'Builder',
    summary: '负责实现与工具执行。',
    accent: '#34D399',
    softAccent: 'rgba(52, 211, 153, 0.18)',
    zone: 'workbench',
    home: { x: 79, y: 28 },
  },
  researcher: {
    label: 'Researcher',
    summary: '负责检索、推理与整理资料。',
    accent: '#A78BFA',
    softAccent: 'rgba(167, 139, 250, 0.18)',
    zone: 'thinking',
    home: { x: 31, y: 21 },
  },
  reviewer: {
    label: 'Reviewer',
    summary: '负责检查细节与质量把关。',
    accent: '#38BDF8',
    softAccent: 'rgba(56, 189, 248, 0.18)',
    zone: 'review',
    home: { x: 60, y: 28 },
  },
  ops: {
    label: 'Ops',
    summary: '负责监控、守护与异常响应。',
    accent: '#F87171',
    softAccent: 'rgba(248, 113, 113, 0.18)',
    zone: 'alert',
    home: { x: 84, y: 76 },
  },
};

export const ROOM_ZONE_META: Record<RoomZone, RoomZoneMeta> = {
  lounge: { label: '休息区', color: 'rgba(52, 211, 153, 0.16)', x: 4, y: 58, w: 24, h: 30 },
  thinking: { label: '思考区', color: 'rgba(167, 139, 250, 0.16)', x: 5, y: 6, w: 38, h: 26 },
  review: { label: '审查台', color: 'rgba(56, 189, 248, 0.15)', x: 47, y: 6, w: 20, h: 26 },
  workbench: { label: '工作区', color: 'rgba(245, 158, 11, 0.16)', x: 70, y: 6, w: 25, h: 30 },
  meeting: { label: '会议区', color: 'rgba(96, 165, 250, 0.14)', x: 34, y: 56, w: 32, h: 28 },
  alert: { label: 'Bug 区', color: 'rgba(248, 113, 113, 0.16)', x: 71, y: 62, w: 24, h: 24 },
};

export const ROOM_IDLE_NOTES: Record<AgentRole, string> = {
  main: '巡逻待命',
  coordinator: '整理任务',
  builder: '待命工位',
  researcher: '翻看资料',
  reviewer: '检查清单',
  ops: '监控值班',
};

export function inferActiveRole(state: AgentState): AgentRole {
  switch (state) {
    case 'thinking':
      return 'researcher';
    case 'tool_use':
      return 'builder';
    case 'responding':
      return 'coordinator';
    case 'error':
      return 'ops';
    default:
      return 'main';
  }
}

export function deriveAgentState(status: ServiceStatus | null): AgentState {
  if (!status) {
    return 'idle';
  }

  if (!status.running) {
    return 'error';
  }

  if (status.activeSessions > 0) {
    return 'responding';
  }

  if (status.activeTaskCount > 0) {
    return 'tool_use';
  }

  return 'idle';
}

export function getAgentStateForRole(role: AgentRole, activeRole: AgentRole, agentState: AgentState): AgentState {
  return role === activeRole ? agentState : 'idle';
}

export function buildRoomAgents(activeRole: AgentRole, agentState: AgentState): RoomAgent[] {
  const activeState = STATE_MAP[agentState];

  return (Object.keys(ROLE_MAP) as AgentRole[]).map((role) => {
    const roleMeta = ROLE_MAP[role];

    if (role === activeRole) {
      return {
        role,
        state: agentState,
        x: roleMeta.home.x,
        y: roleMeta.home.y,
        note: activeState.bubble,
      };
    }

    return {
      role,
      state: 'idle',
      x: roleMeta.home.x,
      y: roleMeta.home.y,
      note: ROOM_IDLE_NOTES[role],
    };
  });
}

/** 可用角色插槽池（用于动态分配 API Agent） */
const ROLE_SLOTS: AgentRole[] = ['main', 'coordinator', 'builder', 'researcher', 'reviewer', 'ops'];

/**
 * 从 API Agent 列表构建房间角色（动态，非硬编码）
 * 每个 API Agent 按顺序分配一个视觉角色插槽（颜色、位置）
 */
export function buildRoomAgentsFromApi(
  apiAgents: Array<{ id: string; name: string; isDefault?: boolean }>,
  agentState: AgentState,
): { agents: RoomAgent[]; agentIdToRole: Map<string, AgentRole> } {
  const idToRole = new Map<string, AgentRole>();
  const agents: RoomAgent[] = [];
  const activeState = STATE_MAP[agentState];

  // 默认 agent 固定用 'main' 角色
  const sorted = [...apiAgents].sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));

  sorted.forEach((apiAgent, i) => {
    if (i >= ROLE_SLOTS.length) return; // 最多 6 个角色
    const role = ROLE_SLOTS[i];
    const roleMeta = ROLE_MAP[role];
    idToRole.set(apiAgent.id, role);

    const isActive = apiAgent.isDefault && agentState !== 'idle';
    agents.push({
      role,
      state: isActive ? agentState : 'idle',
      x: roleMeta.home.x,
      y: roleMeta.home.y,
      note: isActive ? activeState.bubble : apiAgent.name,
    });
  });

  return { agents, agentIdToRole: idToRole };
}
