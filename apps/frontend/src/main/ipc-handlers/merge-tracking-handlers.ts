/**
 * IPC handlers for merge tracking history retrieval
 *
 * These handlers provide access to the persisted merge history
 * stored in .auto-claude/merge_history/. They read the JSON files
 * created by the Python MergeHistoryStore and return data in
 * TypeScript-compatible format.
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type {
  IPCResult,
  MergeAttempt,
  MergeStatus,
  MergeHealth,
  MergeProgressConflict,
  MergeHistoryListResult,
  MergeHistoryStats
} from '../../shared/types';
import path from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { projectStore } from '../project-store';
import { findTaskAndProject } from './task/shared';

/**
 * Merge history directory name (relative to .auto-claude)
 */
const MERGE_HISTORY_DIR = 'merge_history';
const INDEX_FILE = 'index.json';

/**
 * Interface for raw merge attempt data from Python JSON files
 */
interface RawMergeAttempt {
  id: string;
  task_id: string;
  worktree_path: string;
  started_at: string;
  completed_at?: string | null;
  status: string;
  health: string;
  conflicts: Array<{
    file_path: string;
    resolved: boolean;
    resolution_method?: string | null;
    details?: string;
  }>;
  progress_percent: number;
  current_step?: string;
  error_message?: string | null;
  is_fast_forward: boolean;
  commit_hash?: string | null;
  duration_seconds: number;
}

/**
 * Interface for raw task history data from Python JSON files
 */
interface RawTaskHistory {
  task_id: string;
  created_at: string;
  updated_at: string;
  attempts: RawMergeAttempt[];
}

/**
 * Transform raw Python merge attempt data to TypeScript format
 */
function transformMergeAttempt(raw: RawMergeAttempt): MergeAttempt {
  // Transform conflicts from Python naming (file_path) to TypeScript (filePath)
  const conflicts: MergeProgressConflict[] = raw.conflicts.map((c) => ({
    filePath: c.file_path,
    resolved: c.resolved,
    resolutionMethod: c.resolution_method || undefined,
    details: c.details || undefined
  }));

  return {
    id: raw.id,
    taskId: raw.task_id,
    worktreePath: raw.worktree_path,
    startedAt: raw.started_at,
    completedAt: raw.completed_at || undefined,
    status: raw.status as MergeStatus,
    health: raw.health as MergeHealth,
    conflicts,
    progressPercent: raw.progress_percent,
    currentStep: raw.current_step || undefined,
    errorMessage: raw.error_message || undefined,
    isFastForward: raw.is_fast_forward,
    commitHash: raw.commit_hash || undefined,
    durationSeconds: raw.duration_seconds
  };
}

/**
 * Get the merge history directory path for a project
 */
function getMergeHistoryDir(projectPath: string, autoBuildPath: string | undefined): string {
  const basePath = autoBuildPath || '.auto-claude';
  return path.join(projectPath, basePath, MERGE_HISTORY_DIR);
}

/**
 * Get the history file path for a specific task
 */
function getTaskHistoryPath(historyDir: string, taskId: string): string {
  // Sanitize task_id for safe filename (matching Python implementation)
  const safeName = taskId.replace(/\//g, '_').replace(/\\/g, '_');
  return path.join(historyDir, `${safeName}.json`);
}

/**
 * Load the index file containing list of all tasks with history
 */
function loadIndex(historyDir: string): { tasks: string[]; updated_at: string | null } {
  const indexPath = path.join(historyDir, INDEX_FILE);
  if (!existsSync(indexPath)) {
    return { tasks: [], updated_at: null };
  }

  try {
    const content = readFileSync(indexPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { tasks: [], updated_at: null };
  }
}

/**
 * Load raw task history from file
 */
function loadTaskHistoryRaw(historyDir: string, taskId: string): RawTaskHistory | null {
  const historyPath = getTaskHistoryPath(historyDir, taskId);
  if (!existsSync(historyPath)) {
    return null;
  }

  try {
    const content = readFileSync(historyPath, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    console.error(`Failed to load merge history for task ${taskId}:`, e);
    return null;
  }
}

/**
 * Register merge tracking IPC handlers
 */
export function registerMergeTrackingHandlers(): void {
  /**
   * Get merge history for a specific task
   * Returns all merge attempts, ordered by started_at (oldest first)
   */
  ipcMain.handle(
    IPC_CHANNELS.MERGE_HISTORY_GET,
    async (_, taskId: string, projectId?: string): Promise<IPCResult<MergeAttempt[]>> => {
      try {
        // If projectId is provided, use that directly
        let project;
        if (projectId) {
          project = projectStore.getProject(projectId);
        } else {
          // Fall back to finding via task
          const result = findTaskAndProject(taskId);
          project = result.project;
        }

        if (!project) {
          return { success: false, error: 'Project not found' };
        }

        const historyDir = getMergeHistoryDir(project.path, project.autoBuildPath);

        if (!existsSync(historyDir)) {
          // No history directory yet - return empty array (not an error)
          return { success: true, data: [] };
        }

        const rawHistory = loadTaskHistoryRaw(historyDir, taskId);
        if (!rawHistory) {
          // No history for this task - return empty array
          return { success: true, data: [] };
        }

        // Transform and sort by started_at
        const attempts = rawHistory.attempts.map(transformMergeAttempt);
        attempts.sort((a, b) => a.startedAt.localeCompare(b.startedAt));

        return { success: true, data: attempts };
      } catch (error) {
        console.error('Failed to get merge history:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get merge history'
        };
      }
    }
  );

  /**
   * Get the latest merge attempt for a task
   * Returns the most recent merge attempt, or null if none exists
   */
  ipcMain.handle(
    IPC_CHANNELS.MERGE_HISTORY_GET_LATEST,
    async (_, taskId: string, projectId?: string): Promise<IPCResult<MergeAttempt | null>> => {
      try {
        // If projectId is provided, use that directly
        let project;
        if (projectId) {
          project = projectStore.getProject(projectId);
        } else {
          // Fall back to finding via task
          const result = findTaskAndProject(taskId);
          project = result.project;
        }

        if (!project) {
          return { success: false, error: 'Project not found' };
        }

        const historyDir = getMergeHistoryDir(project.path, project.autoBuildPath);

        if (!existsSync(historyDir)) {
          return { success: true, data: null };
        }

        const rawHistory = loadTaskHistoryRaw(historyDir, taskId);
        if (!rawHistory || rawHistory.attempts.length === 0) {
          return { success: true, data: null };
        }

        // Sort and get the last one
        const attempts = rawHistory.attempts.map(transformMergeAttempt);
        attempts.sort((a, b) => a.startedAt.localeCompare(b.startedAt));

        return { success: true, data: attempts[attempts.length - 1] };
      } catch (error) {
        console.error('Failed to get latest merge attempt:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get latest merge attempt'
        };
      }
    }
  );

  /**
   * List all task IDs that have merge history
   */
  ipcMain.handle(
    IPC_CHANNELS.MERGE_HISTORY_LIST_TASKS,
    async (_, projectId: string): Promise<IPCResult<MergeHistoryListResult>> => {
      try {
        const project = projectStore.getProject(projectId);
        if (!project) {
          return { success: false, error: 'Project not found' };
        }

        const historyDir = getMergeHistoryDir(project.path, project.autoBuildPath);

        if (!existsSync(historyDir)) {
          return { success: true, data: { taskIds: [] } };
        }

        // First try to read from index file
        const index = loadIndex(historyDir);
        if (index.tasks.length > 0) {
          return { success: true, data: { taskIds: index.tasks } };
        }

        // Fallback: scan directory for .json files (excluding index.json)
        const taskIds: string[] = [];
        try {
          const files = readdirSync(historyDir);
          for (const file of files) {
            if (file.endsWith('.json') && file !== INDEX_FILE) {
              // Remove .json extension and un-sanitize the task ID
              // Note: This is a lossy operation if the original task ID had underscores
              taskIds.push(file.slice(0, -5));
            }
          }
        } catch {
          // Directory might not exist or be readable
        }

        return { success: true, data: { taskIds } };
      } catch (error) {
        console.error('Failed to list tasks with merge history:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list tasks with merge history'
        };
      }
    }
  );

  /**
   * Get summary statistics for all merge history
   */
  ipcMain.handle(
    IPC_CHANNELS.MERGE_HISTORY_GET_STATS,
    async (_, projectId: string): Promise<IPCResult<MergeHistoryStats>> => {
      try {
        const project = projectStore.getProject(projectId);
        if (!project) {
          return { success: false, error: 'Project not found' };
        }

        const historyDir = getMergeHistoryDir(project.path, project.autoBuildPath);

        // Initialize stats
        const stats: MergeHistoryStats = {
          totalTasks: 0,
          totalAttempts: 0,
          successfulAttempts: 0,
          failedAttempts: 0,
          timeoutAttempts: 0,
          successRate: 0,
          totalConflicts: 0,
          resolvedConflicts: 0,
          conflictResolutionRate: 1.0
        };

        if (!existsSync(historyDir)) {
          return { success: true, data: stats };
        }

        // Get list of tasks
        const index = loadIndex(historyDir);
        const taskIds = index.tasks.length > 0 ? index.tasks : [];

        stats.totalTasks = taskIds.length;

        // Aggregate stats from all tasks
        for (const taskId of taskIds) {
          const rawHistory = loadTaskHistoryRaw(historyDir, taskId);
          if (!rawHistory) continue;

          for (const attempt of rawHistory.attempts) {
            stats.totalAttempts++;

            // Count conflicts
            const conflictsDetected = attempt.conflicts.length;
            const conflictsResolved = attempt.conflicts.filter(c => c.resolved).length;
            stats.totalConflicts += conflictsDetected;
            stats.resolvedConflicts += conflictsResolved;

            // Count by status
            switch (attempt.status) {
              case 'complete':
                stats.successfulAttempts++;
                break;
              case 'failed':
                stats.failedAttempts++;
                break;
              case 'timeout':
                stats.timeoutAttempts++;
                break;
              // Other statuses (idle, merging, resolving) are transient
            }
          }
        }

        // Calculate rates
        if (stats.totalAttempts > 0) {
          stats.successRate = stats.successfulAttempts / stats.totalAttempts;
        }
        if (stats.totalConflicts > 0) {
          stats.conflictResolutionRate = stats.resolvedConflicts / stats.totalConflicts;
        }

        return { success: true, data: stats };
      } catch (error) {
        console.error('Failed to get merge history stats:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get merge history stats'
        };
      }
    }
  );
}
