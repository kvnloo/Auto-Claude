/**
 * Autonomous Mode IPC Handlers
 *
 * Handles communication between renderer and main process for autonomous mode operations.
 * Follows the GitHub handlers pattern for consistency with the existing codebase.
 *
 * Operations:
 * - Start/Stop/Pause/Resume queue
 * - Get queue status and task list
 * - Add/Remove tasks
 * - Get/Save autonomous mode settings
 *
 * Events (forwarded to renderer):
 * - Progress updates
 * - Task completion/failure
 * - Queue status changes
 * - Errors
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type {
  AutonomousTask,
  QueueStatus,
  SessionStats,
  TaskProgress,
  QueuePauseReason
} from '../../shared/types/autonomous';
import type { AutonomousModeSettings } from '../../shared/types/settings';
import type { IPCResult } from '../../shared/types';
import {
  getAutonomousQueueManager,
  type AutonomousQueueManager
} from '../services/autonomous-queue-manager';
import { debugLog, debugError } from '../../shared/utils/debug-logger';
import type { PythonEnvManager } from '../python-env-manager';
import { getEffectiveSourcePath } from '../updater/path-resolver';

// ============================================
// Settings Persistence
// ============================================

/**
 * Autonomous mode settings are stored in the project's .auto-claude directory
 * as autonomous-settings.json
 */
import path from 'path';
import fs from 'fs';
import { projectStore } from '../project-store';

const SETTINGS_FILE = 'autonomous-settings.json';

/**
 * Get the settings file path for a project
 */
function getSettingsPath(projectPath: string): string {
  return path.join(projectPath, '.auto-claude', SETTINGS_FILE);
}

/**
 * Load autonomous mode settings for a project
 */
function loadSettings(projectPath: string): AutonomousModeSettings | null {
  const settingsPath = getSettingsPath(projectPath);
  try {
    const data = fs.readFileSync(settingsPath, 'utf-8');
    return JSON.parse(data) as AutonomousModeSettings;
  } catch {
    // Settings file doesn't exist or is invalid
    return null;
  }
}

/**
 * Save autonomous mode settings for a project
 */
function saveSettings(projectPath: string, settings: AutonomousModeSettings): void {
  const settingsPath = getSettingsPath(projectPath);
  const dir = path.dirname(settingsPath);

  // Ensure directory exists
  fs.mkdirSync(dir, { recursive: true });

  // Write settings
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

/**
 * Get default autonomous mode settings
 */
function getDefaultSettings(): AutonomousModeSettings {
  return {
    enabled: false,
    maxConcurrentTasks: 1,
    maxConsecutiveFailures: 3,
    sessionTimeLimitMinutes: 240, // 4 hours
    pollIntervalSeconds: 60,
    tokenBudget: undefined
  };
}

// ============================================
// Event Forwarding
// ============================================

/**
 * Setup event forwarding from the queue manager to the renderer process.
 * Events are sent via IPC to keep the UI in sync with queue state.
 */
function setupEventForwarding(
  queueManager: AutonomousQueueManager,
  getMainWindow: () => BrowserWindow | null
): void {
  // Helper to send events to renderer
  const sendToRenderer = (channel: string, ...args: unknown[]): void => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args);
    }
  };

  // Forward queue started event
  queueManager.on('queue-started', () => {
    debugLog('[AutonomousHandlers] Queue started');
    sendToRenderer(IPC_CHANNELS.AUTONOMOUS_PROGRESS, {
      type: 'queue_started',
      timestamp: new Date()
    });
  });

  // Forward queue stopped event
  queueManager.on('queue-stopped', (stats: SessionStats) => {
    debugLog('[AutonomousHandlers] Queue stopped', stats);
    sendToRenderer(IPC_CHANNELS.AUTONOMOUS_PROGRESS, {
      type: 'queue_stopped',
      timestamp: new Date(),
      payload: { stats }
    });
  });

  // Forward queue paused event
  queueManager.on('queue-paused', (reason: QueuePauseReason, stats: SessionStats) => {
    debugLog('[AutonomousHandlers] Queue paused', { reason, stats });
    sendToRenderer(IPC_CHANNELS.AUTONOMOUS_PROGRESS, {
      type: 'queue_paused',
      timestamp: new Date(),
      payload: { reason, stats }
    });
  });

  // Forward queue resumed event
  queueManager.on('queue-resumed', () => {
    debugLog('[AutonomousHandlers] Queue resumed');
    sendToRenderer(IPC_CHANNELS.AUTONOMOUS_PROGRESS, {
      type: 'queue_resumed',
      timestamp: new Date()
    });
  });

  // Forward task started event
  queueManager.on('task-started', (task: AutonomousTask) => {
    debugLog('[AutonomousHandlers] Task started', { taskId: task.id });
    sendToRenderer(IPC_CHANNELS.AUTONOMOUS_PROGRESS, {
      type: 'task_started',
      timestamp: new Date(),
      taskId: task.id,
      payload: { task }
    });
  });

  // Forward task progress event
  queueManager.on('task-progress', (progress: TaskProgress) => {
    sendToRenderer(IPC_CHANNELS.AUTONOMOUS_PROGRESS, {
      type: 'task_progress',
      timestamp: new Date(),
      taskId: progress.taskId,
      payload: { progress }
    });
  });

  // Forward task completed event
  queueManager.on('task-completed', (task: AutonomousTask, prUrl?: string) => {
    debugLog('[AutonomousHandlers] Task completed', { taskId: task.id, prUrl });
    sendToRenderer(IPC_CHANNELS.AUTONOMOUS_TASK_COMPLETE, {
      type: 'task_completed',
      timestamp: new Date(),
      taskId: task.id,
      payload: { task, pullRequestUrl: prUrl }
    });
  });

  // Forward task failed event
  queueManager.on('task-failed', (task: AutonomousTask, error: string) => {
    debugLog('[AutonomousHandlers] Task failed', { taskId: task.id, error });
    sendToRenderer(IPC_CHANNELS.AUTONOMOUS_TASK_FAILED, {
      type: 'task_failed',
      timestamp: new Date(),
      taskId: task.id,
      payload: { task, error }
    });
  });

  // Forward status update event
  queueManager.on('status-update', (status: QueueStatus) => {
    sendToRenderer(IPC_CHANNELS.AUTONOMOUS_PROGRESS, {
      type: 'status_updated',
      timestamp: new Date(),
      payload: { status }
    });
  });

  // Forward rate limit event
  queueManager.on('rate-limit', (resetTime: Date) => {
    debugLog('[AutonomousHandlers] Rate limit hit', { resetTime });
    sendToRenderer(IPC_CHANNELS.AUTONOMOUS_PROGRESS, {
      type: 'rate_limit_hit',
      timestamp: new Date(),
      payload: { resetAt: resetTime }
    });
  });

  // Forward error event
  queueManager.on('queue-error', (error: string) => {
    debugError('[AutonomousHandlers] Queue error', error);
    sendToRenderer(IPC_CHANNELS.AUTONOMOUS_ERROR, {
      type: 'error',
      timestamp: new Date(),
      payload: { error }
    });
  });

  debugLog('[AutonomousHandlers] Event forwarding setup complete');
}

// ============================================
// Handler Registration
// ============================================

let eventForwardingSetup = false;

/**
 * Register all autonomous mode IPC handlers
 *
 * @param pythonEnvManager - Python environment manager for path configuration
 * @param getMainWindow - Function to get the main BrowserWindow
 */
export function registerAutonomousHandlers(
  pythonEnvManager: PythonEnvManager,
  getMainWindow: () => BrowserWindow | null
): void {
  debugLog('[AutonomousHandlers] Registering handlers');

  // Get the queue manager singleton
  const queueManager = getAutonomousQueueManager();

  // Setup event forwarding (only once)
  if (!eventForwardingSetup) {
    setupEventForwarding(queueManager, getMainWindow);
    eventForwardingSetup = true;
  }

  // ============================================
  // Queue Control Operations
  // ============================================

  /**
   * Start the autonomous queue
   */
  ipcMain.handle(
    IPC_CHANNELS.AUTONOMOUS_START,
    async (_, projectId: string): Promise<IPCResult<QueueStatus>> => {
      debugLog('[AutonomousHandlers] Start requested', { projectId });

      try {
        const project = projectStore.getProject(projectId);
        if (!project) {
          return { success: false, error: 'Project not found' };
        }

        // Load settings for project
        const settings = loadSettings(project.path) ?? getDefaultSettings();

        // Get paths using the proper approach from python env manager and path resolver
        const autoBuildSourcePath = getEffectiveSourcePath();
        if (!autoBuildSourcePath) {
          return { success: false, error: 'Auto-build source path not configured' };
        }

        const pythonPath = pythonEnvManager.getPythonPath() || 'python3';

        // Configure the queue manager
        queueManager.configure(pythonPath, autoBuildSourcePath, project.path);
        queueManager.updateSettings(settings);

        // Start the queue
        await queueManager.start();

        const status = queueManager.getStatus();
        return { success: true, data: status };
      } catch (error) {
        debugError('[AutonomousHandlers] Start failed', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to start autonomous queue'
        };
      }
    }
  );

  /**
   * Stop the autonomous queue
   */
  ipcMain.handle(
    IPC_CHANNELS.AUTONOMOUS_STOP,
    async (): Promise<IPCResult<SessionStats>> => {
      debugLog('[AutonomousHandlers] Stop requested');

      try {
        await queueManager.stop();
        const stats = queueManager.getSessionStats();
        return { success: true, data: stats };
      } catch (error) {
        debugError('[AutonomousHandlers] Stop failed', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to stop autonomous queue'
        };
      }
    }
  );

  /**
   * Pause the autonomous queue
   */
  ipcMain.handle(
    IPC_CHANNELS.AUTONOMOUS_PAUSE,
    async (_, reason?: QueuePauseReason): Promise<IPCResult<QueueStatus>> => {
      debugLog('[AutonomousHandlers] Pause requested', { reason });

      try {
        await queueManager.pause(reason ?? 'user_requested');
        const status = queueManager.getStatus();
        return { success: true, data: status };
      } catch (error) {
        debugError('[AutonomousHandlers] Pause failed', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to pause autonomous queue'
        };
      }
    }
  );

  /**
   * Resume the autonomous queue
   */
  ipcMain.handle(
    IPC_CHANNELS.AUTONOMOUS_RESUME,
    async (): Promise<IPCResult<QueueStatus>> => {
      debugLog('[AutonomousHandlers] Resume requested');

      try {
        await queueManager.resume();
        const status = queueManager.getStatus();
        return { success: true, data: status };
      } catch (error) {
        debugError('[AutonomousHandlers] Resume failed', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to resume autonomous queue'
        };
      }
    }
  );

  // ============================================
  // Queue Status Operations
  // ============================================

  /**
   * Get current queue status
   */
  ipcMain.handle(
    IPC_CHANNELS.AUTONOMOUS_GET_STATUS,
    async (): Promise<IPCResult<QueueStatus>> => {
      try {
        const status = queueManager.getStatus();
        return { success: true, data: status };
      } catch (error) {
        debugError('[AutonomousHandlers] Get status failed', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get queue status'
        };
      }
    }
  );

  /**
   * Get all tasks in the queue
   */
  ipcMain.handle(
    IPC_CHANNELS.AUTONOMOUS_GET_QUEUE,
    async (): Promise<IPCResult<AutonomousTask[]>> => {
      try {
        const tasks = queueManager.getQueue();
        return { success: true, data: tasks };
      } catch (error) {
        debugError('[AutonomousHandlers] Get queue failed', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get queue'
        };
      }
    }
  );

  // ============================================
  // Task Management Operations
  // ============================================

  /**
   * Add a task to the queue
   */
  ipcMain.handle(
    IPC_CHANNELS.AUTONOMOUS_ADD_TASK,
    async (_, task: AutonomousTask): Promise<IPCResult<AutonomousTask>> => {
      debugLog('[AutonomousHandlers] Add task requested', { taskId: task.id });

      try {
        // Ensure dates are Date objects (they may come serialized as strings)
        const normalizedTask: AutonomousTask = {
          ...task,
          createdAt: new Date(task.createdAt),
          startedAt: task.startedAt ? new Date(task.startedAt) : undefined,
          completedAt: task.completedAt ? new Date(task.completedAt) : undefined
        };

        queueManager.addTask(normalizedTask);
        return { success: true, data: normalizedTask };
      } catch (error) {
        debugError('[AutonomousHandlers] Add task failed', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to add task'
        };
      }
    }
  );

  /**
   * Remove a task from the queue
   */
  ipcMain.handle(
    IPC_CHANNELS.AUTONOMOUS_REMOVE_TASK,
    async (_, taskId: string): Promise<IPCResult<boolean>> => {
      debugLog('[AutonomousHandlers] Remove task requested', { taskId });

      try {
        const removed = queueManager.removeTask(taskId);
        if (!removed) {
          return { success: false, error: 'Task not found in queue' };
        }
        return { success: true, data: true };
      } catch (error) {
        debugError('[AutonomousHandlers] Remove task failed', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to remove task'
        };
      }
    }
  );

  // ============================================
  // Settings Operations
  // ============================================

  /**
   * Get autonomous mode settings for a project
   */
  ipcMain.handle(
    IPC_CHANNELS.AUTONOMOUS_SETTINGS_GET,
    async (_, projectId: string): Promise<IPCResult<AutonomousModeSettings>> => {
      debugLog('[AutonomousHandlers] Get settings requested', { projectId });

      try {
        const project = projectStore.getProject(projectId);
        if (!project) {
          return { success: false, error: 'Project not found' };
        }

        const settings = loadSettings(project.path) ?? getDefaultSettings();
        return { success: true, data: settings };
      } catch (error) {
        debugError('[AutonomousHandlers] Get settings failed', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get settings'
        };
      }
    }
  );

  /**
   * Save autonomous mode settings for a project
   */
  ipcMain.handle(
    IPC_CHANNELS.AUTONOMOUS_SETTINGS_SAVE,
    async (_, projectId: string, settings: AutonomousModeSettings): Promise<IPCResult<boolean>> => {
      debugLog('[AutonomousHandlers] Save settings requested', { projectId, settings });

      try {
        const project = projectStore.getProject(projectId);
        if (!project) {
          return { success: false, error: 'Project not found' };
        }

        // Validate settings
        if (settings.maxConcurrentTasks < 1 || settings.maxConcurrentTasks > 3) {
          return { success: false, error: 'maxConcurrentTasks must be between 1 and 3' };
        }
        if (settings.maxConsecutiveFailures < 1 || settings.maxConsecutiveFailures > 5) {
          return { success: false, error: 'maxConsecutiveFailures must be between 1 and 5' };
        }
        if (settings.sessionTimeLimitMinutes < 60 || settings.sessionTimeLimitMinutes > 480) {
          return { success: false, error: 'sessionTimeLimitMinutes must be between 60 and 480' };
        }
        if (settings.pollIntervalSeconds < 30) {
          return { success: false, error: 'pollIntervalSeconds must be at least 30' };
        }

        // Save settings
        saveSettings(project.path, settings);

        // Update the queue manager if running
        queueManager.updateSettings(settings);

        return { success: true, data: true };
      } catch (error) {
        debugError('[AutonomousHandlers] Save settings failed', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save settings'
        };
      }
    }
  );

  debugLog('[AutonomousHandlers] All handlers registered');
}
