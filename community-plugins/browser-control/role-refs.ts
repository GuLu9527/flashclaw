/**
 * Role-based Element Reference Utilities for FlashClaw
 *
 * Parses Playwright AI snapshots and extracts element references (e1, e2, etc.)
 * for use with page interactions.
 */

import type { RoleRefMap } from "./session.js";

// ============================================================================
// Constants
// ============================================================================

/** Interactive ARIA roles that should always have refs */
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "treeitem",
]);

/** Structural roles that can be filtered out in compact mode */
const STRUCTURAL_ROLES = new Set([
  "generic",
  "group",
  "list",
  "table",
  "row",
  "rowgroup",
  "grid",
  "treegrid",
  "menu",
  "menubar",
  "toolbar",
  "tablist",
  "tree",
  "directory",
  "document",
  "application",
  "presentation",
  "none",
]);

// ============================================================================
// Types
// ============================================================================

export type RoleSnapshotOptions = {
  /** Only include interactive elements */
  interactive?: boolean;
  /** Maximum depth to include (0 = root only) */
  maxDepth?: number;
  /** Remove unnamed structural elements */
  compact?: boolean;
};

// ============================================================================
// Helper Functions
// ============================================================================

/** Get indentation level (2 spaces per level) */
function getIndentLevel(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? Math.floor(match[1].length / 2) : 0;
}

/** Extract ref from suffix string like "[ref=e13]" */
function parseRefFromSuffix(suffix: string): string | null {
  const match = suffix.match(/\[ref=(e\d+)\]/i);
  return match ? match[1] : null;
}

/** Remove empty branches from tree */
function compactTree(tree: string): string {
  const lines = tree.split("\n");
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Always keep lines with refs
    if (line.includes("[ref=")) {
      result.push(line);
      continue;
    }
    
    // Keep content lines (with value after colon)
    if (line.includes(":") && !line.trimEnd().endsWith(":")) {
      result.push(line);
      continue;
    }

    // Check if this line has relevant children
    const currentIndent = getIndentLevel(line);
    let hasRelevantChildren = false;
    
    for (let j = i + 1; j < lines.length; j++) {
      const childIndent = getIndentLevel(lines[j]);
      if (childIndent <= currentIndent) break;
      if (lines[j]?.includes("[ref=")) {
        hasRelevantChildren = true;
        break;
      }
    }
    
    if (hasRelevantChildren) {
      result.push(line);
    }
  }

  return result.join("\n");
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Build role snapshot from Playwright's AI snapshot output.
 * Extracts refs (e1, e2, etc.) from the snapshot for element interactions.
 */
export function buildRoleSnapshotFromAiSnapshot(
  aiSnapshot: string,
  options: RoleSnapshotOptions = {}
): { snapshot: string; refs: RoleRefMap } {
  const lines = String(aiSnapshot ?? "").split("\n");
  const refs: RoleRefMap = {};

  // Interactive-only mode: flatten to list
  if (options.interactive) {
    const out: string[] = [];
    
    for (const line of lines) {
      const depth = getIndentLevel(line);
      if (options.maxDepth !== undefined && depth > options.maxDepth) continue;

      // Parse line: "  - role \"name\" [ref=e1]..."
      const match = line.match(/^(\s*-\s*)(\w+)(?:\s+"([^"]*)")?(.*)$/);
      if (!match) continue;

      const [, , roleRaw, name, suffix] = match;
      if (roleRaw.startsWith("/")) continue;

      const role = roleRaw.toLowerCase();
      if (!INTERACTIVE_ROLES.has(role)) continue;

      const ref = parseRefFromSuffix(suffix);
      if (!ref) continue;

      refs[ref] = { role, ...(name ? { name } : {}) };
      out.push(`- ${roleRaw}${name ? ` "${name}"` : ""}${suffix}`);
    }

    return {
      snapshot: out.join("\n") || "(no interactive elements)",
      refs,
    };
  }

  // Full tree mode
  const out: string[] = [];
  
  for (const line of lines) {
    const depth = getIndentLevel(line);
    if (options.maxDepth !== undefined && depth > options.maxDepth) continue;

    const match = line.match(/^(\s*-\s*)(\w+)(?:\s+"([^"]*)")?(.*)$/);
    if (!match) {
      out.push(line);
      continue;
    }

    const [, , roleRaw, name, suffix] = match;
    if (roleRaw.startsWith("/")) {
      out.push(line);
      continue;
    }

    const role = roleRaw.toLowerCase();
    
    // In compact mode, skip unnamed structural elements
    if (options.compact && STRUCTURAL_ROLES.has(role) && !name) {
      continue;
    }

    // Extract ref if present
    const ref = parseRefFromSuffix(suffix);
    if (ref) {
      refs[ref] = { role, ...(name ? { name } : {}) };
    }

    out.push(line);
  }

  const tree = out.join("\n") || "(empty)";
  
  return {
    snapshot: options.compact ? compactTree(tree) : tree,
    refs,
  };
}
