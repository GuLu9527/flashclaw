/**
 * Browser Control Storage Module for FlashClaw
 * 
 * Provides storage operations (Cookie, LocalStorage, SessionStorage)
 * for browser automation via Playwright.
 */

import type { Page, Cookie } from "playwright-core";

// ============================================================================
// Types
// ============================================================================

/** Cookie input for setting a new cookie */
export type CookieInput = {
  name: string;
  value: string;
  url?: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Lax" | "None" | "Strict";
};

/** Storage kind for localStorage or sessionStorage */
type StorageKind = "local" | "session";

// ============================================================================
// Cookie Operations
// ============================================================================

/**
 * Get cookies from the browser context.
 * @param page - Playwright Page instance
 * @param urls - Optional URLs to filter cookies by
 * @returns Array of cookies
 */
export async function getCookies(
  page: Page,
  urls?: string | string[]
): Promise<Cookie[]> {
  const urlArray = urls 
    ? (Array.isArray(urls) ? urls : [urls]) 
    : undefined;
  return await page.context().cookies(urlArray);
}

/**
 * Set a cookie in the browser context.
 * @param page - Playwright Page instance
 * @param cookie - Cookie to set (requires name, value, and url OR domain+path)
 */
export async function setCookie(page: Page, cookie: CookieInput): Promise<void> {
  if (!cookie.name || cookie.value === undefined) {
    throw new Error("Cookie name and value are required");
  }

  const hasUrl = typeof cookie.url === "string" && cookie.url.trim();
  const hasDomainPath =
    typeof cookie.domain === "string" &&
    cookie.domain.trim() &&
    typeof cookie.path === "string" &&
    cookie.path.trim();

  if (!hasUrl && !hasDomainPath) {
    throw new Error("Cookie requires url, or domain+path");
  }

  await page.context().addCookies([cookie as Cookie]);
}

/**
 * Clear all cookies from the browser context.
 * @param page - Playwright Page instance
 */
export async function clearCookies(page: Page): Promise<void> {
  await page.context().clearCookies();
}

// ============================================================================
// Storage Operations (Internal)
// ============================================================================

async function getStorage(
  page: Page,
  kind: StorageKind,
  key?: string
): Promise<Record<string, string>> {
  return await page.evaluate(
    ({ kind: k, key: targetKey }) => {
      const store = k === "session" ? window.sessionStorage : window.localStorage;
      
      if (targetKey) {
        const value = store.getItem(targetKey);
        return value === null ? {} : { [targetKey]: value };
      }

      const result: Record<string, string> = {};
      for (let i = 0; i < store.length; i++) {
        const itemKey = store.key(i);
        if (itemKey) {
          const value = store.getItem(itemKey);
          if (value !== null) {
            result[itemKey] = value;
          }
        }
      }
      return result;
    },
    { kind, key }
  );
}

async function setStorage(
  page: Page,
  kind: StorageKind,
  key: string,
  value: string
): Promise<void> {
  if (!key) {
    throw new Error("Storage key is required");
  }

  await page.evaluate(
    ({ kind: k, key: itemKey, value: itemValue }) => {
      const store = k === "session" ? window.sessionStorage : window.localStorage;
      store.setItem(itemKey, itemValue);
    },
    { kind, key, value: String(value ?? "") }
  );
}

async function clearStorage(page: Page, kind: StorageKind): Promise<void> {
  await page.evaluate(
    ({ kind: k }) => {
      const store = k === "session" ? window.sessionStorage : window.localStorage;
      store.clear();
    },
    { kind }
  );
}

// ============================================================================
// LocalStorage Operations
// ============================================================================

/**
 * Get localStorage values.
 * @param page - Playwright Page instance
 * @param key - Optional specific key to get (returns all if omitted)
 */
export async function getLocalStorage(
  page: Page,
  key?: string
): Promise<Record<string, string>> {
  return getStorage(page, "local", key);
}

/**
 * Set a localStorage value.
 * @param page - Playwright Page instance
 * @param key - Storage key
 * @param value - Value to store
 */
export async function setLocalStorage(
  page: Page,
  key: string,
  value: string
): Promise<void> {
  return setStorage(page, "local", key, value);
}

/**
 * Clear all localStorage.
 * @param page - Playwright Page instance
 */
export async function clearLocalStorage(page: Page): Promise<void> {
  return clearStorage(page, "local");
}

// ============================================================================
// SessionStorage Operations
// ============================================================================

/**
 * Get sessionStorage values.
 * @param page - Playwright Page instance
 * @param key - Optional specific key to get (returns all if omitted)
 */
export async function getSessionStorage(
  page: Page,
  key?: string
): Promise<Record<string, string>> {
  return getStorage(page, "session", key);
}

/**
 * Set a sessionStorage value.
 * @param page - Playwright Page instance
 * @param key - Storage key
 * @param value - Value to store
 */
export async function setSessionStorage(
  page: Page,
  key: string,
  value: string
): Promise<void> {
  return setStorage(page, "session", key, value);
}

/**
 * Clear all sessionStorage.
 * @param page - Playwright Page instance
 */
export async function clearSessionStorage(page: Page): Promise<void> {
  return clearStorage(page, "session");
}
