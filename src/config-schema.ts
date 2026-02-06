// src/config-schema.ts
import { z } from 'zod';

export const envSchema = z.object({
  // AI API 配置
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().url().optional(),
  ANTHROPIC_AUTH_TOKEN: z.string().optional(),
  AI_MODEL: z.string().default('claude-sonnet-4-20250514'),
  
  // 飞书配置
  FEISHU_APP_ID: z.string().optional(),
  FEISHU_APP_SECRET: z.string().optional(),
  
  // 其他配置
  BOT_NAME: z.string().default('FlashClaw'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TIMEZONE: z.string().default('Asia/Shanghai'),
  AGENT_TIMEOUT: z.coerce.number().default(300000),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(env: Record<string, string | undefined>): EnvConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const errors = result.error.issues.map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`).join('\n');
    throw new Error(`配置校验失败:\n${errors}`);
  }
  return result.data;
}
