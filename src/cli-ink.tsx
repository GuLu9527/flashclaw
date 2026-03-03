/**
 * FlashClaw CLI - Ink (React) 终端 UI
 * 使用 React + Ink 渲染，与 Claude Code / Gemini CLI 相同技术栈
 */

import React, { useState, useEffect, useCallback } from 'react';
import { render, Box, Text, useInput, useApp, useStdout } from 'ink';
import { getModelContextWindow } from './core/model-capabilities.js';

// ==================== 品牌色 ====================
const GOLD = '#D4A017';
const GOLD_LIGHT = '#FFE066';

// ==================== API 路径（避免硬编码） ====================
const API = {
  STATUS: '/api/status',
  CHAT_STREAM: '/api/chat/stream',
  CHAT_CLEAR: '/api/chat/clear',
  CHAT_HISTORY: '/api/chat/history',
} as const;

// ==================== UI 常量 ====================
const UI = {
  CONTEXT_BAR_WIDTH: 20,
  CONTEXT_WARN_PCT: 50,
  CONTEXT_DANGER_PCT: 80,
  CONTEXT_WARN_COLOR: '#FFAA00',
  CONTEXT_DANGER_COLOR: '#FF4444',
  TOOL_PARAMS_MAX_LEN: 60,
  METRICS_LINE_WIDTH: 36,
  EXIT_DELAY_MS: 100,
  SPINNER_INTERVAL_MS: 80,
  DEFAULT_CONTEXT_WINDOW: 128000,
} as const;

// ==================== 类型 ====================

interface CliAppProps {
  apiUrl: string;
  group: string;
  version: string;
  botName?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'tool' | 'metrics' | 'streaming' | 'thinking';
  content: string;
}

interface StreamMetrics {
  durationMs: number;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

// ==================== 吉祥物（像素风闪电龙虾） ====================

const MASCOT_LINES: { text: string; color?: string }[][] = [
  [{ text: '  \u2584\u2584\u2584\u2584\u2584\u2584', color: GOLD }],
  [{ text: ' \u2590\u259b', color: GOLD }, { text: '\u25c6', color: GOLD_LIGHT }, { text: '  ', color: GOLD }, { text: '\u25c6', color: GOLD_LIGHT }, { text: '\u259c\u258c', color: GOLD }],
  [{ text: ' \u2590\u2588\u2584\u2584\u2584\u2584\u2588\u258c', color: GOLD }],
  [{ text: '  \u259d\u2580  \u2580\u2598', color: GOLD }],
];


// ==================== Markdown 简易渲染 ====================

function renderMarkdownLine(line: string): React.ReactNode {
  // 代码块标记（由调用方处理状态）
  if (line.startsWith('### ')) return <Text bold>{line.slice(4)}</Text>;
  if (line.startsWith('## ')) return <Text bold color="cyan">{line.slice(3)}</Text>;
  if (line.startsWith('# ')) return <Text bold color={GOLD}>{line.slice(2)}</Text>;
  if (/^[-*_]{3,}\s*$/.test(line)) return <Text dimColor>{'─'.repeat(44)}</Text>;
  if (line.startsWith('> ')) return <Text dimColor>│ {line.slice(2)}</Text>;
  if (/^\s*[-*•]\s/.test(line)) {
    const content = line.replace(/^\s*[-*•]\s/, '');
    const indent = line.match(/^(\s*)/)?.[1] || '';
    return <Text>{indent}  • {content}</Text>;
  }
  return <Text>{line}</Text>;
}

// ==================== Header 组件 ====================

function Header({ version, model }: { version: string; model: string }) {
  return (
    <Box flexDirection="row" marginBottom={1}>
      <Box flexDirection="column" marginRight={2}>
        {MASCOT_LINES.map((parts, i) => (
          <Text key={i}>
            {parts.map((p, j) => (
              <Text key={j} color={p.color}>{p.text}</Text>
            ))}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" justifyContent="center">
        <Text>
          <Text bold color={GOLD}>FlashClaw</Text>
          <Text dimColor> v{version}</Text>
        </Text>
        <Text dimColor>{model}</Text>
        <Text dimColor>{process.cwd().replace(process.env.HOME || '', '~')}</Text>
      </Box>
    </Box>
  );
}

// ==================== 消息显示组件 ====================

function MessageView({ messages, botName, showThinking }: { messages: ChatMessage[]; botName: string; showThinking: boolean }) {
  return (
    <Box flexDirection="column">
      {messages.map((msg, i) => {
        if (msg.role === 'user') {
          return (
            <Box key={i} marginTop={1}>
              <Text bold color={GOLD}>❯ </Text>
              <Text bold>{msg.content}</Text>
            </Box>
          );
        }
        if (msg.role === 'thinking') {
          if (!showThinking) {
            // 折叠模式：显示一行摘要
            const charCount = msg.content.length;
            return (
              <Box key={i} paddingLeft={2}>
                <Text dimColor>💭 思考中… ({charCount} 字)  </Text>
                <Text dimColor italic>Ctrl+T 展开</Text>
              </Box>
            );
          }
          // 展开模式：显示完整思考内容
          return (
            <Box key={i} flexDirection="column" paddingLeft={2}>
              <Text dimColor>💭 思考过程：</Text>
              {msg.content.split('\n').map((line, j) => (
                <Text key={j} dimColor>  {line}</Text>
              ))}
            </Box>
          );
        }
        if (msg.role === 'tool') {
          return (
            <Box key={i} paddingLeft={2}>
              <Text dimColor>⚙ </Text>
              <Text color="cyan" dimColor>{msg.content}</Text>
            </Box>
          );
        }
        if (msg.role === 'metrics') {
          return (
            <Box key={i} marginTop={1} marginBottom={1} paddingLeft={2}>
              <Text dimColor>── {msg.content} {'─'.repeat(Math.max(0, UI.METRICS_LINE_WIDTH - msg.content.length))}</Text>
            </Box>
          );
        }
        if (msg.role === 'streaming') {
          return (
            <Box key={i} flexDirection="column" marginTop={1} paddingLeft={2}>
              <Text bold color={GOLD}>⚡ {botName}</Text>
              <Text>{msg.content}{msg.content.length > 0 ? '█' : ''}</Text>
            </Box>
          );
        }
        // assistant
        const lines = msg.content.split('\n');
        return (
          <Box key={i} flexDirection="column" marginTop={1} paddingLeft={2}>
            <Text bold color={GOLD}>⚡ {botName}</Text>
            {lines.map((line, j) => (
              <Box key={j} paddingLeft={0}>
                {renderMarkdownLine(line)}
              </Box>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}

// ==================== Spinner 组件 ====================

function Spinner({ label }: { label: string }) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame(f => (f + 1) % frames.length), UI.SPINNER_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
  return (
    <Box paddingLeft={2} marginTop={1}>
      <Text color={GOLD}>{frames[frame]} </Text>
      <Text dimColor>{label}</Text>
    </Box>
  );
}

// ==================== 输入组件 ====================

const SLASH_COMMANDS = [
  { cmd: '/new', alias: '/n', desc: '新建会话' },
  { cmd: '/clear', alias: '/c', desc: '清除屏幕' },
  { cmd: '/status', alias: '/s', desc: '查看状态' },
  { cmd: '/history', alias: '/h', desc: '消息历史' },
  { cmd: '/compact', alias: '', desc: '压缩上下文' },
  { cmd: '/quit', alias: '/q', desc: '退出' },
];

function InputLine({ value, onChange, onSubmit, disabled }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  disabled: boolean;
}) {
  const { stdout } = useStdout();
  const cols = stdout?.columns || 80;

  useInput((input, key) => {
    if (disabled) return;
    if (key.return) {
      onSubmit(value);
      return;
    }
    if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
      return;
    }
    if (key.tab) {
      const allCmds = SLASH_COMMANDS.flatMap(c => [c.cmd, c.alias].filter(Boolean));
      if (value.startsWith('/')) {
        const hits = allCmds.filter(c => c.startsWith(value));
        if (hits.length === 1) onChange(hits[0]);
      }
      return;
    }
    if (!key.ctrl && !key.meta && input) {
      onChange(value + input);
    }
  });

  // slash command suggestions
  const showSuggestions = value.startsWith('/') && value.length >= 1;
  const suggestions = showSuggestions
    ? SLASH_COMMANDS.filter(c => c.cmd.startsWith(value) || (c.alias && c.alias.startsWith(value)))
    : [];

  return (
    <Box flexDirection="column">
      <Box width="100%"><Text dimColor>{'\u2500'.repeat(cols)}</Text></Box>
      <Box>
        <Text bold color={GOLD}>❯ </Text>
        <Text>{value}</Text>
        {!disabled && <Text color={GOLD}>█</Text>}
      </Box>
      {suggestions.length > 0 && (
        <Box flexDirection="row" gap={2} paddingLeft={2}>
          {suggestions.map((s, i) => (
            <Text key={i}>
              <Text color={GOLD}>{s.cmd}</Text>
              {s.alias ? <Text dimColor> {s.alias}</Text> : null}
              <Text dimColor> {s.desc}</Text>
            </Text>
          ))}
        </Box>
      )}
      <Box width="100%"><Text dimColor>{'\u2500'.repeat(cols)}</Text></Box>
    </Box>
  );
}

// ==================== StatusBar 组件 ====================

function ContextBar({ used, max }: { used: number; max: number }) {
  if (!max || max <= 0) return null;
  const pct = Math.min(100, Math.round((used / max) * 100));
  const filled = Math.round((pct / 100) * UI.CONTEXT_BAR_WIDTH);
  const empty = UI.CONTEXT_BAR_WIDTH - filled;
  const barColor = pct >= UI.CONTEXT_DANGER_PCT ? UI.CONTEXT_DANGER_COLOR
    : pct >= UI.CONTEXT_WARN_PCT ? UI.CONTEXT_WARN_COLOR : GOLD;
  return (
    <Text>
      <Text dimColor> [</Text>
      <Text color={barColor}>{'█'.repeat(filled)}</Text>
      <Text dimColor>{'░'.repeat(empty)}</Text>
      <Text dimColor>] </Text>
      <Text color={barColor}>{pct}%</Text>
    </Text>
  );
}

function StatusBar({ group, model, contextUsed, contextMax }: {
  group: string; model: string;
  contextUsed: number; contextMax: number;
}) {
  const ctxLabel = contextMax > 0
    ? `${Math.round((contextUsed / contextMax) * 100)}%`
    : '';

  return (
    <Box>
      <Text dimColor>flashclaw</Text>
      <Text dimColor> | </Text>
      <Text color={GOLD}>⚡</Text>
      <Text dimColor> {group}</Text>
      <Text dimColor> | </Text>
      <Text dimColor>{model}</Text>
      {ctxLabel ? (
        <>
          <Text dimColor> | </Text>
          <ContextBar used={contextUsed} max={contextMax} />
        </>
      ) : null}
    </Box>
  );
}

// ==================== 主应用 ====================

function App({ apiUrl, group, version, botName = 'FlashClaw' }: CliAppProps) {
  const { exit } = useApp();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [receivedThinking, setReceivedThinking] = useState(false);
  const [currentModel, setCurrentModel] = useState('-');
  const [currentProvider, setCurrentProvider] = useState('-');
  const [contextUsed, setContextUsed] = useState(0);
  const [contextMax, setContextMax] = useState(0);
  const [showThinking, setShowThinking] = useState(false);

  // 启动时检查服务
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${apiUrl}${API.STATUS}`);
        const st = await res.json() as { running?: boolean; provider?: string | null; model?: string | null };
        if (!st.running) {
          setMessages([{ role: 'assistant', content: '❌ 服务未运行。请先运行 flashclaw start' }]);
          return;
        }
        if (st.provider) setCurrentProvider(st.provider);
        if (st.model) {
          setCurrentModel(st.model);
          setContextMax(getModelContextWindow(st.model));
        }
      } catch {
        setMessages([{ role: 'assistant', content: '❌ 无法连接到服务。请确认 flashclaw start 已启动。' }]);
      }
    })();
  }, []);

  // Ctrl+C 退出，Ctrl+T 切换 thinking 显示
  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      exit();
      setTimeout(() => process.exit(0), UI.EXIT_DELAY_MS);
    }
    if (key.ctrl && _input === 't') {
      setShowThinking(prev => !prev);
    }
  });

  const modelDisplay = currentModel !== '-' ? `${currentProvider}/${currentModel}` : currentProvider;
  const modelFull = currentModel !== '-' ? `${currentProvider} / ${currentModel}` : currentProvider;

  const formatLatency = (ms: number) => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
  const formatTps = (tps: number | null) => (!tps || !Number.isFinite(tps) || tps <= 0) ? '-' : `${tps.toFixed(2)} tok/s`;

  const handleSubmit = useCallback(async (text: string) => {
    const trimmed = text.trim();
    setInput('');
    if (!trimmed) return;

    // /quit
    if (trimmed === '/quit' || trimmed === '/q' || trimmed === '/exit' || trimmed === '/e') {
      exit();
      setTimeout(() => process.exit(0), UI.EXIT_DELAY_MS);
      return;
    }

    // /clear
    if (trimmed === '/clear' || trimmed === '/c') {
      setMessages([]);
      return;
    }

    // /new
    if (trimmed === '/new' || trimmed === '/n') {
      try { await fetch(`${apiUrl}${API.CHAT_CLEAR}`, { method: 'POST' }); } catch { /* ok */ }
      setMessages(prev => [...prev, { role: 'assistant', content: '✅ 已新建会话' }]);
      return;
    }

    // /help
    if (trimmed.startsWith('/')) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚡ 命令\n/new /n     新建会话    /quit /q    退出\n/clear /c   清除屏幕    /status /s  查看状态\n/history /h 消息历史    /compact    压缩上下文',
      }]);
      return;
    }

    // 发送消息
    setMessages(prev => [...prev, { role: 'user', content: trimmed }]);
    setBusy(true);

    try {
      const response = await fetch(`${apiUrl}${API.CHAT_STREAM}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, group }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error('No response body');

      const requestStart = Date.now();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let responseText = '';
      let streamMetrics: StreamMetrics | null = null;

      setReceivedThinking(false);

      // 添加流式消息占位（thinking + streaming）
      // 用唯一 thinkingId 标记本次对话的 thinking，避免与之前对话的 thinking 叠加
      const thinkingId = `thinking-${Date.now()}`;
      setMessages(prev => [...prev, { role: 'streaming', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });

        // 思考过程（[THINKING:text] 标记）
        const thinkingRegex = /\[THINKING:([^\]]*)\]/g;
        let thinkingMatch;
        let hasThinking = false;
        let cleanChunk = chunk;
        while ((thinkingMatch = thinkingRegex.exec(chunk)) !== null) {
          hasThinking = true;
          const thinkText = thinkingMatch[1];
          setReceivedThinking(true);
          // 实时更新本次对话的 thinking 消息
          setMessages(prev => {
            const msgs = [...prev];
            // 只查找 streaming 消息紧前的 thinking（本次对话的）
            const streamIdx = msgs.findLastIndex(m => m.role === 'streaming');
            if (streamIdx < 0) return msgs;
            const thinkIdx = streamIdx > 0 && msgs[streamIdx - 1]?.role === 'thinking' ? streamIdx - 1 : -1;
            if (thinkIdx >= 0) {
              msgs[thinkIdx] = { role: 'thinking', content: msgs[thinkIdx].content + thinkText };
            } else {
              msgs.splice(streamIdx, 0, { role: 'thinking', content: thinkText });
            }
            return msgs;
          });
        }
        if (hasThinking) {
          cleanChunk = chunk.replace(/\[THINKING:[^\]]*\]/g, '');
          if (!cleanChunk.trim()) continue;
        }

        // 工具调用
        const toolMatch = cleanChunk.match(/\[TOOL:({.*?})\]/);
        if (toolMatch) {
          try {
            const ti = JSON.parse(toolMatch[1]) as { name: string; input?: Record<string, unknown> };
            let params = '';
            if (ti.input && Object.keys(ti.input).length > 0) {
              const p = Object.entries(ti.input).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');
              params = p.length > UI.TOOL_PARAMS_MAX_LEN ? p.slice(0, UI.TOOL_PARAMS_MAX_LEN - 3) + '...' : p;
            }
            // 在流式消息前插入工具调用
            setMessages(prev => {
              const msgs = [...prev];
              const streamIdx = msgs.findLastIndex(m => m.role === 'streaming');
              if (streamIdx >= 0) msgs.splice(streamIdx, 0, { role: 'tool', content: `${ti.name}(${params})` });
              return msgs;
            });
            responseText += cleanChunk.replace(/\[TOOL:.*?\]/g, '');
            continue;
          } catch { /* fall through */ }
        }

        const metricsMatch = cleanChunk.match(/\[METRICS:({.*?})\]/);
        if (metricsMatch) {
          try {
            streamMetrics = JSON.parse(metricsMatch[1]) as StreamMetrics;
            if (streamMetrics?.model) setCurrentModel(streamMetrics.model);
            const clean = cleanChunk.replace(/\[METRICS:.*?\]/g, '');
            if (clean) responseText += clean;
            continue;
          } catch { /* fall through */ }
        }

        responseText += cleanChunk;
        // 实时更新流式显示
        const currentText = responseText;
        setMessages(prev => {
          const msgs = [...prev];
          const streamIdx = msgs.findLastIndex(m => m.role === 'streaming');
          if (streamIdx >= 0) msgs[streamIdx] = { role: 'streaming', content: currentText };
          return msgs;
        });
      }

      // 流结束，将 streaming 替换为 assistant
      if (responseText.trim()) {
        setMessages(prev => prev.map(m =>
          m.role === 'streaming' ? { role: 'assistant', content: responseText.trimEnd() } : m
        ));
      } else {
        setMessages(prev => prev.filter(m => m.role !== 'streaming'));
      }

      const elapsedMs = streamMetrics?.durationMs ?? (Date.now() - requestStart);
      const outputTokens = streamMetrics?.outputTokens ?? 0;
      const durationSec = elapsedMs / 1000;
      const tps = durationSec > 0 && outputTokens > 0 ? outputTokens / durationSec : null;
      const tokLabel = outputTokens > 0 ? `${outputTokens} tok` : `${responseText.length} ch`;
      const tpsLabel = (streamMetrics && streamMetrics.outputTokens !== null) ? formatTps(tps) : '-';
      setMessages(prev => [...prev, {
        role: 'metrics',
        content: `${formatLatency(elapsedMs)} · ${tokLabel} · ${tpsLabel}`,
      }]);

      // 更新上下文用量
      if (streamMetrics?.inputTokens) {
        setContextUsed(prev => prev + (streamMetrics?.inputTokens ?? 0) + (streamMetrics?.outputTokens ?? 0));
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ 错误: ${err instanceof Error ? err.message : String(err)}`,
      }]);
    }

    setBusy(false);
  }, [apiUrl, group]);

  return (
    <Box flexDirection="column" height="100%">
      {/* Header with mascot */}
      <Header version={version} model={modelFull} />

      {/* Tips */}
      <Box marginBottom={1} paddingLeft={1}>
        <Text dimColor>│ </Text>
        <Text color={GOLD}>/help</Text>
        <Text dimColor> 命令 · </Text>
        <Text color={GOLD}>/new</Text>
        <Text dimColor> 新会话 · </Text>
        <Text color={GOLD}>Ctrl+C</Text>
        <Text dimColor> 退出</Text>
      </Box>

      {/* Messages */}
      <Box flexDirection="column" flexGrow={1}>
        <MessageView messages={messages} botName={botName} showThinking={showThinking} />
        {busy && !receivedThinking && <Spinner label="接收中..." />}
      </Box>

      {/* Input */}
      <Box marginTop={1}>
        <InputLine value={input} onChange={setInput} onSubmit={handleSubmit} disabled={busy} />
      </Box>

      {/* Status bar */}
      <StatusBar group={group} model={modelDisplay}
        contextUsed={contextUsed} contextMax={contextMax} />
    </Box>
  );
}

// ==================== 启动函数 ====================

export async function startInkCli(options: { apiUrl: string; group: string; version: string; botName?: string }): Promise<void> {
  // 清屏
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H');

  const { waitUntilExit } = render(
    <App apiUrl={options.apiUrl} group={options.group} version={options.version} botName={options.botName} />,
    { exitOnCtrlC: false },
  );

  await waitUntilExit();
}
