import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ChevronDown, ChevronUp, ListTodo, MessageSquare, Send, StopCircle, Users, Zap } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ActivityTimeline from '../components/status-board/ActivityTimeline';
import AgentDetailCard from '../components/status-board/AgentDetailCard';
import ChannelStatusCards from '../components/status-board/ChannelStatusCards';
import { buildRoomAgentsFromApi, deriveAgentState, inferActiveRole, ROLE_MAP, STATE_MAP } from '../components/status-board/constants';
import DailyNote from '../components/status-board/DailyNote';
import MemoryTimeline from '../components/status-board/MemoryTimeline';
import RoomScene from '../components/status-board/RoomScene';
import type { ActivityItem, ActivityItemType, AgentRole, AgentState, PluginInfo, ServiceStatus } from '../components/status-board/types';

interface ApiAgent {
  id: string;
  name: string;
  soul: string;
  toolCount: number;
  isDefault: boolean;
}

const PLUGINS_POLL_INTERVAL = 15000;
const ACTIVITY_POLL_INTERVAL = 5000;
const MAX_ACTIVITY_ITEMS = 12;
const EMPTY_ACTIVITY_ITEMS: ActivityItem[] = [
  {
    id: 'activity-empty-state',
    time: '--:--:--',
    type: 'empty',
    title: '状态看板已加载',
    detail: '等待新的活动记录。',
    source: 'placeholder',
    agent: 'main',
  },
];

function formatNowTime() {
  return new Date().toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function trimItems(items: ActivityItem[]) {
  return items.slice(-MAX_ACTIVITY_ITEMS);
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

function usePollingTask(task: (signal: AbortSignal) => Promise<void>, interval: number) {
  const taskRef = useRef(task);

  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  useEffect(() => {
    let disposed = false;
    let timer: number | null = null;
    let controller: AbortController | null = null;

    const run = async () => {
      if (disposed) {
        return;
      }

      controller = new AbortController();
      try {
        await taskRef.current(controller.signal);
      } finally {
        controller = null;
        if (!disposed) {
          timer = window.setTimeout(run, interval);
        }
      }
    };

    void run();

    return () => {
      disposed = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      controller?.abort();
    };
  }, [interval]);
}

function inferActivityType(sender: string, content: string): ActivityItemType {
  const value = `${sender} ${content}`.toLowerCase();

  if (/tool|工具|web_fetch|browser|schedule|memory|recall|remember/.test(value)) {
    return 'tool_use';
  }

  if (/task|任务|schedule|定时/.test(value)) {
    return 'task';
  }

  if (/启动|停止|恢复|异常|error|offline|online|连接/.test(value)) {
    return 'status';
  }

  return 'message';
}

function buildHtmlActivityItem(time: string, sender: string, content: string): ActivityItem {
  const safeSender = sender || '系统';
  const safeContent = content || '无内容';
  const type = inferActivityType(safeSender, safeContent);
  const normalizedSender = safeSender.toLowerCase();

  let title = `${safeSender} 发送消息`;
  let agent: AgentRole | undefined;

  if (type === 'tool_use') {
    title = `${safeSender} 触发工具操作`;
    agent = 'builder';
  } else if (type === 'task') {
    title = `${safeSender} 更新任务状态`;
    agent = 'reviewer';
  } else if (type === 'status') {
    title = `${safeSender} 状态更新`;
    agent = 'ops';
  } else if (normalizedSender.includes('flashclaw')) {
    title = 'FlashClaw 回复';
    agent = 'coordinator';
  } else if (safeSender.includes('用户')) {
    title = '用户发送消息';
    agent = 'main';
  }

  return {
    id: `activity-html-${time}-${safeSender}-${safeContent}`,
    time,
    type,
    title,
    detail: safeContent,
    sender: safeSender,
    source: 'activity-html',
    agent,
  };
}

function parseActivityHtml(content: string): ActivityItem[] {
  if (!content.trim()) {
    return [];
  }

  const doc = new DOMParser().parseFromString(content, 'text/html');
  const rows = Array.from(doc.querySelectorAll('tr'));

  if (rows.length === 0) {
    const text = doc.body.textContent?.trim() ?? '';
    if (!text || text.includes('暂无活动记录')) {
      return [];
    }

    return [];
  }

  return rows
    .map((row) => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 3) {
        return null;
      }

      const time = cells[0]?.textContent?.trim() || formatNowTime();
      const sender = cells[1]?.textContent?.trim() || '系统';
      const detail = cells[2]?.textContent?.trim() || '';
      return buildHtmlActivityItem(time, sender, detail);
    })
    .filter((item): item is ActivityItem => item !== null);
}

function buildStatusFallbackItems(prev: ServiceStatus | null, current: ServiceStatus): ActivityItem[] {
  const time = formatNowTime();
  const items: ActivityItem[] = [];

  if (prev === null) {
    items.push({
      id: `status-fallback-init-${time}`,
      time,
      type: 'status',
      title: current.running ? '状态看板已连接服务' : '状态看板已加载',
      detail: current.running
        ? `服务运行中 · ${current.provider || '-'} / ${current.model || '-'}`
        : '当前服务未运行，等待新的状态变化。',
      source: 'status-fallback',
      agent: current.running ? 'main' : 'ops',
    });
    return items;
  }

  if (prev.running !== current.running) {
    items.push({
      id: `status-fallback-running-${time}`,
      time,
      type: 'status',
      title: current.running ? '服务已恢复运行' : '服务已停止运行',
      detail: current.running ? '状态接口检测到服务重新启动。' : '状态接口检测到服务已停止。',
      source: 'status-fallback',
      agent: 'ops',
    });
  }

  if (current.messageCount > prev.messageCount) {
    const diff = current.messageCount - prev.messageCount;
    items.push({
      id: `status-fallback-message-${time}-${current.messageCount}`,
      time,
      type: 'message',
      title: `新增 ${diff} 条消息`,
      detail: `累计消息数已更新到 ${current.messageCount}。`,
      source: 'status-fallback',
      agent: 'coordinator',
    });
  }

  if (current.activeTaskCount > prev.activeTaskCount) {
    items.push({
      id: `status-fallback-task-${time}-${current.activeTaskCount}`,
      time,
      type: 'task',
      title: `活跃任务增加到 ${current.activeTaskCount}`,
      detail: `总任务数 ${current.totalTaskCount}，Builder 正在继续执行。`,
      source: 'status-fallback',
      agent: 'builder',
    });
  }

  if (prev.activeSessions === 0 && current.activeSessions > 0) {
    items.push({
      id: `status-fallback-session-${time}-${current.activeSessions}`,
      time,
      type: 'message',
      title: '出现新的活跃会话',
      detail: `当前活跃会话数 ${current.activeSessions}。`,
      source: 'status-fallback',
      agent: 'coordinator',
    });
  }

  return items;
}

interface TodayStats {
  messages: number;
  sessions: number;
}

interface AgentStateEvent {
  state: string;
  detail: string;
  status: ServiceStatus;
  lastActivity: { sender: string; content: string; time: string } | null;
}

export default function StatusBoard() {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [statusRequestFailed, setStatusRequestFailed] = useState(false);
  const [focusedAgent, setFocusedAgent] = useState<AgentRole | null>(null);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [statusFallbackItems, setStatusFallbackItems] = useState<ActivityItem[]>([]);
  const [apiAgents, setApiAgents] = useState<ApiAgent[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [sseAgentDetail, setSseAgentDetail] = useState('');
  const prevStatusRef = useRef<ServiceStatus | null>(null);

  // 获取已注册的 Agent 列表
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/agents');
        const data = await res.json();
        if (!cancelled && data.success) setApiAgents(data.agents);
      } catch { /* ignore */ }
    };
    load();
    const timer = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // 内嵌对话状态
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [chatSending, setChatSending] = useState(false);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // 提前计算 agentState（供下方 useMemo 使用）
  const agentState: AgentState = statusRequestFailed ? 'error' : deriveAgentState(status);
  const activeRole = inferActiveRole(agentState);

  // Agent ID ↔ Role 映射
  const { agents: roomAgentsDynamic, agentIdToRole } = useMemo(
    () => buildRoomAgentsFromApi(apiAgents, agentState),
    [apiAgents, agentState]
  );
  const roleToAgentId = useMemo(() => {
    const m = new Map<AgentRole, string>();
    agentIdToRole.forEach((role, id) => m.set(role, id));
    return m;
  }, [agentIdToRole]);

  // 聚焦 agent 时滚动到底
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  // 切换聚焦 agent 时清空对话
  useEffect(() => { setChatMessages([]); setChatInput(''); }, [focusedAgent]);

  // 内嵌对话：发送消息
  const handleInlineChat = useCallback(async () => {
    if (!chatInput.trim() || chatSending || !focusedAgent) return;
    const text = chatInput.trim();
    const agentId = roleToAgentId.get(focusedAgent) || 'main';
    setChatInput('');
    setChatSending(true);
    setChatMessages(prev => [...prev, { role: 'user', content: text }]);
    setChatMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    const controller = new AbortController();
    chatAbortRef.current = controller;
    let acc = '';
    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, group: agentId }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error('request failed');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === 'token') {
              acc += evt.data;
              setChatMessages(prev => {
                const msgs = [...prev];
                msgs[msgs.length - 1] = { role: 'assistant', content: acc };
                return msgs;
              });
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        acc += '\n❌ 发送失败';
        setChatMessages(prev => {
          const msgs = [...prev];
          msgs[msgs.length - 1] = { role: 'assistant', content: acc };
          return msgs;
        });
      }
    }
    chatAbortRef.current = null;
    setChatSending(false);
  }, [chatInput, chatSending, focusedAgent, roleToAgentId]);

  const [todayStats, setTodayStats] = useState<TodayStats>({ messages: 0, sessions: 0 });

  // SSE: real-time agent state (replaces status polling)
  useEffect(() => {
    let evtSource: EventSource | null = null;
    let cancelled = false;
    let reconnectTimer: number | null = null;

    const connect = () => {
      if (cancelled) return;
      evtSource = new EventSource('/sse/agent-state');

      evtSource.addEventListener('agent-state', (e) => {
        try {
          const data = JSON.parse(e.data) as AgentStateEvent;
          const fallback = buildStatusFallbackItems(prevStatusRef.current, data.status);
          setStatus(data.status);
          setStatusRequestFailed(false);
          setSseAgentDetail(data.detail || (data.lastActivity?.content ?? ''));
          if (fallback.length > 0) {
            setStatusFallbackItems((prev) => trimItems([...prev, ...fallback]));
          }
          prevStatusRef.current = data.status;
        } catch { /* ignore */ }
      });

      evtSource.onerror = () => {
        setStatusRequestFailed(true);
        evtSource?.close();
        evtSource = null;
        // reconnect after 5s
        if (!cancelled) {
          reconnectTimer = window.setTimeout(connect, 5000);
        }
      };
    };

    connect();

    // Fallback: initial fetch in case SSE takes time to connect
    fetch('/api/status').then(r => r.json()).then((data: ServiceStatus) => {
      if (!cancelled && !status) {
        setStatus(data);
        prevStatusRef.current = data;
      }
    }).catch(() => {});

    return () => {
      cancelled = true;
      evtSource?.close();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    };
  }, []);

  // Poll today's stats (less frequent)
  usePollingTask(async (signal) => {
    try {
      const res = await fetch('/api/stats/today', { signal });
      if (res.ok) {
        const data = await res.json();
        setTodayStats({ messages: data.messages ?? 0, sessions: data.sessions ?? 0 });
      }
    } catch (error) {
      if (signal.aborted || isAbortError(error)) return;
    }
  }, 10000);

  usePollingTask(async (signal) => {
    try {
      const res = await fetch('/api/plugins', { signal });
      if (!res.ok) {
        throw new Error('plugins request failed');
      }
      setPlugins((await res.json()) as PluginInfo[]);
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        return;
      }
      setPlugins([]);
    }
  }, PLUGINS_POLL_INTERVAL);

  usePollingTask(async (signal) => {
    try {
      const res = await fetch('/api/activity', { signal });
      if (!res.ok) {
        throw new Error('activity request failed');
      }

      const html = await res.text();
      setActivityItems(trimItems(parseActivityHtml(html)));
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        return;
      }
      setActivityItems([]);
    }
  }, ACTIVITY_POLL_INTERVAL);

  const activeRoleConfig = ROLE_MAP[activeRole];
  const stateConfig = STATE_MAP[agentState];
  const StatusIcon = stateConfig.icon;
  const roomAgents = roomAgentsDynamic;
  const displayedActivityItems = useMemo(() => {
    if (activityItems.length > 0) {
      return activityItems;
    }

    if (statusFallbackItems.length > 0) {
      return statusFallbackItems;
    }

    return EMPTY_ACTIVITY_ITEMS;
  }, [activityItems, statusFallbackItems]);

  const summaryStats = [
    { label: '消息数', value: status?.messageCount ?? 0, icon: MessageSquare, color: 'text-purple-400' },
    { label: '活跃会话', value: status?.activeSessions ?? 0, icon: Users, color: 'text-cyan-400' },
    { label: '活跃任务', value: `${status?.activeTaskCount ?? 0}/${status?.totalTaskCount ?? 0}`, icon: ListTodo, color: 'text-orange-400' },
    { label: '运行时间', value: status?.uptime ?? '-', icon: Activity, color: 'text-blue-400' },
    { label: '今日消息', value: todayStats.messages, icon: MessageSquare, color: 'text-green-400' },
    { label: '今日会话', value: todayStats.sessions, icon: Users, color: 'text-emerald-400' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* 房间场景（主焦点） */}
      <div className="flex-1 min-h-0">
        <div className="flex items-center justify-between mb-2">
          <h1 className="flex items-center gap-2 text-xl font-bold text-gold">
            <Zap className="h-6 w-6" /> 状态看板
          </h1>
          <div className="flex items-center gap-3 text-xs text-pixel-muted">
            {apiAgents.length > 0 && (
              <span>{apiAgents.length} 个 Agent</span>
            )}
            <span className={stateConfig.color}>{stateConfig.label}</span>
            {status?.model && <span>{status.model}</span>}
          </div>
        </div>

        <RoomScene
          agents={roomAgents}
          activeRole={activeRole}
          focusedAgent={focusedAgent}
          status={status}
          onAgentClick={(role) => {
            setFocusedAgent(role);
          }}
        />

        {/* Agent 详情 + 内嵌对话 */}
        {focusedAgent && (
          <div className="mt-2 rounded border-2 border-pixel-border bg-pixel-surface p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold" style={{ color: ROLE_MAP[focusedAgent]?.accent }}>
                💬 与 {ROLE_MAP[focusedAgent]?.label || focusedAgent} 对话
                <span className="ml-2 text-[10px] text-pixel-muted">({roleToAgentId.get(focusedAgent) || 'main'})</span>
              </span>
              <button onClick={() => setFocusedAgent(null)} className="text-xs text-pixel-muted hover:text-pixel-text">✕</button>
            </div>
            {/* 消息区 */}
            <div className="max-h-48 overflow-y-auto space-y-2 mb-2">
              {chatMessages.length === 0 && (
                <p className="text-xs text-pixel-muted text-center py-4">点击发送开始对话</p>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`text-xs px-2 py-1 rounded ${msg.role === 'user' ? 'bg-gold/10 text-pixel-text text-right' : 'bg-pixel-bg text-pixel-text'}`}>
                  {msg.role === 'assistant' ? (
                    <div className="prose prose-invert prose-xs max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content || '...'}</ReactMarkdown>
                    </div>
                  ) : msg.content}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            {/* 输入框 */}
            <div className="flex gap-2">
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleInlineChat(); } }}
                placeholder="输入消息..."
                disabled={chatSending}
                className="flex-1 bg-pixel-bg border border-pixel-border rounded px-2 py-1 text-xs text-pixel-text placeholder-pixel-muted focus:outline-none focus:border-gold"
              />
              {chatSending ? (
                <button onClick={() => { chatAbortRef.current?.abort(); setChatSending(false); }} className="px-2 py-1 bg-red-500/80 text-white rounded text-xs"><StopCircle className="w-3 h-3" /></button>
              ) : (
                <button onClick={handleInlineChat} disabled={!chatInput.trim()} className="px-2 py-1 bg-gold text-pixel-bg rounded text-xs disabled:opacity-40"><Send className="w-3 h-3" /></button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 折叠详情面板 */}
      <div className="mt-4 border-t-2 border-pixel-border">
        <button
          onClick={() => setDetailsOpen(!detailsOpen)}
          className="flex w-full items-center justify-between border-none bg-transparent px-2 py-3 text-sm text-pixel-muted transition-colors hover:text-pixel-text"
        >
          <span className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            详细信息
            {sseAgentDetail && <span className="text-xs text-gold/70">· {sseAgentDetail.slice(0, 30)}{sseAgentDetail.length > 30 ? '...' : ''}</span>}
          </span>
          {detailsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        {detailsOpen && (
          <div className="space-y-4 pb-8">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <section className={`rounded border-2 border-pixel-border p-4 ${stateConfig.bgColor}`}>
                <h3 className="mb-3 text-sm font-bold text-gold">状态摘要</h3>
                <div className="flex items-start gap-3">
                  <StatusIcon className={`mt-0.5 h-6 w-6 ${stateConfig.color}`} />
                  <div>
                    <div className={`font-bold ${stateConfig.color}`}>{stateConfig.label}</div>
                    {status?.provider && (
                      <div className="mt-1 text-xs text-pixel-muted">
                        {status.provider} / {status.model || '-'}
                      </div>
                    )}
                  </div>
                </div>
                {statusRequestFailed && (
                  <div className="mt-2 rounded border border-red-400/30 bg-red-400/10 px-3 py-1 text-xs text-red-300">
                    状态接口请求失败
                  </div>
                )}
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {summaryStats.map(({ label, value, icon: Icon, color }) => (
                    <div key={label} className="rounded border border-pixel-border bg-pixel-bg/70 p-2">
                      <div className="mb-0.5 flex items-center gap-1 text-[10px] text-pixel-muted">
                        <Icon className={`h-3 w-3 ${color}`} />
                        {label}
                      </div>
                      <div className={`text-xs font-bold ${color}`}>{value}</div>
                    </div>
                  ))}
                </div>
              </section>
              <DailyNote />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <MemoryTimeline />
              <ChannelStatusCards plugins={plugins} />
            </div>
            <ActivityTimeline items={displayedActivityItems} />
          </div>
        )}
      </div>
    </div>
  );
}
