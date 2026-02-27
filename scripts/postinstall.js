#!/usr/bin/env node
/**
 * Post-install script for FlashClaw.
 * 
 * - Creates necessary user directories (~/.flashclaw/)
 * - Shows first-time installation guide if .env doesn't exist
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

async function run() {
  try {
    const { ensureDirectories, paths } = await import('../dist/paths.js');
    ensureDirectories();

    const envPath = paths.env();
    const isFirstTime = !existsSync(envPath);

    if (isFirstTime) {
      // 首次安装引导
      console.log('');
      console.log('  ⚡ FlashClaw 安装成功！');
      console.log('');
      console.log('  下一步:');
      console.log('    1. flashclaw init     交互式配置（推荐）');
      console.log('    2. flashclaw start    启动服务');
      console.log('    3. flashclaw doctor   检查运行环境');
      console.log('');
      console.log('  文档: https://github.com/GuLu9527/flashclaw');
      console.log('');
    } else {
      console.log('✓ FlashClaw directories initialized');
    }
  } catch (error) {
    // dist 未编译时（开发环境 clone 后首次 npm install），尝试最小化创建
    if (error && error.code === 'MODULE_NOT_FOUND') {
      try {
        const flashclawHome = process.env.FLASHCLAW_HOME || join(homedir(), '.flashclaw');
        const dirs = ['config', 'data', 'logs', 'plugins', 'groups'];
        const { mkdirSync } = await import('fs');
        for (const dir of dirs) {
          const p = join(flashclawHome, dir);
          if (!existsSync(p)) mkdirSync(p, { recursive: true });
        }
        console.log('✓ FlashClaw directories initialized (dev mode)');
      } catch {
        // 完全静默失败，目录会在运行时创建
      }
    } else {
      console.warn('Warning: Could not initialize FlashClaw directories:', error.message);
    }
  }
}

run();
