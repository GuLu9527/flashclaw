#!/usr/bin/env node
/**
 * Post-install script to create FlashClaw user configuration directories.
 * This script runs after npm install to ensure necessary directories exist.
 */

async function run() {
  try {
    const { ensureDirectories } = await import('../dist/paths.js');
    ensureDirectories();
    console.log('✓ FlashClaw directories initialized');
  } catch (error) {
    // Silently fail if dist is not built yet (e.g., during development)
    // The directories will be created when the app runs
    if (error && error.code !== 'MODULE_NOT_FOUND') {
      console.warn('Warning: Could not initialize FlashClaw directories:', error.message);
    }
  }
}

run();
