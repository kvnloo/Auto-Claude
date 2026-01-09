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

/**
 * Position information for a task bar on the timeline
 */
export interface TaskBarPosition {
  /** Left position in pixels from timeline start */
  left: number;
  /** Width of the bar in pixels */
  width: number;
  /** The task ID for reference */
  taskId: string;
  /** Start date used for positioning */
  startDate: Date;
  /** End date used for positioning */
  endDate: Date;
}

/**
 * Get the start date for a task on the timeline.
 * Priority: scheduledStartDate > createdAt
 *
 * @param task The task to get start date for
 * @returns The start date to use for timeline positioning
 */
export function getTaskStartDate(task: Task): Date {
  // Use scheduledStartDate if set in metadata
  if (task.metadata?.scheduledStartDate) {
    return new Date(task.metadata.scheduledStartDate);
  }

  // Fall back to task creation date
  return new Date(task.createdAt);
}

/**
 * Get the end date for a task on the timeline.
 * Priority: scheduledEndDate > (startDate + duration based on effort)
 *
 * @param task The task to get end date for
 * @returns The end date to use for timeline positioning
 */
export function getTaskEndDate(task: Task): Date {
  // Use scheduledEndDate if set in metadata
  if (task.metadata?.scheduledEndDate) {
    return new Date(task.metadata.scheduledEndDate);
  }

  // Calculate end date from start date + estimated duration
  const startDate = getTaskStartDate(task);
  const durationDays = getTaskDuration(task);

  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + durationDays);

  return endDate;
}

/**
 * Get the date range for a task (start and end dates).
 * Convenience function combining getTaskStartDate and getTaskEndDate.
 *
 * @param task The task to get date range for
 * @returns Object with startDate and endDate
 */
export function getTaskDateRange(task: Task): { startDate: Date; endDate: Date } {
  return {
    startDate: getTaskStartDate(task),
    endDate: getTaskEndDate(task)
  };
}

/**
 * Calculate the pixel position for a date within a visible range.
 *
 * @param date The date to calculate position for
 * @param visibleStartDate Start of the visible timeline range
 * @param visibleEndDate End of the visible timeline range
 * @param totalWidth Total width of the timeline in pixels
 * @returns Position in pixels from timeline start (can be negative if before visible range)
 */
export function getDatePixelPosition(
  date: Date,
  visibleStartDate: Date,
  visibleEndDate: Date,
  totalWidth: number
): number {
  const dateMs = date.getTime();
  const startMs = visibleStartDate.getTime();
  const endMs = visibleEndDate.getTime();
  const rangeMs = endMs - startMs;

  if (rangeMs <= 0) return 0;

  return ((dateMs - startMs) / rangeMs) * totalWidth;
}

/**
 * Calculate the task bar position for rendering on the timeline.
 * Returns pixel offset (left) and width based on the current zoom scale.
 *
 * @param task The task to calculate position for
 * @param visibleStartDate Start of the visible timeline range
 * @param visibleEndDate End of the visible timeline range
 * @param totalWidth Total width of the timeline in pixels
 * @returns TaskBarPosition with left, width, taskId, startDate, endDate
 */
export function calculateTaskBarPosition(
  task: Task,
  visibleStartDate: Date,
  visibleEndDate: Date,
  totalWidth: number
): TaskBarPosition {
  const startDate = getTaskStartDate(task);
  const endDate = getTaskEndDate(task);

  // Calculate pixel positions
  const left = getDatePixelPosition(startDate, visibleStartDate, visibleEndDate, totalWidth);
  const rightEdge = getDatePixelPosition(endDate, visibleStartDate, visibleEndDate, totalWidth);

  // Calculate width (minimum 8px for visibility)
  const width = Math.max(rightEdge - left, 8);

  return {
    left,
    width,
    taskId: task.id,
    startDate,
    endDate
  };
}

/**
 * Calculate task bar positions for multiple tasks.
 * Useful for rendering all task bars in the timeline grid.
 *
 * @param tasks Array of tasks to calculate positions for
 * @param visibleStartDate Start of the visible timeline range
 * @param visibleEndDate End of the visible timeline range
 * @param totalWidth Total width of the timeline in pixels
 * @returns Map of task ID to TaskBarPosition
 */
export function calculateAllTaskBarPositions(
  tasks: Task[],
  visibleStartDate: Date,
  visibleEndDate: Date,
  totalWidth: number
): Map<string, TaskBarPosition> {
  const positions = new Map<string, TaskBarPosition>();

  for (const task of tasks) {
    const position = calculateTaskBarPosition(task, visibleStartDate, visibleEndDate, totalWidth);
    positions.set(task.id, position);
  }

  return positions;
}

/**
 * Check if a task bar is visible within the current timeline viewport.
 * A task is considered visible if any part of its duration falls within the visible range.
 *
 * @param position The task bar position
 * @param totalWidth Total width of the timeline (represents visible range)
 * @returns True if any part of the task bar is visible
 */
export function isTaskBarVisible(position: TaskBarPosition, totalWidth: number): boolean {
  const rightEdge = position.left + position.width;

  // Task is visible if its right edge is past 0 AND its left edge is before total width
  return rightEdge > 0 && position.left < totalWidth;
}
