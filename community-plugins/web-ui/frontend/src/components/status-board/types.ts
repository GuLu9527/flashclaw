import type { LucideIcon } from 'lucide-react';

export interface ServiceStatus {
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

export interface PluginInfo {
  name: string;
  version: string;
  type: string;
  description: string;
  author?: string;
  enabled: boolean;
  isBuiltin: boolean;
}

export type AgentState = 'idle' | 'thinking' | 'tool_use' | 'responding' | 'error';
export type AgentRole = 'main' | 'coordinator' | 'builder' | 'researcher' | 'reviewer' | 'ops';
export type RoomZone = 'lounge' | 'thinking' | 'workbench' | 'meeting' | 'review' | 'alert';

export interface StateConfig {
  label: string;
  icon: LucideIcon;
  color: string;
  bgColor: string;
  bubble: string;
}

export interface RoleConfig {
  label: string;
  summary: string;
  accent: string;
  softAccent: string;
  zone: RoomZone;
  home: { x: number; y: number };
}

export interface RoomZoneMeta {
  label: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoomAgent {
  role: AgentRole;
  state: AgentState;
  x: number;
  y: number;
  note: string;
}

export type ActivityItemType = 'message' | 'tool_use' | 'task' | 'system' | 'status' | 'empty';
export type ActivitySource = 'activity-html' | 'status-fallback' | 'placeholder';

export interface ActivityItem {
  id: string;
  time: string;
  type: ActivityItemType;
  title: string;
  detail?: string;
  sender?: string;
  source: ActivitySource;
  agent?: AgentRole;
}
