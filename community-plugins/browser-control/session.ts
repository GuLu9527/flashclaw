/**
 * Browser Control Session Manager for FlashClaw
 * 
 * Manages Playwright browser connections via CDP, page state tracking,
 * and role-based element references (e1, e2, etc.).
 */

import type { Browser, ConsoleMessage, Page, Locator } from "playwright-core";
import { chromium } from "playwright-core";

// ============================================================================
// Types
// ============================================================================

/** Role-based element reference map (e.g., e1 -> { role: "button", name: "Submit" }) */
export type RoleRefMap = Record<string, { role: string; name?: string; nth?: number }>;

/** Console message captured from page */
export type BrowserConsoleMessage = {
  type: string;
  text: string;
  timestamp: string;
  location?: { url?: string; lineNumber?: number; columnNumber?: number };
};

/** Page error captured from page */
export type BrowserPageError = {
  message: string;
  name?: string;
  stack?: string;
  timestamp: string;
};

/** Internal page state for tracking */
type PageState = {
  console: BrowserConsoleMessage[];
  errors: BrowserPageError[];
  roleRefs?: RoleRefMap;
  roleRefsTargetId?: string;
  roleRefsCdpUrl?: string;
};

/** Connected browser instance */
type ConnectedBrowser = {
  browser: Browser;
  cdpUrl: string;
};

// ============================================================================
// State Management (using globalThis for persistence across module reloads)
// ============================================================================

const MAX_CONSOLE_MESSAGES = 200;
const MAX_PAGE_ERRORS = 100;
const MAX_ROLE_REFS_CACHE = 50;

// Use a unique symbol key to avoid conflicts with other modules
const BROWSER_CONTROL_STATE_KEY = Symbol.for('__browser_control_state__');

// Define the global state interface
interface BrowserControlGlobalState {
  roleRefsByTarget: Map<string, RoleRefMap>;
  cached: ConnectedBrowser | null;
  connecting: Promise<ConnectedBrowser> | null;
  lastTargetId?: string | null;
}

// Initialize or retrieve global state
function getGlobalState(): BrowserControlGlobalState {
  const g = globalThis as unknown as { [BROWSER_CONTROL_STATE_KEY]?: BrowserControlGlobalState };
  if (!g[BROWSER_CONTROL_STATE_KEY]) {
    g[BROWSER_CONTROL_STATE_KEY] = {
      roleRefsByTarget: new Map<string, RoleRefMap>(),
      cached: null,
      connecting: null,
    };
  }
  return g[BROWSER_CONTROL_STATE_KEY];
}

/** WeakMap to store page states (can be module-local as Page objects don't persist) */
const pageStates = new WeakMap<Page, PageState>();

/** Set of observed pages to prevent duplicate listeners */
const observedPages = new WeakSet<Page>();

/** Build cache key for roleRefs */
function roleRefsKey(cdpUrl: string, targetId: string): string {
  return `${normalizeCdpUrl(cdpUrl)}::${targetId}`;
}

// ============================================================================
// Utility Functions
// ============================================================================

/** Normalize CDP URL by removing trailing slash */
function normalizeCdpUrl(url: string): string {
  return url.replace(/\/$/, "");
}

/**
 * Get WebSocket URL from CDP HTTP endpoint.
 * This is crucial for Playwright connection to work properly.
 */
async function getWebSocketUrl(cdpUrl: string, timeoutMs = 5000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const versionUrl = `${cdpUrl}/json/version`;
    const response = await fetch(versionUrl, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json() as { webSocketDebuggerUrl?: string };
    const wsUrl = String(data?.webSocketDebuggerUrl ?? "").trim();
    return wsUrl || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Ensure page state exists, create if not */
function ensurePageState(page: Page): PageState {
  const existing = pageStates.get(page);
  if (existing) {
    return existing;
  }

  const state: PageState = {
    console: [],
    errors: [],
  };
  pageStates.set(page, state);

  // Set up event listeners if not already done
  if (!observedPages.has(page)) {
    observedPages.add(page);

    // Track console messages
    page.on("console", (msg: ConsoleMessage) => {
      const entry: BrowserConsoleMessage = {
        type: msg.type(),
        text: msg.text(),
        timestamp: new Date().toISOString(),
        location: msg.location(),
      };
      state.console.push(entry);
      if (state.console.length > MAX_CONSOLE_MESSAGES) {
        state.console.shift();
      }
    });

    // Track page errors
    page.on("pageerror", (err: Error) => {
      state.errors.push({
        message: err?.message ? String(err.message) : String(err),
        name: err?.name ? String(err.name) : undefined,
        stack: err?.stack ? String(err.stack) : undefined,
        timestamp: new Date().toISOString(),
      });
      if (state.errors.length > MAX_PAGE_ERRORS) {
        state.errors.shift();
      }
    });

    // Cleanup on page close
    page.on("close", () => {
      targetIdCache.delete(page);
      if (state.roleRefsTargetId && state.roleRefsCdpUrl) {
        const globalState = getGlobalState();
        globalState.roleRefsByTarget.delete(
          roleRefsKey(state.roleRefsCdpUrl, state.roleRefsTargetId)
        );
      }
      pageStates.delete(page);
      observedPages.delete(page);
    });
  }

  return state;
}

/** Set up observation for all pages in browser */
function observeBrowser(browser: Browser): void {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      ensurePageState(page);
    }
    // Observe new pages
    context.on("page", (page) => ensurePageState(page));
  }
}

/** Cache targetId per page to avoid repeated CDP sessions */
const targetIdCache = new WeakMap<Page, string>();

/** Get page target ID via CDP */
export async function getPageTargetId(page: Page): Promise<string | null> {
  // 从缓存获取
  const cached = targetIdCache.get(page);
  if (cached) return cached;

  try {
    const session = await page.context().newCDPSession(page);
    try {
      const info = await session.send("Target.getTargetInfo") as {
        targetInfo?: { targetId?: string };
      };
      const targetId = info?.targetInfo?.targetId?.trim() || null;
      // 缓存结果
      if (targetId) targetIdCache.set(page, targetId);
      return targetId;
    } finally {
      await session.detach().catch(() => {});
    }
  } catch {
    return null;
  }
}

// ============================================================================
// Exported Functions
// ============================================================================

/**
 * Connect to a browser via CDP URL.
 * Caches the connection and reuses it for the same CDP URL.
 */
export async function connectBrowser(cdpUrl: string): Promise<Browser> {
  const normalized = normalizeCdpUrl(cdpUrl);
  const state = getGlobalState();

  // Return cached connection if valid
  if (state.cached?.cdpUrl === normalized && state.cached.browser.isConnected()) {
    return state.cached.browser;
  }

  // Wait for in-flight connection
  if (state.connecting) {
    const result = await state.connecting;
    return result.browser;
  }

  // Create new connection with retry
  const connectWithRetry = async (): Promise<ConnectedBrowser> => {
    let lastErr: unknown;
    
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const timeout = 5000 + attempt * 2000;
        
        // First, get the WebSocket URL from /json/version
        // This is crucial for Playwright to connect properly
        const wsUrl = await getWebSocketUrl(normalized, timeout);
        const endpoint = wsUrl ?? normalized;
        
        const browser = await chromium.connectOverCDP(endpoint, { timeout });
        
        const connected: ConnectedBrowser = { browser, cdpUrl: normalized };
        state.cached = connected;
        observeBrowser(browser);

        // Clear cache on disconnect
        browser.on("disconnected", () => {
          if (state.cached?.browser === browser) {
            state.cached = null;
          }
          const prefix = `${normalized}::`;
          for (const key of state.roleRefsByTarget.keys()) {
            if (key.startsWith(prefix)) {
              state.roleRefsByTarget.delete(key);
            }
          }
        });

        return connected;
      } catch (err) {
        lastErr = err;
        const delay = 250 + attempt * 250;
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error("CDP connect failed");
  };

  state.connecting = connectWithRetry().finally(() => {
    state.connecting = null;
  });

  const result = await state.connecting;
  return result.browser;
}

/**
 * Get all pages from the connected browser.
 */
export async function getAllPages(cdpUrl: string): Promise<Page[]> {
  const browser = await connectBrowser(cdpUrl);
  const pages = browser.contexts().flatMap((c) => c.pages());
  
  // Ensure state tracking for all pages
  for (const page of pages) {
    ensurePageState(page);
  }
  
  return pages;
}

/**
 * Get a specific page by target ID, or the first page if no target ID is provided.
 * Also restores roleRefs from cache if available.
 */
export async function getPage(cdpUrl: string, targetId?: string): Promise<Page> {
  const pages = await getAllPages(cdpUrl);
  
  if (pages.length === 0) {
    throw new Error("No pages available in the connected browser.");
  }

  let page: Page | undefined;
  let resolvedTargetId: string | null = null;

  // 优先使用 lastTargetId 粘性选择（保持 snapshot -> action 连贯性）
  if (!targetId) {
    const globalState = getGlobalState();
    const stickyId = globalState.lastTargetId;

    if (stickyId) {
      // 尝试找到 lastTargetId 对应的页面
      for (const p of pages) {
        const tid = await getPageTargetId(p);
        if (tid === stickyId) {
          page = p;
          resolvedTargetId = tid;
          break;
        }
      }
    }

    // 如果粘性选择找不到，fallback 到第一个页面
    if (!page) {
      page = pages[0];
      resolvedTargetId = await getPageTargetId(page);
    }
  } else {
    // Find page by target ID
    for (const p of pages) {
      const tid = await getPageTargetId(p);
      if (tid === targetId) {
        page = p;
        resolvedTargetId = tid;
        break;
      }
    }

    // Fallback: if only one page exists, return it
    if (!page && pages.length === 1) {
      page = pages[0];
      resolvedTargetId = await getPageTargetId(page);
    }

    if (!page) {
      throw new Error(`Tab with targetId "${targetId}" not found`);
    }
  }

  // Restore roleRefs from cache if page state doesn't have them
  const pageState = ensurePageState(page);
  const globalState2 = getGlobalState();
  if (!pageState.roleRefs && resolvedTargetId) {
    const cachedRefs = globalState2.roleRefsByTarget.get(roleRefsKey(cdpUrl, resolvedTargetId));
    if (cachedRefs) {
      pageState.roleRefs = cachedRefs;
      pageState.roleRefsTargetId = resolvedTargetId;
      pageState.roleRefsCdpUrl = normalizeCdpUrl(cdpUrl);
    }
  }

  // 更新粘性标签页选择
  if (resolvedTargetId) {
    getGlobalState().lastTargetId = resolvedTargetId;
  }

  return page;
}

/**
 * Store role refs for a page (e.g., { e1: { role: "button", name: "Submit" } }).
 */
export async function storeRoleRefs(page: Page, refs: RoleRefMap): Promise<void> {
  const pageState = ensurePageState(page);
  pageState.roleRefs = refs;
  pageState.roleRefsTargetId = undefined;
  pageState.roleRefsCdpUrl = undefined;
}

/**
 * Store role refs and cache by targetId for cross-request stability.
 */
export async function storeRoleRefsForTarget(opts: {
  page: Page;
  cdpUrl: string;
  targetId?: string;
  refs: RoleRefMap;
}): Promise<void> {
  const pageState = ensurePageState(opts.page);
  pageState.roleRefs = opts.refs;

  const normalizedCdpUrl = opts.cdpUrl?.trim();
  if (!normalizedCdpUrl) {
    return;
  }

  let targetId = opts.targetId?.trim();
  if (!targetId) {
    targetId = (await getPageTargetId(opts.page)) ?? undefined;
  }
  if (!targetId) {
    return;
  }

  const globalState = getGlobalState();
  globalState.roleRefsByTarget.set(roleRefsKey(normalizedCdpUrl, targetId), opts.refs);
  pageState.roleRefsTargetId = targetId;
  pageState.roleRefsCdpUrl = normalizeCdpUrl(normalizedCdpUrl);
  while (globalState.roleRefsByTarget.size > MAX_ROLE_REFS_CACHE) {
    const first = globalState.roleRefsByTarget.keys().next();
    if (first.done) break;
    globalState.roleRefsByTarget.delete(first.value);
  }
}

/**
 * Restore role refs from cache by targetId.
 */
export async function restoreRoleRefsForTarget(opts: {
  page: Page;
  cdpUrl: string;
  targetId?: string;
}): Promise<void> {
  const normalizedCdpUrl = opts.cdpUrl?.trim();
  if (!normalizedCdpUrl) {
    return;
  }

  let targetId = opts.targetId?.trim();
  if (!targetId) {
    targetId = (await getPageTargetId(opts.page)) ?? undefined;
  }
  if (!targetId) {
    return;
  }

  const globalState = getGlobalState();
  const cachedRefs = globalState.roleRefsByTarget.get(roleRefsKey(normalizedCdpUrl, targetId));
  if (!cachedRefs) {
    return;
  }

  const pageState = ensurePageState(opts.page);
  if (!pageState.roleRefs) {
    pageState.roleRefs = cachedRefs;
    pageState.roleRefsTargetId = targetId;
    pageState.roleRefsCdpUrl = normalizeCdpUrl(normalizedCdpUrl);
  }
}

/**
 * Get role refs stored for a page.
 */
export function getRoleRefs(page: Page): RoleRefMap | undefined {
  return pageStates.get(page)?.roleRefs;
}

/**
 * Create a Playwright Locator from a role ref (e.g., "e1", "@e2", "ref=e3").
 */
export function refLocator(page: Page, ref: string): Locator {
  // Normalize ref format (remove @, ref= prefixes)
  const normalized = ref.startsWith("@")
    ? ref.slice(1)
    : ref.startsWith("ref=")
      ? ref.slice(4)
      : ref;

  // Handle role-based refs (e1, e2, etc.)
  if (/^e\d+$/.test(normalized)) {
    const pageState = pageStates.get(page);
    const info = pageState?.roleRefs?.[normalized];

    if (!info) {
      throw new Error(
        `Unknown ref "${normalized}". Run a new snapshot and use a ref from that snapshot.`
      );
    }

    // Build locator using getByRole
    const locator = info.name
      ? page.getByRole(info.role as Parameters<Page["getByRole"]>[0], { 
          name: info.name, 
          exact: true 
        })
      : page.getByRole(info.role as Parameters<Page["getByRole"]>[0]);

    return info.nth !== undefined ? locator.nth(info.nth) : locator;
  }

  // Fallback to aria-ref for non-role refs
  return page.locator(`aria-ref=${normalized}`);
}

/**
 * Get console messages captured from a page.
 */
export function getConsoleMessages(page: Page): BrowserConsoleMessage[] {
  return pageStates.get(page)?.console ?? [];
}

/**
 * Get page errors captured from a page.
 */
export function getPageErrors(page: Page): BrowserPageError[] {
  return pageStates.get(page)?.errors ?? [];
}

/**
 * Clear the cached browser connection.
 */
export async function disconnectBrowser(): Promise<void> {
  const state = getGlobalState();
  const cur = state.cached;
  state.cached = null;
  if (cur?.browser.isConnected()) {
    await cur.browser.close().catch(() => {});
  }
}
