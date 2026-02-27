/**
 * Browser Control Snapshot Module for FlashClaw
 *
 * Provides page snapshot capabilities:
 * - AI Snapshot: Structured page description via Playwright's _snapshotForAI
 * - ARIA Snapshot: Accessibility tree via CDP
 * - Text Extraction: Page text or HTML content
 */

import type { Page } from "playwright-core";
import { storeRoleRefsForTarget, type RoleRefMap } from "./session.js";
import { buildRoleSnapshotFromAiSnapshot } from "./role-refs.js";

// ============================================================================
// Types
// ============================================================================

/** ARIA accessibility tree node */
export type AriaSnapshotNode = {
  role: string;
  name?: string;
  value?: string;
  description?: string;
  children?: AriaSnapshotNode[];
};

/** Raw accessibility node from CDP */
type RawAXNode = {
  nodeId: string;
  role?: { value?: string };
  name?: { value?: string };
  value?: { value?: string };
  description?: { value?: string };
  parentId?: string;
  childIds?: string[];
  ignored?: boolean;
};

/** Page with internal _snapshotForAI method */
type PageWithSnapshotForAI = Page & {
  _snapshotForAI?: (opts: {
    timeout?: number;
    track?: string;
  }) => Promise<{ full?: string }>;
};

// ============================================================================
// AI Snapshot
// ============================================================================

/**
 * Get AI-optimized page snapshot using Playwright's _snapshotForAI.
 * Returns structured page description with element references.
 */
export async function snapshotAi(
  page: Page,
  options?: { maxChars?: number; timeout?: number; cdpUrl?: string; targetId?: string }
): Promise<{ snapshot: string; truncated?: boolean; refs: RoleRefMap }> {
  const maybe = page as PageWithSnapshotForAI;

  if (!maybe._snapshotForAI) {
    throw new Error(
      "Playwright _snapshotForAI is not available. Please upgrade playwright-core to 1.49+."
    );
  }

  const timeout = Math.max(500, Math.min(60_000, options?.timeout ?? 5000));
  const result = await maybe._snapshotForAI({ timeout, track: "response" });

  let snapshot = String(result?.full ?? "");
  let truncated = false;

  // Apply max chars limit if specified
  const maxChars = options?.maxChars;
  if (
    typeof maxChars === "number" &&
    Number.isFinite(maxChars) &&
    maxChars > 0 &&
    snapshot.length > maxChars
  ) {
    snapshot = `${snapshot.slice(0, maxChars)}\n\n[...TRUNCATED - page content exceeds ${maxChars} characters]`;
    truncated = true;
  }

  // Build role refs from snapshot
  const built = buildRoleSnapshotFromAiSnapshot(snapshot);
  await storeRoleRefsForTarget({
    page,
    cdpUrl: options?.cdpUrl ?? "",
    targetId: options?.targetId,
    refs: built.refs,
  });

  return truncated
    ? { snapshot, truncated, refs: built.refs }
    : { snapshot, refs: built.refs };
}

// ============================================================================
// ARIA Snapshot
// ============================================================================

/**
 * Format raw accessibility nodes into structured ARIA tree.
 */
function formatAriaNodes(
  nodes: RawAXNode[],
  limit: number
): AriaSnapshotNode[] {
  const nodeMap = new Map<string, RawAXNode>();
  const rootIds: string[] = [];

  // Index nodes by ID
  for (const node of nodes) {
    if (node.ignored) continue;
    nodeMap.set(node.nodeId, node);
    if (!node.parentId) {
      rootIds.push(node.nodeId);
    }
  }

  let count = 0;

  // Recursively build tree
  function buildNode(nodeId: string): AriaSnapshotNode | null {
    if (count >= limit) return null;

    const raw = nodeMap.get(nodeId);
    if (!raw) return null;

    count++;

    const node: AriaSnapshotNode = {
      role: raw.role?.value ?? "unknown",
    };

    if (raw.name?.value) node.name = raw.name.value;
    if (raw.value?.value) node.value = raw.value.value;
    if (raw.description?.value) node.description = raw.description.value;

    if (raw.childIds?.length) {
      const children: AriaSnapshotNode[] = [];
      for (const childId of raw.childIds) {
        if (count >= limit) break;
        const child = buildNode(childId);
        if (child) children.push(child);
      }
      if (children.length) node.children = children;
    }

    return node;
  }

  const result: AriaSnapshotNode[] = [];
  for (const rootId of rootIds) {
    if (count >= limit) break;
    const node = buildNode(rootId);
    if (node) result.push(node);
  }

  return result;
}

/**
 * Get ARIA accessibility tree snapshot via CDP.
 */
export async function snapshotAria(
  page: Page,
  options?: { limit?: number }
): Promise<{ nodes: AriaSnapshotNode[] }> {
  const limit = Math.max(1, Math.min(2000, Math.floor(options?.limit ?? 500)));

  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Accessibility.enable").catch(() => {});

    const res = (await session.send("Accessibility.getFullAXTree")) as {
      nodes?: RawAXNode[];
    };

    const rawNodes = Array.isArray(res?.nodes) ? res.nodes : [];
    return { nodes: formatAriaNodes(rawNodes, limit) };
  } finally {
    await session.detach().catch(() => {});
  }
}

// ============================================================================
// Text Extraction
// ============================================================================

/**
 * Get page text content or HTML.
 */
export async function getPageText(
  page: Page,
  options?: { html?: boolean; selector?: string }
): Promise<string> {
  const selector = options?.selector?.trim() || "body";

  if (options?.html) {
    // Get outer HTML
    return page.locator(selector).evaluate((el) => el.outerHTML);
  }

  // Get text content
  const text = await page.locator(selector).innerText();
  return text.trim();
}
