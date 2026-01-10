import { memo, useMemo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, GripVertical } from 'lucide-react';
import { cn } from '../lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { getTaskDateRange } from '../lib/timeline-utils';
import type { Task, TaskStatus, Subtask } from '../../shared/types';

/**
 * Resize edge type - indicates which edge of the task bar is being resized
 */
export type ResizeEdge = 'left' | 'right';

/**
 * Props for TimelineTaskBar component
 */
export interface TimelineTaskBarProps {
  /** The task to render */
  task: Task;
  /** Left position in pixels from timeline start */
  left: number;
  /** Width of the bar in pixels */
  width: number;
  /** Whether this task is currently selected */
  isSelected?: boolean;
  /** Whether this task is currently hovered (for linked artifact highlighting) */
  isHovered?: boolean;
  /** Whether this task is part of a dependency cycle */
  isInCycle?: boolean;
  /** Whether dragging is enabled for this task bar */
  isDraggable?: boolean;
  /** Whether this task is currently being dragged */
  isDragging?: boolean;
  /** Whether resizing is enabled for this task bar */
  isResizable?: boolean;
  /** Which edge is currently being resized (if any) */
  resizingEdge?: ResizeEdge | null;
  /** Callback when task is clicked */
  onClick: (task: Task) => void;
  /** Callback when task is hovered */
  onHover?: (task: Task | null) => void;
  /** Callback when resize starts on an edge */
  onResizeStart?: (task: Task, edge: ResizeEdge) => void;
  /** Callback when resize ends */
  onResizeEnd?: (task: Task, edge: ResizeEdge, deltaPixels: number) => void;
}

/**
 * Get the background color class for a task based on its status
 * Reuses the same color scheme as KanbanBoard column borders
 */
function getStatusBackgroundColor(status: TaskStatus): string {
  switch (status) {
    case 'backlog':
      // Muted gray - matches column-backlog (var(--muted-foreground))
      return 'bg-muted-foreground/70';
    case 'in_progress':
      // Blue - matches column-in-progress (var(--info))
      return 'bg-blue-500';
    case 'ai_review':
      // Amber/Yellow - matches column-ai-review (var(--warning))
      return 'bg-amber-500';
    case 'human_review':
      // Purple - matches column-human-review (#A855F7)
      return 'bg-purple-500';
    case 'pr_created':
      // Green with indicator - similar to done but slightly different
      return 'bg-emerald-500';
    case 'done':
      // Green - matches column-done (var(--success))
      return 'bg-green-500';
    default:
      return 'bg-muted-foreground/50';
  }
}

/**
 * Get the border color class for a task based on its status
 * Used for hover/selected states
 */
function getStatusBorderColor(status: TaskStatus): string {
  switch (status) {
    case 'backlog':
      return 'border-muted-foreground';
    case 'in_progress':
      return 'border-blue-400';
    case 'ai_review':
      return 'border-amber-400';
    case 'human_review':
      return 'border-purple-400';
    case 'pr_created':
      return 'border-emerald-400';
    case 'done':
      return 'border-green-400';
    default:
      return 'border-muted-foreground/50';
  }
}

/**
 * Get the text color class for task title based on status
 * Ensures readability against the status background
 */
function getStatusTextColor(status: TaskStatus): string {
  switch (status) {
    case 'backlog':
      return 'text-foreground';
    case 'in_progress':
    case 'ai_review':
    case 'human_review':
    case 'pr_created':
    case 'done':
      return 'text-white';
    default:
      return 'text-foreground';
  }
}

/**
 * Calculate the progress percentage of subtasks
 * Returns an object with percentage, completed count, and total count
 */
function calculateSubtaskProgress(subtasks: Subtask[]): {
  percent: number;
  completed: number;
  total: number;
} {
  if (!subtasks || subtasks.length === 0) {
    return { percent: 0, completed: 0, total: 0 };
  }

  const completed = subtasks.filter(
    (subtask) => subtask.status === 'completed'
  ).length;
  const total = subtasks.length;
  const percent = Math.round((completed / total) * 100);

  return { percent, completed, total };
}

/**
 * Format a date for display in the tooltip
 */
function formatTooltipDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Custom comparator for React.memo - only re-render when relevant props change
 */
function timelineTaskBarPropsAreEqual(
  prevProps: TimelineTaskBarProps,
  nextProps: TimelineTaskBarProps
): boolean {
  const prevTask = prevProps.task;
  const nextTask = nextProps.task;

  // Fast path: same references
  if (
    prevTask === nextTask &&
    prevProps.left === nextProps.left &&
    prevProps.width === nextProps.width &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isHovered === nextProps.isHovered &&
    prevProps.isInCycle === nextProps.isInCycle &&
    prevProps.isDraggable === nextProps.isDraggable &&
    prevProps.isDragging === nextProps.isDragging &&
    prevProps.isResizable === nextProps.isResizable &&
    prevProps.resizingEdge === nextProps.resizingEdge &&
    prevProps.onClick === nextProps.onClick &&
    prevProps.onHover === nextProps.onHover
  ) {
    return true;
  }

  // Compare subtask progress (shallow comparison)
  const prevProgress = calculateSubtaskProgress(prevTask.subtasks);
  const nextProgress = calculateSubtaskProgress(nextTask.subtasks);
  const subtaskProgressEqual =
    prevProgress.percent === nextProgress.percent &&
    prevProgress.total === nextProgress.total;

  // Compare relevant task fields
  return (
    prevTask.id === nextTask.id &&
    prevTask.status === nextTask.status &&
    prevTask.title === nextTask.title &&
    prevTask.createdAt === nextTask.createdAt &&
    prevTask.metadata?.scheduledStartDate === nextTask.metadata?.scheduledStartDate &&
    prevTask.metadata?.scheduledEndDate === nextTask.metadata?.scheduledEndDate &&
    subtaskProgressEqual &&
    prevProps.left === nextProps.left &&
    prevProps.width === nextProps.width &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isHovered === nextProps.isHovered &&
    prevProps.isInCycle === nextProps.isInCycle &&
    prevProps.isDraggable === nextProps.isDraggable &&
    prevProps.isDragging === nextProps.isDragging &&
    prevProps.isResizable === nextProps.isResizable &&
    prevProps.resizingEdge === nextProps.resizingEdge
  );
}

/**
 * TimelineTaskBar - Renders a horizontal bar for a task on the timeline
 *
 * Visual representation:
 * - Horizontal bar with status-based coloring
 * - Truncated title with Tooltip showing full title and date range
 * - Progress indicator showing completed subtasks %
 * - Click to open TaskDetailModal
 * - Hover state for linked artifact highlighting
 * - Horizontal drag support for rescheduling tasks
 *
 * Status colors match KanbanBoard column border colors:
 * - backlog: muted gray
 * - in_progress: blue
 * - ai_review: amber/yellow
 * - human_review: purple
 * - pr_created: emerald
 * - done: green
 */
export const TimelineTaskBar = memo(function TimelineTaskBar({
  task,
  left,
  width,
  isSelected = false,
  isHovered = false,
  isInCycle = false,
  isDraggable = true,
  isDragging: isDraggingProp = false,
  isResizable = true,
  resizingEdge = null,
  onClick,
  onHover,
  onResizeStart,
  onResizeEnd
}: TimelineTaskBarProps) {
  const { t } = useTranslation('tasks');

  // Local resize tracking state for visual feedback during resize
  const [localResizeEdge, setLocalResizeEdge] = useState<ResizeEdge | null>(null);
  const [resizeStartX, setResizeStartX] = useState<number>(0);

  // Setup draggable functionality using @dnd-kit/core
  // We use a unique ID that includes task ID to ensure each bar is uniquely identifiable
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging: isDraggingInternal
  } = useDraggable({
    id: `timeline-task-${task.id}`,
    data: {
      type: 'timeline-task',
      task,
      // Include original position for delta calculation during drag
      originalLeft: left,
      originalWidth: width
    },
    disabled: !isDraggable
  });

  // Use internal drag state or prop (for DragOverlay coordination)
  const isDragging = isDraggingInternal || isDraggingProp;

  // Combined resize state - either from parent prop or local state
  const isResizing = localResizeEdge !== null || resizingEdge !== null;
  const currentResizeEdge = resizingEdge ?? localResizeEdge;

  // Calculate date range for tooltip
  const dateRange = useMemo(() => getTaskDateRange(task), [task]);

  // Calculate subtask progress
  const progress = useMemo(
    () => calculateSubtaskProgress(task.subtasks),
    [task.subtasks]
  );

  // Compute the visual transform style for dragging
  // Only apply horizontal (x) translation to maintain row position
  const dragStyle = useMemo(() => {
    if (!transform) return {};
    return {
      transform: CSS.Transform.toString({
        x: transform.x,
        y: 0, // Lock vertical movement - only horizontal dragging allowed
        scaleX: 1,
        scaleY: 1
      }),
      // Elevate during drag for visual feedback
      zIndex: isDragging ? 100 : undefined
    };
  }, [transform, isDragging]);

  // Memoize class names to prevent recalculation
  const barClasses = useMemo(() => {
    const bgColor = getStatusBackgroundColor(task.status);
    const borderColor = getStatusBorderColor(task.status);
    const textColor = getStatusTextColor(task.status);

    return cn(
      // Base bar styles - 'group' enables group-hover for child elements (resize handles)
      'group absolute h-6 rounded-md cursor-pointer transition-all duration-150',
      'flex items-center overflow-hidden',
      // Status-based background color
      bgColor,
      textColor,
      // Border for selected/hovered states
      'border',
      isSelected ? `${borderColor} border-2 shadow-md` : 'border-transparent',
      // Hover effects (disabled during drag or resize)
      !isDragging && !isResizing && 'hover:brightness-110 hover:shadow-sm',
      // Highlight when linked artifacts are being viewed
      isHovered && !isDragging && !isResizing && 'ring-2 ring-primary/50 ring-offset-1 ring-offset-background',
      // Warning ring for tasks in dependency cycles
      isInCycle && !isDragging && !isResizing && 'ring-2 ring-red-500/70 ring-offset-1 ring-offset-background',
      // Drag state styling
      isDragging && 'opacity-90 shadow-lg ring-2 ring-primary/70 cursor-grabbing',
      // Resize state styling
      isResizing && 'opacity-95 shadow-md ring-2 ring-primary/50',
      // Draggable cursor when enabled (but not when resizing)
      isDraggable && !isDragging && !isResizing && 'cursor-grab',
      // Touch handling for mobile
      'touch-none'
    );
  }, [task.status, isSelected, isHovered, isInCycle, isDragging, isDraggable, isResizing]);

  // Handle mouse events for linked artifact highlighting
  const handleMouseEnter = () => {
    if (!isDragging) {
      onHover?.(task);
    }
  };

  const handleMouseLeave = () => {
    if (!isDragging) {
      onHover?.(null);
    }
  };

  const handleClick = () => {
    // Don't trigger click when dragging or resizing (user might have just finished)
    if (!isDragging && !localResizeEdge && !resizingEdge) {
      onClick(task);
    }
  };

  /**
   * Handle resize start - triggered on mousedown on a resize handle
   * Uses pointer capture for reliable tracking across the document
   */
  const handleResizeStart = useCallback((edge: ResizeEdge) => (e: React.MouseEvent | React.PointerEvent) => {
    // Prevent triggering drag or click handlers
    e.stopPropagation();
    e.preventDefault();

    // Capture the pointer for reliable tracking
    (e.target as HTMLElement).setPointerCapture((e as React.PointerEvent).pointerId);

    setLocalResizeEdge(edge);
    setResizeStartX(e.clientX);

    // Notify parent of resize start
    onResizeStart?.(task, edge);
  }, [task, onResizeStart]);

  /**
   * Handle pointer move during resize
   */
  const handleResizeMove = useCallback((e: React.PointerEvent) => {
    if (!localResizeEdge) return;

    // The actual delta calculation will happen in the parent component
    // This handler is mainly for visual feedback during resize
    e.stopPropagation();
    e.preventDefault();
  }, [localResizeEdge]);

  /**
   * Handle resize end - triggered on pointerup
   */
  const handleResizeEnd = useCallback((e: React.PointerEvent) => {
    if (!localResizeEdge) return;

    e.stopPropagation();
    e.preventDefault();

    // Release pointer capture
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);

    // Calculate the pixel delta
    const deltaPixels = e.clientX - resizeStartX;

    // Notify parent of resize end with the delta
    onResizeEnd?.(task, localResizeEdge, deltaPixels);

    // Reset local state
    setLocalResizeEdge(null);
    setResizeStartX(0);
  }, [task, localResizeEdge, resizeStartX, onResizeEnd]);

  // Minimum width thresholds for content display
  const showTitle = width > 60;
  const showProgressBar = width > 40 && progress.total > 0;
  // Show cycle badge when bar is wide enough and task is in a cycle
  const showCycleBadge = isInCycle && width > 50;
  // Show drag handle when bar is wide enough and dragging is enabled
  const showDragHandle = isDraggable && width > 30;
  // Show resize handles when bar is wide enough and resizing is enabled
  // Resize handles need less space than drag handle since they're on the edges
  const showResizeHandles = isResizable && width > 20 && !isDragging;

  // Format dates for tooltip
  const startDateStr = formatTooltipDate(dateRange.startDate);
  const endDateStr = formatTooltipDate(dateRange.endDate);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          ref={setNodeRef}
          className={barClasses}
          style={{
            left: `${left}px`,
            width: `${Math.max(width, 8)}px`, // Minimum 8px for visibility
            top: '50%',
            transform: 'translateY(-50%)',
            ...dragStyle
          }}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleClick();
            }
          }}
          aria-label={t('timeline.taskBar.ariaLabel', { title: task.title })}
          aria-grabbed={isDragging}
          {...attributes}
          {...listeners}
        >
          {/* Left resize handle - adjusts start date */}
          {showResizeHandles && (
            <div
              className={cn(
                'absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-30',
                'flex items-center justify-center',
                'opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity duration-150',
                // Visual indicator - small vertical line/grip
                'before:content-[""] before:absolute before:left-0.5 before:top-1/2 before:-translate-y-1/2',
                'before:w-0.5 before:h-4 before:bg-white/50 before:rounded-full',
                // Enhanced visibility during resize
                (currentResizeEdge === 'left') && 'opacity-100 before:bg-white/80 before:h-5'
              )}
              onPointerDown={handleResizeStart('left')}
              onPointerMove={handleResizeMove}
              onPointerUp={handleResizeEnd}
              onPointerCancel={handleResizeEnd}
              role="slider"
              aria-label={t('timeline.taskBar.resizeHandle.left')}
              aria-orientation="horizontal"
              tabIndex={-1}
            />
          )}

          {/* Right resize handle - adjusts duration/end date */}
          {showResizeHandles && (
            <div
              className={cn(
                'absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-30',
                'flex items-center justify-center',
                'opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity duration-150',
                // Visual indicator - small vertical line/grip
                'before:content-[""] before:absolute before:right-0.5 before:top-1/2 before:-translate-y-1/2',
                'before:w-0.5 before:h-4 before:bg-white/50 before:rounded-full',
                // Enhanced visibility during resize
                (currentResizeEdge === 'right') && 'opacity-100 before:bg-white/80 before:h-5'
              )}
              onPointerDown={handleResizeStart('right')}
              onPointerMove={handleResizeMove}
              onPointerUp={handleResizeEnd}
              onPointerCancel={handleResizeEnd}
              role="slider"
              aria-label={t('timeline.taskBar.resizeHandle.right')}
              aria-orientation="horizontal"
              tabIndex={-1}
            />
          )}

          {/* Progress bar overlay (background) */}
          {showProgressBar && progress.percent > 0 && (
            <div
              className="absolute inset-0 bg-white/20 origin-left"
              style={{ width: `${progress.percent}%` }}
            />
          )}

          {/* Content container - title and optional progress indicator */}
          <div className="relative flex items-center gap-1 px-2 w-full z-10">
            {/* Drag handle indicator (subtle visual cue) */}
            {showDragHandle && (
              <GripVertical
                className={cn(
                  'h-3 w-3 flex-shrink-0 opacity-40 transition-opacity',
                  isDragging ? 'opacity-70' : 'group-hover:opacity-60'
                )}
              />
            )}

            {/* Cycle warning badge - positioned at start of bar */}
            {showCycleBadge && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex-shrink-0 flex items-center justify-center w-4 h-4 bg-red-500 rounded-sm">
                    <AlertTriangle className="h-3 w-3 text-white" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold text-red-500 flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {t('timeline.dependencyCycle.warningTitle')}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t('timeline.dependencyCycle.tooltip')}
                    </span>
                  </div>
                </TooltipContent>
              </Tooltip>
            )}

            {showTitle && (
              <span className="truncate text-xs font-medium flex-1 min-w-0">
                {task.title}
              </span>
            )}

            {/* Mini progress indicator badge (when bar is wide enough but not for 100% or 0%) */}
            {showProgressBar && progress.percent > 0 && progress.percent < 100 && width > 80 && (
              <span className="flex-shrink-0 text-[10px] font-semibold opacity-90 tabular-nums">
                {progress.percent}%
              </span>
            )}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="flex flex-col gap-1">
          {/* Full task title */}
          <span className="font-semibold text-sm">{task.title}</span>

          {/* Date range */}
          <span className="text-xs text-muted-foreground">
            {t('timeline.taskBar.tooltip.dateRange', {
              startDate: startDateStr,
              endDate: endDateStr
            })}
          </span>

          {/* Cycle warning banner */}
          {isInCycle && (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-red-500/10 border border-red-500/30 rounded text-xs">
              <AlertTriangle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
              <span className="text-red-600 dark:text-red-400">
                {t('timeline.dependencyCycle.warningDescription')}
              </span>
            </div>
          )}

          {/* Progress indicator */}
          {progress.total > 0 ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">
                {t('timeline.taskBar.tooltip.progress', {
                  percent: progress.percent,
                  completed: progress.completed,
                  total: progress.total
                })}
              </span>
              {/* Visual progress bar */}
              <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground italic">
              {t('timeline.taskBar.tooltip.noSubtasks')}
            </span>
          )}

          {/* Drag and resize hints when enabled */}
          {(isDraggable || isResizable) && (
            <div className="flex flex-col gap-0.5 mt-0.5">
              {isDraggable && (
                <span className="text-xs text-primary/70">
                  {t('timeline.dragToSchedule')}
                </span>
              )}
              {isResizable && (
                <span className="text-xs text-primary/70">
                  {t('timeline.taskBar.resizeHint')}
                </span>
              )}
            </div>
          )}

          {/* Click hint */}
          <span className="text-xs text-muted-foreground/70 mt-1 border-t border-border/50 pt-1">
            {t('timeline.taskBar.tooltip.clickToOpen')}
          </span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}, timelineTaskBarPropsAreEqual);

/**
 * Export color utility functions for use in other timeline components
 * (e.g., legend, status indicators)
 */
export { getStatusBackgroundColor, getStatusBorderColor, getStatusTextColor };

// Note: TaskBarPosition type is now defined in timeline-utils.ts with full implementation
