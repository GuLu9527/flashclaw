/**
 * 模型能力配置
 * 参考 openclaw 的 model-catalog.ts 设计
 */

/**
 * 模型能力定义
 */
export interface ModelCapabilities {
  /** 模型 ID（可以是模式匹配） */
  pattern: string | RegExp;
  /** 提供者 */
  provider?: string;
  /** 支持的输入类型 */
  input: Array<'text' | 'image' | 'audio' | 'video'>;
  /** 上下文窗口大小 */
  contextWindow?: number;
  /** 是否支持推理/思考 */
  reasoning?: boolean;
}

/**
 * 已知模型能力目录
 * 根据实际支持情况配置
 */
const MODEL_CAPABILITIES: ModelCapabilities[] = [
  // Anthropic Claude 系列（支持图片）
  { pattern: /^claude/i, provider: 'anthropic', input: ['text', 'image'], contextWindow: 200000 },
  
  // OpenAI GPT-4 系列（支持图片）
  { pattern: /^gpt-4/i, provider: 'openai', input: ['text', 'image'], contextWindow: 128000 },
  { pattern: /^gpt-4o/i, provider: 'openai', input: ['text', 'image', 'audio'], contextWindow: 128000 },
  { pattern: /^gpt-3/i, provider: 'openai', input: ['text'], contextWindow: 16000 },
  
  // Google Gemini 系列（支持图片）
  { pattern: /^gemini/i, provider: 'google', input: ['text', 'image', 'audio', 'video'], contextWindow: 1000000 },
  
  // MiniMax 系列（不支持图片）
  { pattern: /^abab/i, provider: 'minimax', input: ['text'], contextWindow: 32000 },
  { pattern: /^minimax/i, provider: 'minimax', input: ['text'], contextWindow: 32000 },
  
  // 智谱 GLM 系列
  { pattern: /^glm-4v/i, provider: 'zhipu', input: ['text', 'image'], contextWindow: 128000 },
  { pattern: /^glm-4/i, provider: 'zhipu', input: ['text'], contextWindow: 128000 },
  
  // 通义千问系列
  { pattern: /^qwen-vl/i, provider: 'alibaba', input: ['text', 'image'], contextWindow: 32000 },
  { pattern: /^qwen/i, provider: 'alibaba', input: ['text'], contextWindow: 32000 },
  
  // DeepSeek 系列
  { pattern: /^deepseek/i, provider: 'deepseek', input: ['text'], contextWindow: 64000 },
  
  // Moonshot Kimi 系列
  { pattern: /^moonshot/i, provider: 'moonshot', input: ['text'], contextWindow: 128000 },
  { pattern: /^kimi/i, provider: 'moonshot', input: ['text'], contextWindow: 128000 },
];

/**
 * 根据模型 ID 查找能力
 */
export function findModelCapabilities(modelId: string): ModelCapabilities | null {
  const normalized = modelId.trim().toLowerCase();
  
  for (const cap of MODEL_CAPABILITIES) {
    if (cap.pattern instanceof RegExp) {
      if (cap.pattern.test(normalized)) {
        return cap;
      }
    } else if (normalized.includes(cap.pattern.toLowerCase())) {
      return cap;
    }
  }
  
  return null;
}

/**
 * 检查模型是否支持图片输入
 */
export function modelSupportsVision(modelId: string): boolean {
  const cap = findModelCapabilities(modelId);
  return cap?.input.includes('image') ?? false;
}

/**
 * 检查模型是否支持音频输入
 */
export function modelSupportsAudio(modelId: string): boolean {
  const cap = findModelCapabilities(modelId);
  return cap?.input.includes('audio') ?? false;
}

/**
 * 获取模型的上下文窗口大小
 */
export function getModelContextWindow(modelId: string): number {
  const cap = findModelCapabilities(modelId);
  return cap?.contextWindow ?? 32000; // 默认 32k
}

/**
 * 从环境变量或配置中获取当前模型 ID
 * 支持多种环境变量名（兼容不同配置）
 */
export function getCurrentModelId(): string {
  return process.env.AI_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
}

/**
 * 检查当前配置的模型是否支持图片
 */
export function currentModelSupportsVision(): boolean {
  const modelId = getCurrentModelId();
  return modelSupportsVision(modelId);
}
