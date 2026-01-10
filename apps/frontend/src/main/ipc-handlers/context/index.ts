import type { BrowserWindow } from 'electron';
import { registerProjectContextHandlers } from './project-context-handlers';
import { registerMemoryStatusHandlers } from './memory-status-handlers';
import { registerMemoryDataHandlers } from './memory-data-handlers';
import { registerDependencyGraphHandlers } from './dependency-graph-handlers';

/**
 * Register all context-related IPC handlers
 */
export function registerContextHandlers(
  getMainWindow: () => BrowserWindow | null
): void {
  registerProjectContextHandlers(getMainWindow);
  registerMemoryStatusHandlers(getMainWindow);
  registerMemoryDataHandlers(getMainWindow);
  registerDependencyGraphHandlers(getMainWindow);
}

// Re-export utility functions for testing or external use
export * from './utils';
export * from './memory-status-handlers';
export * from './memory-data-handlers';
export * from './project-context-handlers';
export * from './dependency-graph-handlers';
