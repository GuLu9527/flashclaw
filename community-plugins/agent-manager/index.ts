/**
 * FlashClaw 插件 - Agent 管理器
 * 
 * 多 Agent 注册表：加载 agents.json、路由匹配、工具白名单。
 * 作为插件实现，遵循"核心极简，功能靠插件"原则。
 * 
 * 通过 global.__flashclaw_agent_registry 暴露接口给核心代码（可选依赖）。
 * 核心代码在此插件未加载时回退到默认单 Agent 行为。
 */

import fs from 'fs';
import path from 'path';
import { ToolPlugin, ToolContext, ToolResult, PluginConfig } from '../../src/plugins/types.js';
import type { MultiAgentConfig } from '../../src/types.js';

// ==================== 默认 Agent ====================

const DEFAULT_AGENT: MultiAgentConfig = {
  id: 'main',
  name: 'FlashClaw',
  soul: 'souls/default.md',
  model: null,
  tools: ['*'],
  default: true,
  promptMode: 'full',
};

// ==================== 注册表状态 ====================

let agents: MultiAgentConfig[] = [DEFAULT_AGENT];

// ==================== 路由上下文 ====================

interface RouteContext {
  channel?: string;
  group?: string;
  peer?: string;
}

// ==================== 核心逻辑 ====================

function loadAgentsFromFile(): MultiAgentConfig[] {
  // 获取 ~/.flashclaw 路径
  const homePath = process.env.FLASHCLAW_HOME || path.join(
    process.env.HOME || process.env.USERPROFILE || '.',
    '.flashclaw'
  );
  const configPath = path.join(homePath, 'agents.json');

  if (!fs.existsSync(configPath)) {
    agents = [DEFAULT_AGENT];
    return agents;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);

    if (!parsed.agents || !Array.isArray(parsed.agents)) {
      agents = [DEFAULT_AGENT];
      return agents;
    }

    const validated: MultiAgentConfig[] = [];
    const ids = new Set<string>();

    for (const entry of parsed.agents) {
      if (!entry.id || !entry.name) continue;
      if (ids.has(entry.id)) continue;

      ids.add(entry.id);
      validated.push({
        id: entry.id,
        name: entry.name,
        soul: entry.soul || 'souls/default.md',
        model: entry.model ?? null,
        tools: Array.isArray(entry.tools) ? entry.tools : ['*'],
        default: entry.default === true,
        bindings: Array.isArray(entry.bindings) ? entry.bindings : undefined,
        promptMode: ['full', 'minimal', 'none'].includes(entry.promptMode) ? entry.promptMode : 'full',
      });
    }

    if (validated.length === 0) {
      agents = [DEFAULT_AGENT];
    } else if (!validated.some(a => a.default)) {
      validated[0].default = true;
      agents = validated;
    } else {
      agents = validated;
    }

    return agents;
  } catch {
    agents = [DEFAULT_AGENT];
    return agents;
  }
}

function getAllAgents(): MultiAgentConfig[] {
  return agents;
}

function getAgentById(id: string): MultiAgentConfig | undefined {
  return agents.find(a => a.id === id);
}

function getDefaultAgent(): MultiAgentConfig {
  return agents.find(a => a.default) || DEFAULT_AGENT;
}

function matchWildcard(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  if (pattern === value) return true;
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${regexStr}$`).test(value);
}

function resolveAgent(ctx: RouteContext): MultiAgentConfig {
  if (agents.length <= 1) {
    return agents[0] || DEFAULT_AGENT;
  }

  // Level 1: peer 精确匹配
  if (ctx.peer) {
    for (const agent of agents) {
      if (!agent.bindings) continue;
      for (const binding of agent.bindings) {
        if (binding.peer && binding.peer === ctx.peer) return agent;
      }
    }
  }

  // Level 2: channel + group 匹配
  if (ctx.channel && ctx.group) {
    for (const agent of agents) {
      if (!agent.bindings) continue;
      for (const binding of agent.bindings) {
        if (binding.channel && binding.group) {
          const channelMatch = binding.channel === '*' || binding.channel === ctx.channel;
          const groupMatch = matchWildcard(binding.group, ctx.group);
          if (channelMatch && groupMatch) return agent;
        }
      }
    }
  }

  // Level 3: channel 匹配
  if (ctx.channel) {
    for (const agent of agents) {
      if (!agent.bindings) continue;
      for (const binding of agent.bindings) {
        if (binding.channel && !binding.group && !binding.peer) {
          if (binding.channel === '*' || binding.channel === ctx.channel) return agent;
        }
      }
    }
  }

  return getDefaultAgent();
}

function filterToolsByAgent<T extends { name: string }>(
  agentConfig: MultiAgentConfig,
  allTools: T[]
): T[] {
  if (agentConfig.tools.length === 1 && agentConfig.tools[0] === '*') {
    return allTools;
  }
  const allowed = new Set(agentConfig.tools);
  allowed.add('send_message');
  return allTools.filter(t => allowed.has(t.name));
}

// ==================== Global 接口（供核心代码可选使用） ====================

export interface AgentRegistry {
  getAllAgents: () => MultiAgentConfig[];
  getAgentById: (id: string) => MultiAgentConfig | undefined;
  getDefaultAgent: () => MultiAgentConfig;
  resolveAgent: (ctx: RouteContext) => MultiAgentConfig;
  filterToolsByAgent: <T extends { name: string }>(agentConfig: MultiAgentConfig, allTools: T[]) => T[];
}

// ==================== 插件实现 ====================

const plugin: ToolPlugin = {
  name: 'agent-manager',
  version: '1.0.0',
  description: '多 Agent 注册表 — 路由、白名单、配置管理',

  tools: [
    {
      name: 'agent_list',
      description: `列出所有可用的 Agent 及其配置信息。

示例：agent_list({})`,
      input_schema: {
        type: 'object',
        properties: {},
        required: []
      }
    },
    {
      name: 'agent_send',
      description: `向另一个 Agent 发送消息。目标 Agent 会处理消息并返回结果。

适用场景：
- 委派任务给专门的 Agent
- 多 Agent 协作完成复杂任务

注意：不能给自己发消息。使用 agent_list 查看可用的 Agent。

示例：agent_send({ agentId: "work", message: "帮我整理今天的会议纪要" })`,
      input_schema: {
        type: 'object',
        properties: {
          agentId: {
            type: 'string',
            description: '目标 Agent 的 ID（使用 agent_list 查看可用 Agent）'
          },
          message: {
            type: 'string',
            description: '要发送给目标 Agent 的消息'
          }
        },
        required: ['agentId', 'message']
      }
    }
  ],

  async init(_config: PluginConfig): Promise<void> {
    // 加载 agents.json
    loadAgentsFromFile();

    // 通过 global 暴露接口给核心代码（可选依赖）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__flashclaw_agent_registry = {
      getAllAgents,
      getAgentById,
      getDefaultAgent,
      resolveAgent,
      filterToolsByAgent,
    } satisfies AgentRegistry;
  },

  async cleanup(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).__flashclaw_agent_registry;
  },

  async execute(toolName: unknown, paramsOrContext?: unknown, maybeContext?: ToolContext): Promise<ToolResult> {
    const name = toolName as string;

    if (name === 'agent_list') {
      return executeAgentList();
    }

    if (name === 'agent_send') {
      return executeAgentSend(paramsOrContext as { agentId: string; message: string }, maybeContext as ToolContext);
    }

    return { success: false, error: `未知工具: ${name}` };
  }
};

function executeAgentList(): ToolResult {
  const list = agents.map(a => ({
    id: a.id,
    name: a.name,
    soul: a.soul,
    tools: a.tools[0] === '*' ? '全部工具' : a.tools.join(', '),
    default: a.default || false,
    promptMode: a.promptMode || 'full',
    bindings: a.bindings?.map(b => {
      const parts: string[] = [];
      if (b.channel) parts.push(`channel=${b.channel}`);
      if (b.group) parts.push(`group=${b.group}`);
      if (b.peer) parts.push(`peer=${b.peer}`);
      return parts.join(', ');
    }) || [],
  }));

  return { success: true, data: { count: list.length, agents: list } };
}

async function executeAgentSend(params: { agentId: string; message: string }, context: ToolContext): Promise<ToolResult> {
  const { agentId, message } = params;

  if (!agentId || typeof agentId !== 'string') {
    return { success: false, error: 'agentId 不能为空' };
  }
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return { success: false, error: '消息内容不能为空' };
  }

  const targetAgent = getAgentById(agentId);
  if (!targetAgent) {
    const available = agents.map(a => a.id).join(', ');
    return { success: false, error: `Agent "${agentId}" 不存在。可用的 Agent: ${available}` };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coreApi = (globalThis as any).__flashclaw_core_api as typeof import('../../src/core-api.js') | undefined;
  if (!coreApi) {
    return { success: false, error: 'FlashClaw 核心 API 未初始化，无法执行跨 Agent 通信' };
  }

  try {
    const result = await coreApi.chat({
      message: message.trim(),
      group: `agent-${targetAgent.id}-${Date.now()}`,
      userId: `agent-${context.groupId}`,
      platform: 'agent-internal',
    });

    return {
      success: true,
      data: {
        targetAgent: targetAgent.id,
        targetName: targetAgent.name,
        response: result.response,
      }
    };
  } catch (error) {
    return {
      success: false,
      error: `Agent 通信失败: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export default plugin;
