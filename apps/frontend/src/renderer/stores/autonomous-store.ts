/**
 * Autonomous Mode Store
 *
 * Zustand store for managing autonomous mode state in the renderer process.
 * Handles queue status, current task, session stats, and settings.
 * Communicates with main process via IPC for all operations.
 */

import { create } from 'zustand';
import type {
  AutonomousTask,
  QueueStatus,
  SessionStats,
  QueuePauseReason,
  TaskProgress,
  AutonomousEvent
} from '../../shared/types/autonomous';
import type { AutonomousModeSettings } from '../../shared/types/settings';

// ============================================
// Store State Interface
// ============================================

interface AutonomousState {
  // Core state
  isEnabled: boolean;
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;

  // Queue status
  queueStatus: QueueStatus | null;

  // Current task being executed
  currentTask: AutonomousTask | null;
  currentTaskProgress: TaskProgress | null;

  // Task queue
  taskQueue: AutonomousTask[];

  // Session statistics
  sessionStats: SessionStats | null;

  // Settings (per-project)
  settings: AutonomousModeSettings | null;
  currentProjectId: string | null;

  // Actions - Queue Control
  startQueue: (projectId: string) => Promise<boolean>;
  stopQueue: () => Promise<boolean>;
  pauseQueue: (reason?: QueuePauseReason) => Promise<boolean>;
  resumeQueue: () => Promise<boolean>;

  // Actions - Status
  refreshStatus: () => Promise<void>;
  refreshQueue: () => Promise<void>;

  // Actions - Task Management
  addTask: (task: AutonomousTask) => Promise<boolean>;
  removeTask: (taskId: string) => Promise<boolean>;

  // Actions - Settings
  loadSettings: (projectId: string) => Promise<void>;
  saveSettings: (projectId: string, settings: AutonomousModeSettings) => Promise<boolean>;

  // Actions - Event Handlers (called from IPC listeners)
  handleQueueStarted: () => void;
  handleQueueStopped: (stats: SessionStats) => void;
  handleQueuePaused: (reason: QueuePauseReason, stats: SessionStats) => void;
  handleQueueResumed: () => void;
  handleTaskStarted: (task: AutonomousTask) => void;
  handleTaskProgress: (progress: TaskProgress) => void;
  handleTaskCompleted: (task: AutonomousTask, prUrl?: string) => void;
  handleTaskFailed: (task: AutonomousTask, error: string) => void;
  handleStatusUpdate: (status: QueueStatus) => void;
  handleRateLimit: (resetAt: Date) => void;
  handleError: (error: string) => void;

  // Actions - Utility
  reset: () => void;
  setError: (error: string | null) => void;
}

// ============================================
// Default States
// ============================================

const defaultQueueStatus: QueueStatus = {
  state: 'idle',
  pendingCount: 0,
  inProgressCount: 0,
  completedCount: 0,
  failedCount: 0,
  totalCount: 0,
  consecutiveFailures: 0,
  lastUpdated: new Date()
};

const defaultSettings: AutonomousModeSettings = {
  enabled: false,
  maxConcurrentTasks: 1,
  maxConsecutiveFailures: 3,
  sessionTimeLimitMinutes: 240,
  pollIntervalSeconds: 60
};

// ============================================
// Store Implementation
// ============================================

export const useAutonomousStore = create<AutonomousState>((set, get) => ({
  // Initial state
  isEnabled: false,
  isInitialized: false,
  isLoading: false,
  error: null,
  queueStatus: null,
  currentTask: null,
  currentTaskProgress: null,
  taskQueue: [],
  sessionStats: null,
  settings: null,
  currentProjectId: null,

  // =========================================
  // Queue Control Actions
  // =========================================

  startQueue: async (projectId: string): Promise<boolean> => {
    set({ isLoading: true, error: null, currentProjectId: projectId });

    try {
      const result = await window.electronAPI.autonomous.start(projectId);

      if (result.success && result.data) {
        set({
          isEnabled: true,
          queueStatus: result.data,
          isLoading: false
        });
        return true;
      } else {
        set({
          error: result.error || 'Failed to start queue',
          isLoading: false
        });
        return false;
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to start queue',
        isLoading: false
      });
      return false;
    }
  },

  stopQueue: async (): Promise<boolean> => {
    set({ isLoading: true, error: null });

    try {
      const result = await window.electronAPI.autonomous.stop();

      if (result.success && result.data) {
        set({
          isEnabled: false,
          queueStatus: { ...defaultQueueStatus, state: 'stopped' },
          sessionStats: result.data,
          currentTask: null,
          currentTaskProgress: null,
          isLoading: false
        });
        return true;
      } else {
        set({
          error: result.error || 'Failed to stop queue',
          isLoading: false
        });
        return false;
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to stop queue',
        isLoading: false
      });
      return false;
    }
  },

  pauseQueue: async (reason: QueuePauseReason = 'user_requested'): Promise<boolean> => {
    set({ isLoading: true, error: null });

    try {
      const result = await window.electronAPI.autonomous.pause(reason);

      if (result.success && result.data) {
        set({
          queueStatus: result.data,
          isLoading: false
        });
        return true;
      } else {
        set({
          error: result.error || 'Failed to pause queue',
          isLoading: false
        });
        return false;
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to pause queue',
        isLoading: false
      });
      return false;
    }
  },

  resumeQueue: async (): Promise<boolean> => {
    set({ isLoading: true, error: null });

    try {
      const result = await window.electronAPI.autonomous.resume();

      if (result.success && result.data) {
        set({
          queueStatus: result.data,
          isLoading: false
        });
        return true;
      } else {
        set({
          error: result.error || 'Failed to resume queue',
          isLoading: false
        });
        return false;
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to resume queue',
        isLoading: false
      });
      return false;
    }
  },

  // =========================================
  // Status Actions
  // =========================================

  refreshStatus: async (): Promise<void> => {
    try {
      const result = await window.electronAPI.autonomous.getStatus();

      if (result.success && result.data) {
        set({
          queueStatus: result.data,
          isEnabled: result.data.state === 'running' || result.data.state === 'paused'
        });
      }
    } catch (error) {
      if (window.DEBUG) {
        console.error('[AutonomousStore] Failed to refresh status:', error);
      }
    }
  },

  refreshQueue: async (): Promise<void> => {
    try {
      const result = await window.electronAPI.autonomous.getQueue();

      if (result.success && result.data) {
        set({ taskQueue: result.data });
      }
    } catch (error) {
      if (window.DEBUG) {
        console.error('[AutonomousStore] Failed to refresh queue:', error);
      }
    }
  },

  // =========================================
  // Task Management Actions
  // =========================================

  addTask: async (task: AutonomousTask): Promise<boolean> => {
    try {
      const result = await window.electronAPI.autonomous.addTask(task);

      if (result.success && result.data) {
        set((state) => ({
          taskQueue: [...state.taskQueue, result.data!]
        }));
        return true;
      } else {
        set({ error: result.error || 'Failed to add task' });
        return false;
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to add task'
      });
      return false;
    }
  },

  removeTask: async (taskId: string): Promise<boolean> => {
    try {
      const result = await window.electronAPI.autonomous.removeTask(taskId);

      if (result.success) {
        set((state) => ({
          taskQueue: state.taskQueue.filter((t) => t.id !== taskId)
        }));
        return true;
      } else {
        set({ error: result.error || 'Failed to remove task' });
        return false;
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to remove task'
      });
      return false;
    }
  },

  // =========================================
  // Settings Actions
  // =========================================

  loadSettings: async (projectId: string): Promise<void> => {
    set({ isLoading: true, currentProjectId: projectId });

    try {
      const result = await window.electronAPI.autonomous.getSettings(projectId);

      if (result.success && result.data) {
        set({
          settings: result.data,
          isInitialized: true,
          isLoading: false
        });
      } else {
        // Use default settings if none exist
        set({
          settings: defaultSettings,
          isInitialized: true,
          isLoading: false
        });
      }
    } catch (error) {
      set({
        settings: defaultSettings,
        isInitialized: true,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load settings'
      });
    }
  },

  saveSettings: async (projectId: string, settings: AutonomousModeSettings): Promise<boolean> => {
    set({ isLoading: true, error: null });

    try {
      const result = await window.electronAPI.autonomous.saveSettings(projectId, settings);

      if (result.success) {
        set({
          settings,
          isLoading: false
        });
        return true;
      } else {
        set({
          error: result.error || 'Failed to save settings',
          isLoading: false
        });
        return false;
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to save settings',
        isLoading: false
      });
      return false;
    }
  },

  // =========================================
  // Event Handler Actions (from IPC)
  // =========================================

  handleQueueStarted: (): void => {
    set({
      isEnabled: true,
      queueStatus: {
        ...(get().queueStatus || defaultQueueStatus),
        state: 'running'
      }
    });
  },

  handleQueueStopped: (stats: SessionStats): void => {
    set({
      isEnabled: false,
      queueStatus: {
        ...(get().queueStatus || defaultQueueStatus),
        state: 'stopped'
      },
      sessionStats: stats,
      currentTask: null,
      currentTaskProgress: null
    });
  },

  handleQueuePaused: (reason: QueuePauseReason, stats: SessionStats): void => {
    set({
      queueStatus: {
        ...(get().queueStatus || defaultQueueStatus),
        state: 'paused',
        pauseReason: reason
      },
      sessionStats: stats
    });
  },

  handleQueueResumed: (): void => {
    set({
      queueStatus: {
        ...(get().queueStatus || defaultQueueStatus),
        state: 'running',
        pauseReason: undefined
      }
    });
  },

  handleTaskStarted: (task: AutonomousTask): void => {
    set({
      currentTask: task,
      currentTaskProgress: null,
      taskQueue: get().taskQueue.map((t) =>
        t.id === task.id ? { ...t, status: 'in_progress' as const } : t
      )
    });
  },

  handleTaskProgress: (progress: TaskProgress): void => {
    set({ currentTaskProgress: progress });
  },

  handleTaskCompleted: (task: AutonomousTask, prUrl?: string): void => {
    const updatedTask = { ...task, status: 'completed' as const, pullRequestUrl: prUrl };

    set((state) => ({
      currentTask: null,
      currentTaskProgress: null,
      taskQueue: state.taskQueue.map((t) =>
        t.id === task.id ? updatedTask : t
      ),
      queueStatus: state.queueStatus
        ? {
            ...state.queueStatus,
            completedCount: state.queueStatus.completedCount + 1,
            inProgressCount: Math.max(0, state.queueStatus.inProgressCount - 1)
          }
        : null
    }));
  },

  handleTaskFailed: (task: AutonomousTask, error: string): void => {
    const updatedTask = { ...task, status: 'failed' as const, error };

    set((state) => ({
      currentTask: null,
      currentTaskProgress: null,
      taskQueue: state.taskQueue.map((t) =>
        t.id === task.id ? updatedTask : t
      ),
      queueStatus: state.queueStatus
        ? {
            ...state.queueStatus,
            failedCount: state.queueStatus.failedCount + 1,
            inProgressCount: Math.max(0, state.queueStatus.inProgressCount - 1),
            consecutiveFailures: state.queueStatus.consecutiveFailures + 1
          }
        : null
    }));
  },

  handleStatusUpdate: (status: QueueStatus): void => {
    set({
      queueStatus: status,
      isEnabled: status.state === 'running' || status.state === 'paused'
    });
  },

  handleRateLimit: (resetAt: Date): void => {
    set((state) => ({
      queueStatus: state.queueStatus
        ? {
            ...state.queueStatus,
            state: 'paused',
            pauseReason: 'rate_limit_hit'
          }
        : null,
      sessionStats: state.sessionStats
        ? {
            ...state.sessionStats,
            rateLimitHits: state.sessionStats.rateLimitHits + 1,
            lastRateLimitResetAt: resetAt
          }
        : null
    }));
  },

  handleError: (error: string): void => {
    set({
      error,
      queueStatus: {
        ...(get().queueStatus || defaultQueueStatus),
        state: 'error',
        error
      }
    });
  },

  // =========================================
  // Utility Actions
  // =========================================

  reset: (): void => {
    set({
      isEnabled: false,
      isInitialized: false,
      isLoading: false,
      error: null,
      queueStatus: null,
      currentTask: null,
      currentTaskProgress: null,
      taskQueue: [],
      sessionStats: null,
      settings: null,
      currentProjectId: null
    });
  },

  setError: (error: string | null): void => {
    set({ error });
  }
}));

// ============================================
// IPC Event Listener Setup
// ============================================

/**
 * Initialize IPC event listeners for autonomous mode events.
 * Should be called once when the app initializes.
 * Returns a cleanup function to remove the listeners.
 */
export function initializeAutonomousEventListeners(): () => void {
  const store = useAutonomousStore.getState();

  // Progress events (queue lifecycle and task updates)
  const cleanupProgress = window.electronAPI.autonomous.onProgress((data: AutonomousEvent) => {
    switch (data.type) {
      case 'queue_started':
        store.handleQueueStarted();
        break;
      case 'queue_stopped':
        if (data.payload && typeof data.payload === 'object' && 'stats' in data.payload) {
          store.handleQueueStopped(data.payload.stats as SessionStats);
        }
        break;
      case 'queue_paused':
        if (data.payload && typeof data.payload === 'object') {
          const payload = data.payload as { reason: QueuePauseReason; stats: SessionStats };
          store.handleQueuePaused(payload.reason, payload.stats);
        }
        break;
      case 'queue_resumed':
        store.handleQueueResumed();
        break;
      case 'task_started':
        if (data.payload && typeof data.payload === 'object' && 'task' in data.payload) {
          store.handleTaskStarted(data.payload.task as AutonomousTask);
        }
        break;
      case 'task_progress':
        if (data.payload && typeof data.payload === 'object' && 'progress' in data.payload) {
          store.handleTaskProgress(data.payload.progress as TaskProgress);
        }
        break;
      case 'status_updated':
        if (data.payload && typeof data.payload === 'object' && 'status' in data.payload) {
          store.handleStatusUpdate(data.payload.status as QueueStatus);
        }
        break;
      case 'rate_limit_hit':
        if (data.payload && typeof data.payload === 'object' && 'resetAt' in data.payload) {
          store.handleRateLimit(new Date(data.payload.resetAt as string));
        }
        break;
    }
  });

  // Task complete event
  const cleanupTaskComplete = window.electronAPI.autonomous.onTaskComplete((data: AutonomousEvent) => {
    if (data.payload && typeof data.payload === 'object' && 'task' in data.payload) {
      const payload = data.payload as { task: AutonomousTask; pullRequestUrl?: string };
      store.handleTaskCompleted(payload.task, payload.pullRequestUrl);
    }
  });

  // Task failed event
  const cleanupTaskFailed = window.electronAPI.autonomous.onTaskFailed((data: AutonomousEvent) => {
    if (data.payload && typeof data.payload === 'object' && 'task' in data.payload) {
      const payload = data.payload as { task: AutonomousTask; error: string };
      store.handleTaskFailed(payload.task, payload.error);
    }
  });

  // Error event
  const cleanupError = window.electronAPI.autonomous.onError((data: AutonomousEvent) => {
    if (data.payload && typeof data.payload === 'object' && 'error' in data.payload) {
      store.handleError((data.payload as { error: string }).error);
    }
  });

  // Return cleanup function that calls all individual cleanup functions
  return () => {
    cleanupProgress();
    cleanupTaskComplete();
    cleanupTaskFailed();
    cleanupError();
  };
}

// ============================================
// Selector Hooks
// ============================================

/**
 * Check if the queue is currently running
 */
export const useIsQueueRunning = (): boolean => {
  return useAutonomousStore((state) => state.queueStatus?.state === 'running');
};

/**
 * Check if the queue is paused
 */
export const useIsQueuePaused = (): boolean => {
  return useAutonomousStore((state) => state.queueStatus?.state === 'paused');
};

/**
 * Get the current pause reason if paused
 */
export const usePauseReason = (): QueuePauseReason | undefined => {
  return useAutonomousStore((state) => state.queueStatus?.pauseReason);
};

/**
 * Get pending task count
 */
export const usePendingTaskCount = (): number => {
  return useAutonomousStore((state) => state.queueStatus?.pendingCount ?? 0);
};

/**
 * Get completed task count
 */
export const useCompletedTaskCount = (): number => {
  return useAutonomousStore((state) => state.queueStatus?.completedCount ?? 0);
};

/**
 * Check if there's an active task
 */
export const useHasActiveTask = (): boolean => {
  return useAutonomousStore((state) => state.currentTask !== null);
};

/**
 * Get the session success rate
 */
export const useSuccessRate = (): number => {
  return useAutonomousStore((state) => state.sessionStats?.successRate ?? 0);
};

/**
 * Get remaining session time in milliseconds
 */
export const useRemainingTime = (): number => {
  return useAutonomousStore((state) => state.sessionStats?.remainingTimeMs ?? 0);
};

/**
 * Get total tokens used in the session
 */
export const useTokensUsed = (): number => {
  return useAutonomousStore((state) => state.sessionStats?.tokensUsed ?? 0);
};
