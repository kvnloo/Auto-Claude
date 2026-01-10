/**
 * Task Store - Central state management for Auto Claude tasks
 *
 * PERFORMANCE OPTIMIZATION: This store uses Zustand's immer middleware for efficient state updates.
 *
 * WHY IMMER?
 * - Before: Every task update created a new array with [...tasks], an O(n) operation
 * - After: Direct draft mutations allow O(1) updates to individual tasks
 * - Critical for appendLog: Logs can be appended multiple times per second during builds
 * - Reduces GC pressure and unnecessary re-renders across the application
 *
 * IMMER USAGE PATTERN:
 * Instead of:
 *   set((state) => ({
 *     tasks: state.tasks.map(t => t.id === taskId ? { ...t, ...updates } : t)
 *   }))
 *
 * Use:
 *   set((draft) => {
 *     const task = draft.tasks[index];
 *     Object.assign(task, updates);
 *   })
 *
 * KEY PRINCIPLES:
 * 1. Mutate draft state directly - immer handles immutability behind the scenes
 * 2. Use draft.tasks.push() instead of [...state.tasks, newTask]
 * 3. Use Object.assign() or direct property assignment (task.status = 'done')
 * 4. Don't return anything from the set() callback - immer tracks mutations
 * 5. findTaskIndex() helper locates tasks efficiently before mutation
 *
 * MIGRATION NOTES:
 * - All task update functions migrated to immer draft mutations (subtask-3 through subtask-9)
 * - updateTaskAtIndex helper removed as it's no longer needed (subtask-10)
 * - findTaskIndex helper retained for efficient task lookup by id or specId
 *
 * @see https://github.com/pmndrs/zustand/blob/main/docs/integrations/immer-middleware.md
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Task, TaskStatus, SubtaskStatus, ImplementationPlan, Subtask, TaskMetadata, ExecutionProgress, ExecutionPhase, ReviewReason, TaskDraft } from '../../shared/types';
import { debugLog } from '../../shared/utils/debug-logger';

interface TaskState {
  tasks: Task[];
  selectedTaskId: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setTasks: (tasks: Task[]) => void;
  addTask: (task: Task) => void;
  updateTask: (taskId: string, updates: Partial<Task>) => void;
  updateTaskStatus: (taskId: string, status: TaskStatus) => void;
  updateTaskFromPlan: (taskId: string, plan: ImplementationPlan) => void;
  updateExecutionProgress: (taskId: string, progress: Partial<ExecutionProgress>) => void;
  appendLog: (taskId: string, log: string) => void;
  batchAppendLogs: (taskId: string, logs: string[]) => void;
  selectTask: (taskId: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearTasks: () => void;

  // Selectors
  getSelectedTask: () => Task | undefined;
  getTasksByStatus: (status: TaskStatus) => Task[];
}

/**
 * Helper to find task index by id or specId.
 * Returns -1 if not found.
 */
function findTaskIndex(tasks: Task[], taskId: string): number {
  return tasks.findIndex((t) => t.id === taskId || t.specId === taskId);
}

/**
 * Validates implementation plan data structure before processing.
 * Returns true if valid, false if invalid/incomplete.
 */
function validatePlanData(plan: ImplementationPlan): boolean {
  // Validate plan has phases array
  if (!plan.phases || !Array.isArray(plan.phases)) {
    console.warn('[validatePlanData] Invalid plan: missing or invalid phases array');
    return false;
  }

  // Validate each phase has subtasks array
  for (let i = 0; i < plan.phases.length; i++) {
    const phase = plan.phases[i];
    if (!phase || !phase.subtasks || !Array.isArray(phase.subtasks)) {
      console.warn(`[validatePlanData] Invalid phase ${i}: missing or invalid subtasks array`);
      return false;
    }

    // Validate each subtask has at minimum a description
    for (let j = 0; j < phase.subtasks.length; j++) {
      const subtask = phase.subtasks[j];
      if (!subtask || typeof subtask !== 'object') {
        console.warn(`[validatePlanData] Invalid subtask at phase ${i}, index ${j}: not an object`);
        return false;
      }

      // Description is critical - we can't show a subtask without it
      if (!subtask.description || typeof subtask.description !== 'string' || subtask.description.trim() === '') {
        console.warn(`[validatePlanData] Invalid subtask at phase ${i}, index ${j}: missing or empty description`);
        return false;
      }
    }
  }

  return true;
}

/**
 * Task store with immer middleware
 *
 * The store is created using Zustand's curried syntax with immer middleware:
 * create<TaskState>()(immer((set, get) => ({...})))
 *
 * This allows all `set()` callbacks to receive a mutable draft state that
 * immer automatically converts to immutable updates behind the scenes.
 */
export const useTaskStore = create<TaskState>()(
  immer((set, get) => ({
    tasks: [],
    selectedTaskId: null,
    isLoading: false,
    error: null,

  setTasks: (tasks) => set({ tasks }),

  /**
   * Add a new task to the store
   *
   * IMMER PATTERN: Uses draft.tasks.push() instead of array spread
   * - Old approach: set((state) => ({ tasks: [...state.tasks, task] }))
   * - New approach: draft.tasks.push(task)
   * - Performance: O(1) push vs O(n) array copy
   */
  addTask: (task) =>
    set((draft) => {
      draft.tasks.push(task);
    }),

  /**
   * Update task properties
   *
   * IMMER PATTERN: Direct mutation with Object.assign()
   * - Old approach: tasks.map(t => t.id === taskId ? { ...t, ...updates } : t)
   * - New approach: Object.assign(draft.tasks[index], updates)
   * - Performance: O(1) direct mutation vs O(n) array iteration + spread
   */
  updateTask: (taskId, updates) =>
    set((draft) => {
      const index = findTaskIndex(draft.tasks, taskId);
      if (index === -1) return;

      // Direct mutation with immer - no need for spread operations
      Object.assign(draft.tasks[index], updates);
    }),

  /**
   * Update task status and execution progress
   *
   * IMMER PATTERN: Direct property assignment on draft state
   * - Old approach: tasks.map(t => t.id === taskId ? { ...t, status, executionProgress, updatedAt } : t)
   * - New approach: task.status = status; task.executionProgress = ...; task.updatedAt = ...
   * - Performance: O(1) direct mutation vs O(n) array iteration + spread
   */
  updateTaskStatus: (taskId, status) =>
    set((draft) => {
      const index = findTaskIndex(draft.tasks, taskId);
      if (index === -1) return;

      const task = draft.tasks[index];

      // Determine execution progress based on status transition
      let executionProgress = task.executionProgress;

      if (status === 'backlog') {
        // When status goes to backlog, reset execution progress to idle
        // This ensures the planning/coding animation stops when task is stopped
        executionProgress = { phase: 'idle' as ExecutionPhase, phaseProgress: 0, overallProgress: 0 };
      } else if (status === 'in_progress' && !task.executionProgress?.phase) {
        // When starting a task and no phase is set yet, default to planning
        // This prevents the "no active phase" UI state during startup race condition
        executionProgress = { phase: 'planning' as ExecutionPhase, phaseProgress: 0, overallProgress: 0 };
      }

      // Direct mutation with immer - no need for spread operations
      task.status = status;
      task.executionProgress = executionProgress;
      task.updatedAt = new Date();
    }),

  /**
   * Update task with implementation plan data
   *
   * IMMER PATTERN: Direct property assignment on draft state
   * - Old approach: Complex nested spread operations creating new task and tasks array
   * - New approach: Direct mutations on task properties (task.title, task.subtasks, etc.)
   * - Performance: O(1) direct mutation vs O(n) array iteration + deep object spread
   *
   * NOTE: This function handles complex logic for status transitions, subtask creation,
   * and race condition prevention. All mutations use immer draft pattern.
   */
  updateTaskFromPlan: (taskId, plan) =>
    set((draft) => {
      // FIX (PR Review): Gate debug logging to prevent production console clutter
      debugLog('[updateTaskFromPlan] called with plan:', {
        taskId,
        feature: plan.feature,
        phases: plan.phases?.length || 0,
        totalSubtasks: plan.phases?.reduce((acc, p) => acc + (p.subtasks?.length || 0), 0) || 0
        // Note: planData removed to avoid verbose output in logs
      });

      const index = findTaskIndex(draft.tasks, taskId);
      if (index === -1) {
        console.warn('[updateTaskFromPlan] Task not found:', taskId);
        return;
      }

      // Validate plan data before processing
      if (!validatePlanData(plan)) {
        console.error('[updateTaskFromPlan] Invalid plan data, skipping update:', {
          taskId,
          plan
        });
        return;
      }

      const task = draft.tasks[index];

      const subtasks: Subtask[] = plan.phases.flatMap((phase) =>
        phase.subtasks.map((subtask) => {
          // Ensure all required fields have valid values to prevent UI issues
          // Use crypto.randomUUID() for stronger randomness when available
          const id = subtask.id || (typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `subtask-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
          // Defensive fallback: validatePlanData() ensures description exists, but kept for safety
          const description = subtask.description || 'No description available';
          const title = description; // Title and description are the same for subtasks
          const status = (subtask.status as SubtaskStatus) || 'pending';

          return {
            id,
            title,
            description,
            status,
            files: [],
            verification: subtask.verification as Subtask['verification']
          };
        })
      );

      debugLog('[updateTaskFromPlan] Created subtasks:', {
        taskId,
        subtaskCount: subtasks.length,
        subtasks: subtasks.map(s => ({
          id: s.id,
          title: s.title,
          status: s.status
        }))
      });

      const allCompleted = subtasks.every((s) => s.status === 'completed');
      const anyFailed = subtasks.some((s) => s.status === 'failed');
      const anyInProgress = subtasks.some((s) => s.status === 'in_progress');
      const anyCompleted = subtasks.some((s) => s.status === 'completed');

      let status: TaskStatus = task.status;
      let reviewReason: ReviewReason | undefined = task.reviewReason;

      // RACE CONDITION FIX: Don't let stale plan data override status during active execution
      const activePhases: ExecutionPhase[] = ['planning', 'coding', 'qa_review', 'qa_fixing'];
      const isInActivePhase = task.executionProgress?.phase && activePhases.includes(task.executionProgress.phase);

      // FIX (Flip-Flop Bug): Terminal phases should NOT trigger status recalculation
      // When phase is 'complete' or 'failed', the task has finished and status should be stable
      const terminalPhases: ExecutionPhase[] = ['complete', 'failed'];
      const isInTerminalPhase = task.executionProgress?.phase && terminalPhases.includes(task.executionProgress.phase);

      // FIX (Flip-Flop Bug): Respect explicit human_review status from plan file
      // When the plan explicitly says 'human_review', don't override it with calculated status
      // Note: ImplementationPlan type already defines status?: TaskStatus
      const planStatus = plan.status;
      const isExplicitHumanReview = planStatus === 'human_review';

      // Only recalculate status if:
      // 1. NOT in an active execution phase (planning, coding, qa_review, qa_fixing)
      // 2. NOT in a terminal phase (complete, failed) - status should be stable
      // 3. Plan doesn't explicitly say human_review
      if (!isInActivePhase && !isInTerminalPhase && !isExplicitHumanReview) {
        if (allCompleted) {
          // FIX (Flip-Flop Bug): Don't downgrade from terminal statuses to ai_review
          // Once a task reaches human_review, pr_created, or done, it should stay there
          // unless explicitly changed (these are finalized workflow states)
          const terminalStatuses: TaskStatus[] = ['human_review', 'pr_created', 'done'];
          if (!terminalStatuses.includes(task.status)) {
            status = 'ai_review';
          }
        } else if (anyFailed) {
          status = 'human_review';
          reviewReason = 'errors';
        } else if (anyInProgress || anyCompleted) {
          status = 'in_progress';
        }
      }

      debugLog('[updateTaskFromPlan] Status computation:', {
        taskId,
        currentStatus: task.status,
        newStatus: status,
        isInActivePhase,
        isInTerminalPhase,
        isExplicitHumanReview,
        planStatus,
        currentPhase: task.executionProgress?.phase,
        allCompleted,
        anyFailed,
        anyInProgress,
        anyCompleted
      });

      // Direct mutation with immer - no need for spread operations
      task.title = plan.feature || task.title;
      task.subtasks = subtasks;
      task.status = status;
      task.reviewReason = reviewReason;
      task.updatedAt = new Date();
    }),

  /**
   * Update task execution progress (phase, progress percentages)
   *
   * IMMER PATTERN: Direct property assignment on draft state
   * - Old approach: tasks.map(t => t.id === taskId ? { ...t, executionProgress: {...}, updatedAt } : t)
   * - New approach: task.executionProgress = {...}; task.updatedAt = ...
   * - Performance: O(1) direct mutation vs O(n) array iteration + spread
   *
   * NOTE: This function includes sequence number validation to prevent out-of-order updates
   * during async progress reporting. Only updates updatedAt on phase changes to minimize re-renders.
   */
  updateExecutionProgress: (taskId, progress) =>
    set((draft) => {
      const index = findTaskIndex(draft.tasks, taskId);
      if (index === -1) return;

      const task = draft.tasks[index];

      const existingProgress = task.executionProgress || {
        phase: 'idle' as ExecutionPhase,
        phaseProgress: 0,
        overallProgress: 0,
        sequenceNumber: 0
      };

      const incomingSeq = progress.sequenceNumber ?? 0;
      const currentSeq = existingProgress.sequenceNumber ?? 0;
      if (incomingSeq > 0 && currentSeq > 0 && incomingSeq < currentSeq) {
        // FIX (ACS-55): Log when updates are dropped due to sequence numbers
        // This helps debug phase transition issues
        console.warn('[updateExecutionProgress] Dropping out-of-order update:', {
          taskId,
          incomingSeq,
          currentSeq,
          incomingPhase: progress.phase,
          currentPhase: existingProgress.phase
        });
        return; // Skip out-of-order update
      }

      // Only update updatedAt on phase transitions (not on every progress tick)
      // This prevents unnecessary re-renders from the memo comparator
      const phaseChanged = progress.phase && progress.phase !== existingProgress.phase;

      // Direct mutation with immer - no need for spread operations
      task.executionProgress = {
        ...existingProgress,
        ...progress
      };

      // Only set updatedAt on phase changes to reduce re-renders
      if (phaseChanged) {
        task.updatedAt = new Date();
      }
    }),

  /**
   * Append a single log entry to task logs
   *
   * IMMER PATTERN: Direct array push on draft state
   * - Old approach: tasks.map(t => t.id === taskId ? { ...t, logs: [...(t.logs || []), log] } : t)
   * - New approach: task.logs.push(log)
   * - Performance: O(1) push vs O(n) task array copy + O(m) log array copy
   *
   * CRITICAL: This function can fire multiple times per second during build execution.
   * The immer optimization eliminates O(n) array creation on every log append,
   * significantly reducing GC pressure and preventing UI stuttering.
   */
  appendLog: (taskId, log) =>
    set((draft) => {
      const index = findTaskIndex(draft.tasks, taskId);
      if (index === -1) return;

      // Direct mutation with immer - no need for spread operations
      const task = draft.tasks[index];
      if (!task.logs) {
        task.logs = [];
      }
      task.logs.push(log);
    }),

  /**
   * Batch append multiple log entries at once
   *
   * IMMER PATTERN: Direct array push with spread operator on draft state
   * - Old approach: tasks.map(t => t.id === taskId ? { ...t, logs: [...(t.logs || []), ...logs] } : t)
   * - New approach: task.logs.push(...logs)
   * - Performance: O(1) push vs O(n) task array copy + O(m) log array copy
   *
   * NOTE: Batching reduces the number of state updates and re-renders.
   * Use this when you have multiple logs to append from a single operation.
   */
  batchAppendLogs: (taskId, logs) =>
    set((draft) => {
      if (logs.length === 0) return;
      const index = findTaskIndex(draft.tasks, taskId);
      if (index === -1) return;

      // Direct mutation with immer - no need for spread operations
      const task = draft.tasks[index];
      if (!task.logs) {
        task.logs = [];
      }
      task.logs.push(...logs);
    }),

  selectTask: (taskId) => set({ selectedTaskId: taskId }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  clearTasks: () => set({ tasks: [], selectedTaskId: null }),

  getSelectedTask: () => {
    const state = get();
    return state.tasks.find((t) => t.id === state.selectedTaskId);
  },

  getTasksByStatus: (status) => {
    const state = get();
    return state.tasks.filter((t) => t.status === status);
  }
  }))
);

/**
 * Load tasks for a project
 */
export async function loadTasks(projectId: string): Promise<void> {
  const store = useTaskStore.getState();
  store.setLoading(true);
  store.setError(null);

  try {
    const result = await window.electronAPI.getTasks(projectId);
    if (result.success && result.data) {
      store.setTasks(result.data);
    } else {
      store.setError(result.error || 'Failed to load tasks');
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    store.setLoading(false);
  }
}

/**
 * Create a new task
 */
export async function createTask(
  projectId: string,
  title: string,
  description: string,
  metadata?: TaskMetadata
): Promise<Task | null> {
  const store = useTaskStore.getState();

  try {
    const result = await window.electronAPI.createTask(projectId, title, description, metadata);
    if (result.success && result.data) {
      store.addTask(result.data);
      return result.data;
    } else {
      store.setError(result.error || 'Failed to create task');
      return null;
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

/**
 * Start a task
 */
export function startTask(taskId: string, options?: { parallel?: boolean; workers?: number }): void {
  window.electronAPI.startTask(taskId, options);
}

/**
 * Stop a task
 */
export function stopTask(taskId: string): void {
  window.electronAPI.stopTask(taskId);
}

/**
 * Submit review for a task
 */
export async function submitReview(
  taskId: string,
  approved: boolean,
  feedback?: string
): Promise<boolean> {
  const store = useTaskStore.getState();

  try {
    const result = await window.electronAPI.submitReview(taskId, approved, feedback);
    if (result.success) {
      store.updateTaskStatus(taskId, approved ? 'done' : 'in_progress');
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Update task status and persist to file
 */
export async function persistTaskStatus(
  taskId: string,
  status: TaskStatus
): Promise<boolean> {
  const store = useTaskStore.getState();

  try {
    // Update local state first for immediate feedback
    store.updateTaskStatus(taskId, status);

    // Persist to file
    const result = await window.electronAPI.updateTaskStatus(taskId, status);
    if (!result.success) {
      console.error('Failed to persist task status:', result.error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error persisting task status:', error);
    return false;
  }
}

/**
 * Update task title/description/metadata and persist to file
 */
export async function persistUpdateTask(
  taskId: string,
  updates: { title?: string; description?: string; metadata?: Partial<TaskMetadata> }
): Promise<boolean> {
  const store = useTaskStore.getState();

  try {
    // Call the IPC to persist changes to spec files
    const result = await window.electronAPI.updateTask(taskId, updates);

    if (result.success && result.data) {
      // Update local state with the returned task data
      store.updateTask(taskId, {
        title: result.data.title,
        description: result.data.description,
        metadata: result.data.metadata,
        updatedAt: new Date()
      });
      return true;
    }

    console.error('Failed to persist task update:', result.error);
    return false;
  } catch (error) {
    console.error('Error persisting task update:', error);
    return false;
  }
}

/**
 * Check if a task has an active running process
 */
export async function checkTaskRunning(taskId: string): Promise<boolean> {
  try {
    const result = await window.electronAPI.checkTaskRunning(taskId);
    return result.success && result.data === true;
  } catch (error) {
    console.error('Error checking task running status:', error);
    return false;
  }
}

/**
 * Recover a stuck task (status shows in_progress but no process running)
 * @param taskId - The task ID to recover
 * @param options - Recovery options (autoRestart defaults to true)
 */
export async function recoverStuckTask(
  taskId: string,
  options: { targetStatus?: TaskStatus; autoRestart?: boolean } = { autoRestart: true }
): Promise<{ success: boolean; message: string; autoRestarted?: boolean }> {
  const store = useTaskStore.getState();

  try {
    const result = await window.electronAPI.recoverStuckTask(taskId, options);

    if (result.success && result.data) {
      // Update local state
      store.updateTaskStatus(taskId, result.data.newStatus);
      return {
        success: true,
        message: result.data.message,
        autoRestarted: result.data.autoRestarted
      };
    }

    return {
      success: false,
      message: result.error || 'Failed to recover task'
    };
  } catch (error) {
    console.error('Error recovering stuck task:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Delete a task and its spec directory
 */
export async function deleteTask(
  taskId: string
): Promise<{ success: boolean; error?: string }> {
  const store = useTaskStore.getState();

  try {
    const result = await window.electronAPI.deleteTask(taskId);

    if (result.success) {
      // Remove from local state
      store.setTasks(store.tasks.filter(t => t.id !== taskId && t.specId !== taskId));
      // Clear selection if this task was selected
      if (store.selectedTaskId === taskId) {
        store.selectTask(null);
      }
      return { success: true };
    }

    return {
      success: false,
      error: result.error || 'Failed to delete task'
    };
  } catch (error) {
    console.error('Error deleting task:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Archive tasks
 * Marks tasks as archived by adding archivedAt timestamp to metadata
 */
export async function archiveTasks(
  projectId: string,
  taskIds: string[],
  version?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await window.electronAPI.archiveTasks(projectId, taskIds, version);

    if (result.success) {
      // Reload tasks to update the UI (archived tasks will be filtered out by default)
      await loadTasks(projectId);
      return { success: true };
    }

    return {
      success: false,
      error: result.error || 'Failed to archive tasks'
    };
  } catch (error) {
    console.error('Error archiving tasks:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// ============================================
// Task Creation Draft Management
// ============================================

const DRAFT_KEY_PREFIX = 'task-creation-draft';

/**
 * Get the localStorage key for a project's draft
 */
function getDraftKey(projectId: string): string {
  return `${DRAFT_KEY_PREFIX}-${projectId}`;
}

/**
 * Save a task creation draft to localStorage
 * Note: For large images, we only store thumbnails in the draft to avoid localStorage limits
 */
export function saveDraft(draft: TaskDraft): void {
  try {
    const key = getDraftKey(draft.projectId);
    // Create a copy with thumbnails only to avoid localStorage size limits
    const draftToStore = {
      ...draft,
      images: draft.images.map(img => ({
        ...img,
        data: undefined // Don't store full image data in localStorage
      })),
      savedAt: new Date().toISOString()
    };
    localStorage.setItem(key, JSON.stringify(draftToStore));
  } catch (error) {
    console.error('Failed to save draft:', error);
  }
}

/**
 * Load a task creation draft from localStorage
 */
export function loadDraft(projectId: string): TaskDraft | null {
  try {
    const key = getDraftKey(projectId);
    const stored = localStorage.getItem(key);
    if (!stored) return null;

    const draft = JSON.parse(stored);
    // Convert savedAt back to Date
    draft.savedAt = new Date(draft.savedAt);
    return draft as TaskDraft;
  } catch (error) {
    console.error('Failed to load draft:', error);
    return null;
  }
}

/**
 * Clear a task creation draft from localStorage
 */
export function clearDraft(projectId: string): void {
  try {
    const key = getDraftKey(projectId);
    localStorage.removeItem(key);
  } catch (error) {
    console.error('Failed to clear draft:', error);
  }
}

/**
 * Check if a draft exists for a project
 */
export function hasDraft(projectId: string): boolean {
  const key = getDraftKey(projectId);
  return localStorage.getItem(key) !== null;
}

/**
 * Check if a draft has any meaningful content (title, description, or images)
 */
export function isDraftEmpty(draft: TaskDraft | null): boolean {
  if (!draft) return true;
  return (
    !draft.title.trim() &&
    !draft.description.trim() &&
    draft.images.length === 0 &&
    !draft.category &&
    !draft.priority &&
    !draft.complexity &&
    !draft.impact
  );
}

// ============================================
// GitHub Issue Linking Helpers
// ============================================

/**
 * Find a task by GitHub issue number
 * Used to check if a task already exists for a GitHub issue
 */
export function getTaskByGitHubIssue(issueNumber: number): Task | undefined {
  const store = useTaskStore.getState();
  return store.tasks.find(t => t.metadata?.githubIssueNumber === issueNumber);
}

// ============================================
// Task State Detection Helpers
// ============================================

/**
 * Check if a task is in human_review but has no completed subtasks.
 * This indicates the task crashed/exited before implementation completed
 * and should be resumed rather than reviewed.
 */
export function isIncompleteHumanReview(task: Task): boolean {
  if (task.status !== 'human_review') return false;

  // If no subtasks defined, task hasn't been planned yet (shouldn't be in human_review)
  if (!task.subtasks || task.subtasks.length === 0) return true;

  // Check if any subtasks are completed
  const completedSubtasks = task.subtasks.filter(s => s.status === 'completed').length;

  // If 0 completed subtasks, this task crashed before implementation
  return completedSubtasks === 0;
}

/**
 * Get the count of completed subtasks for a task
 */
export function getCompletedSubtaskCount(task: Task): number {
  if (!task.subtasks || task.subtasks.length === 0) return 0;
  return task.subtasks.filter(s => s.status === 'completed').length;
}

/**
 * Get task progress info
 */
export function getTaskProgress(task: Task): { completed: number; total: number; percentage: number } {
  const total = task.subtasks?.length || 0;
  const completed = task.subtasks?.filter(s => s.status === 'completed').length || 0;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { completed, total, percentage };
}
