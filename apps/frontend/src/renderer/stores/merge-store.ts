import { create } from 'zustand';
import type {
  MergeProgress,
  MergeAttempt,
  MergeHealth,
  MergeStatus,
  MergeHistoryStats,
  MergeProgressConflict
} from '../../shared/types';

/**
 * Merge tracking store state interface.
 * Manages real-time merge progress and history for task worktree merges.
 */
interface MergeState {
  // Active merge operations (keyed by taskId)
  activeMerges: Record<string, MergeProgress>;

  // Merge history cache (keyed by taskId, each containing array of attempts)
  historyByTask: Record<string, MergeAttempt[]>;

  // Global stats (cached, refreshed on demand)
  globalStats: MergeHistoryStats | null;

  // Loading states
  isLoadingHistory: boolean;
  isLoadingStats: boolean;

  // Error state
  error: string | null;

  // Actions for updating active merges
  startMerge: (taskId: string, worktreePath?: string) => void;
  updateMergeProgress: (taskId: string, progress: Partial<MergeProgress>) => void;
  completeMerge: (taskId: string, health: MergeHealth, commitHash?: string) => void;
  failMerge: (taskId: string, errorMessage: string) => void;
  addConflict: (taskId: string, conflict: MergeProgressConflict) => void;
  resolveConflict: (taskId: string, filePath: string, method?: string) => void;
  clearActiveMerge: (taskId: string) => void;

  // Actions for merge history (data provided externally via IPC)
  setHistory: (taskId: string, attempts: MergeAttempt[]) => void;
  addHistoryEntry: (attempt: MergeAttempt) => void;
  setStats: (stats: MergeHistoryStats) => void;
  clearHistory: (taskId: string) => void;

  // Loading state management
  setLoadingHistory: (loading: boolean) => void;
  setLoadingStats: (loading: boolean) => void;

  // Error handling
  setError: (error: string | null) => void;

  // Selectors
  getMergeProgress: (taskId: string) => MergeProgress | undefined;
  getMergeHealth: (taskId: string) => MergeHealth;
  getTaskHistory: (taskId: string) => MergeAttempt[];
  getLatestAttempt: (taskId: string) => MergeAttempt | undefined;
  isTaskMerging: (taskId: string) => boolean;
  getActiveMergeCount: () => number;
}

/**
 * Create initial merge progress state for a new merge operation
 */
function createInitialProgress(taskId: string): MergeProgress {
  return {
    taskId,
    status: 'merging' as MergeStatus,
    health: 'pass' as MergeHealth, // Optimistic - assume clean merge until conflicts detected
    progress: 0,
    currentStep: 'Initializing merge...',
    conflicts: [],
    conflictsResolved: 0,
    startedAt: new Date().toISOString(),
    elapsedTime: 0
  };
}

/**
 * Zustand store for merge tracking.
 *
 * This store manages:
 * - Active merge operations with real-time progress tracking
 * - Merge history cache for displaying past attempts
 * - Global merge statistics
 *
 * Usage:
 * ```typescript
 * const { activeMerges, getMergeProgress } = useMergeStore();
 * const progress = getMergeProgress(taskId);
 * ```
 *
 * IPC event subscription is handled separately via initMergeStoreListeners()
 * which should be called once when the app starts.
 */
export const useMergeStore = create<MergeState>((set, get) => ({
  // Initial state
  activeMerges: {},
  historyByTask: {},
  globalStats: null,
  isLoadingHistory: false,
  isLoadingStats: false,
  error: null,

  // Start a new merge operation
  startMerge: (taskId) => {
    set((state) => ({
      activeMerges: {
        ...state.activeMerges,
        [taskId]: createInitialProgress(taskId)
      },
      error: null
    }));
  },

  // Update merge progress
  updateMergeProgress: (taskId, progressUpdate) => {
    set((state) => {
      const existing = state.activeMerges[taskId];
      if (!existing) {
        // If no active merge, create one with the update
        return {
          activeMerges: {
            ...state.activeMerges,
            [taskId]: {
              ...createInitialProgress(taskId),
              ...progressUpdate
            }
          }
        };
      }

      // Calculate elapsed time if merge is in progress
      let elapsedTime = existing.elapsedTime || 0;
      if (existing.startedAt) {
        elapsedTime = Date.now() - new Date(existing.startedAt).getTime();
      }

      return {
        activeMerges: {
          ...state.activeMerges,
          [taskId]: {
            ...existing,
            ...progressUpdate,
            elapsedTime
          }
        }
      };
    });
  },

  // Complete a merge operation
  completeMerge: (taskId, health) => {
    set((state) => {
      const existing = state.activeMerges[taskId];
      if (!existing) return state;

      return {
        activeMerges: {
          ...state.activeMerges,
          [taskId]: {
            ...existing,
            status: 'complete' as MergeStatus,
            health,
            progress: 100,
            currentStep: 'Merge completed'
          }
        }
      };
    });
  },

  // Fail a merge operation
  failMerge: (taskId, errorMessage) => {
    set((state) => {
      const existing = state.activeMerges[taskId];
      if (!existing) return state;

      // Calculate final health based on unresolved conflicts
      const unresolvedCount = existing.conflicts.filter(c => !c.resolved).length;
      const health: MergeHealth = unresolvedCount > 0 ? 'fail' : 'warning';

      return {
        activeMerges: {
          ...state.activeMerges,
          [taskId]: {
            ...existing,
            status: 'failed' as MergeStatus,
            health,
            currentStep: errorMessage
          }
        },
        error: errorMessage
      };
    });
  },

  // Add a conflict to an active merge
  addConflict: (taskId, conflict) => {
    set((state) => {
      const existing = state.activeMerges[taskId];
      if (!existing) return state;

      // Check if conflict already exists for this file
      const existingIndex = existing.conflicts.findIndex(
        c => c.filePath === conflict.filePath
      );

      let updatedConflicts: MergeProgressConflict[];
      if (existingIndex >= 0) {
        // Update existing conflict
        updatedConflicts = [...existing.conflicts];
        updatedConflicts[existingIndex] = conflict;
      } else {
        // Add new conflict
        updatedConflicts = [...existing.conflicts, conflict];
      }

      // Recalculate health
      const unresolvedCount = updatedConflicts.filter(c => !c.resolved).length;
      const health: MergeHealth = unresolvedCount > 0 ? 'fail' :
        updatedConflicts.length > 0 ? 'warning' : 'pass';

      return {
        activeMerges: {
          ...state.activeMerges,
          [taskId]: {
            ...existing,
            conflicts: updatedConflicts,
            health,
            status: unresolvedCount > 0 ? 'resolving' as MergeStatus : existing.status
          }
        }
      };
    });
  },

  // Resolve a conflict in an active merge
  resolveConflict: (taskId, filePath, method) => {
    set((state) => {
      const existing = state.activeMerges[taskId];
      if (!existing) return state;

      const updatedConflicts = existing.conflicts.map(c =>
        c.filePath === filePath
          ? { ...c, resolved: true, resolutionMethod: method }
          : c
      );

      const resolvedCount = updatedConflicts.filter(c => c.resolved).length;
      const totalConflicts = updatedConflicts.length;

      // Recalculate health
      const health: MergeHealth = totalConflicts === 0 ? 'pass' :
        resolvedCount >= totalConflicts ? 'warning' : 'fail';

      // If all conflicts resolved, status can transition from resolving to merging
      const allResolved = resolvedCount >= totalConflicts;
      const status: MergeStatus = existing.status === 'resolving' && allResolved
        ? 'merging' : existing.status;

      return {
        activeMerges: {
          ...state.activeMerges,
          [taskId]: {
            ...existing,
            conflicts: updatedConflicts,
            conflictsResolved: resolvedCount,
            health,
            status
          }
        }
      };
    });
  },

  // Clear an active merge (after completion or manual dismissal)
  clearActiveMerge: (taskId) => {
    set((state) => {
      const { [taskId]: _removed, ...remaining } = state.activeMerges;
      return { activeMerges: remaining };
    });
  },

  // Set history for a task (called from IPC response)
  setHistory: (taskId, attempts) => {
    set((state) => ({
      historyByTask: {
        ...state.historyByTask,
        [taskId]: attempts
      },
      isLoadingHistory: false
    }));
  },

  // Add a history entry (typically from IPC event on merge complete)
  addHistoryEntry: (attempt) => {
    set((state) => {
      const taskHistory = state.historyByTask[attempt.taskId] || [];
      return {
        historyByTask: {
          ...state.historyByTask,
          [attempt.taskId]: [...taskHistory, attempt]
        }
      };
    });
  },

  // Set global stats (called from IPC response)
  setStats: (stats) => {
    set({
      globalStats: stats,
      isLoadingStats: false
    });
  },

  // Clear history for a task (e.g., when task is deleted)
  clearHistory: (taskId) => {
    set((state) => {
      const { [taskId]: _removed, ...remaining } = state.historyByTask;
      return { historyByTask: remaining };
    });
  },

  // Loading state management
  setLoadingHistory: (loading) => set({ isLoadingHistory: loading }),
  setLoadingStats: (loading) => set({ isLoadingStats: loading }),

  // Set error state
  setError: (error) => set({ error }),

  // Selectors
  getMergeProgress: (taskId) => {
    return get().activeMerges[taskId];
  },

  getMergeHealth: (taskId) => {
    const progress = get().activeMerges[taskId];
    if (progress) {
      return progress.health;
    }

    // Check latest history entry if no active merge
    const history = get().historyByTask[taskId];
    if (history && history.length > 0) {
      return history[history.length - 1].health;
    }

    return 'pass'; // Default to pass if no data
  },

  getTaskHistory: (taskId) => {
    return get().historyByTask[taskId] || [];
  },

  getLatestAttempt: (taskId) => {
    const history = get().historyByTask[taskId];
    if (history && history.length > 0) {
      return history[history.length - 1];
    }
    return undefined;
  },

  isTaskMerging: (taskId) => {
    const progress = get().activeMerges[taskId];
    return progress?.status === 'merging' || progress?.status === 'resolving';
  },

  getActiveMergeCount: () => {
    return Object.keys(get().activeMerges).length;
  }
}));

/**
 * Hook to get merge progress for a specific task.
 * Convenience wrapper around useMergeStore for common use case.
 */
export function useMergeProgress(taskId: string): MergeProgress | undefined {
  return useMergeStore((state) => state.activeMerges[taskId]);
}

/**
 * Hook to get merge health for a specific task.
 * Returns health from active merge or latest history entry.
 */
export function useMergeHealth(taskId: string): MergeHealth {
  return useMergeStore((state) => {
    const progress = state.activeMerges[taskId];
    if (progress) {
      return progress.health;
    }
    const history = state.historyByTask[taskId];
    if (history && history.length > 0) {
      return history[history.length - 1].health;
    }
    return 'pass';
  });
}

/**
 * Hook to check if a task currently has an active merge.
 */
export function useIsTaskMerging(taskId: string): boolean {
  return useMergeStore((state) => {
    const progress = state.activeMerges[taskId];
    return progress?.status === 'merging' || progress?.status === 'resolving';
  });
}

/**
 * Hook to get merge history for a specific task.
 */
export function useMergeHistory(taskId: string): MergeAttempt[] {
  return useMergeStore((state) => state.historyByTask[taskId] || []);
}

/**
 * Hook to get the latest merge attempt for a specific task.
 */
export function useLatestMergeAttempt(taskId: string): MergeAttempt | undefined {
  return useMergeStore((state) => {
    const history = state.historyByTask[taskId];
    return history && history.length > 0 ? history[history.length - 1] : undefined;
  });
}

/**
 * Hook to get global merge statistics.
 */
export function useMergeStats(): MergeHistoryStats | null {
  return useMergeStore((state) => state.globalStats);
}

/**
 * Hook to get the count of active merges.
 */
export function useActiveMergeCount(): number {
  return useMergeStore((state) => Object.keys(state.activeMerges).length);
}
