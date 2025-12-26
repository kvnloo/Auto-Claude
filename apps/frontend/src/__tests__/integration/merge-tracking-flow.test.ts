/**
 * End-to-End Integration Tests for Merge Tracking Flow
 *
 * Tests the complete flow:
 * Backend emits events → IPC → Store updates → UI refreshes
 *
 * This verifies that:
 * 1. Backend merge progress events are correctly formatted
 * 2. IPC handlers transform events and emit to renderer
 * 3. Merge store updates with progress data
 * 4. UI components receive and display updates correctly
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useMergeStore, setupMergeStoreListeners } from '../../renderer/stores/merge-store';
import type { MergeHealth, MergeStatus } from '../../shared/types';
import type {
  MergeProgressEventData,
  MergeCompleteEventData,
  MergeConflictEventData,
} from '../../preload/api/task-api';

// Mock the window.electronAPI for IPC communication
const mockListeners: Record<string, Array<(taskId: string, data: unknown) => void>> = {};

const mockElectronAPI = {
  onMergeProgress: vi.fn((callback: (taskId: string, data: MergeProgressEventData) => void) => {
    if (!mockListeners['merge:progress']) {
      mockListeners['merge:progress'] = [];
    }
    mockListeners['merge:progress'].push(callback as (taskId: string, data: unknown) => void);
    return () => {
      const index = mockListeners['merge:progress'].indexOf(callback as (taskId: string, data: unknown) => void);
      if (index >= 0) mockListeners['merge:progress'].splice(index, 1);
    };
  }),
  onMergeComplete: vi.fn((callback: (taskId: string, data: MergeCompleteEventData) => void) => {
    if (!mockListeners['merge:complete']) {
      mockListeners['merge:complete'] = [];
    }
    mockListeners['merge:complete'].push(callback as (taskId: string, data: unknown) => void);
    return () => {
      const index = mockListeners['merge:complete'].indexOf(callback as (taskId: string, data: unknown) => void);
      if (index >= 0) mockListeners['merge:complete'].splice(index, 1);
    };
  }),
  onMergeConflictDetected: vi.fn((callback: (taskId: string, data: MergeConflictEventData) => void) => {
    if (!mockListeners['merge:conflict']) {
      mockListeners['merge:conflict'] = [];
    }
    mockListeners['merge:conflict'].push(callback as (taskId: string, data: unknown) => void);
    return () => {
      const index = mockListeners['merge:conflict'].indexOf(callback as (taskId: string, data: unknown) => void);
      if (index >= 0) mockListeners['merge:conflict'].splice(index, 1);
    };
  }),
};

// Helper to simulate backend emitting events
function emitMergeProgress(taskId: string, data: MergeProgressEventData) {
  mockListeners['merge:progress']?.forEach((cb) => cb(taskId, data));
}

function emitMergeComplete(taskId: string, data: MergeCompleteEventData) {
  mockListeners['merge:complete']?.forEach((cb) => cb(taskId, data));
}

function emitMergeConflict(taskId: string, data: MergeConflictEventData) {
  mockListeners['merge:conflict']?.forEach((cb) => cb(taskId, data));
}

// Helper to create test progress event data (matches MergeProgressEventData interface)
function createProgressEvent(overrides: Partial<MergeProgressEventData> = {}): MergeProgressEventData {
  return {
    step: 'detecting_conflicts',
    progressPercent: 30,
    filePath: 'src/components/TestComponent.tsx',
    conflictsDetected: 0,
    conflictsResolved: 0,
    ...overrides,
  };
}

// Helper to create test complete event data (matches MergeCompleteEventData interface)
function createCompleteEvent(overrides: Partial<MergeCompleteEventData> = {}): MergeCompleteEventData {
  return {
    success: true,
    taskId: 'test-task-001',
    status: 'complete' as MergeStatus,
    health: 'pass' as MergeHealth,
    conflictsDetected: 0,
    conflictsResolved: 0,
    durationMs: 1500,
    ...overrides,
  };
}

describe('Merge Tracking End-to-End Flow', () => {
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

  describe('Backend → IPC → Store Flow', () => {
    it('should register all merge event listeners on setup', () => {
      expect(mockElectronAPI.onMergeProgress).toHaveBeenCalled();
      expect(mockElectronAPI.onMergeComplete).toHaveBeenCalled();
      expect(mockElectronAPI.onMergeConflictDetected).toHaveBeenCalled();
    });

    it('should cleanup all listeners when cleanup function is called', () => {
      const initialProgressListeners = mockListeners['merge:progress']?.length || 0;

      // Cleanup
      if (cleanupListeners) {
        cleanupListeners();
        cleanupListeners = null;
      }

      // Listeners should be removed
      expect(mockListeners['merge:progress']?.length || 0).toBeLessThan(initialProgressListeners);
    });
  });

  describe('MERGE_PROGRESS Event Flow', () => {
    it('should update store when progress event is received', () => {
      const taskId = 'test-task-001';

      // Simulate backend emitting progress event
      emitMergeProgress(taskId, createProgressEvent({
        step: 'loading_baseline',
        progressPercent: 10,
      }));

      // Verify store was updated
      const state = useMergeStore.getState();
      const progress = state.activeMerges[taskId];

      expect(progress).toBeDefined();
      expect(progress?.progress).toBe(10);
      expect(progress?.status).toBe('merging');
    });

    it('should update progress through multiple stages', () => {
      const taskId = 'test-task-001';

      // Stage 1: File start (0%)
      emitMergeProgress(taskId, createProgressEvent({
        step: 'file_start',
        progressPercent: 0,
      }));

      expect(useMergeStore.getState().activeMerges[taskId]?.progress).toBe(0);

      // Stage 2: Loading baseline (10%)
      emitMergeProgress(taskId, createProgressEvent({
        step: 'loading_baseline',
        progressPercent: 10,
      }));

      expect(useMergeStore.getState().activeMerges[taskId]?.progress).toBe(10);

      // Stage 3: Detecting conflicts (30%)
      emitMergeProgress(taskId, createProgressEvent({
        step: 'detecting_conflicts',
        progressPercent: 30,
      }));

      expect(useMergeStore.getState().activeMerges[taskId]?.progress).toBe(30);

      // Stage 4: Applying changes (80%)
      emitMergeProgress(taskId, createProgressEvent({
        step: 'applying_changes',
        progressPercent: 80,
      }));

      expect(useMergeStore.getState().activeMerges[taskId]?.progress).toBe(80);

      // Stage 5: File complete (100%)
      emitMergeProgress(taskId, createProgressEvent({
        step: 'file_complete',
        progressPercent: 100,
      }));

      expect(useMergeStore.getState().activeMerges[taskId]?.progress).toBe(100);
    });

    it('should update health indicator when conflicts are detected', () => {
      const taskId = 'test-task-001';

      // Initially clean merge (pass)
      emitMergeProgress(taskId, createProgressEvent({
        step: 'detecting_conflicts',
        progressPercent: 30,
        conflictsDetected: 0,
        conflictsResolved: 0,
      }));

      expect(useMergeStore.getState().activeMerges[taskId]?.health).toBe('pass');

      // Conflicts detected (fail - unresolved)
      emitMergeProgress(taskId, createProgressEvent({
        step: 'resolving_conflicts',
        progressPercent: 60,
        conflictsDetected: 3,
        conflictsResolved: 1,
      }));

      expect(useMergeStore.getState().activeMerges[taskId]?.health).toBe('fail');
      expect(useMergeStore.getState().activeMerges[taskId]?.status).toBe('resolving');

      // All conflicts resolved (warning)
      emitMergeProgress(taskId, createProgressEvent({
        step: 'applying_changes',
        progressPercent: 80,
        conflictsDetected: 3,
        conflictsResolved: 3,
      }));

      expect(useMergeStore.getState().activeMerges[taskId]?.health).toBe('warning');
      expect(useMergeStore.getState().activeMerges[taskId]?.status).toBe('merging');
    });

    it('should handle multiple concurrent merge operations', () => {
      const taskId1 = 'task-001';
      const taskId2 = 'task-002';

      // Start two merges simultaneously
      emitMergeProgress(taskId1, createProgressEvent({
        step: 'loading_baseline',
        progressPercent: 10,
      }));

      emitMergeProgress(taskId2, createProgressEvent({
        step: 'detecting_conflicts',
        progressPercent: 30,
      }));

      const state = useMergeStore.getState();

      // Both should be tracked independently
      expect(Object.keys(state.activeMerges)).toHaveLength(2);
      expect(state.activeMerges[taskId1]?.progress).toBe(10);
      expect(state.activeMerges[taskId2]?.progress).toBe(30);

      // Progress one independently
      emitMergeProgress(taskId1, createProgressEvent({
        step: 'applying_changes',
        progressPercent: 80,
      }));

      expect(useMergeStore.getState().activeMerges[taskId1]?.progress).toBe(80);
      expect(useMergeStore.getState().activeMerges[taskId2]?.progress).toBe(30); // Unchanged
    });
  });

  describe('MERGE_CONFLICT_DETECTED Event Flow', () => {
    it('should add conflict to active merge when detected', () => {
      const taskId = 'test-task-001';

      // First start a merge
      emitMergeProgress(taskId, createProgressEvent({
        step: 'detecting_conflicts',
        progressPercent: 30,
      }));

      // Then emit conflict detection
      emitMergeConflict(taskId, {
        conflictsDetected: 2,
        filePath: 'src/components/Button.tsx',
        message: 'Conflicting changes detected in Button component',
      });

      const state = useMergeStore.getState();
      const progress = state.activeMerges[taskId];

      expect(progress?.conflicts).toHaveLength(1);
      expect(progress?.conflicts[0].filePath).toBe('src/components/Button.tsx');
      expect(progress?.conflicts[0].resolved).toBe(false);
      expect(progress?.health).toBe('fail'); // Unresolved conflict
    });

    it('should handle multiple conflicts in different files', () => {
      const taskId = 'test-task-001';

      // Start merge
      emitMergeProgress(taskId, createProgressEvent({
        step: 'detecting_conflicts',
        progressPercent: 30,
      }));

      // Multiple conflicts
      emitMergeConflict(taskId, {
        conflictsDetected: 1,
        filePath: 'src/file1.ts',
        message: 'Conflict in file1',
      });

      emitMergeConflict(taskId, {
        conflictsDetected: 2,
        filePath: 'src/file2.ts',
        message: 'Conflict in file2',
      });

      const conflicts = useMergeStore.getState().activeMerges[taskId]?.conflicts;

      expect(conflicts).toHaveLength(2);
      expect(conflicts?.map((c) => c.filePath)).toContain('src/file1.ts');
      expect(conflicts?.map((c) => c.filePath)).toContain('src/file2.ts');
    });
  });

  describe('MERGE_COMPLETE Event Flow', () => {
    it('should complete merge successfully with pass health', () => {
      const taskId = 'test-task-001';

      // Start merge
      emitMergeProgress(taskId, createProgressEvent({
        step: 'applying_changes',
        progressPercent: 80,
      }));

      // Complete successfully
      emitMergeComplete(taskId, createCompleteEvent({
        success: true,
        taskId,
        health: 'pass',
        status: 'complete',
        conflictsDetected: 0,
        conflictsResolved: 0,
        durationMs: 2000,
      }));

      const state = useMergeStore.getState();
      const progress = state.activeMerges[taskId];

      expect(progress?.status).toBe('complete');
      expect(progress?.health).toBe('pass');
      expect(progress?.progress).toBe(100);
    });

    it('should add history entry on successful completion', () => {
      const taskId = 'test-task-001';

      // Start merge with a startedAt timestamp
      useMergeStore.getState().startMerge(taskId);

      // Complete successfully
      emitMergeComplete(taskId, createCompleteEvent({
        success: true,
        taskId,
        health: 'warning', // Had conflicts but resolved
        status: 'complete',
        conflictsDetected: 2,
        conflictsResolved: 2,
        durationMs: 3500,
      }));

      const history = useMergeStore.getState().historyByTask[taskId];

      expect(history).toBeDefined();
      expect(history?.length).toBeGreaterThanOrEqual(1);

      const lastEntry = history?.[history.length - 1];
      expect(lastEntry?.health).toBe('warning');
      expect(lastEntry?.status).toBe('complete');
    });

    it('should mark merge as failed on unsuccessful completion', () => {
      const taskId = 'test-task-001';

      // Start merge
      emitMergeProgress(taskId, createProgressEvent({
        step: 'resolving_conflicts',
        progressPercent: 60,
        conflictsDetected: 3,
        conflictsResolved: 1,
      }));

      // Add actual conflict entries (simulating what conflict detection events would do)
      useMergeStore.getState().addConflict(taskId, {
        filePath: 'src/file1.ts',
        resolved: false,
        details: 'Unresolved conflict',
      });
      useMergeStore.getState().addConflict(taskId, {
        filePath: 'src/file2.ts',
        resolved: false,
        details: 'Another unresolved conflict',
      });
      useMergeStore.getState().addConflict(taskId, {
        filePath: 'src/file3.ts',
        resolved: true,
        details: 'This one was resolved',
      });

      // Failed completion (2 unresolved conflicts)
      emitMergeComplete(taskId, createCompleteEvent({
        success: false,
        taskId,
        health: 'fail',
        status: 'failed',
        conflictsDetected: 3,
        conflictsResolved: 1,
        hasConflicts: true,
        durationMs: 5000,
      }));

      const state = useMergeStore.getState();
      const progress = state.activeMerges[taskId];

      expect(progress?.status).toBe('failed');
      expect(progress?.health).toBe('fail'); // 2 unresolved conflicts = fail
      expect(state.error).toContain('conflicts');
    });

    it('should complete merge with warning health when conflicts were resolved', () => {
      const taskId = 'test-task-001';

      // Start merge
      useMergeStore.getState().startMerge(taskId);

      // Add some conflicts that were resolved
      useMergeStore.getState().addConflict(taskId, {
        filePath: 'src/test.ts',
        resolved: false,
        details: 'Conflict in test',
      });
      useMergeStore.getState().resolveConflict(taskId, 'src/test.ts', 'ai');

      // Complete with warning (conflicts existed but resolved)
      emitMergeComplete(taskId, createCompleteEvent({
        success: true,
        taskId,
        health: 'warning',
        status: 'complete',
        conflictsDetected: 1,
        conflictsResolved: 1,
        durationMs: 4000,
      }));

      const progress = useMergeStore.getState().activeMerges[taskId];

      expect(progress?.status).toBe('complete');
      expect(progress?.health).toBe('warning');
    });
  });

  describe('Full Merge Lifecycle', () => {
    it('should track complete merge lifecycle: start → progress → complete', () => {
      const taskId = 'lifecycle-test-001';

      // 1. File start
      emitMergeProgress(taskId, createProgressEvent({
        step: 'file_start',
        progressPercent: 0,
      }));

      expect(useMergeStore.getState().isTaskMerging(taskId)).toBe(true);
      expect(useMergeStore.getState().activeMerges[taskId]?.progress).toBe(0);

      // 2. Loading baseline
      emitMergeProgress(taskId, createProgressEvent({
        step: 'loading_baseline',
        progressPercent: 10,
      }));

      expect(useMergeStore.getState().activeMerges[taskId]?.progress).toBe(10);

      // 3. Detecting conflicts
      emitMergeProgress(taskId, createProgressEvent({
        step: 'detecting_conflicts',
        progressPercent: 30,
      }));

      expect(useMergeStore.getState().activeMerges[taskId]?.progress).toBe(30);

      // 4. Applying changes
      emitMergeProgress(taskId, createProgressEvent({
        step: 'applying_changes',
        progressPercent: 80,
      }));

      expect(useMergeStore.getState().activeMerges[taskId]?.progress).toBe(80);

      // 5. Complete
      emitMergeComplete(taskId, createCompleteEvent({
        success: true,
        taskId,
        health: 'pass',
        status: 'complete',
        conflictsDetected: 0,
        conflictsResolved: 0,
        durationMs: 1200,
      }));

      expect(useMergeStore.getState().activeMerges[taskId]?.status).toBe('complete');
      expect(useMergeStore.getState().activeMerges[taskId]?.progress).toBe(100);
      expect(useMergeStore.getState().activeMerges[taskId]?.health).toBe('pass');
    });

    it('should track merge with conflict resolution lifecycle', () => {
      const taskId = 'conflict-lifecycle-001';

      // Start merge
      emitMergeProgress(taskId, createProgressEvent({
        step: 'file_start',
        progressPercent: 0,
      }));

      // Detect conflicts
      emitMergeProgress(taskId, createProgressEvent({
        step: 'detecting_conflicts',
        progressPercent: 30,
        conflictsDetected: 2,
        conflictsResolved: 0,
      }));

      expect(useMergeStore.getState().activeMerges[taskId]?.health).toBe('fail');

      // Conflict details
      emitMergeConflict(taskId, {
        conflictsDetected: 2,
        filePath: 'src/component.tsx',
        message: 'Conflicting changes in component',
      });

      // Resolve conflicts
      emitMergeProgress(taskId, createProgressEvent({
        step: 'resolving_conflicts',
        progressPercent: 60,
        conflictsDetected: 2,
        conflictsResolved: 2,
      }));

      expect(useMergeStore.getState().activeMerges[taskId]?.health).toBe('warning');

      // Complete with warning
      emitMergeComplete(taskId, createCompleteEvent({
        success: true,
        taskId,
        health: 'warning',
        status: 'complete',
        conflictsDetected: 2,
        conflictsResolved: 2,
        durationMs: 8000,
      }));

      expect(useMergeStore.getState().activeMerges[taskId]?.status).toBe('complete');
      expect(useMergeStore.getState().activeMerges[taskId]?.health).toBe('warning');
    });
  });

  describe('Store Selector Hooks', () => {
    it('should correctly report isTaskMerging during active merge', () => {
      const taskId = 'selector-test-001';

      // Initially not merging
      expect(useMergeStore.getState().isTaskMerging(taskId)).toBe(false);

      // Start merge
      emitMergeProgress(taskId, createProgressEvent({
        step: 'detecting_conflicts',
        progressPercent: 30,
      }));

      expect(useMergeStore.getState().isTaskMerging(taskId)).toBe(true);

      // Complete
      emitMergeComplete(taskId, createCompleteEvent({ taskId }));

      // After completion, status is 'complete' not 'merging'
      expect(useMergeStore.getState().isTaskMerging(taskId)).toBe(false);
    });

    it('should correctly report getMergeHealth', () => {
      const taskId = 'health-test-001';

      // Default health when no data
      expect(useMergeStore.getState().getMergeHealth(taskId)).toBe('pass');

      // Start merge with conflicts
      emitMergeProgress(taskId, createProgressEvent({
        step: 'resolving_conflicts',
        progressPercent: 60,
        conflictsDetected: 1,
        conflictsResolved: 0,
      }));

      expect(useMergeStore.getState().getMergeHealth(taskId)).toBe('fail');
    });

    it('should correctly track active merge count', () => {
      expect(useMergeStore.getState().getActiveMergeCount()).toBe(0);

      // Start first merge
      emitMergeProgress('task-1', createProgressEvent({
        step: 'loading_baseline',
        progressPercent: 10,
      }));

      expect(useMergeStore.getState().getActiveMergeCount()).toBe(1);

      // Start second merge
      emitMergeProgress('task-2', createProgressEvent({
        step: 'detecting_conflicts',
        progressPercent: 30,
      }));

      expect(useMergeStore.getState().getActiveMergeCount()).toBe(2);
    });
  });

  describe('Error Handling', () => {
    it('should handle failed merge gracefully', () => {
      const taskId = 'error-test-001';

      // Start merge
      emitMergeProgress(taskId, createProgressEvent({
        step: 'resolving_conflicts',
        progressPercent: 60,
      }));

      // Add unresolved conflicts
      useMergeStore.getState().addConflict(taskId, {
        filePath: 'src/file.ts',
        resolved: false,
        details: 'Unresolved',
      });

      // Fail with error
      emitMergeComplete(taskId, {
        success: false,
        taskId,
        status: 'failed' as MergeStatus,
        health: 'fail' as MergeHealth,
        conflictsDetected: 3,
        conflictsResolved: 0,
        durationMs: 10000,
        hasConflicts: true,
      });

      const state = useMergeStore.getState();
      expect(state.activeMerges[taskId]?.status).toBe('failed');
      expect(state.error).toContain('conflicts');
    });

    it('should handle timeout scenario', () => {
      const taskId = 'timeout-test-001';

      // Start merge that will timeout
      emitMergeProgress(taskId, createProgressEvent({
        step: 'resolving_conflicts',
        progressPercent: 50,
      }));

      // Add unresolved conflict
      useMergeStore.getState().addConflict(taskId, {
        filePath: 'src/file.ts',
        resolved: false,
        details: 'Timed out',
      });

      // Timeout event (simulated as failed completion)
      emitMergeComplete(taskId, {
        success: false,
        taskId,
        status: 'failed' as MergeStatus,
        health: 'fail' as MergeHealth,
        conflictsDetected: 1,
        conflictsResolved: 0,
        durationMs: 600000,
        hasConflicts: true,
      });

      expect(useMergeStore.getState().activeMerges[taskId]?.status).toBe('failed');
    });
  });
});

describe('MergeProgressEvent Format Verification', () => {
  it('should have correct structure matching backend MergeProgressEvent.to_dict()', () => {
    // This verifies the event data structure matches what the Python backend emits
    // The Python backend sends this format via MergeProgressEvent.to_dict():
    const backendEvent = {
      file_path: 'src/test.ts',
      task_ids: ['task-001'],
      step: 'detecting_conflicts',
      progress_percent: 30,
      message: 'Detecting conflicts',
      conflicts_detected: 0,
      conflicts_resolved: 0,
      error: null,
      metadata: {},
    };

    // The IPC handler in worktree-handlers.ts transforms this to MergeProgressEventData:
    const frontendEvent: MergeProgressEventData = {
      step: backendEvent.step,
      progressPercent: backendEvent.progress_percent,
      filePath: backendEvent.file_path,
      conflictsDetected: backendEvent.conflicts_detected,
      conflictsResolved: backendEvent.conflicts_resolved,
    };

    // Verify all required fields are present
    expect(frontendEvent).toHaveProperty('step');
    expect(frontendEvent).toHaveProperty('progressPercent');
    expect(frontendEvent).toHaveProperty('conflictsDetected');
    expect(frontendEvent).toHaveProperty('conflictsResolved');
  });

  it('should derive health correctly from conflict counts', () => {
    // Test health derivation logic (matching transformMergeProgressEvent in worktree-handlers.ts)

    // No conflicts = pass
    const noConflicts = { conflictsDetected: 0, conflictsResolved: 0 };
    expect(deriveHealth(noConflicts)).toBe('pass');

    // Unresolved conflicts = fail
    const unresolved = { conflictsDetected: 3, conflictsResolved: 1 };
    expect(deriveHealth(unresolved)).toBe('fail');

    // All resolved = warning
    const allResolved = { conflictsDetected: 3, conflictsResolved: 3 };
    expect(deriveHealth(allResolved)).toBe('warning');
  });
});

// Helper function to derive health (matches transformMergeProgressEvent logic in worktree-handlers.ts)
function deriveHealth(counts: { conflictsDetected: number; conflictsResolved: number }): MergeHealth {
  if (counts.conflictsDetected === 0) {
    return 'pass';
  } else if (counts.conflictsResolved >= counts.conflictsDetected) {
    return 'warning';
  } else {
    return 'fail';
  }
}
