/**
 * FlashClaw 插件 - 浏览器自动化控制
 * 提供浏览器启动、页面快照、交互操作、标签页管理和存储管理功能
 */

import type { ToolPlugin, ToolContext, ToolResult, ToolSchema } from '../../src/plugins/types.js';

// 导入各功能模块
import { launchBrowser, type BrowserInstance } from './launcher.js';
import { snapshotAi } from './snapshot.js';
import {
  connectBrowser,
  getAllPages,
  getPage,
  disconnectBrowser,
  getPageTargetId,
} from './session.js';
import {
  navigate,
  click,
  type as typeText,
  fill,
  hover,
  drag,
  scroll,
  scrollTo,
  screenshot,
  selectOption,
  handleDialog,
  uploadFile,
  waitForDownload,
} from './interactions.js';
import {
  getCookies,
  setCookie,
  clearCookies,
  getLocalStorage,
  setLocalStorage,
  clearLocalStorage,
  getSessionStorage,
  setSessionStorage,
  clearSessionStorage,
  type CookieInput,
} from './storage.js';

// ============================================================================
// 全局状态
// ============================================================================

/** 全局浏览器实例 */
let browserInstance: BrowserInstance | null = null;

/** 全局 CDP URL */
let globalCdpUrl: string | null = null;

/** 最近一次截图的临时文件路径（供 send_message 引用） */
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFile } from 'fs/promises';
import { readFileSync, existsSync, unlinkSync } from 'fs';

const LATEST_SCREENSHOT_PATH = join(tmpdir(), 'flashclaw-latest-screenshot.txt');

/** 保存最近截图到临时文件（异步，不阻塞事件循环） */
function saveLatestScreenshot(base64: string): void {
  writeFile(LATEST_SCREENSHOT_PATH, base64, 'utf-8').catch(() => {});
}

/** 获取最近截图（从临时文件读取） */
export function getLatestScreenshot(): string | null {
  if (!existsSync(LATEST_SCREENSHOT_PATH)) return null;
  try {
    return readFileSync(LATEST_SCREENSHOT_PATH, 'utf-8');
  } catch {
    return null;
  }
}

// ============================================================================
// 工具参数类型
// ============================================================================

interface BrowserLaunchParams {
  headless?: boolean;
  port?: number;
}

interface BrowserSnapshotParams {
  maxChars?: number;
  targetId?: string;
}

interface BrowserActionParams {
  action: string;
  url?: string;
  ref?: string;
  text?: string;
  selector?: string;
  files?: string | string[];
  accept?: boolean;
  promptText?: string;
  targetId?: string;
  x?: number;
  y?: number;
  endRef?: string;
  values?: string | string[];
  fullPage?: boolean;
  path?: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  timeout?: number;
}

interface BrowserTabsParams {
  action: 'list' | 'new' | 'close' | 'activate';
  url?: string;
  targetId?: string;
}

interface BrowserStorageParams {
  action: 'get_cookies' | 'set_cookie' | 'clear_cookies' |
          'get_local' | 'set_local' | 'clear_local' |
          'get_session' | 'set_session' | 'clear_session';
  key?: string;
  value?: string;
  cookie?: CookieInput;
  targetId?: string;
}

// ============================================================================
// 工具 Schema 定义
// ============================================================================

const browserLaunchSchema: ToolSchema = {
  name: 'browser_launch',
  description: '【必须首先调用】启动浏览器并开启 CDP 调试端口。在使用任何其他 browser_* 工具之前，必须先调用此工具启动浏览器。如果浏览器已启动，返回当前状态。',
  input_schema: {
    type: 'object',
    properties: {
      headless: {
        type: 'boolean',
        description: '是否以无头模式启动（默认 false，即显示浏览器窗口）',
      },
      port: {
        type: 'number',
        description: 'CDP 调试端口（默认 9222）',
      },
    },
    required: [],
  },
};

const browserSnapshotSchema: ToolSchema = {
  name: 'browser_snapshot',
  description: '获取当前页面的 AI 快照，包含页面结构和元素引用（e1, e2...）。【前置条件：必须先调用 browser_launch】在执行任何交互操作前必须先获取快照。',
  input_schema: {
    type: 'object',
    properties: {
      maxChars: {
        type: 'number',
        description: '快照最大字符数限制（超出将截断）',
      },
      targetId: {
        type: 'string',
        description: '目标标签页 ID（可选，默认使用当前活动标签页）',
      },
    },
    required: [],
  },
};

const browserActionSchema: ToolSchema = {
  name: 'browser_action',
  description: '执行浏览器交互操作，如导航、点击、输入、滚动等。【前置条件：必须先调用 browser_launch】执行 click/type/hover 等操作前需先调用 browser_snapshot 获取元素引用。',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: '操作类型',
        enum: [
          'navigate',      // 导航到 URL
          'click',         // 点击元素
          'type',          // 输入文本（追加）
          'fill',          // 填充文本（替换）
          'hover',         // 悬停
          'drag',          // 拖拽
          'scroll',        // 滚动到元素
          'scroll_to',     // 滚动到坐标
          'screenshot',    // 截图
          'select',        // 下拉框选择
          'dialog',        // 处理对话框
          'upload',        // 上传文件
          'download',      // 等待下载
          'wait',          // 等待指定时间
        ],
      },
      url: {
        type: 'string',
        description: '目标 URL（navigate 操作需要）',
      },
      ref: {
        type: 'string',
        description: '元素引用，如 e1、e2（从 snapshot 获取）',
      },
      text: {
        type: 'string',
        description: '输入的文本内容（type/fill 操作需要）',
      },
      selector: {
        type: 'string',
        description: 'CSS 选择器（可选，用于特定元素操作）',
      },
      files: {
        oneOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } },
        ],
        description: '要上传的文件路径（upload 操作需要）',
      },
      accept: {
        type: 'boolean',
        description: '是否接受对话框（dialog 操作，默认 true）',
      },
      promptText: {
        type: 'string',
        description: 'prompt 对话框的输入文本',
      },
      targetId: {
        type: 'string',
        description: '目标标签页 ID',
      },
      x: {
        type: 'number',
        description: '水平坐标（scroll_to 操作）',
      },
      y: {
        type: 'number',
        description: '垂直坐标（scroll_to 操作）',
      },
      endRef: {
        type: 'string',
        description: '拖拽目标元素引用（drag 操作）',
      },
      values: {
        oneOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } },
        ],
        description: '下拉框选择的值（select 操作）',
      },
      fullPage: {
        type: 'boolean',
        description: '是否截取整页（screenshot 操作）',
      },
      path: {
        type: 'string',
        description: '保存路径（screenshot/download 操作）',
      },
      waitUntil: {
        type: 'string',
        description: '导航等待状态',
        enum: ['load', 'domcontentloaded', 'networkidle', 'commit'],
      },
      timeout: {
        type: 'number',
        description: '操作超时时间（毫秒）',
      },
    },
    required: ['action'],
  },
};

const browserTabsSchema: ToolSchema = {
  name: 'browser_tabs',
  description: '管理浏览器标签页：列出、新建、关闭或切换标签页。【前置条件：必须先调用 browser_launch】',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: '操作类型',
        enum: ['list', 'new', 'close', 'activate'],
      },
      url: {
        type: 'string',
        description: '新标签页要打开的 URL（new 操作可选）',
      },
      targetId: {
        type: 'string',
        description: '目标标签页 ID（close/activate 操作需要）',
      },
    },
    required: ['action'],
  },
};

const browserStorageSchema: ToolSchema = {
  name: 'browser_storage',
  description: '管理浏览器存储：Cookie、LocalStorage、SessionStorage 的读取、设置和清除。【前置条件：必须先调用 browser_launch】',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: '操作类型',
        enum: [
          'get_cookies',    // 获取 cookies
          'set_cookie',     // 设置 cookie
          'clear_cookies',  // 清除所有 cookies
          'get_local',      // 获取 localStorage
          'set_local',      // 设置 localStorage
          'clear_local',    // 清除 localStorage
          'get_session',    // 获取 sessionStorage
          'set_session',    // 设置 sessionStorage
          'clear_session',  // 清除 sessionStorage
        ],
      },
      key: {
        type: 'string',
        description: '存储键名（get/set 操作可选/需要）',
      },
      value: {
        type: 'string',
        description: '存储值（set 操作需要）',
      },
      cookie: {
        type: 'object',
        description: 'Cookie 对象（set_cookie 操作需要）',
        properties: {
          name: { type: 'string', description: 'Cookie 名称' },
          value: { type: 'string', description: 'Cookie 值' },
          url: { type: 'string', description: 'Cookie URL' },
          domain: { type: 'string', description: 'Cookie 域' },
          path: { type: 'string', description: 'Cookie 路径' },
          expires: { type: 'number', description: '过期时间戳' },
          httpOnly: { type: 'boolean', description: '是否 HttpOnly' },
          secure: { type: 'boolean', description: '是否 Secure' },
          sameSite: { type: 'string', enum: ['Lax', 'None', 'Strict'] },
        },
      },
      targetId: {
        type: 'string',
        description: '目标标签页 ID',
      },
    },
    required: ['action'],
  },
};

// ============================================================================
// 工具执行函数
// ============================================================================

/**
 * 确保浏览器已启动并返回 CDP URL
 */
function ensureCdpUrl(): string {
  if (!globalCdpUrl) {
    throw new Error('浏览器未启动，请先调用 browser_launch');
  }
  return globalCdpUrl;
}

/**
 * 执行 browser_launch
 */
async function executeLaunch(params: BrowserLaunchParams): Promise<ToolResult> {
  // 如果已有浏览器实例，验证 Playwright 连接是否仍然可用
  if (browserInstance && globalCdpUrl) {
    try {
      const browser = await connectBrowser(globalCdpUrl);
      if (browser.isConnected()) {
        return {
          success: true,
          data: {
            cdpUrl: globalCdpUrl,
            pid: browserInstance.pid,
            message: '浏览器已在运行',
          },
        };
      }
    } catch {
      // 连接失败，需要重启浏览器
    }
    // 连接失败，清理旧状态
    browserInstance = null;
    globalCdpUrl = null;
    await disconnectBrowser();
  }

  try {
    browserInstance = await launchBrowser({
      headless: params.headless ?? false,
      port: params.port,
    });
    globalCdpUrl = browserInstance.cdpUrl;

    // 验证 Playwright 连接
    const browser = await connectBrowser(globalCdpUrl);
    if (!browser.isConnected()) {
      throw new Error('Playwright 无法连接到浏览器');
    }

    return {
      success: true,
      data: {
        cdpUrl: globalCdpUrl,
        pid: browserInstance.pid,
        message: '浏览器启动成功',
      },
    };
  } catch (err) {
    // 启动失败，清理状态
    if (browserInstance) {
      await browserInstance.close().catch(() => {});
      browserInstance = null;
    }
    globalCdpUrl = null;
    await disconnectBrowser();
    
    return {
      success: false,
      error: `启动浏览器失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** 默认快照最大字符数（防止撑爆上下文窗口） */
const DEFAULT_SNAPSHOT_MAX_CHARS = 8000;

/**
 * 执行 browser_snapshot
 */
async function executeSnapshot(params: BrowserSnapshotParams): Promise<ToolResult> {
  try {
    const cdpUrl = ensureCdpUrl();
    const page = await getPage(cdpUrl, params.targetId);
    
    const result = await snapshotAi(page, {
      maxChars: params.maxChars ?? DEFAULT_SNAPSHOT_MAX_CHARS,
      cdpUrl,
      targetId: params.targetId,
    });

    return {
      success: true,
      data: {
        url: page.url(),
        title: await page.title(),
        snapshot: result.snapshot,
        truncated: result.truncated,
        refs: Object.keys(result.refs),
      },
    };
  } catch (err) {
    return {
      success: false,
      error: `获取快照失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 执行 browser_action
 */
async function executeAction(params: BrowserActionParams): Promise<ToolResult> {
  try {
    const cdpUrl = ensureCdpUrl();
    const page = await getPage(cdpUrl, params.targetId);

    switch (params.action) {
      case 'navigate': {
        if (!params.url) {
          return { success: false, error: 'navigate 操作需要 url 参数' };
        }
        await navigate(page, params.url, {
          waitUntil: params.waitUntil,
          timeout: params.timeout,
        });
        return {
          success: true,
          data: { url: page.url(), title: await page.title() },
        };
      }

      case 'click': {
        if (!params.ref) {
          return { success: false, error: 'click 操作需要 ref 参数' };
        }
        await click(page, params.ref, { timeout: params.timeout });
        return { success: true, data: { action: 'click', ref: params.ref } };
      }

      case 'type': {
        if (!params.ref) {
          return { success: false, error: 'type 操作需要 ref 参数' };
        }
        await typeText(page, params.ref, params.text ?? '', { timeout: params.timeout });
        return { success: true, data: { action: 'type', ref: params.ref } };
      }

      case 'fill': {
        if (!params.ref) {
          return { success: false, error: 'fill 操作需要 ref 参数' };
        }
        await fill(page, params.ref, params.text ?? '', { timeout: params.timeout });
        return { success: true, data: { action: 'fill', ref: params.ref } };
      }

      case 'hover': {
        if (!params.ref) {
          return { success: false, error: 'hover 操作需要 ref 参数' };
        }
        await hover(page, params.ref, { timeout: params.timeout });
        return { success: true, data: { action: 'hover', ref: params.ref } };
      }

      case 'drag': {
        if (!params.ref || !params.endRef) {
          return { success: false, error: 'drag 操作需要 ref 和 endRef 参数' };
        }
        await drag(page, params.ref, params.endRef, { timeout: params.timeout });
        return { success: true, data: { action: 'drag', from: params.ref, to: params.endRef } };
      }

      case 'scroll': {
        await scroll(page, params.ref, { timeout: params.timeout });
        return { success: true, data: { action: 'scroll', ref: params.ref } };
      }

      case 'scroll_to': {
        await scrollTo(page, params.x ?? 0, params.y ?? 0);
        return { success: true, data: { action: 'scroll_to', x: params.x, y: params.y } };
      }

      case 'screenshot': {
        const buffer = await screenshot(page, {
          ref: params.ref,
          fullPage: params.fullPage,
          path: params.path,
        });
        const base64 = buffer.toString('base64');
        // 存储到临时文件，供 send_message 引用
        saveLatestScreenshot(base64);
        return {
          success: true,
          data: {
            action: 'screenshot',
            size: buffer.length,
            path: params.path,
            // 不返回完整 base64 给 Claude，避免上下文过大
            // 使用 send_message({ image: "latest_screenshot" }) 发送截图
            hint: '截图已保存。使用 send_message 工具发送：send_message({ image: "latest_screenshot", caption: "可选说明" })',
          },
        };
      }

      case 'select': {
        if (!params.ref || !params.values) {
          return { success: false, error: 'select 操作需要 ref 和 values 参数' };
        }
        await selectOption(page, params.ref, params.values, { timeout: params.timeout });
        return { success: true, data: { action: 'select', ref: params.ref, values: params.values } };
      }

      case 'dialog': {
        const accept = params.accept ?? true;
        await handleDialog(page, accept, params.promptText);
        return { success: true, data: { action: 'dialog', accept, promptText: params.promptText } };
      }

      case 'upload': {
        if (!params.ref || !params.files) {
          return { success: false, error: 'upload 操作需要 ref 和 files 参数' };
        }
        await uploadFile(page, params.ref, params.files, { timeout: params.timeout });
        return { success: true, data: { action: 'upload', ref: params.ref, files: params.files } };
      }

      case 'download': {
        const result = await waitForDownload(page, {
          path: params.path,
          timeout: params.timeout,
        });
        return { success: true, data: { action: 'download', ...result } };
      }

      case 'wait': {
        const ms = params.timeout ?? 1000;
        await new Promise((resolve) => setTimeout(resolve, ms));
        return { success: true, data: { action: 'wait', ms } };
      }

      default:
        return { success: false, error: `未知操作: ${params.action}` };
    }
  } catch (err) {
    return {
      success: false,
      error: `操作失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 执行 browser_tabs
 */
async function executeTabs(params: BrowserTabsParams): Promise<ToolResult> {
  try {
    const cdpUrl = ensureCdpUrl();
    const browser = await connectBrowser(cdpUrl);

    switch (params.action) {
      case 'list': {
        const pages = await getAllPages(cdpUrl);
        const tabs = await Promise.all(
          pages.map(async (page, index) => ({
            index,
            targetId: await getPageTargetId(page) ?? undefined,
            url: page.url(),
            title: await page.title(),
          }))
        );
        return { success: true, data: { tabs } };
      }

      case 'new': {
        const context = browser.contexts()[0];
        if (!context) {
          return { success: false, error: '没有可用的浏览器上下文' };
        }
        const newPage = await context.newPage();
        if (params.url) {
          await newPage.goto(params.url);
        }
        return {
          success: true,
          data: {
            url: newPage.url(),
            title: await newPage.title(),
          },
        };
      }

      case 'close': {
        if (!params.targetId) {
          return { success: false, error: 'close 操作需要 targetId 参数' };
        }
        const page = await getPage(cdpUrl, params.targetId);
        await page.close();
        return { success: true, data: { closed: params.targetId } };
      }

      case 'activate': {
        if (!params.targetId) {
          return { success: false, error: 'activate 操作需要 targetId 参数' };
        }
        const page = await getPage(cdpUrl, params.targetId);
        await page.bringToFront();
        return {
          success: true,
          data: {
            activated: params.targetId,
            url: page.url(),
            title: await page.title(),
          },
        };
      }

      default:
        return { success: false, error: `未知操作: ${params.action}` };
    }
  } catch (err) {
    return {
      success: false,
      error: `标签页操作失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 执行 browser_storage
 */
async function executeStorage(params: BrowserStorageParams): Promise<ToolResult> {
  try {
    const cdpUrl = ensureCdpUrl();
    const page = await getPage(cdpUrl, params.targetId);

    switch (params.action) {
      case 'get_cookies': {
        const cookies = await getCookies(page);
        return { success: true, data: { cookies } };
      }

      case 'set_cookie': {
        if (!params.cookie) {
          return { success: false, error: 'set_cookie 操作需要 cookie 参数' };
        }
        await setCookie(page, params.cookie);
        return { success: true, data: { set: params.cookie.name } };
      }

      case 'clear_cookies': {
        await clearCookies(page);
        return { success: true, data: { cleared: 'cookies' } };
      }

      case 'get_local': {
        const data = await getLocalStorage(page, params.key);
        return { success: true, data: { localStorage: data } };
      }

      case 'set_local': {
        if (!params.key) {
          return { success: false, error: 'set_local 操作需要 key 参数' };
        }
        await setLocalStorage(page, params.key, params.value ?? '');
        return { success: true, data: { set: params.key } };
      }

      case 'clear_local': {
        await clearLocalStorage(page);
        return { success: true, data: { cleared: 'localStorage' } };
      }

      case 'get_session': {
        const data = await getSessionStorage(page, params.key);
        return { success: true, data: { sessionStorage: data } };
      }

      case 'set_session': {
        if (!params.key) {
          return { success: false, error: 'set_session 操作需要 key 参数' };
        }
        await setSessionStorage(page, params.key, params.value ?? '');
        return { success: true, data: { set: params.key } };
      }

      case 'clear_session': {
        await clearSessionStorage(page);
        return { success: true, data: { cleared: 'sessionStorage' } };
      }

      default:
        return { success: false, error: `未知操作: ${params.action}` };
    }
  } catch (err) {
    return {
      success: false,
      error: `存储操作失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ============================================================================
// 插件导出
// ============================================================================

const plugin: ToolPlugin = {
  name: 'browser-control',
  version: '1.0.0',
  description: '浏览器自动化控制插件，提供启动、快照、交互、标签页和存储管理功能',

  tools: [
    browserLaunchSchema,
    browserSnapshotSchema,
    browserActionSchema,
    browserTabsSchema,
    browserStorageSchema,
  ],

  async execute(toolName: string, params: unknown, context: ToolContext): Promise<ToolResult> {
    switch (toolName) {
      case 'browser_launch':
        return executeLaunch(params as BrowserLaunchParams);

      case 'browser_snapshot':
        return executeSnapshot(params as BrowserSnapshotParams);

      case 'browser_action':
        return executeAction(params as BrowserActionParams);

      case 'browser_tabs':
        return executeTabs(params as BrowserTabsParams);

      case 'browser_storage':
        return executeStorage(params as BrowserStorageParams);

      default:
        return { success: false, error: `未知工具: ${toolName}` };
    }
  },

  // 可选：插件卸载时清理资源
  async cleanup() {
    if (browserInstance) {
      await browserInstance.close();
      browserInstance = null;
    }
    globalCdpUrl = null;
    await disconnectBrowser();
  },
};

export default plugin;
