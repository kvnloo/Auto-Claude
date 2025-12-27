/**
 * IPC Handlers Module Index
 *
 * This module exports a single setup function that registers all IPC handlers
 * organized by domain into separate handler modules.
 */

import type { BrowserWindow } from 'electron';
import { AgentManager } from '../agent';
import { TerminalManager } from '../terminal-manager';
import { PythonEnvManager } from '../python-env-manager';

// Import all handler registration functions
import { registerProjectHandlers } from './project-handlers';
import { registerTaskHandlers } from './task-handlers';
import { registerTerminalHandlers } from './terminal-handlers';
import { registerAgenteventsHandlers } from './agent-events-handlers';
import { registerSettingsHandlers } from './settings-handlers';
import { registerFileHandlers } from './file-handlers';
import { registerRoadmapHandlers } from './roadmap-handlers';
import { registerContextHandlers } from './context-handlers';
import { registerEnvHandlers } from './env-handlers';
import { registerLinearHandlers } from './linear-handlers';
import { registerGithubHandlers } from './github-handlers';
import { registerAutobuildSourceHandlers } from './autobuild-source-handlers';
import { registerIdeationHandlers } from './ideation-handlers';
import { registerChangelogHandlers } from './changelog-handlers';
import { registerInsightsHandlers } from './insights-handlers';
import { registerMemoryHandlers } from './memory-handlers';
import { registerAppUpdateHandlers } from './app-update-handlers';
import { notificationService } from '../notification-service';

/**
 * Setup all IPC handlers across all domains
 *
 * @param agentManager - The agent manager instance (null for secondary instances in multi-instance mode)
 * @param terminalManager - The terminal manager instance
 * @param getMainWindow - Function to get the main BrowserWindow
 * @param pythonEnvManager - The Python environment manager instance
 */
export function setupIpcHandlers(
  agentManager: AgentManager | null,
  terminalManager: TerminalManager,
  getMainWindow: () => BrowserWindow | null,
  pythonEnvManager: PythonEnvManager
): void {
  // Initialize notification service
  notificationService.initialize(getMainWindow);

  // Determine if we're running in primary mode (has AgentManager) or secondary mode (client mode)
  const isPrimaryInstance = agentManager !== null;

  // File explorer handlers (work in both modes)
  registerFileHandlers();

  // Terminal and Claude profile handlers (work in both modes)
  registerTerminalHandlers(terminalManager, getMainWindow);

  // Context and memory handlers (work in both modes)
  registerContextHandlers(getMainWindow);

  // Environment configuration handlers (work in both modes)
  registerEnvHandlers(getMainWindow);

  // Changelog handlers (work in both modes)
  registerChangelogHandlers(getMainWindow);

  // Insights handlers (work in both modes)
  registerInsightsHandlers(getMainWindow);

  // Memory & infrastructure handlers (work in both modes)
  registerMemoryHandlers();

  // App auto-update handlers (work in both modes)
  registerAppUpdateHandlers();

  // Auto-build source update handlers (work in both modes)
  registerAutobuildSourceHandlers(getMainWindow);

  // Handlers that require AgentManager (primary instance only)
  if (isPrimaryInstance) {
    // Project handlers (including Python environment setup)
    registerProjectHandlers(pythonEnvManager, agentManager, getMainWindow);

    // Task handlers
    registerTaskHandlers(agentManager, pythonEnvManager, getMainWindow);

    // Agent event handlers (event forwarding from agent manager to renderer)
    registerAgenteventsHandlers(agentManager, getMainWindow);

    // Settings and dialog handlers
    registerSettingsHandlers(agentManager, getMainWindow);

    // Roadmap handlers
    registerRoadmapHandlers(agentManager, getMainWindow);

    // Linear integration handlers
    registerLinearHandlers(agentManager, getMainWindow);

    // GitHub integration handlers
    registerGithubHandlers(agentManager, getMainWindow);

    // Ideation handlers
    registerIdeationHandlers(agentManager, getMainWindow);
  } else {
    // Secondary instance (client mode) - register limited handlers
    // Note: In future subtasks, these handlers will proxy requests to the primary backend via API
    console.warn('[IPC] Secondary instance: Agent-dependent handlers not registered');
    console.warn('[IPC] Task updates will be received via WebSocket from primary backend');
  }

  const mode = isPrimaryInstance ? 'primary' : 'secondary (client mode)';
  console.warn(`[IPC] Handler modules registered (${mode})`);
}

// Re-export all individual registration functions for potential custom usage
export {
  registerProjectHandlers,
  registerTaskHandlers,
  registerTerminalHandlers,
  registerAgenteventsHandlers,
  registerSettingsHandlers,
  registerFileHandlers,
  registerRoadmapHandlers,
  registerContextHandlers,
  registerEnvHandlers,
  registerLinearHandlers,
  registerGithubHandlers,
  registerAutobuildSourceHandlers,
  registerIdeationHandlers,
  registerChangelogHandlers,
  registerInsightsHandlers,
  registerMemoryHandlers,
  registerAppUpdateHandlers
};
