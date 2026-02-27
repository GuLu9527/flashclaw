/**
 * Browser Control Plugin - Interactions Module
 * 
 * 浏览器交互操作模块，提供页面导航、元素操作、截图等功能。
 * 所有函数接收 Playwright Page 对象作为第一个参数。
 */

import type { Page, Download } from 'playwright';
import { refLocator } from './session.js';

// ============================================================================
// Types
// ============================================================================

export interface ClickOptions {
  /** 是否双击 */
  doubleClick?: boolean;
  /** 鼠标按钮: left, right, middle */
  button?: 'left' | 'right' | 'middle';
  /** 修饰键 */
  modifiers?: Array<'Alt' | 'Control' | 'ControlOrMeta' | 'Meta' | 'Shift'>;
  /** 超时时间(ms) */
  timeout?: number;
}

export interface ScreenshotOptions {
  /** 元素引用，截取特定元素 */
  ref?: string;
  /** 是否截取整页 */
  fullPage?: boolean;
  /** 图片格式 */
  type?: 'png' | 'jpeg';
  /** 保存路径 */
  path?: string;
}

export interface DownloadResult {
  /** 下载文件的建议名称 */
  suggestedFilename: string;
  /** 下载文件的 URL */
  url: string;
  /** 保存路径 */
  path: string | null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 规范化超时时间
 */
function normalizeTimeout(timeout?: number, defaultMs = 8000): number {
  if (typeof timeout !== 'number' || !Number.isFinite(timeout)) {
    return defaultMs;
  }
  return Math.max(500, Math.min(60_000, Math.floor(timeout)));
}

/**
 * 验证并返回元素引用
 */
function requireRef(ref: string): string {
  const trimmed = String(ref ?? '').trim();
  if (!trimmed) {
    throw new Error('Element ref is required');
  }
  return trimmed;
}

/**
 * 转换错误为友好的错误信息
 */
function toFriendlyError(err: unknown, ref?: string): Error {
  const message = err instanceof Error ? err.message : String(err);
  const context = ref ? ` (ref: ${ref})` : '';
  return new Error(`Interaction failed${context}: ${message}`);
}

// ============================================================================
// Navigation
// ============================================================================

/**
 * 导航到指定 URL
 * 
 * @param page - Playwright Page 对象
 * @param url - 目标 URL
 * @param options - 导航选项
 */
export async function navigate(
  page: Page,
  url: string,
  options?: {
    /** 等待的加载状态 */
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
    /** 超时时间(ms) */
    timeout?: number;
  }
): Promise<void> {
  const targetUrl = String(url ?? '').trim();
  if (!targetUrl) {
    throw new Error('URL is required');
  }

  try {
    await page.goto(targetUrl, {
      waitUntil: options?.waitUntil ?? 'domcontentloaded',
      timeout: normalizeTimeout(options?.timeout, 30_000),
    });
  } catch (err) {
    throw toFriendlyError(err);
  }
}

// ============================================================================
// Element Interactions
// ============================================================================

/**
 * 点击元素
 * 
 * @param page - Playwright Page 对象
 * @param ref - 元素引用
 * @param options - 点击选项
 */
export async function click(
  page: Page,
  ref: string,
  options?: ClickOptions
): Promise<void> {
  const elementRef = requireRef(ref);
  const locator = await refLocator(page, elementRef);
  const timeout = normalizeTimeout(options?.timeout);

  try {
    if (options?.doubleClick) {
      await locator.dblclick({
        timeout,
        button: options.button,
        modifiers: options.modifiers,
      });
    } else {
      await locator.click({
        timeout,
        button: options?.button,
        modifiers: options?.modifiers,
      });
    }
  } catch (err) {
    throw toFriendlyError(err, elementRef);
  }
}

/**
 * 在元素中输入文本（追加模式）
 * 
 * @param page - Playwright Page 对象
 * @param ref - 元素引用
 * @param text - 要输入的文本
 * @param options - 输入选项
 */
export async function type(
  page: Page,
  ref: string,
  text: string,
  options?: {
    /** 每个字符之间的延迟(ms) */
    delay?: number;
    /** 超时时间(ms) */
    timeout?: number;
  }
): Promise<void> {
  const elementRef = requireRef(ref);
  const locator = await refLocator(page, elementRef);
  const timeout = normalizeTimeout(options?.timeout);
  const inputText = String(text ?? '');

  try {
    // 先点击聚焦，然后逐字输入
    await locator.click({ timeout });
    await locator.pressSequentially(inputText, {
      delay: options?.delay ?? 50,
      timeout,
    });
  } catch (err) {
    throw toFriendlyError(err, elementRef);
  }
}

/**
 * 填充元素文本（替换模式）
 * 
 * @param page - Playwright Page 对象
 * @param ref - 元素引用
 * @param text - 要填充的文本
 * @param options - 填充选项
 */
export async function fill(
  page: Page,
  ref: string,
  text: string,
  options?: {
    /** 超时时间(ms) */
    timeout?: number;
  }
): Promise<void> {
  const elementRef = requireRef(ref);
  const locator = await refLocator(page, elementRef);
  const timeout = normalizeTimeout(options?.timeout);
  const fillText = String(text ?? '');

  try {
    await locator.fill(fillText, { timeout });
  } catch (err) {
    throw toFriendlyError(err, elementRef);
  }
}

/**
 * 悬停在元素上
 * 
 * @param page - Playwright Page 对象
 * @param ref - 元素引用
 * @param options - 悬停选项
 */
export async function hover(
  page: Page,
  ref: string,
  options?: {
    /** 超时时间(ms) */
    timeout?: number;
  }
): Promise<void> {
  const elementRef = requireRef(ref);
  const locator = await refLocator(page, elementRef);
  const timeout = normalizeTimeout(options?.timeout);

  try {
    await locator.hover({ timeout });
  } catch (err) {
    throw toFriendlyError(err, elementRef);
  }
}

/**
 * 拖拽元素
 * 
 * @param page - Playwright Page 对象
 * @param startRef - 起始元素引用
 * @param endRef - 目标元素引用
 * @param options - 拖拽选项
 */
export async function drag(
  page: Page,
  startRef: string,
  endRef: string,
  options?: {
    /** 超时时间(ms) */
    timeout?: number;
  }
): Promise<void> {
  const startElement = requireRef(startRef);
  const endElement = requireRef(endRef);
  const timeout = normalizeTimeout(options?.timeout);

  const startLocator = await refLocator(page, startElement);
  const endLocator = await refLocator(page, endElement);

  try {
    await startLocator.dragTo(endLocator, { timeout });
  } catch (err) {
    throw toFriendlyError(err, `${startElement} -> ${endElement}`);
  }
}

// ============================================================================
// Scrolling
// ============================================================================

/**
 * 滚动到元素可见位置
 * 
 * @param page - Playwright Page 对象
 * @param ref - 元素引用（可选，不提供则滚动页面）
 * @param options - 滚动选项
 */
export async function scroll(
  page: Page,
  ref?: string,
  options?: {
    /** 超时时间(ms) */
    timeout?: number;
  }
): Promise<void> {
  const timeout = normalizeTimeout(options?.timeout, 20_000);

  if (!ref) {
    // 无元素引用时，滚动一屏
    try {
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight * 0.8);
      });
    } catch (err) {
      throw toFriendlyError(err);
    }
    return;
  }

  const elementRef = requireRef(ref);
  const locator = await refLocator(page, elementRef);

  try {
    await locator.scrollIntoViewIfNeeded({ timeout });
  } catch (err) {
    throw toFriendlyError(err, elementRef);
  }
}

/**
 * 滚动到指定坐标
 * 
 * @param page - Playwright Page 对象
 * @param x - 水平滚动位置
 * @param y - 垂直滚动位置
 */
export async function scrollTo(
  page: Page,
  x: number,
  y: number
): Promise<void> {
  const scrollX = Math.max(0, Math.floor(x ?? 0));
  const scrollY = Math.max(0, Math.floor(y ?? 0));

  try {
    await page.evaluate(
      ({ sx, sy }) => {
        window.scrollTo(sx, sy);
      },
      { sx: scrollX, sy: scrollY }
    );
  } catch (err) {
    throw toFriendlyError(err);
  }
}

// ============================================================================
// Screenshot
// ============================================================================

/**
 * 截取页面或元素截图
 * 
 * @param page - Playwright Page 对象
 * @param options - 截图选项
 * @returns 截图 Buffer
 */
export async function screenshot(
  page: Page,
  options?: ScreenshotOptions
): Promise<Buffer> {
  const type = options?.type ?? 'png';

  try {
    // 截取特定元素
    if (options?.ref) {
      if (options.fullPage) {
        throw new Error('fullPage is not supported for element screenshots');
      }
      const elementRef = requireRef(options.ref);
      const locator = await refLocator(page, elementRef);
      return await locator.screenshot({
        type,
        path: options.path,
      });
    }

    // 截取整个页面
    return await page.screenshot({
      type,
      fullPage: Boolean(options?.fullPage),
      path: options?.path,
    });
  } catch (err) {
    throw toFriendlyError(err, options?.ref);
  }
}

// ============================================================================
// Form Interactions
// ============================================================================

/**
 * 下拉框选择选项
 * 
 * @param page - Playwright Page 对象
 * @param ref - 元素引用
 * @param values - 要选择的值（可以是 value、label 或 index）
 * @param options - 选择选项
 */
export async function selectOption(
  page: Page,
  ref: string,
  values: string | string[],
  options?: {
    /** 超时时间(ms) */
    timeout?: number;
  }
): Promise<void> {
  const elementRef = requireRef(ref);
  const locator = await refLocator(page, elementRef);
  const timeout = normalizeTimeout(options?.timeout);
  const selectValues = Array.isArray(values) ? values : [values];

  if (!selectValues.length) {
    throw new Error('At least one value is required');
  }

  try {
    await locator.selectOption(selectValues, { timeout });
  } catch (err) {
    throw toFriendlyError(err, elementRef);
  }
}

// ============================================================================
// Dialog Handling
// ============================================================================

/**
 * 处理页面对话框（alert, confirm, prompt）
 * 
 * @param page - Playwright Page 对象
 * @param accept - 是否接受对话框
 * @param promptText - prompt 对话框的输入文本
 */
export async function handleDialog(
  page: Page,
  accept: boolean,
  promptText?: string
): Promise<void> {
  // 设置一次性对话框处理器
  page.once('dialog', async (dialog) => {
    try {
      if (accept) {
        await dialog.accept(promptText);
      } else {
        await dialog.dismiss();
      }
    } catch {
      // 对话框可能已经被处理，忽略错误
    }
  });
}

// ============================================================================
// File Operations
// ============================================================================

/**
 * 上传文件到文件输入框
 * 
 * @param page - Playwright Page 对象
 * @param ref - 文件输入框元素引用
 * @param filePaths - 要上传的文件路径列表
 * @param options - 上传选项
 */
export async function uploadFile(
  page: Page,
  ref: string,
  filePaths: string | string[],
  options?: {
    /** 超时时间(ms) */
    timeout?: number;
  }
): Promise<void> {
  const elementRef = requireRef(ref);
  const locator = await refLocator(page, elementRef);
  const paths = Array.isArray(filePaths) ? filePaths : [filePaths];

  if (!paths.length) {
    throw new Error('At least one file path is required');
  }

  try {
    await locator.setInputFiles(paths, {
      timeout: normalizeTimeout(options?.timeout),
    });

    // 触发 input 和 change 事件，确保文件上传被正确处理
    const handle = await locator.elementHandle();
    if (handle) {
      await handle.evaluate((el) => {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
  } catch (err) {
    throw toFriendlyError(err, elementRef);
  }
}

/**
 * 等待下载完成
 * 
 * @param page - Playwright Page 对象
 * @param options - 下载选项
 * @returns 下载结果
 */
export async function waitForDownload(
  page: Page,
  options?: {
    /** 保存路径 */
    path?: string;
    /** 超时时间(ms) */
    timeout?: number;
  }
): Promise<DownloadResult> {
  const timeout = normalizeTimeout(options?.timeout, 30_000);

  try {
    // 等待下载事件
    const downloadPromise = page.waitForEvent('download', { timeout });
    const download: Download = await downloadPromise;

    // 获取下载信息
    const suggestedFilename = download.suggestedFilename();
    const url = download.url();

    // 如果提供了保存路径，保存文件
    let savedPath: string | null = null;
    if (options?.path) {
      await download.saveAs(options.path);
      savedPath = options.path;
    } else {
      // 获取默认下载路径
      savedPath = await download.path();
    }

    return {
      suggestedFilename,
      url,
      path: savedPath,
    };
  } catch (err) {
    throw toFriendlyError(err);
  }
}
