import path from 'path';
import os from 'os';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// ==================== Bot Configuration ====================
// Bot name for display in messages (customizable via .env)
export const BOT_NAME = process.env.BOT_NAME || 'FlashClaw';

// ==================== Polling Intervals ====================
export const SCHEDULER_POLL_INTERVAL = 60000;
export const IPC_POLL_INTERVAL = 1000;

// ==================== Paths ====================
const PROJECT_ROOT = process.cwd();

function getHomeDir(): string {
  return process.env.HOME || os.homedir() || '/home/user';
}

function getConfigDir(): string {
  const IS_WINDOWS = process.platform === 'win32';
  if (IS_WINDOWS) {
    return path.join(process.env.APPDATA || path.join(getHomeDir(), 'AppData', 'Roaming'), 'flashclaw');
  }
  return path.join(getHomeDir(), '.config', 'flashclaw');
}

// Mount security: allowlist stored OUTSIDE project root
export const MOUNT_ALLOWLIST_PATH = path.join(getConfigDir(), 'mount-allowlist.json');
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'main';

// ==================== Agent Configuration ====================
export const AGENT_TIMEOUT = parseInt(process.env.AGENT_TIMEOUT || '300000', 10); // 5 minutes default

// ==================== Timezone ====================
// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
