import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, Trash2, Wrench, Loader2, Plus, MessageSquare, X, Brain, BarChart3, StopCircle, Cpu } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant' | 'tool' | 'thinking';
  content: string;
  timestamp?: string;
}

interface SessionItem {
  id: string;
  name: string;
  lastMessage?: string;
  lastTime?: string;
  messageCount: number;
}

interface Metrics {
  durationMs: number;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

interface ContextInfo {
  model: string | null;
  provider: string | null;
  tokenCount: number;
  maxTokens: number;
  usagePercent: number;
}

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [currentGroup, setCurrentGroup] = useState('main');
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [lastMetrics, setLastMetrics] = useState<Metrics | null>(null);
  const [thinkingText, setThinkingText] = useState('');
  const [contextInfo, setContextInfo] = useState<ContextInfo | null>(null);
  const [showThinking, setShowThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => { scrollToBottom(); }, [messages]);

  // 加载上下文信息
  const loadContext = useCallback(async (group: string) => {
    try {
      const res = await fetch(`/api/chat/context?group=${encodeURIComponent(group)}`);
      const data = await res.json();
      if (data.success) {
        setContextInfo(data);
      }
    } catch { /* ignore */ }
  }, []);

  // 加载会话列表
  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      if (data.success && data.sessions) {
        setSessions(data.sessions);
        // 如果没有会话，确保至少有 main
        if (data.sessions.length === 0) {
          setSessions([{ id: 'main', name: 'main Chat', messageCount: 0 }]);
        }
      }
    } catch { /* ignore */ }
  }, []);

  // 加载历史消息
  const loadHistory = useCallback(async (group: string) => {
    try {
      const res = await fetch(`/api/chat/history?group=${encodeURIComponent(group)}`);
      const data = await res.json();
      if (data.success && data.messages) {
        setMessages(data.messages.map((m: { role: string; content: string; timestamp?: string }) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: m.timestamp,
        })));
      }
    } catch {
      setMessages([]);
    }
  }, []);

  useEffect(() => {
    loadSessions();
    loadHistory(currentGroup);
    loadContext(currentGroup);
  }, [loadSessions, loadHistory, loadContext, currentGroup]);

  // 切换会话
  const switchSession = (groupId: string) => {
    if (groupId === currentGroup || sending) return;
    setCurrentGroup(groupId);
    setMessages([]);
    setLastMetrics(null);
    setThinkingText('');
  };

  // 创建新会话
  const createSession = async () => {
    const name = prompt('输入会话名称：');
    if (!name?.trim()) return;
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        await loadSessions();
        switchSession(data.id);
      }
    } catch { /* ignore */ }
  };

  // 删除会话
  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (id === 'main') return;
    if (!confirm(`确定删除会话 "${id}"？`)) return;
    try {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      await loadSessions();
      if (currentGroup === id) switchSession('main');
    } catch { /* ignore */ }
  };

  // 取消请求
  const handleCancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    // 也通知后端取消
    fetch('/api/chat/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: currentGroup }),
    }).catch(() => {});
    setSending(false);
  }, [currentGroup]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    setInput('');
    setSending(true);
    setLastMetrics(null);
    setThinkingText('');
    setShowThinking(false);

    const userMsg: ChatMessage = { role: 'user', content: text, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setMessages(prev => [...prev, { role: 'assistant', content: '', timestamp: new Date().toISOString() }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, group: currentGroup }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        setMessages(prev => {
          const msgs = [...prev];
          msgs[msgs.length - 1] = { role: 'assistant', content: '❌ 发送失败', timestamp: new Date().toISOString() };
          return msgs;
        });
        setSending(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      let lineBuf = '';
      let thinkBuf = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        lineBuf += decoder.decode(value, { stream: true });
        const lines = lineBuf.split('\n');
        lineBuf = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === 'token') {
              accumulated += evt.data;
              setMessages(prev => {
                const msgs = [...prev];
                msgs[msgs.length - 1] = { role: 'assistant', content: accumulated, timestamp: new Date().toISOString() };
                return msgs;
              });
            } else if (evt.type === 'thinking') {
              thinkBuf += evt.data;
              setThinkingText(thinkBuf);
            } else if (evt.type === 'tool') {
              const toolMsg: ChatMessage = {
                role: 'tool',
                content: `🔧 ${evt.data?.name || 'unknown'}`,
                timestamp: new Date().toISOString(),
              };
              setMessages(prev => {
                const msgs = [...prev];
                msgs.splice(msgs.length - 1, 0, toolMsg);
                return msgs;
              });
            } else if (evt.type === 'metrics') {
              setLastMetrics(evt.data);
            } else if (evt.type === 'error') {
              accumulated += '\n\n❌ ' + evt.data;
              setMessages(prev => {
                const msgs = [...prev];
                msgs[msgs.length - 1] = { role: 'assistant', content: accumulated, timestamp: new Date().toISOString() };
                return msgs;
              });
            }
          } catch { /* non-JSON line */ }
        }
      }

      if (!accumulated.trim()) {
        setMessages(prev => prev.filter((_, i) => i !== prev.length - 1));
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // 用户主动取消
        setMessages(prev => {
          const msgs = [...prev];
          if (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant' && !msgs[msgs.length - 1].content) {
            return msgs.slice(0, -1);
          }
          return msgs;
        });
      } else {
        setMessages(prev => {
          const msgs = [...prev];
          msgs[msgs.length - 1] = {
            role: 'assistant',
            content: `❌ 网络错误: ${err instanceof Error ? err.message : String(err)}`,
            timestamp: new Date().toISOString(),
          };
          return msgs;
        });
      }
    }

    abortRef.current = null;
    setSending(false);
    loadSessions();
    loadContext(currentGroup);
    inputRef.current?.focus();
  }, [input, sending, currentGroup, loadSessions, loadContext]);

  const handleClear = async () => {
    if (!confirm('确定要清空当前会话的对话记录吗？')) return;
    try {
      await fetch('/api/chat/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group: currentGroup }),
      });
      setMessages([]);
      setLastMetrics(null);
      loadSessions();
    } catch { /* ignore */ }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full gap-4">
      {/* Session Sidebar */}
      <div className="w-48 flex-shrink-0 flex flex-col border-r-2 border-pixel-border pr-3">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold text-pixel-muted uppercase tracking-wider">会话</span>
          <button
            onClick={createSession}
            className="p-1 text-pixel-muted hover:text-gold transition-colors"
            title="新建会话"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-1">
          {sessions.map(s => (
            <div
              key={s.id}
              onClick={() => switchSession(s.id)}
              className={`group flex items-center gap-2 px-2 py-2 rounded cursor-pointer text-xs transition-colors ${
                s.id === currentGroup
                  ? 'bg-gold/20 text-gold border border-gold/40'
                  : 'text-pixel-muted hover:text-pixel-text hover:bg-pixel-bg border border-transparent'
              }`}
            >
              <MessageSquare className="w-3 h-3 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{s.name.replace(/ Chat$/, '')}</div>
                {s.lastMessage && (
                  <div className="truncate text-[10px] opacity-60">{s.lastMessage}</div>
                )}
              </div>
              {s.id !== 'main' && (
                <button
                  onClick={(e) => deleteSession(s.id, e)}
                  className="hidden group-hover:block p-0.5 text-pixel-muted hover:text-red-400"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-gold flex items-center gap-2">
            💬 {currentGroup === 'main' ? 'AI 对话' : currentGroup}
          </h1>
          <div className="flex items-center gap-3">
            {/* 模型 + 上下文用量 */}
            {contextInfo && (
              <div className="flex items-center gap-2 text-[11px] text-pixel-muted">
                <Cpu className="w-3 h-3 text-gold" />
                <span className="text-pixel-text">{contextInfo.model || '未知'}</span>
                <div className="flex items-center gap-1" title={`${contextInfo.tokenCount.toLocaleString()} / ${contextInfo.maxTokens.toLocaleString()} tokens`}>
                  <div className="w-20 h-1.5 bg-pixel-bg rounded-full overflow-hidden border border-pixel-border">
                    <div
                      className={`h-full rounded-full transition-all ${
                        contextInfo.usagePercent > 80 ? 'bg-red-500' :
                        contextInfo.usagePercent > 50 ? 'bg-yellow-500' : 'bg-green-500'
                      }`}
                      style={{ width: `${Math.min(contextInfo.usagePercent, 100)}%` }}
                    />
                  </div>
                  <span>{contextInfo.usagePercent}%</span>
                </div>
              </div>
            )}
            {/* 最近请求指标 */}
            {lastMetrics && (
              <div className="flex items-center gap-1 text-[10px] text-pixel-muted">
                <BarChart3 className="w-3 h-3" />
                {(lastMetrics.durationMs / 1000).toFixed(1)}s
                {lastMetrics.inputTokens != null && ` · ${lastMetrics.inputTokens}→${lastMetrics.outputTokens}t`}
              </div>
            )}
            <button
              onClick={handleClear}
              className="flex items-center gap-1 px-3 py-1.5 text-xs border-2 border-pixel-border text-pixel-muted hover:text-red-400 hover:border-red-400 rounded transition-colors"
            >
              <Trash2 className="w-3 h-3" /> 清空
            </button>
          </div>
        </div>

        {/* Thinking indicator */}
        {thinkingText && (
          <div
            className="mb-2 px-3 py-2 bg-purple-500/10 border border-purple-500/30 rounded text-xs text-purple-300 cursor-pointer"
            onClick={() => setShowThinking(!showThinking)}
          >
            <div className="flex items-center gap-1">
              <Brain className="w-3 h-3" />
              <span>思考中... ({thinkingText.length} 字)</span>
              <span className="ml-auto text-[10px]">{showThinking ? '收起' : '展开'}</span>
            </div>
            {showThinking && (
              <pre className="mt-2 whitespace-pre-wrap text-[11px] opacity-80 max-h-40 overflow-y-auto">
                {thinkingText}
              </pre>
            )}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
          {messages.length === 0 && (
            <p className="text-center text-pixel-muted mt-20">开始与 FlashClaw 对话吧！</p>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'tool' ? (
                <div className="flex items-center gap-1 text-xs text-pixel-muted px-3 py-1 bg-pixel-surface rounded border border-pixel-border">
                  <Wrench className="w-3 h-3 text-gold" />
                  {msg.content}
                </div>
              ) : (
                <div className={`max-w-[80%] px-4 py-3 rounded-lg ${
                  msg.role === 'user'
                    ? 'bg-gold/20 border-2 border-gold/40 text-pixel-text'
                    : 'bg-pixel-surface border-2 border-pixel-border text-pixel-text'
                }`}>
                  {msg.role === 'assistant' ? (
                    <div className="markdown-body prose prose-invert prose-sm max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content || (sending && i === messages.length - 1 ? '...' : '')}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                  )}
                  {msg.timestamp && (
                    <p className="text-[10px] text-pixel-muted mt-1">
                      {new Date(msg.timestamp).toLocaleTimeString('zh-CN')}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="flex gap-2 border-t-2 border-pixel-border pt-4">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"
            disabled={sending}
            rows={1}
            className="flex-1 bg-pixel-surface border-2 border-pixel-border rounded px-3 py-2 text-sm text-pixel-text placeholder-pixel-muted resize-none focus:outline-none focus:border-gold transition-colors"
          />
          {sending ? (
            <button
              onClick={handleCancel}
              className="px-4 py-2 bg-red-500/80 text-white rounded font-bold text-sm hover:bg-red-500 transition-colors flex items-center gap-1"
              title="取消请求"
            >
              <StopCircle className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="px-4 py-2 bg-gold text-pixel-bg rounded font-bold text-sm disabled:opacity-40 hover:bg-gold-light transition-colors flex items-center gap-1"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
