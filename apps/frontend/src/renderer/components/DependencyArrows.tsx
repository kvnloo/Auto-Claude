import { memo, useMemo, useCallback } from 'react';
import { cn } from '../lib/utils';
import { calculateTaskBarPosition, isTaskBarVisible } from '../lib/timeline-utils';
import type { TaskBarPosition } from '../lib/timeline-utils';
import type { Task } from '../../shared/types';

/**
 * Represents a dependency connection between two tasks
 */
interface DependencyConnection {
  /** ID of the source task (the one being depended on) */
  fromTaskId: string;
  /** ID of the target task (the one that depends on the source) */
  toTaskId: string;
  /** Position of the source task bar */
  fromPosition: TaskBarPosition;
  /** Position of the target task bar */
  toPosition: TaskBarPosition;
  /** Vertical offset for source task (row index * row height) */
  fromY: number;
  /** Vertical offset for target task (row index * row height) */
  toY: number;
  /** Whether this connection involves a cyclic dependency */
  isCyclic?: boolean;
}

/**
 * Props for the DependencyArrows component
 */
export interface DependencyArrowsProps {
  /** Array of tasks to render dependencies for */
  tasks: Task[];
  /** Start of the visible timeline range */
  visibleStartDate: Date;
  /** End of the visible timeline range */
  visibleEndDate: Date;
  /** Total width of the timeline in pixels */
  totalWidth: number;
  /** Height of each task row in pixels */
  rowHeight: number;
  /** Currently selected task ID (for highlighting) */
  selectedTaskId?: string;
  /** Currently hovered task ID (for highlighting connected arrows) */
  hoveredTaskId?: string;
  /** Set of task IDs involved in dependency cycles (for warning styling) */
  cyclicTaskIds?: Set<string>;
}

// SVG marker IDs for arrowheads
const ARROW_MARKER_ID = 'dependency-arrow';
const ARROW_MARKER_HIGHLIGHT_ID = 'dependency-arrow-highlight';
const ARROW_MARKER_CYCLIC_ID = 'dependency-arrow-cyclic';

/**
 * Calculate control points for a bezier curve connecting two task bars
 * Uses a smooth S-curve that goes around the task bars
 */
function calculateBezierPath(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): string {
  // Calculate the horizontal distance
  const dx = toX - fromX;
  const dy = toY - fromY;

  // For arrows going forward in time (left to right)
  if (dx > 0) {
    // Control point offset - larger for longer distances
    const cpOffset = Math.min(Math.abs(dx) * 0.4, 60);

    // Standard bezier curve: exit right, enter left
    const cp1x = fromX + cpOffset;
    const cp1y = fromY;
    const cp2x = toX - cpOffset;
    const cp2y = toY;

    return `M ${fromX} ${fromY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${toX} ${toY}`;
  } else {
    // Arrows going backward in time (right to left) - need to curve around
    const loopRadius = Math.max(Math.abs(dx) * 0.3, 30);
    const verticalOffset = dy > 0 ? -20 : 20; // Go up or down based on relative position

    // Create a path that goes up/down and around
    const midY = (fromY + toY) / 2 + verticalOffset;
    const cp1x = fromX + loopRadius;
    const cp1y = fromY;
    const cp2x = fromX + loopRadius;
    const cp2y = midY;
    const cp3x = toX - loopRadius;
    const cp3y = midY;
    const cp4x = toX - loopRadius;
    const cp4y = toY;

    return `M ${fromX} ${fromY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${(fromX + toX) / 2} ${midY} S ${cp4x} ${cp4y}, ${toX} ${toY}`;
  }
}

/**
 * Calculate connection points for dependency arrows
 * Arrows go from the right edge of the source task to the left edge of the target task
 */
function calculateConnectionPoints(
  fromPosition: TaskBarPosition,
  toPosition: TaskBarPosition,
  fromY: number,
  toY: number,
  rowHeight: number
): { fromX: number; fromY: number; toX: number; toY: number } {
  // From point: right edge of source task bar, vertically centered
  const fromX = fromPosition.left + fromPosition.width;
  const fromYCenter = fromY + rowHeight / 2;

  // To point: left edge of target task bar, vertically centered
  const toX = toPosition.left;
  const toYCenter = toY + rowHeight / 2;

  return {
    fromX,
    fromY: fromYCenter,
    toX,
    toY: toYCenter
  };
}

/**
 * Custom comparator for React.memo
 */
function dependencyArrowsPropsAreEqual(
  prevProps: DependencyArrowsProps,
  nextProps: DependencyArrowsProps
): boolean {
  // Fast path: check simple properties
  if (
    prevProps.totalWidth !== nextProps.totalWidth ||
    prevProps.rowHeight !== nextProps.rowHeight ||
    prevProps.selectedTaskId !== nextProps.selectedTaskId ||
    prevProps.hoveredTaskId !== nextProps.hoveredTaskId ||
    prevProps.tasks.length !== nextProps.tasks.length
  ) {
    return false;
  }

  // Check date ranges
  if (
    prevProps.visibleStartDate.getTime() !== nextProps.visibleStartDate.getTime() ||
    prevProps.visibleEndDate.getTime() !== nextProps.visibleEndDate.getTime()
  ) {
    return false;
  }

  // Check cyclic task IDs
  if (prevProps.cyclicTaskIds !== nextProps.cyclicTaskIds) {
    if (!prevProps.cyclicTaskIds || !nextProps.cyclicTaskIds) return false;
    if (prevProps.cyclicTaskIds.size !== nextProps.cyclicTaskIds.size) return false;
  }

  // Shallow check on task IDs and dependencies
  for (let i = 0; i < prevProps.tasks.length; i++) {
    const prevTask = prevProps.tasks[i];
    const nextTask = nextProps.tasks[i];
    if (prevTask.id !== nextTask.id) return false;
    if (prevTask.specId !== nextTask.specId) return false;

    // Check dependsOnTaskIds array
    const prevDeps = prevTask.metadata?.dependsOnTaskIds;
    const nextDeps = nextTask.metadata?.dependsOnTaskIds;
    if (prevDeps?.length !== nextDeps?.length) return false;
    if (prevDeps && nextDeps) {
      for (let j = 0; j < prevDeps.length; j++) {
        if (prevDeps[j] !== nextDeps[j]) return false;
      }
    }
  }

  return true;
}

/**
 * DependencyArrows - Renders SVG overlay with bezier curve arrows connecting dependent tasks
 *
 * Features:
 * - Smooth bezier curve arrows from source to target tasks
 * - Arrows point from dependency to dependent task (right edge to left edge)
 * - Highlight arrows when connected task is hovered/selected
 * - Different color for cyclic dependencies (red/warning)
 * - Semi-transparent stroke matching theme
 * - Arrowhead markers at endpoints
 */
export const DependencyArrows = memo(function DependencyArrows({
  tasks,
  visibleStartDate,
  visibleEndDate,
  totalWidth,
  rowHeight,
  selectedTaskId,
  hoveredTaskId,
  cyclicTaskIds
}: DependencyArrowsProps) {
  // Create task position map and index lookup
  const { taskPositions, taskIndexMap } = useMemo(() => {
    const positions = new Map<string, TaskBarPosition>();
    const indexMap = new Map<string, number>();

    tasks.forEach((task, index) => {
      const position = calculateTaskBarPosition(
        task,
        visibleStartDate,
        visibleEndDate,
        totalWidth
      );
      // Use specId as the key since dependsOnTaskIds uses specId
      positions.set(task.specId, position);
      indexMap.set(task.specId, index);
    });

    return { taskPositions: positions, taskIndexMap: indexMap };
  }, [tasks, visibleStartDate, visibleEndDate, totalWidth]);

  // Build dependency connections
  const connections = useMemo((): DependencyConnection[] => {
    const result: DependencyConnection[] = [];

    for (const task of tasks) {
      const dependsOnIds = task.metadata?.dependsOnTaskIds;
      if (!dependsOnIds || dependsOnIds.length === 0) continue;

      const toPosition = taskPositions.get(task.specId);
      const toIndex = taskIndexMap.get(task.specId);

      if (toPosition === undefined || toIndex === undefined) continue;

      for (const fromSpecId of dependsOnIds) {
        const fromPosition = taskPositions.get(fromSpecId);
        const fromIndex = taskIndexMap.get(fromSpecId);

        if (fromPosition === undefined || fromIndex === undefined) continue;

        // Check if connection is visible (at least one end is in viewport)
        const fromVisible = isTaskBarVisible(fromPosition, totalWidth);
        const toVisible = isTaskBarVisible(toPosition, totalWidth);

        if (!fromVisible && !toVisible) continue;

        // Check if this is part of a cyclic dependency
        const isCyclic =
          (cyclicTaskIds?.has(task.specId) ?? false) &&
          (cyclicTaskIds?.has(fromSpecId) ?? false);

        result.push({
          fromTaskId: fromSpecId,
          toTaskId: task.specId,
          fromPosition,
          toPosition,
          fromY: fromIndex * rowHeight,
          toY: toIndex * rowHeight,
          isCyclic
        });
      }
    }

    return result;
  }, [tasks, taskPositions, taskIndexMap, totalWidth, rowHeight, cyclicTaskIds]);

  // Check if a connection should be highlighted
  const isConnectionHighlighted = useCallback(
    (connection: DependencyConnection): boolean => {
      if (!selectedTaskId && !hoveredTaskId) return false;

      // Find the actual task IDs from the spec IDs
      const highlightedSpecId = tasks.find(
        (t) => t.id === selectedTaskId || t.id === hoveredTaskId
      )?.specId;

      if (!highlightedSpecId) return false;

      return (
        connection.fromTaskId === highlightedSpecId ||
        connection.toTaskId === highlightedSpecId
      );
    },
    [selectedTaskId, hoveredTaskId, tasks]
  );

  // Don't render if no connections
  if (connections.length === 0) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none overflow-visible"
      style={{ width: totalWidth, height: tasks.length * rowHeight }}
    >
      {/* Define arrow markers - theme-aware colors */}
      <defs>
        {/* Default arrow marker - semi-transparent, theme-matching */}
        <marker
          id={ARROW_MARKER_ID}
          markerWidth="10"
          markerHeight="10"
          refX="9"
          refY="5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path
            d="M 0 0 L 10 5 L 0 10 L 2 5 Z"
            className="fill-blue-400/50 dark:fill-blue-400/60"
          />
        </marker>

        {/* Highlighted arrow marker - brighter, more visible */}
        <marker
          id={ARROW_MARKER_HIGHLIGHT_ID}
          markerWidth="10"
          markerHeight="10"
          refX="9"
          refY="5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path
            d="M 0 0 L 10 5 L 0 10 L 2 5 Z"
            className="fill-blue-500 dark:fill-blue-400"
          />
        </marker>

        {/* Cyclic dependency arrow marker - red/warning color */}
        <marker
          id={ARROW_MARKER_CYCLIC_ID}
          markerWidth="10"
          markerHeight="10"
          refX="9"
          refY="5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path
            d="M 0 0 L 10 5 L 0 10 L 2 5 Z"
            className="fill-red-500/90 dark:fill-red-400/90"
          />
        </marker>
      </defs>

      {/* Render dependency arrows */}
      {connections.map((connection, idx) => {
        const points = calculateConnectionPoints(
          connection.fromPosition,
          connection.toPosition,
          connection.fromY,
          connection.toY,
          rowHeight
        );

        const pathD = calculateBezierPath(
          points.fromX,
          points.fromY,
          points.toX,
          points.toY
        );

        const isHighlighted = isConnectionHighlighted(connection);
        const isCyclic = connection.isCyclic;

        // Determine marker and stroke based on state
        let markerId = ARROW_MARKER_ID;
        if (isCyclic) {
          markerId = ARROW_MARKER_CYCLIC_ID;
        } else if (isHighlighted) {
          markerId = ARROW_MARKER_HIGHLIGHT_ID;
        }

        // Determine whether other arrows are being highlighted (fade non-highlighted arrows)
        const hasActiveHighlight = !!(selectedTaskId || hoveredTaskId);
        const shouldFade = hasActiveHighlight && !isHighlighted;

        return (
          <path
            key={`${connection.fromTaskId}-${connection.toTaskId}-${idx}`}
            d={pathD}
            className={cn(
              // Smooth transitions for all state changes
              'transition-all duration-200 ease-out',
              // Default state - semi-transparent, theme-aware
              !isHighlighted && !isCyclic && 'stroke-blue-400/40 dark:stroke-blue-400/50',
              // Highlighted state - brighter with enhanced visibility
              isHighlighted && !isCyclic && 'stroke-blue-500 dark:stroke-blue-400',
              // Cyclic dependency - red/warning color for visibility
              isCyclic && !isHighlighted && 'stroke-red-500/60 dark:stroke-red-400/70',
              // Cyclic + highlighted - full intensity warning color
              isCyclic && isHighlighted && 'stroke-red-500 dark:stroke-red-400'
            )}
            fill="none"
            strokeWidth={isHighlighted ? 2.5 : 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            markerEnd={`url(#${markerId})`}
            style={{
              // Fade non-highlighted arrows when another task is focused
              opacity: shouldFade ? 0.25 : 1,
              // Add subtle filter effect for highlighted arrows
              filter: isHighlighted
                ? isCyclic
                  ? 'drop-shadow(0 0 3px rgba(239, 68, 68, 0.5))'
                  : 'drop-shadow(0 0 3px rgba(59, 130, 246, 0.4))'
                : 'none'
            }}
          />
        );
      })}
    </svg>
  );
}, dependencyArrowsPropsAreEqual);

/**
 * Export utility function for external use
 */
export { calculateBezierPath, calculateConnectionPoints };

/**
 * Re-export types for use in other components
 */
export type { DependencyConnection };
