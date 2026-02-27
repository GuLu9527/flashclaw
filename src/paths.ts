/**
 * FlashClaw Path Management Module
 * 
 * Centralized path management for all FlashClaw directories and files.
 * Uses ~/.flashclaw/ as the configuration root directory.
 */

import { homedir } from 'os';
import { join, dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';

/**
 * Get the FlashClaw home directory.
 * Supports FLASHCLAW_HOME environment variable override.
 * 
 * @returns The FlashClaw home directory path (~/.flashclaw or FLASHCLAW_HOME)
 */
export function getFlashClawHome(): string {
  return process.env.FLASHCLAW_HOME || join(homedir(), '.flashclaw');
}

/**
 * Path utility object containing all FlashClaw path functions.
 */
export const paths = {
  /**
   * Root directory (~/.flashclaw)
   */
  home(): string {
    return getFlashClawHome();
  },

  /**
   * Environment file path (~/.flashclaw/.env)
   */
  env(): string {
    return join(getFlashClawHome(), '.env');
  },

  /**
   * Config directory (~/.flashclaw/config)
   */
  config(): string {
    return join(getFlashClawHome(), 'config');
  },

  /**
   * Plugins configuration file (~/.flashclaw/config/plugins.json)
   */
  pluginsConfig(): string {
    return join(getFlashClawHome(), 'config', 'plugins.json');
  },

  /**
   * Data directory (~/.flashclaw/data)
   */
  data(): string {
    return join(getFlashClawHome(), 'data');
  },

  /**
   * Database file path (~/.flashclaw/data/flashclaw.db)
   */
  database(): string {
    return join(getFlashClawHome(), 'data', 'flashclaw.db');
  },

  /**
   * PID file path (~/.flashclaw/data/flashclaw.pid)
   */
  pidFile(): string {
    return join(getFlashClawHome(), 'data', 'flashclaw.pid');
  },

  /**
   * Logs directory (~/.flashclaw/logs)
   */
  logs(): string {
    return join(getFlashClawHome(), 'logs');
  },

  /**
   * Log file path (~/.flashclaw/logs/flashclaw.log)
   */
  logFile(): string {
    return join(getFlashClawHome(), 'logs', 'flashclaw.log');
  },

  /**
   * User plugins directory (~/.flashclaw/plugins)
   */
  userPlugins(): string {
    return join(getFlashClawHome(), 'plugins');
  },

  /**
   * Groups directory (~/.flashclaw/groups)
   */
  groups(): string {
    return join(getFlashClawHome(), 'groups');
  },
};

/**
 * Get the built-in plugins directory.
 * Returns the path relative to the current module (../plugins).
 *
 * @returns The built-in plugins directory path
 */
export function getBuiltinPluginsDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  return join(__dirname, '..', 'plugins');
}

/**
 * Get the community plugins directory.
 * Returns the path relative to the current module (../community-plugins).
 *
 * @returns The community plugins directory path
 */
export function getCommunityPluginsDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  return join(__dirname, '..', 'community-plugins');
}

/**
 * Ensure all necessary directories exist.
 * Creates the following directories if they don't exist:
 * - ~/.flashclaw
 * - ~/.flashclaw/config
 * - ~/.flashclaw/data
 * - ~/.flashclaw/logs
 * - ~/.flashclaw/plugins
 * - ~/.flashclaw/groups
 */
export function ensureDirectories(): void {
  const directories = [
    paths.home(),
    paths.config(),
    paths.data(),
    paths.logs(),
    paths.userPlugins(),
    paths.groups(),
  ];

  for (const dir of directories) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}
