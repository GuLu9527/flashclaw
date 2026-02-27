/**
 * browser-control 插件全链路测试
 *
 * 测试覆盖：
 * 1. 浏览器启动 (browser_launch)
 * 2. 页面导航 (browser_action: navigate)
 * 3. 页面快照 (browser_snapshot)
 * 4. 元素交互 (browser_action: click/fill/type/hover/scroll)
 * 5. 截图功能 (browser_action: screenshot)
 * 6. 标签页管理 (browser_tabs)
 * 7. 存储管理 (browser_storage)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { promises as fs } from 'fs';

// 动态导入插件
let plugin: Awaited<typeof import('../../community-plugins/browser-control/index.js')>['default'];

// 测试上下文
const testContext = {
  conversationId: 'test-conversation',
  messageId: 'test-message',
  sessionId: 'test-session',
};

// 临时目录用于截图等
let tempDir: string;

describe('browser-control 插件全链路测试', () => {
  beforeAll(async () => {
    // 创建临时目录
    tempDir = await fs.mkdtemp(join(tmpdir(), 'browser-control-test-'));

    // 动态导入插件
    const mod = await import('../../community-plugins/browser-control/index.js');
    plugin = mod.default;
  }, 30000);

  afterAll(async () => {
    // 清理浏览器资源
    if (plugin?.cleanup) {
      await plugin.cleanup();
    }

    // 清理临时目录
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 15000);

  describe('1. 浏览器启动 (browser_launch)', () => {
    it('应该成功启动浏览器', async () => {
      const result = await plugin.execute('browser_launch', {
        headless: true, // 无头模式，CI 环境友好
      }, testContext);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.cdpUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(result.data.pid).toBeGreaterThan(0);
      console.log('✅ 浏览器启动成功:', result.data);
    }, 30000);

    it('重复调用应该返回已有实例', async () => {
      const result = await plugin.execute('browser_launch', {}, testContext);

      expect(result.success).toBe(true);
      expect(result.data.message).toContain('已在运行');
      console.log('✅ 浏览器实例复用:', result.data.message);
    }, 10000);
  });

  describe('2. 页面导航 (browser_action: navigate)', () => {
    it('应该成功导航到测试页面', async () => {
      const result = await plugin.execute('browser_action', {
        action: 'navigate',
        url: 'https://example.com',
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      }, testContext);

      expect(result.success).toBe(true);
      expect(result.data.url).toContain('example.com');
      expect(result.data.title).toBeTruthy();
      console.log('✅ 页面导航成功:', result.data);
    }, 20000);

    it('无效 URL 应该返回错误', async () => {
      const result = await plugin.execute('browser_action', {
        action: 'navigate',
        url: '',
      }, testContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('url');
      console.log('✅ 无效 URL 正确报错:', result.error);
    }, 5000);
  });

  describe('3. 页面快照 (browser_snapshot)', () => {
    it('应该成功获取页面快照和元素引用', async () => {
      const result = await plugin.execute('browser_snapshot', {}, testContext);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.url).toContain('example.com');
      expect(result.data.title).toBeTruthy();
      expect(result.data.snapshot).toBeTruthy();
      expect(Array.isArray(result.data.refs)).toBe(true);
      console.log('✅ 页面快照成功，元素引用数量:', result.data.refs.length);
      console.log('   快照预览:', result.data.snapshot.slice(0, 200) + '...');
    }, 15000);

    it('应该支持 maxChars 限制', async () => {
      const result = await plugin.execute('browser_snapshot', {
        maxChars: 500,
      }, testContext);

      expect(result.success).toBe(true);
      if (result.data.truncated) {
        expect(result.data.snapshot.length).toBeLessThanOrEqual(600); // 包含截断提示
        console.log('✅ maxChars 限制生效，已截断');
      } else {
        console.log('✅ 页面内容较短，无需截断');
      }
    }, 15000);
  });

  describe('4. 标签页管理 (browser_tabs)', () => {
    it('应该成功列出标签页', async () => {
      const result = await plugin.execute('browser_tabs', {
        action: 'list',
      }, testContext);

      expect(result.success).toBe(true);
      expect(result.data.tabs).toBeDefined();
      expect(Array.isArray(result.data.tabs)).toBe(true);
      expect(result.data.tabs.length).toBeGreaterThan(0);
      console.log('✅ 标签页列表:', result.data.tabs.map((t: { url: string }) => t.url));
    }, 10000);

    it('应该成功创建新标签页', async () => {
      const result = await plugin.execute('browser_tabs', {
        action: 'new',
        url: 'https://httpbin.org/html',
      }, testContext);

      expect(result.success).toBe(true);
      expect(result.data.url).toContain('httpbin.org');
      console.log('✅ 新标签页创建成功:', result.data.url);
    }, 15000);

    it('应该成功切换标签页', async () => {
      // 先获取标签页列表
      const listResult = await plugin.execute('browser_tabs', {
        action: 'list',
      }, testContext);

      expect(listResult.success).toBe(true);
      const tabs = listResult.data.tabs;
      expect(tabs.length).toBeGreaterThanOrEqual(2);

      // 切换到第一个标签页
      const firstTab = tabs[0];
      if (firstTab.targetId) {
        const activateResult = await plugin.execute('browser_tabs', {
          action: 'activate',
          targetId: firstTab.targetId,
        }, testContext);

        expect(activateResult.success).toBe(true);
        console.log('✅ 标签页切换成功:', activateResult.data);
      }
    }, 10000);
  });

  describe('5. 元素交互 (browser_action)', () => {
    beforeAll(async () => {
      // 导航到一个有表单的测试页面
      await plugin.execute('browser_action', {
        action: 'navigate',
        url: 'https://httpbin.org/forms/post',
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      }, testContext);

      // 获取快照以生成元素引用
      await plugin.execute('browser_snapshot', {}, testContext);
    }, 20000);

    it('应该成功滚动页面', async () => {
      const result = await plugin.execute('browser_action', {
        action: 'scroll',
      }, testContext);

      expect(result.success).toBe(true);
      console.log('✅ 页面滚动成功');
    }, 10000);

    it('应该成功滚动到指定坐标', async () => {
      const result = await plugin.execute('browser_action', {
        action: 'scroll_to',
        x: 0,
        y: 100,
      }, testContext);

      expect(result.success).toBe(true);
      console.log('✅ 滚动到坐标成功:', result.data);
    }, 10000);

    it('click 操作缺少 ref 应该报错', async () => {
      const result = await plugin.execute('browser_action', {
        action: 'click',
      }, testContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('ref');
      console.log('✅ 缺少 ref 正确报错');
    }, 5000);

    it('fill 操作缺少 ref 应该报错', async () => {
      const result = await plugin.execute('browser_action', {
        action: 'fill',
        text: 'test',
      }, testContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('ref');
      console.log('✅ fill 缺少 ref 正确报错');
    }, 5000);
  });

  describe('6. 截图功能 (browser_action: screenshot)', () => {
    it('应该成功截取页面截图', async () => {
      const screenshotPath = join(tempDir, 'page-screenshot.png');

      const result = await plugin.execute('browser_action', {
        action: 'screenshot',
        path: screenshotPath,
      }, testContext);

      expect(result.success).toBe(true);
      expect(result.data.size).toBeGreaterThan(0);
      expect(result.data.base64).toBeTruthy();
      console.log('✅ 页面截图成功，大小:', result.data.size, 'bytes');

      // 验证文件是否创建
      const stat = await fs.stat(screenshotPath).catch(() => null);
      if (stat) {
        console.log('   截图已保存到:', screenshotPath);
      }
    }, 15000);

    it('应该成功截取整页截图', async () => {
      const result = await plugin.execute('browser_action', {
        action: 'screenshot',
        fullPage: true,
      }, testContext);

      expect(result.success).toBe(true);
      expect(result.data.size).toBeGreaterThan(0);
      console.log('✅ 整页截图成功，大小:', result.data.size, 'bytes');
    }, 15000);
  });

  describe('7. 存储管理 (browser_storage)', () => {
    beforeAll(async () => {
      // 确保在一个有效页面上
      await plugin.execute('browser_action', {
        action: 'navigate',
        url: 'https://example.com',
        waitUntil: 'domcontentloaded',
      }, testContext);
    }, 15000);

    it('应该成功获取 cookies', async () => {
      const result = await plugin.execute('browser_storage', {
        action: 'get_cookies',
      }, testContext);

      expect(result.success).toBe(true);
      expect(result.data.cookies).toBeDefined();
      expect(Array.isArray(result.data.cookies)).toBe(true);
      console.log('✅ 获取 cookies 成功，数量:', result.data.cookies.length);
    }, 10000);

    it('应该成功设置 localStorage', async () => {
      const result = await plugin.execute('browser_storage', {
        action: 'set_local',
        key: 'test_key',
        value: 'test_value_123',
      }, testContext);

      expect(result.success).toBe(true);
      console.log('✅ 设置 localStorage 成功');
    }, 10000);

    it('应该成功获取 localStorage', async () => {
      const result = await plugin.execute('browser_storage', {
        action: 'get_local',
        key: 'test_key',
      }, testContext);

      expect(result.success).toBe(true);
      expect(result.data.localStorage).toBeDefined();
      expect(result.data.localStorage.test_key).toBe('test_value_123');
      console.log('✅ 获取 localStorage 成功:', result.data.localStorage);
    }, 10000);

    it('应该成功清除 localStorage', async () => {
      const result = await plugin.execute('browser_storage', {
        action: 'clear_local',
      }, testContext);

      expect(result.success).toBe(true);
      console.log('✅ 清除 localStorage 成功');

      // 验证已清除
      const getResult = await plugin.execute('browser_storage', {
        action: 'get_local',
      }, testContext);
      expect(Object.keys(getResult.data.localStorage).length).toBe(0);
    }, 10000);

    it('应该成功设置和获取 sessionStorage', async () => {
      // 设置
      const setResult = await plugin.execute('browser_storage', {
        action: 'set_session',
        key: 'session_test',
        value: 'session_value',
      }, testContext);
      expect(setResult.success).toBe(true);

      // 获取
      const getResult = await plugin.execute('browser_storage', {
        action: 'get_session',
        key: 'session_test',
      }, testContext);
      expect(getResult.success).toBe(true);
      expect(getResult.data.sessionStorage.session_test).toBe('session_value');
      console.log('✅ sessionStorage 读写成功');
    }, 10000);
  });

  describe('8. 等待操作 (browser_action: wait)', () => {
    it('应该成功等待指定时间', async () => {
      const start = Date.now();
      const result = await plugin.execute('browser_action', {
        action: 'wait',
        timeout: 1000,
      }, testContext);

      const elapsed = Date.now() - start;
      expect(result.success).toBe(true);
      expect(elapsed).toBeGreaterThanOrEqual(900); // 允许少量误差
      console.log('✅ 等待操作成功，耗时:', elapsed, 'ms');
    }, 5000);
  });

  describe('9. 错误处理', () => {
    it('未知工具应该返回错误', async () => {
      const result = await plugin.execute('unknown_tool', {}, testContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('未知工具');
      console.log('✅ 未知工具正确报错');
    }, 5000);

    it('未知 action 应该返回错误', async () => {
      const result = await plugin.execute('browser_action', {
        action: 'unknown_action',
      }, testContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('未知操作');
      console.log('✅ 未知 action 正确报错');
    }, 5000);
  });
});
