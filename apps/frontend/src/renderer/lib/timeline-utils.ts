/**
 * Timeline Utility Functions
 *
 * Helper functions for timeline/Gantt view calculations and operations.
 */

import type { Task, TaskComplexity } from '../../../shared/types/task';

/**
 * Duration mapping for task complexity levels (in days)
 */
const EFFORT_DURATION_MAP: Record<TaskComplexity, number> = {
  trivial: 1,
  small: 2,
  medium: 5,
  large: 10,
  complex: 20,
};

/**
 * Default duration in days when no estimate is available
 */
const DEFAULT_DURATION_DAYS = 3;

/**
 * Calculate the duration of a task in days based on its estimated effort.
 *
 * Duration mapping:
 * - trivial: 1 day
 * - small: 2 days
 * - medium: 5 days
 * - large: 10 days
 * - complex: 20 days
 * - default (no estimate): 3 days
 *
 * @param task The task to calculate duration for
 * @returns Duration in days
 */
export function getTaskDuration(task: Task): number {
  const estimatedEffort = task.metadata?.estimatedEffort;

  if (estimatedEffort && estimatedEffort in EFFORT_DURATION_MAP) {
    return EFFORT_DURATION_MAP[estimatedEffort];
  }

  return DEFAULT_DURATION_DAYS;
}

/**
 * Get the duration for a specific complexity level.
 * Useful when you only have the complexity without the full task object.
 *
 * @param complexity The task complexity level
 * @returns Duration in days
 */
export function getDurationForComplexity(complexity: TaskComplexity | undefined): number {
  if (complexity && complexity in EFFORT_DURATION_MAP) {
    return EFFORT_DURATION_MAP[complexity];
  }
  return DEFAULT_DURATION_DAYS;
}

/**
 * Get the default duration for tasks without estimates
 */
export function getDefaultDuration(): number {
  return DEFAULT_DURATION_DAYS;
}
