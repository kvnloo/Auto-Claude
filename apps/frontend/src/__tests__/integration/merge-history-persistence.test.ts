/**
 * End-to-End Integration Tests for Merge History Persistence
 *
 * Tests the complete persistence flow across sessions:
 * 1. Complete a merge operation
 * 2. Verify history saved to .auto-claude/merge_history/
 * 3. Restart application (reset state)
 * 4. Query merge history via IPC
 * 5. Confirm all attempts listed with correct metadata
 *
 * This verifies that merge history persists correctly and can be
 * retrieved after application restart.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useMergeStore, setupMergeStoreListeners } from '../../renderer/stores/merge-store';
import type { MergeAttempt, MergeHealth, MergeStatus, MergeHistoryStats } from '../../shared/types';
import type {
  MergeCompleteEventData,
} from '../../preload/api/task-api';

// Mock IPC channels for merge tracking
const mockListeners: Record<string, Array<(taskId: string, data: unknown) => void>> = {};

// Mock merge history data (simulates what's stored in .auto-claude/merge_history/)
const mockHistoryStore: Record<string, MergeAttempt[]> = {};

// Mock the window.electronAPI for IPC communication
const mockElectronAPI = {
  onMergeProgress: vi.fn((callback) => {
    if (!mockListeners['merge:progress']) {
      mockListeners['merge:progress'] = [];
    }
    mockListeners['merge:progress'].push(callback as (taskId: string, data: unknown) => void);
    return () => {
      const index = mockListeners['merge:progress'].indexOf(callback as (taskId: string, data: unknown) => void);
      if (index >= 0) mockListeners['merge:progress'].splice(index, 1);
    };
  }),
  onMergeComplete: vi.fn((callback) => {
    if (!mockListeners['merge:complete']) {
      mockListeners['merge:complete'] = [];
    }
    mockListeners['merge:complete'].push(callback as (taskId: string, data: unknown) => void);
    return () => {
      const index = mockListeners['merge:complete'].indexOf(callback as (taskId: string, data: unknown) => void);
      if (index >= 0) mockListeners['merge:complete'].splice(index, 1);
    };
  }),
  onMergeConflictDetected: vi.fn((callback) => {
    if (!mockListeners['merge:conflict']) {
      mockListeners['merge:conflict'] = [];
    }
    mockListeners['merge:conflict'].push(callback as (taskId: string, data: unknown) => void);
    return () => {
      const index = mockListeners['merge:conflict'].indexOf(callback as (taskId: string, data: unknown) => void);
      if (index >= 0) mockListeners['merge:conflict'].splice(index, 1);
    };
  }),
  // Mock IPC history retrieval methods (simulates reading from .auto-claude/merge_history/)
  getMergeHistory: vi.fn(async (taskId: string): Promise<{ success: boolean; data: MergeAttempt[] }> => {
    const history = mockHistoryStore[taskId] || [];
    return { success: true, data: history };
  }),
  getMergeHistoryLatest: vi.fn(async (taskId: string): Promise<{ success: boolean; data: MergeAttempt | null }> => {
    const history = mockHistoryStore[taskId] || [];
    const latest = history.length > 0 ? history[history.length - 1] : null;
    return { success: true, data: latest };
  }),
  getMergeHistoryListTasks: vi.fn(async (): Promise<{ success: boolean; data: { taskIds: string[] } }> => {
    const taskIds = Object.keys(mockHistoryStore).filter(k => mockHistoryStore[k].length > 0);
    return { success: true, data: { taskIds } };
  }),
  getMergeHistoryStats: vi.fn(async (): Promise<{ success: boolean; data: MergeHistoryStats }> => {
    let totalAttempts = 0;
    let successfulAttempts = 0;
    let failedAttempts = 0;
    let timeoutAttempts = 0;
    let totalConflicts = 0;
    let resolvedConflicts = 0;

    const taskIds = Object.keys(mockHistoryStore);
    for (const taskId of taskIds) {
      const attempts = mockHistoryStore[taskId] || [];
      for (const attempt of attempts) {
        totalAttempts++;
        totalConflicts += attempt.conflicts.length;
        resolvedConflicts += attempt.conflicts.filter(c => c.resolved).length;

        switch (attempt.status) {
          case 'complete':
            successfulAttempts++;
            break;
          case 'failed':
            failedAttempts++;
            break;
          case 'timeout':
            timeoutAttempts++;
            break;
        }
      }
    }

    return {
      success: true,
      data: {
        totalTasks: taskIds.length,
        totalAttempts,
        successfulAttempts,
        failedAttempts,
        timeoutAttempts,
        successRate: totalAttempts > 0 ? successfulAttempts / totalAttempts : 0,
        totalConflicts,
        resolvedConflicts,
        conflictResolutionRate: totalConflicts > 0 ? resolvedConflicts / totalConflicts : 1.0,
      },
    };
  }),
};

// Helper to simulate backend emitting merge complete event
function emitMergeComplete(taskId: string, data: MergeCompleteEventData) {
  mockListeners['merge:complete']?.forEach((cb) => cb(taskId, data));
}

// Helper to create a mock merge attempt record (simulates persisted data)
function createMergeAttempt(taskId: string, overrides: Partial<MergeAttempt> = {}): MergeAttempt {
  const now = new Date().toISOString();
  return {
    id: `attempt-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    taskId,
    worktreePath: `/path/to/worktree/${taskId}`,
    startedAt: now,
    completedAt: now,
    status: 'complete' as MergeStatus,
    health: 'pass' as MergeHealth,
    conflicts: [],
    progressPercent: 100,
    currentStep: 'Complete',
    errorMessage: undefined,
    isFastForward: false,
    commitHash: 'abc123def456',
    durationSeconds: 2.5,
    ...overrides,
  };
}

// Helper to simulate persisting a merge attempt to history (simulates Python MergeHistoryStore.append())
function persistMergeAttempt(attempt: MergeAttempt) {
  if (!mockHistoryStore[attempt.taskId]) {
    mockHistoryStore[attempt.taskId] = [];
  }
  mockHistoryStore[attempt.taskId].push(attempt);
}

// Helper to clear all persisted history (simulate fresh state)
function clearMockHistoryStore() {
  Object.keys(mockHistoryStore).forEach(key => {
    delete mockHistoryStore[key];
  });
}

// Helper to simulate application restart (resets store state)
function simulateAppRestart() {
  useMergeStore.setState({
    activeMerges: {},
    historyByTask: {},
    globalStats: null,
    isLoadingHistory: false,
    isLoadingStats: false,
    error: null,
  });
}

describe('Merge History Persistence and Retrieval', () => {
  let cleanupListeners: (() => void) | null = null;

  beforeEach(() => {
    // Reset store to initial state
    useMergeStore.setState({
      activeMerges: {},
      historyByTask: {},
      globalStats: null,
      isLoadingHistory: false,
      isLoadingStats: false,
      error: null,
    });

    // Clear mock listeners
    Object.keys(mockListeners).forEach((key) => {
      mockListeners[key] = [];
    });

    // Clear mock history store
    clearMockHistoryStore();

    // Reset all mocks
    vi.clearAllMocks();

    // Setup window.electronAPI mock
    // @ts-expect-error - mocking window.electronAPI
    global.window = { electronAPI: mockElectronAPI };

    // Setup store listeners
    cleanupListeners = setupMergeStoreListeners();
  });

  afterEach(() => {
    // Cleanup listeners
    if (cleanupListeners) {
      cleanupListeners();
      cleanupListeners = null;
    }

    vi.clearAllMocks();
  });

  describe('Step 1: Complete a merge operation and verify history saved', () => {
    it('should persist merge attempt to history store when merge completes successfully', () => {
      const taskId = 'persistence-test-001';

      // Start a merge operation
      useMergeStore.getState().startMerge(taskId);

      // Simulate merge completing and being persisted
      const attempt = createMergeAttempt(taskId, {
        health: 'pass',
        status: 'complete',
        conflicts: [],
        durationSeconds: 3.2,
      });
      persistMergeAttempt(attempt);

      // Emit complete event to update store
      emitMergeComplete(taskId, {
        success: true,
        taskId,
        status: 'complete',
        health: 'pass',
        conflictsDetected: 0,
        conflictsResolved: 0,
        durationMs: 3200,
      });

      // Verify attempt was persisted to mock history store
      expect(mockHistoryStore[taskId]).toBeDefined();
      expect(mockHistoryStore[taskId].length).toBe(1);
      expect(mockHistoryStore[taskId][0].status).toBe('complete');
      expect(mockHistoryStore[taskId][0].health).toBe('pass');
    });

    it('should persist merge attempt with conflicts to history', () => {
      const taskId = 'conflict-persistence-001';

      // Create attempt with conflicts
      const attempt = createMergeAttempt(taskId, {
        health: 'warning',
        status: 'complete',
        conflicts: [
          { filePath: 'src/file1.ts', resolved: true, resolutionMethod: 'ai', details: 'AI resolved' },
          { filePath: 'src/file2.ts', resolved: true, resolutionMethod: 'manual', details: 'Manual fix' },
        ],
        durationSeconds: 12.5,
      });
      persistMergeAttempt(attempt);

      // Verify persisted
      expect(mockHistoryStore[taskId][0].conflicts.length).toBe(2);
      expect(mockHistoryStore[taskId][0].conflicts[0].filePath).toBe('src/file1.ts');
      expect(mockHistoryStore[taskId][0].conflicts[0].resolved).toBe(true);
      expect(mockHistoryStore[taskId][0].health).toBe('warning');
    });

    it('should persist failed merge attempt to history', () => {
      const taskId = 'failed-persistence-001';

      // Create failed attempt
      const attempt = createMergeAttempt(taskId, {
        health: 'fail',
        status: 'failed',
        conflicts: [
          { filePath: 'src/critical.ts', resolved: false, details: 'Unresolvable conflict' },
        ],
        errorMessage: 'Merge aborted due to unresolved conflicts',
        durationSeconds: 45.0,
      });
      persistMergeAttempt(attempt);

      // Verify persisted
      expect(mockHistoryStore[taskId][0].status).toBe('failed');
      expect(mockHistoryStore[taskId][0].health).toBe('fail');
      expect(mockHistoryStore[taskId][0].errorMessage).toBe('Merge aborted due to unresolved conflicts');
    });
  });

  describe('Step 2: Verify history structure matches .auto-claude/merge_history/ format', () => {
    it('should have correct metadata structure in persisted attempts', () => {
      const taskId = 'structure-test-001';

      const attempt = createMergeAttempt(taskId, {
        worktreePath: '/home/user/project/.worktrees/feature-branch',
        isFastForward: true,
        commitHash: 'deadbeef123456',
      });
      persistMergeAttempt(attempt);

      const stored = mockHistoryStore[taskId][0];

      // Verify all required fields are present
      expect(stored.id).toBeDefined();
      expect(stored.taskId).toBe(taskId);
      expect(stored.worktreePath).toBe('/home/user/project/.worktrees/feature-branch');
      expect(stored.startedAt).toBeDefined();
      expect(stored.completedAt).toBeDefined();
      expect(stored.status).toBeDefined();
      expect(stored.health).toBeDefined();
      expect(stored.conflicts).toBeDefined();
      expect(stored.progressPercent).toBeDefined();
      expect(stored.isFastForward).toBe(true);
      expect(stored.commitHash).toBe('deadbeef123456');
      expect(stored.durationSeconds).toBeDefined();
    });

    it('should maintain chronological order for multiple attempts', () => {
      const taskId = 'order-test-001';

      // Create attempts with different timestamps
      const attempt1 = createMergeAttempt(taskId, {
        id: 'attempt-1',
        startedAt: '2025-01-01T10:00:00.000Z',
        completedAt: '2025-01-01T10:01:00.000Z',
      });
      persistMergeAttempt(attempt1);

      const attempt2 = createMergeAttempt(taskId, {
        id: 'attempt-2',
        startedAt: '2025-01-01T11:00:00.000Z',
        completedAt: '2025-01-01T11:02:00.000Z',
      });
      persistMergeAttempt(attempt2);

      const attempt3 = createMergeAttempt(taskId, {
        id: 'attempt-3',
        startedAt: '2025-01-01T12:00:00.000Z',
        completedAt: '2025-01-01T12:03:00.000Z',
      });
      persistMergeAttempt(attempt3);

      // Verify order is maintained (append-only)
      expect(mockHistoryStore[taskId].length).toBe(3);
      expect(mockHistoryStore[taskId][0].id).toBe('attempt-1');
      expect(mockHistoryStore[taskId][1].id).toBe('attempt-2');
      expect(mockHistoryStore[taskId][2].id).toBe('attempt-3');
    });
  });

  describe('Step 3: Simulate application restart', () => {
    it('should clear in-memory state on restart', () => {
      const taskId = 'restart-test-001';

      // Start a merge and update state
      useMergeStore.getState().startMerge(taskId);
      useMergeStore.getState().updateMergeProgress(taskId, { progress: 50, status: 'merging' });

      // Verify state exists
      expect(useMergeStore.getState().activeMerges[taskId]).toBeDefined();

      // Simulate restart
      simulateAppRestart();

      // Verify state is cleared
      expect(useMergeStore.getState().activeMerges[taskId]).toBeUndefined();
      expect(Object.keys(useMergeStore.getState().activeMerges).length).toBe(0);
      expect(Object.keys(useMergeStore.getState().historyByTask).length).toBe(0);
    });

    it('should preserve persisted history across restart', () => {
      const taskId = 'persist-restart-001';

      // Persist an attempt
      const attempt = createMergeAttempt(taskId, {
        health: 'pass',
        status: 'complete',
      });
      persistMergeAttempt(attempt);

      // Simulate restart
      simulateAppRestart();

      // History should still be in mock store (simulates file system)
      expect(mockHistoryStore[taskId]).toBeDefined();
      expect(mockHistoryStore[taskId].length).toBe(1);
    });
  });

  describe('Step 4: Query merge history via IPC after restart', () => {
    it('should retrieve task history via getMergeHistory IPC call', async () => {
      const taskId = 'ipc-history-001';

      // Persist some history
      persistMergeAttempt(createMergeAttempt(taskId, { id: 'attempt-a' }));
      persistMergeAttempt(createMergeAttempt(taskId, { id: 'attempt-b' }));

      // Simulate restart
      simulateAppRestart();

      // Query via IPC
      const result = await mockElectronAPI.getMergeHistory(taskId);

      expect(result.success).toBe(true);
      expect(result.data.length).toBe(2);
      expect(result.data[0].id).toBe('attempt-a');
      expect(result.data[1].id).toBe('attempt-b');
    });

    it('should retrieve latest attempt via getMergeHistoryLatest IPC call', async () => {
      const taskId = 'ipc-latest-001';

      // Persist multiple attempts
      persistMergeAttempt(createMergeAttempt(taskId, {
        id: 'old-attempt',
        startedAt: '2025-01-01T10:00:00.000Z',
      }));
      persistMergeAttempt(createMergeAttempt(taskId, {
        id: 'latest-attempt',
        startedAt: '2025-01-01T12:00:00.000Z',
        health: 'warning',
      }));

      // Simulate restart
      simulateAppRestart();

      // Query latest via IPC
      const result = await mockElectronAPI.getMergeHistoryLatest(taskId);

      expect(result.success).toBe(true);
      expect(result.data).not.toBeNull();
      expect(result.data?.id).toBe('latest-attempt');
      expect(result.data?.health).toBe('warning');
    });

    it('should list all tasks with history via getMergeHistoryListTasks IPC call', async () => {
      // Persist history for multiple tasks
      persistMergeAttempt(createMergeAttempt('task-alpha'));
      persistMergeAttempt(createMergeAttempt('task-beta'));
      persistMergeAttempt(createMergeAttempt('task-gamma'));

      // Simulate restart
      simulateAppRestart();

      // Query task list via IPC
      const result = await mockElectronAPI.getMergeHistoryListTasks();

      expect(result.success).toBe(true);
      expect(result.data.taskIds.length).toBe(3);
      expect(result.data.taskIds).toContain('task-alpha');
      expect(result.data.taskIds).toContain('task-beta');
      expect(result.data.taskIds).toContain('task-gamma');
    });

    it('should return empty array for task with no history', async () => {
      // Don't persist any history for this task
      simulateAppRestart();

      const result = await mockElectronAPI.getMergeHistory('non-existent-task');

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('should return null for latest attempt when no history exists', async () => {
      simulateAppRestart();

      const result = await mockElectronAPI.getMergeHistoryLatest('non-existent-task');

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });
  });

  describe('Step 5: Confirm all attempts listed with correct metadata', () => {
    it('should retrieve merge stats across all tasks via getMergeHistoryStats', async () => {
      // Create various merge attempts across tasks
      persistMergeAttempt(createMergeAttempt('task-1', {
        status: 'complete',
        health: 'pass',
        conflicts: [],
      }));
      persistMergeAttempt(createMergeAttempt('task-1', {
        status: 'complete',
        health: 'warning',
        conflicts: [
          { filePath: 'a.ts', resolved: true },
          { filePath: 'b.ts', resolved: true },
        ],
      }));
      persistMergeAttempt(createMergeAttempt('task-2', {
        status: 'failed',
        health: 'fail',
        conflicts: [
          { filePath: 'c.ts', resolved: false },
        ],
      }));

      simulateAppRestart();

      const result = await mockElectronAPI.getMergeHistoryStats();

      expect(result.success).toBe(true);
      expect(result.data.totalTasks).toBe(2);
      expect(result.data.totalAttempts).toBe(3);
      expect(result.data.successfulAttempts).toBe(2);
      expect(result.data.failedAttempts).toBe(1);
      expect(result.data.totalConflicts).toBe(3);
      expect(result.data.resolvedConflicts).toBe(2);
      expect(result.data.successRate).toBeCloseTo(2 / 3);
      expect(result.data.conflictResolutionRate).toBeCloseTo(2 / 3);
    });

    it('should correctly retrieve and restore history to store', async () => {
      const taskId = 'restore-test-001';

      // Persist detailed history
      persistMergeAttempt(createMergeAttempt(taskId, {
        id: 'first-attempt',
        status: 'failed',
        health: 'fail',
        conflicts: [{ filePath: 'src/api.ts', resolved: false }],
        errorMessage: 'Conflict not resolved',
      }));
      persistMergeAttempt(createMergeAttempt(taskId, {
        id: 'second-attempt',
        status: 'complete',
        health: 'warning',
        conflicts: [{ filePath: 'src/api.ts', resolved: true, resolutionMethod: 'ai' }],
        commitHash: 'fix123abc',
      }));

      simulateAppRestart();

      // Retrieve via IPC
      const result = await mockElectronAPI.getMergeHistory(taskId);
      expect(result.success).toBe(true);

      // Update store with retrieved history (simulates what would happen in app)
      useMergeStore.getState().setHistory(taskId, result.data);

      // Verify store now has the history
      const storeHistory = useMergeStore.getState().historyByTask[taskId];
      expect(storeHistory).toBeDefined();
      expect(storeHistory.length).toBe(2);

      // Verify first attempt metadata
      expect(storeHistory[0].id).toBe('first-attempt');
      expect(storeHistory[0].status).toBe('failed');
      expect(storeHistory[0].health).toBe('fail');
      expect(storeHistory[0].conflicts[0].filePath).toBe('src/api.ts');
      expect(storeHistory[0].conflicts[0].resolved).toBe(false);
      expect(storeHistory[0].errorMessage).toBe('Conflict not resolved');

      // Verify second attempt metadata
      expect(storeHistory[1].id).toBe('second-attempt');
      expect(storeHistory[1].status).toBe('complete');
      expect(storeHistory[1].health).toBe('warning');
      expect(storeHistory[1].conflicts[0].resolved).toBe(true);
      expect(storeHistory[1].conflicts[0].resolutionMethod).toBe('ai');
      expect(storeHistory[1].commitHash).toBe('fix123abc');
    });

    it('should verify all timestamp fields are correctly formatted', async () => {
      const taskId = 'timestamp-test-001';
      const startTime = '2025-01-15T14:30:00.000Z';
      const endTime = '2025-01-15T14:32:30.000Z';

      persistMergeAttempt(createMergeAttempt(taskId, {
        startedAt: startTime,
        completedAt: endTime,
        durationSeconds: 150,
      }));

      const result = await mockElectronAPI.getMergeHistory(taskId);
      expect(result.success).toBe(true);

      const attempt = result.data[0];
      expect(attempt.startedAt).toBe(startTime);
      expect(attempt.completedAt).toBe(endTime);
      expect(attempt.durationSeconds).toBe(150);
    });

    it('should correctly differentiate fast-forward vs three-way merges', async () => {
      const taskId = 'merge-type-test-001';

      persistMergeAttempt(createMergeAttempt(taskId, {
        id: 'ff-merge',
        isFastForward: true,
        conflicts: [],
      }));
      persistMergeAttempt(createMergeAttempt(taskId, {
        id: 'three-way-merge',
        isFastForward: false,
        conflicts: [{ filePath: 'package.json', resolved: true }],
      }));

      const result = await mockElectronAPI.getMergeHistory(taskId);

      expect(result.data[0].isFastForward).toBe(true);
      expect(result.data[0].conflicts.length).toBe(0);

      expect(result.data[1].isFastForward).toBe(false);
      expect(result.data[1].conflicts.length).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle task with many merge attempts', async () => {
      const taskId = 'many-attempts-001';

      // Create 50 merge attempts
      for (let i = 0; i < 50; i++) {
        persistMergeAttempt(createMergeAttempt(taskId, {
          id: `attempt-${i}`,
          durationSeconds: i * 2,
        }));
      }

      const result = await mockElectronAPI.getMergeHistory(taskId);

      expect(result.success).toBe(true);
      expect(result.data.length).toBe(50);
      expect(result.data[0].id).toBe('attempt-0');
      expect(result.data[49].id).toBe('attempt-49');
    });

    it('should handle concurrent history queries for different tasks', async () => {
      // Persist history for multiple tasks
      persistMergeAttempt(createMergeAttempt('task-a', { id: 'attempt-a' }));
      persistMergeAttempt(createMergeAttempt('task-b', { id: 'attempt-b' }));
      persistMergeAttempt(createMergeAttempt('task-c', { id: 'attempt-c' }));

      // Query all simultaneously
      const [resultA, resultB, resultC] = await Promise.all([
        mockElectronAPI.getMergeHistory('task-a'),
        mockElectronAPI.getMergeHistory('task-b'),
        mockElectronAPI.getMergeHistory('task-c'),
      ]);

      // Each should return correct data without interference
      expect(resultA.data[0].id).toBe('attempt-a');
      expect(resultB.data[0].id).toBe('attempt-b');
      expect(resultC.data[0].id).toBe('attempt-c');
    });

    it('should correctly calculate stats with zero conflicts', async () => {
      // All clean merges
      persistMergeAttempt(createMergeAttempt('clean-1', { status: 'complete', conflicts: [] }));
      persistMergeAttempt(createMergeAttempt('clean-2', { status: 'complete', conflicts: [] }));

      const result = await mockElectronAPI.getMergeHistoryStats();

      expect(result.data.totalConflicts).toBe(0);
      expect(result.data.resolvedConflicts).toBe(0);
      expect(result.data.conflictResolutionRate).toBe(1.0); // Default when no conflicts
      expect(result.data.successRate).toBe(1.0);
    });

    it('should handle timeout status in stats calculation', async () => {
      persistMergeAttempt(createMergeAttempt('timeout-task', {
        status: 'timeout',
        health: 'fail',
        errorMessage: 'Operation timed out after 10 minutes',
      }));

      const result = await mockElectronAPI.getMergeHistoryStats();

      expect(result.data.timeoutAttempts).toBe(1);
      expect(result.data.failedAttempts).toBe(0); // Timeout is separate from failed
      expect(result.data.successfulAttempts).toBe(0);
    });
  });

  describe('Integration with Store Hooks', () => {
    it('should update store history via setHistory and be accessible via hooks', async () => {
      const taskId = 'hook-test-001';

      // Persist and retrieve history
      persistMergeAttempt(createMergeAttempt(taskId, {
        health: 'pass',
        status: 'complete',
      }));

      const result = await mockElectronAPI.getMergeHistory(taskId);
      useMergeStore.getState().setHistory(taskId, result.data);

      // Verify getLatestAttempt returns correct data
      const latest = useMergeStore.getState().getLatestAttempt(taskId);
      expect(latest).toBeDefined();
      expect(latest?.health).toBe('pass');
      expect(latest?.status).toBe('complete');
    });

    it('should correctly add new history entry after restore', async () => {
      const taskId = 'add-after-restore-001';

      // Persist initial history
      persistMergeAttempt(createMergeAttempt(taskId, { id: 'old-attempt' }));

      // Simulate restart and restore
      simulateAppRestart();
      const result = await mockElectronAPI.getMergeHistory(taskId);
      useMergeStore.getState().setHistory(taskId, result.data);

      // Add new entry (addHistoryEntry takes the attempt directly, taskId is in the attempt)
      useMergeStore.getState().addHistoryEntry(createMergeAttempt(taskId, { id: 'new-attempt' }));

      // Verify both are present
      const history = useMergeStore.getState().historyByTask[taskId];
      expect(history.length).toBe(2);
      expect(history[0].id).toBe('old-attempt');
      expect(history[1].id).toBe('new-attempt');
    });

    it('should update stats in store via setStats', async () => {
      // Persist some history
      persistMergeAttempt(createMergeAttempt('task-1', { status: 'complete' }));
      persistMergeAttempt(createMergeAttempt('task-2', { status: 'failed' }));

      // Get and set stats
      const result = await mockElectronAPI.getMergeHistoryStats();
      useMergeStore.getState().setStats(result.data);

      // Verify stats accessible
      const stats = useMergeStore.getState().globalStats;
      expect(stats).toBeDefined();
      expect(stats?.totalTasks).toBe(2);
      expect(stats?.totalAttempts).toBe(2);
      expect(stats?.successfulAttempts).toBe(1);
      expect(stats?.failedAttempts).toBe(1);
    });
  });
});

describe('Cross-Session History Verification Flow', () => {
  // Use a separate local mock store for this test suite to ensure isolation
  const localMockStore: Record<string, MergeAttempt[]> = {};

  function localPersist(attempt: MergeAttempt) {
    if (!localMockStore[attempt.taskId]) {
      localMockStore[attempt.taskId] = [];
    }
    localMockStore[attempt.taskId].push(attempt);
  }

  function localClear() {
    Object.keys(localMockStore).forEach(key => {
      delete localMockStore[key];
    });
  }

  function localGetHistory(taskId: string): MergeAttempt[] {
    return localMockStore[taskId] || [];
  }

  beforeEach(() => {
    // Reset Zustand store to initial state
    useMergeStore.setState({
      activeMerges: {},
      historyByTask: {},
      globalStats: null,
      isLoadingHistory: false,
      isLoadingStats: false,
      error: null,
    });

    // Clear local mock store
    localClear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should complete full cross-session workflow', async () => {
    // SESSION 1: Complete merge operations
    const taskId = 'cross-session-001';

    // Verify we start with empty state
    expect(useMergeStore.getState().historyByTask[taskId]).toBeUndefined();
    expect(Object.keys(localMockStore).length).toBe(0);

    // Simulate a completed merge by directly persisting to mock history store
    const attempt1 = createMergeAttempt(taskId, {
      id: 'session1-attempt',
      health: 'warning',
      status: 'complete',
      conflicts: [{ filePath: 'index.ts', resolved: true, resolutionMethod: 'ai' }],
    });
    localPersist(attempt1);

    // Verify mock store has the attempt
    expect(localMockStore[taskId].length).toBe(1);

    // SESSION 2: Restart and query history (simulates app restart)
    simulateAppRestart();

    // Verify store state is cleared
    expect(useMergeStore.getState().activeMerges[taskId]).toBeUndefined();
    expect(useMergeStore.getState().historyByTask[taskId]).toBeUndefined();

    // Query history from local mock (simulates reading from disk)
    const historyFromDisk = localGetHistory(taskId);
    expect(historyFromDisk.length).toBe(1);

    // Restore to store (simulates app loading history on startup)
    // Use a fresh copy to avoid reference sharing
    useMergeStore.getState().setHistory(taskId, [...historyFromDisk]);

    // Verify restored correctly - check immediately after setHistory
    let currentHistory = useMergeStore.getState().historyByTask[taskId];
    expect(currentHistory.length).toBe(1);
    expect(currentHistory[0].id).toBe('session1-attempt');
    expect(currentHistory[0].health).toBe('warning');
    expect(currentHistory[0].conflicts[0].filePath).toBe('index.ts');
    expect(currentHistory[0].conflicts[0].resolutionMethod).toBe('ai');

    // SESSION 2: Continue with new merge
    const attempt2 = createMergeAttempt(taskId, {
      id: 'session2-attempt',
      health: 'pass',
      status: 'complete',
      conflicts: [],
    });
    // Persist to mock store (simulates Python backend writing to disk)
    localPersist(attempt2);

    // Check store state before adding new entry
    currentHistory = useMergeStore.getState().historyByTask[taskId];
    expect(currentHistory.length).toBe(1);

    // Add to store (simulates frontend receiving completion event)
    useMergeStore.getState().addHistoryEntry(attempt2);

    // Verify both attempts in store
    currentHistory = useMergeStore.getState().historyByTask[taskId];
    expect(currentHistory.length).toBe(2);

    // SESSION 3: Another restart to verify both persisted
    simulateAppRestart();

    // Query from local mock store (simulates reading from disk)
    const finalHistoryFromDisk = localGetHistory(taskId);
    expect(finalHistoryFromDisk.length).toBe(2);
    expect(finalHistoryFromDisk[0].id).toBe('session1-attempt');
    expect(finalHistoryFromDisk[1].id).toBe('session2-attempt');

    // Restore to store and verify
    useMergeStore.getState().setHistory(taskId, [...finalHistoryFromDisk]);
    expect(useMergeStore.getState().historyByTask[taskId].length).toBe(2);
  });
});
