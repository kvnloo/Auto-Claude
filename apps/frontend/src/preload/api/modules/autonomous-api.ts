/**
 * Autonomous Mode API
 *
 * Preload API for autonomous mode operations.
 * Provides methods for queue control, status queries, task management, and settings.
 */

import { IPC_CHANNELS } from '../../../shared/constants';
import type {
  AutonomousTask,
  QueueStatus,
  SessionStats,
  QueuePauseReason,
  AutonomousEvent,
  IPCResult
} from '../../../shared/types';
import type { AutonomousModeSettings } from '../../../shared/types/settings';
import { createIpcListener, invokeIpc, IpcListenerCleanup } from './ipc-utils';

/**
 * Autonomous Mode API operations
 */
export interface AutonomousAPI {
  // Queue Control Operations
  start: (projectId: string) => Promise<IPCResult<QueueStatus>>;
  stop: () => Promise<IPCResult<SessionStats>>;
  pause: (reason?: QueuePauseReason) => Promise<IPCResult<QueueStatus>>;
  resume: () => Promise<IPCResult<QueueStatus>>;

  // Status Operations
  getStatus: () => Promise<IPCResult<QueueStatus>>;
  getQueue: () => Promise<IPCResult<AutonomousTask[]>>;

  // Task Management Operations
  addTask: (task: AutonomousTask) => Promise<IPCResult<AutonomousTask>>;
  removeTask: (taskId: string) => Promise<IPCResult<boolean>>;

  // Settings Operations
  getSettings: (projectId: string) => Promise<IPCResult<AutonomousModeSettings>>;
  saveSettings: (projectId: string, settings: AutonomousModeSettings) => Promise<IPCResult<boolean>>;

  // Event Listeners
  onProgress: (callback: (event: AutonomousEvent) => void) => IpcListenerCleanup;
  onTaskComplete: (callback: (event: AutonomousEvent) => void) => IpcListenerCleanup;
  onTaskFailed: (callback: (event: AutonomousEvent) => void) => IpcListenerCleanup;
  onError: (callback: (event: AutonomousEvent) => void) => IpcListenerCleanup;
}

/**
 * Creates the Autonomous Mode API implementation
 */
export const createAutonomousAPI = (): AutonomousAPI => ({
  // Queue Control Operations
  start: (projectId: string): Promise<IPCResult<QueueStatus>> =>
    invokeIpc(IPC_CHANNELS.AUTONOMOUS_START, projectId),

  stop: (): Promise<IPCResult<SessionStats>> =>
    invokeIpc(IPC_CHANNELS.AUTONOMOUS_STOP),

  pause: (reason?: QueuePauseReason): Promise<IPCResult<QueueStatus>> =>
    invokeIpc(IPC_CHANNELS.AUTONOMOUS_PAUSE, reason),

  resume: (): Promise<IPCResult<QueueStatus>> =>
    invokeIpc(IPC_CHANNELS.AUTONOMOUS_RESUME),

  // Status Operations
  getStatus: (): Promise<IPCResult<QueueStatus>> =>
    invokeIpc(IPC_CHANNELS.AUTONOMOUS_GET_STATUS),

  getQueue: (): Promise<IPCResult<AutonomousTask[]>> =>
    invokeIpc(IPC_CHANNELS.AUTONOMOUS_GET_QUEUE),

  // Task Management Operations
  addTask: (task: AutonomousTask): Promise<IPCResult<AutonomousTask>> =>
    invokeIpc(IPC_CHANNELS.AUTONOMOUS_ADD_TASK, task),

  removeTask: (taskId: string): Promise<IPCResult<boolean>> =>
    invokeIpc(IPC_CHANNELS.AUTONOMOUS_REMOVE_TASK, taskId),

  // Settings Operations
  getSettings: (projectId: string): Promise<IPCResult<AutonomousModeSettings>> =>
    invokeIpc(IPC_CHANNELS.AUTONOMOUS_SETTINGS_GET, projectId),

  saveSettings: (projectId: string, settings: AutonomousModeSettings): Promise<IPCResult<boolean>> =>
    invokeIpc(IPC_CHANNELS.AUTONOMOUS_SETTINGS_SAVE, projectId, settings),

  // Event Listeners
  onProgress: (callback: (event: AutonomousEvent) => void): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AUTONOMOUS_PROGRESS, callback),

  onTaskComplete: (callback: (event: AutonomousEvent) => void): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AUTONOMOUS_TASK_COMPLETE, callback),

  onTaskFailed: (callback: (event: AutonomousEvent) => void): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AUTONOMOUS_TASK_FAILED, callback),

  onError: (callback: (event: AutonomousEvent) => void): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AUTONOMOUS_ERROR, callback)
});
