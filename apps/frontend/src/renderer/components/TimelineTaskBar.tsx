import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import type { Task, TaskStatus } from '../../shared/types';

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
  /** Callback when task is clicked */
  onClick: (task: Task) => void;
  /** Callback when task is hovered */
  onHover?: (task: Task | null) => void;
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
    prevProps.onClick === nextProps.onClick &&
    prevProps.onHover === nextProps.onHover
  ) {
    return true;
  }

  // Compare relevant task fields
  return (
    prevTask.id === nextTask.id &&
    prevTask.status === nextTask.status &&
    prevTask.title === nextTask.title &&
    prevProps.left === nextProps.left &&
    prevProps.width === nextProps.width &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isHovered === nextProps.isHovered
  );
}

/**
 * TimelineTaskBar - Renders a horizontal bar for a task on the timeline
 *
 * Visual representation:
 * - Horizontal bar with status-based coloring
 * - Truncated title with full title on hover
 * - Click to open task details
 * - Hover state for linked artifact highlighting
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
  onClick,
  onHover
}: TimelineTaskBarProps) {
  const { t } = useTranslation('tasks');

  // Memoize class names to prevent recalculation
  const barClasses = useMemo(() => {
    const bgColor = getStatusBackgroundColor(task.status);
    const borderColor = getStatusBorderColor(task.status);
    const textColor = getStatusTextColor(task.status);

    return cn(
      // Base bar styles
      'absolute h-6 rounded-md cursor-pointer transition-all duration-150',
      'flex items-center px-2 overflow-hidden',
      // Status-based background color
      bgColor,
      textColor,
      // Border for selected/hovered states
      'border',
      isSelected ? `${borderColor} border-2 shadow-md` : 'border-transparent',
      // Hover effects
      'hover:brightness-110 hover:shadow-sm',
      // Highlight when linked artifacts are being viewed
      isHovered && 'ring-2 ring-primary/50 ring-offset-1 ring-offset-background'
    );
  }, [task.status, isSelected, isHovered]);

  // Handle mouse events for linked artifact highlighting
  const handleMouseEnter = () => {
    onHover?.(task);
  };

  const handleMouseLeave = () => {
    onHover?.(null);
  };

  const handleClick = () => {
    onClick(task);
  };

  // Minimum width to show any content
  const showTitle = width > 40;

  return (
    <div
      className={barClasses}
      style={{
        left: `${left}px`,
        width: `${Math.max(width, 8)}px`, // Minimum 8px for visibility
        top: '50%',
        transform: 'translateY(-50%)'
      }}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      aria-label={t('timeline.taskBar.ariaLabel', { title: task.title })}
      title={task.title}
    >
      {showTitle && (
        <span className="truncate text-xs font-medium">
          {task.title}
        </span>
      )}
    </div>
  );
}, timelineTaskBarPropsAreEqual);

/**
 * Export color utility functions for use in other timeline components
 * (e.g., legend, status indicators)
 */
export { getStatusBackgroundColor, getStatusBorderColor, getStatusTextColor };

// Note: TaskBarPosition type is now defined in timeline-utils.ts with full implementation
