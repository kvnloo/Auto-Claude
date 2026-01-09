/**
 * Timeline Utility Functions
 *
 * Helper functions for timeline/Gantt view calculations and operations.
 */

import type { Task, TaskComplexity } from '../../shared/types/task';

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

/**
 * Options for calculating a dependency path
 */
export interface DependencyPathOptions {
  /** Position of the source task bar (the task being depended on) */
  sourcePosition: TaskBarPosition;
  /** Position of the target task bar (the task that depends on the source) */
  targetPosition: TaskBarPosition;
  /** Row index of the source task (0-based) */
  sourceRowIndex: number;
  /** Row index of the target task (0-based) */
  targetRowIndex: number;
  /** Height of each row in pixels */
  rowHeight: number;
}

/**
 * Result of a dependency path calculation
 */
export interface DependencyPathResult {
  /** SVG path string (d attribute value) for the bezier curve */
  path: string;
  /** X coordinate where the path starts (right edge of source task) */
  startX: number;
  /** Y coordinate where the path starts (vertical center of source row) */
  startY: number;
  /** X coordinate where the path ends (left edge of target task) */
  endX: number;
  /** Y coordinate where the path ends (vertical center of target row) */
  endY: number;
  /** Recommended arrowhead marker ID based on path direction */
  markerRecommendation: 'standard' | 'reverse';
}

/**
 * SVG Arrowhead marker definition configuration
 * Use this to create consistent arrowhead markers for dependency arrows
 */
export interface ArrowheadMarkerConfig {
  /** Unique ID for the marker */
  id: string;
  /** Width of the marker bounding box */
  markerWidth: number;
  /** Height of the marker bounding box */
  markerHeight: number;
  /** X coordinate of reference point (attachment point) */
  refX: number;
  /** Y coordinate of reference point */
  refY: number;
  /** SVG path data for the arrowhead shape */
  pathD: string;
}

/**
 * Default arrowhead marker configuration
 * Creates a standard triangular arrowhead pointing right
 */
export const DEFAULT_ARROWHEAD_MARKER: ArrowheadMarkerConfig = {
  id: 'dependency-arrowhead',
  markerWidth: 8,
  markerHeight: 8,
  refX: 7,
  refY: 4,
  pathD: 'M 0 0 L 8 4 L 0 8 L 2 4 Z'
};

/**
 * Calculate the SVG path for a dependency arrow between two task bars.
 * Creates a smooth bezier curve from the right edge of the source task to
 * the left edge of the target task, with arrowhead marker support.
 *
 * The function handles both forward (left-to-right) and backward (right-to-left)
 * dependencies with appropriate curve routing:
 * - Forward: Simple S-curve with control points
 * - Backward: Loops around to avoid overlapping with task bars
 *
 * @param options Configuration options including source/target positions
 * @returns DependencyPathResult with SVG path string and coordinates
 *
 * @example
 * ```tsx
 * const result = calculateDependencyPath({
 *   sourcePosition: { left: 100, width: 80, taskId: 'task1', startDate, endDate },
 *   targetPosition: { left: 200, width: 60, taskId: 'task2', startDate, endDate },
 *   sourceRowIndex: 0,
 *   targetRowIndex: 1,
 *   rowHeight: 40
 * });
 *
 * // Use in SVG:
 * <path d={result.path} markerEnd="url(#arrowhead)" />
 * ```
 */
export function calculateDependencyPath(options: DependencyPathOptions): DependencyPathResult {
  const {
    sourcePosition,
    targetPosition,
    sourceRowIndex,
    targetRowIndex,
    rowHeight
  } = options;

  // Calculate connection points
  // From: right edge of source task bar, vertically centered in row
  const startX = sourcePosition.left + sourcePosition.width;
  const startY = sourceRowIndex * rowHeight + rowHeight / 2;

  // To: left edge of target task bar, vertically centered in row
  const endX = targetPosition.left;
  const endY = targetRowIndex * rowHeight + rowHeight / 2;

  // Calculate path based on direction
  const dx = endX - startX;
  const dy = endY - startY;

  let path: string;
  let markerRecommendation: 'standard' | 'reverse';

  if (dx > 0) {
    // Forward direction (left to right) - standard S-curve
    // Control point offset scales with distance but caps at 60px
    const cpOffset = Math.min(Math.abs(dx) * 0.4, 60);

    // Control points: exit horizontally right, enter horizontally left
    const cp1x = startX + cpOffset;
    const cp1y = startY;
    const cp2x = endX - cpOffset;
    const cp2y = endY;

    path = `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`;
    markerRecommendation = 'standard';
  } else {
    // Backward direction (right to left) - need to route around task bars
    // This creates a path that goes up/down first, then back to the target
    const loopRadius = Math.max(Math.abs(dx) * 0.3, 30);

    // Determine vertical direction based on relative row positions
    // Go up if target is above, down if target is below (with offset to create clearance)
    const verticalOffset = dy > 0 ? -20 : 20;

    // Mid-point for the loop apex
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2 + verticalOffset;

    // Control points for the S-curve around the task bars
    const cp1x = startX + loopRadius;
    const cp1y = startY;
    const cp2x = startX + loopRadius;
    const cp2y = midY;
    const cp3x = endX - loopRadius;
    const cp3y = midY;
    const cp4x = endX - loopRadius;
    const cp4y = endY;

    // Using cubic bezier with smooth continuation (S command)
    path = `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${midX} ${midY} S ${cp4x} ${cp4y}, ${endX} ${endY}`;
    markerRecommendation = 'reverse';
  }

  return {
    path,
    startX,
    startY,
    endX,
    endY,
    markerRecommendation
  };
}

/**
 * Calculate dependency paths for multiple connections at once.
 * Useful for batch rendering all dependency arrows in a timeline.
 *
 * @param connections Array of connection specifications
 * @param rowHeight Height of each row in pixels
 * @returns Array of path results with connection metadata
 */
export function calculateAllDependencyPaths(
  connections: Array<{
    sourcePosition: TaskBarPosition;
    targetPosition: TaskBarPosition;
    sourceRowIndex: number;
    targetRowIndex: number;
    sourceTaskId: string;
    targetTaskId: string;
  }>,
  rowHeight: number
): Array<DependencyPathResult & { sourceTaskId: string; targetTaskId: string }> {
  return connections.map((connection) => ({
    ...calculateDependencyPath({
      sourcePosition: connection.sourcePosition,
      targetPosition: connection.targetPosition,
      sourceRowIndex: connection.sourceRowIndex,
      targetRowIndex: connection.targetRowIndex,
      rowHeight
    }),
    sourceTaskId: connection.sourceTaskId,
    targetTaskId: connection.targetTaskId
  }));
}

/**
 * Generate SVG marker definition JSX-compatible attributes for an arrowhead.
 * This helper creates the configuration needed to render an SVG <marker> element.
 *
 * @param config Arrowhead marker configuration
 * @param fillClass Tailwind CSS class for fill color (e.g., 'fill-blue-400/60')
 * @returns Object with all attributes needed for SVG marker element
 *
 * @example
 * ```tsx
 * const markerAttrs = getArrowheadMarkerAttrs(DEFAULT_ARROWHEAD_MARKER, 'fill-blue-500');
 * // In JSX:
 * <marker {...markerAttrs.marker}>
 *   <path d={markerAttrs.pathD} className={markerAttrs.fillClass} />
 * </marker>
 * ```
 */
export function getArrowheadMarkerAttrs(
  config: ArrowheadMarkerConfig = DEFAULT_ARROWHEAD_MARKER,
  fillClass: string = 'fill-blue-400/60'
): {
  marker: {
    id: string;
    markerWidth: string;
    markerHeight: string;
    refX: string;
    refY: string;
    orient: string;
    markerUnits: string;
  };
  pathD: string;
  fillClass: string;
} {
  return {
    marker: {
      id: config.id,
      markerWidth: String(config.markerWidth),
      markerHeight: String(config.markerHeight),
      refX: String(config.refX),
      refY: String(config.refY),
      orient: 'auto',
      markerUnits: 'strokeWidth'
    },
    pathD: config.pathD,
    fillClass
  };
}

/**
 * Result of dependency cycle detection
 */
export interface CycleDetectionResult {
  /** True if any cycles were detected */
  hasCycles: boolean;
  /** Array of task specIds involved in cycles */
  cyclicTaskIds: string[];
  /** Set version for efficient O(1) lookups */
  cyclicTaskIdSet: Set<string>;
  /** Array of individual cycles, each containing the task specIds in that cycle */
  cycles: string[][];
}

/**
 * Detect dependency cycles among tasks.
 *
 * Uses depth-first search (DFS) with coloring to detect cycles in the
 * dependency graph. A cycle exists when we encounter a "gray" node (currently
 * being processed) during DFS traversal.
 *
 * The algorithm:
 * 1. Build adjacency list from task dependencies
 * 2. For each unvisited node, start DFS
 * 3. Mark nodes as gray (in progress) or black (completed)
 * 4. If we visit a gray node, we found a cycle - trace back to identify cycle members
 *
 * @param tasks Array of tasks to check for dependency cycles
 * @returns CycleDetectionResult with information about detected cycles
 *
 * @example
 * ```tsx
 * // Tasks with circular dependency: A -> B -> C -> A
 * const tasks = [
 *   { specId: 'A', metadata: { dependsOnTaskIds: ['C'] } },
 *   { specId: 'B', metadata: { dependsOnTaskIds: ['A'] } },
 *   { specId: 'C', metadata: { dependsOnTaskIds: ['B'] } }
 * ];
 *
 * const result = detectDependencyCycles(tasks);
 * // result.hasCycles === true
 * // result.cyclicTaskIds === ['A', 'B', 'C']
 * // result.cycles === [['A', 'B', 'C']] (or similar ordering)
 * ```
 */
export function detectDependencyCycles(tasks: Task[]): CycleDetectionResult {
  // Build adjacency list: specId -> list of specIds it depends on
  const adjacencyList = new Map<string, string[]>();
  const taskSpecIds = new Set<string>();

  for (const task of tasks) {
    const specId = task.specId;
    taskSpecIds.add(specId);

    // Get dependencies, filtering to only existing tasks
    const deps = task.metadata?.dependsOnTaskIds ?? [];
    adjacencyList.set(specId, deps);
  }

  // Track node states: 0 = white (unvisited), 1 = gray (in progress), 2 = black (done)
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const nodeState = new Map<string, number>();

  // Parent tracking for cycle reconstruction
  const parent = new Map<string, string>();

  // Collect all cyclic nodes and individual cycles
  const cyclicNodes = new Set<string>();
  const detectedCycles: string[][] = [];

  /**
   * Reconstruct the cycle by following parent links back from the repeat node
   */
  function reconstructCycle(start: string, end: string): string[] {
    const cycle: string[] = [end];
    let current = start;

    // Trace back from start until we reach end again
    while (current !== end) {
      cycle.push(current);
      const p = parent.get(current);
      if (!p) break;
      current = p;
    }

    return cycle;
  }

  /**
   * DFS traversal to detect cycles
   * Returns true if a cycle is found starting from this node
   */
  function dfs(node: string, parentNode: string | null): boolean {
    nodeState.set(node, GRAY);
    if (parentNode !== null) {
      parent.set(node, parentNode);
    }

    const neighbors = adjacencyList.get(node) ?? [];

    for (const neighbor of neighbors) {
      // Only consider neighbors that exist in our task set
      if (!taskSpecIds.has(neighbor)) continue;

      const state = nodeState.get(neighbor) ?? WHITE;

      if (state === GRAY) {
        // Found a back edge - this is a cycle!
        const cycle = reconstructCycle(node, neighbor);
        detectedCycles.push(cycle);

        // Mark all nodes in the cycle as cyclic
        for (const cycleNode of cycle) {
          cyclicNodes.add(cycleNode);
        }

        return true;
      } else if (state === WHITE) {
        // Continue DFS
        if (dfs(neighbor, node)) {
          // Propagate that we're part of a cycle path
          cyclicNodes.add(node);
        }
      }
    }

    nodeState.set(node, BLACK);
    return false;
  }

  // Run DFS from each unvisited node
  for (const specId of taskSpecIds) {
    const state = nodeState.get(specId) ?? WHITE;
    if (state === WHITE) {
      parent.clear(); // Reset parent tracking for new DFS tree
      dfs(specId, null);
    }
  }

  return {
    hasCycles: cyclicNodes.size > 0,
    cyclicTaskIds: Array.from(cyclicNodes),
    cyclicTaskIdSet: cyclicNodes,
    cycles: detectedCycles
  };
}

/**
 * Check if a specific task is part of a dependency cycle.
 * Convenience function for UI components.
 *
 * @param taskSpecId The spec ID of the task to check
 * @param cyclicTaskIdSet Set of cyclic task IDs from detectDependencyCycles
 * @returns True if the task is involved in a cycle
 */
export function isTaskInCycle(taskSpecId: string, cyclicTaskIdSet: Set<string>): boolean {
  return cyclicTaskIdSet.has(taskSpecId);
}

/**
 * Get a human-readable description of cycles for UI display.
 * Returns a formatted string showing the cycle path.
 *
 * @param cycles Array of cycles from detectDependencyCycles
 * @param taskNameMap Optional map of specId to task name for prettier display
 * @returns Array of formatted cycle descriptions
 *
 * @example
 * ```ts
 * const descriptions = formatCycleDescriptions([['A', 'B', 'C']]);
 * // Returns: ['A → B → C → A']
 * ```
 */
export function formatCycleDescriptions(
  cycles: string[][],
  taskNameMap?: Map<string, string>
): string[] {
  return cycles.map(cycle => {
    const getLabel = (id: string) => taskNameMap?.get(id) ?? id;
    const labels = cycle.map(getLabel);
    // Close the cycle by adding the first element at the end
    return [...labels, labels[0]].join(' → ');
  });
}

/**
 * Timeline zoom level type
 * Defines the granularity at which the timeline is displayed
 */
export type TimelineZoomLevel = 'quarter' | 'month' | 'week' | 'day';

/**
 * Snap grid configuration for each zoom level
 * Defines what boundary dates should snap to during drag operations
 */
export interface SnapGridConfig {
  /** The unit of time to snap to */
  unit: 'day' | 'week' | 'month';
  /** Human-readable description for tooltips */
  description: string;
}

/**
 * Get the snap grid configuration for a zoom level.
 *
 * Snap behavior:
 * - Day view: snap to day boundaries
 * - Week view: snap to day boundaries
 * - Month view: snap to week boundaries (start of week)
 * - Quarter view: snap to month boundaries (1st of month)
 *
 * @param zoomLevel The current timeline zoom level
 * @returns Configuration for the snap grid
 */
export function getSnapGridConfig(zoomLevel: TimelineZoomLevel): SnapGridConfig {
  switch (zoomLevel) {
    case 'day':
    case 'week':
      return { unit: 'day', description: 'Snapping to day' };
    case 'month':
      return { unit: 'week', description: 'Snapping to week' };
    case 'quarter':
      return { unit: 'month', description: 'Snapping to month' };
    default:
      return { unit: 'day', description: 'Snapping to day' };
  }
}

/**
 * Snap a date to the nearest grid boundary based on the zoom level.
 *
 * Snap behavior:
 * - Day/Week view: snaps to nearest day boundary (midnight)
 * - Month view: snaps to nearest Monday (start of week)
 * - Quarter view: snaps to nearest 1st of month
 *
 * @param date The date to snap
 * @param zoomLevel The current timeline zoom level
 * @returns The date snapped to the nearest grid boundary
 *
 * @example
 * ```ts
 * // Day/Week view - snaps to day boundaries
 * snapDateToGrid(new Date('2024-03-15T14:30:00'), 'day')
 * // Returns: 2024-03-15T00:00:00 or 2024-03-16T00:00:00
 *
 * // Month view - snaps to week start (Monday)
 * snapDateToGrid(new Date('2024-03-15'), 'month')
 * // Returns: 2024-03-11T00:00:00 (previous Monday) or 2024-03-18T00:00:00
 *
 * // Quarter view - snaps to 1st of month
 * snapDateToGrid(new Date('2024-03-15'), 'quarter')
 * // Returns: 2024-03-01T00:00:00 or 2024-04-01T00:00:00
 * ```
 */
export function snapDateToGrid(date: Date, zoomLevel: TimelineZoomLevel): Date {
  const config = getSnapGridConfig(zoomLevel);
  const result = new Date(date);

  switch (config.unit) {
    case 'day':
      // Snap to nearest day boundary (midnight)
      // If past noon, snap to next day; otherwise snap to current day
      result.setHours(0, 0, 0, 0);
      if (date.getHours() >= 12) {
        result.setDate(result.getDate() + 1);
      }
      break;

    case 'week':
      // Snap to nearest Monday (start of week)
      // First, get to the start of the current day
      result.setHours(0, 0, 0, 0);

      // Get day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
      const dayOfWeek = result.getDay();

      // Calculate days to previous Monday (week starts on Monday in ISO standard)
      // If Sunday (0), previous Monday is 6 days back
      // If Monday (1), we're already there
      // If Tuesday (2), previous Monday is 1 day back
      // etc.
      const daysToPreviousMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const previousMonday = new Date(result);
      previousMonday.setDate(result.getDate() - daysToPreviousMonday);

      // Calculate next Monday
      const daysToNextMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek);
      const nextMonday = new Date(result);
      nextMonday.setDate(result.getDate() + daysToNextMonday);

      // Choose the closer Monday (if exactly in the middle, prefer previous)
      const distToPrevious = Math.abs(date.getTime() - previousMonday.getTime());
      const distToNext = Math.abs(nextMonday.getTime() - date.getTime());

      if (distToPrevious <= distToNext) {
        result.setTime(previousMonday.getTime());
      } else {
        result.setTime(nextMonday.getTime());
      }
      break;

    case 'month':
      // Snap to nearest 1st of month
      result.setHours(0, 0, 0, 0);

      // Get current day of month
      const dayOfMonth = result.getDate();
      const totalDaysInMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();

      // Calculate distance to start of current month
      const currentMonthStart = new Date(result.getFullYear(), result.getMonth(), 1);

      // Calculate distance to start of next month
      const nextMonthStart = new Date(result.getFullYear(), result.getMonth() + 1, 1);

      // Choose the closer 1st (if past the middle of the month, go to next)
      if (dayOfMonth <= totalDaysInMonth / 2) {
        result.setTime(currentMonthStart.getTime());
      } else {
        result.setTime(nextMonthStart.getTime());
      }
      break;
  }

  return result;
}

/**
 * Snap both start and end dates to grid boundaries while maintaining the original duration.
 *
 * This is useful for drag operations where the entire task is moved and we want
 * to snap the start position while keeping the task duration the same.
 *
 * @param startDate The proposed start date (after drag)
 * @param endDate The proposed end date (after drag)
 * @param zoomLevel The current timeline zoom level
 * @returns Object with snapped start and end dates, plus the snap delta in milliseconds
 *
 * @example
 * ```ts
 * const { snappedStartDate, snappedEndDate, snapDeltaMs } = snapDatesToGrid(
 *   new Date('2024-03-15T14:30:00'),
 *   new Date('2024-03-18T14:30:00'),
 *   'day'
 * );
 * // snappedStartDate: 2024-03-16T00:00:00
 * // snappedEndDate: 2024-03-19T00:00:00
 * // snapDeltaMs: adjustment applied (positive = moved forward)
 * ```
 */
export function snapDatesToGrid(
  startDate: Date,
  endDate: Date,
  zoomLevel: TimelineZoomLevel
): {
  snappedStartDate: Date;
  snappedEndDate: Date;
  snapDeltaMs: number;
} {
  // Calculate original duration
  const durationMs = endDate.getTime() - startDate.getTime();

  // Snap the start date
  const snappedStartDate = snapDateToGrid(startDate, zoomLevel);

  // Apply the same offset to the end date to maintain duration
  const snapDeltaMs = snappedStartDate.getTime() - startDate.getTime();
  const snappedEndDate = new Date(endDate.getTime() + snapDeltaMs);

  return {
    snappedStartDate,
    snappedEndDate,
    snapDeltaMs
  };
}

/**
 * Get the snap boundary dates visible in the current viewport.
 * Useful for rendering visual snap guides during drag operations.
 *
 * @param visibleStartDate Start of visible timeline range
 * @param visibleEndDate End of visible timeline range
 * @param zoomLevel Current zoom level
 * @returns Array of dates representing snap boundaries
 */
export function getSnapBoundaries(
  visibleStartDate: Date,
  visibleEndDate: Date,
  zoomLevel: TimelineZoomLevel
): Date[] {
  const boundaries: Date[] = [];
  const config = getSnapGridConfig(zoomLevel);

  // Start from a snapped boundary before the visible start
  let current = snapDateToGrid(new Date(visibleStartDate), zoomLevel);
  // Ensure we start at or before the visible start
  if (current > visibleStartDate) {
    // Go back one unit
    switch (config.unit) {
      case 'day':
        current.setDate(current.getDate() - 1);
        break;
      case 'week':
        current.setDate(current.getDate() - 7);
        break;
      case 'month':
        current.setMonth(current.getMonth() - 1);
        break;
    }
  }

  // Iterate through the visible range
  while (current <= visibleEndDate) {
    boundaries.push(new Date(current));

    // Advance to next boundary
    switch (config.unit) {
      case 'day':
        current.setDate(current.getDate() + 1);
        break;
      case 'week':
        current.setDate(current.getDate() + 7);
        break;
      case 'month':
        current.setMonth(current.getMonth() + 1);
        break;
    }
  }

  return boundaries;
}
