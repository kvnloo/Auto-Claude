import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragMoveEvent
} from '@dnd-kit/core';
import { useViewState } from '../contexts/ViewStateContext';
import { useGitHistory } from '../hooks';
import {
  AlertTriangle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Clock,
  Diamond,
  Flag,
  GitBranch,
  GitCommit as GitCommitIcon,
  Inbox,
  Milestone,
  Plus,
  Tag,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { Separator } from './ui/separator';
import { cn } from '../lib/utils';
import {
  calculateTaskBarPosition,
  isTaskBarVisible,
  detectDependencyCycles,
  snapDatesToGrid,
  getDatePixelPosition,
  getTaskStartDate,
  getTaskEndDate,
  getSnapGridConfig
} from '../lib/timeline-utils';
import type { TaskBarPosition, TimelineZoomLevel } from '../lib/timeline-utils';
import { TimelineTaskBar } from './TimelineTaskBar';
import { DependencyArrows } from './DependencyArrows';
import type { Task } from '../../shared/types';
import type { TimelineGitCommit, TimelineGitTag, TimelineMilestone } from '../../shared/types/git';

// Re-export TimelineZoomLevel for external use
export type { TimelineZoomLevel };

interface TimelineViewProps {
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onNewTaskClick?: () => void;
  /** Callback when a task's schedule is changed via drag */
  onTaskScheduleChange?: (taskId: string, newStartDate: Date, newEndDate: Date) => void;
}

// Column widths for each zoom level (in pixels)
const ZOOM_COLUMN_WIDTHS: Record<TimelineZoomLevel, number> = {
  quarter: 120,
  month: 80,
  week: 60,
  day: 40
};

// Task row height
const TASK_ROW_HEIGHT = 36;

// Header height for timeline header (two rows: primary + secondary)
const TIMELINE_HEADER_PRIMARY_HEIGHT = 24;
const TIMELINE_HEADER_SECONDARY_HEIGHT = 28;
const TIMELINE_HEADER_HEIGHT = TIMELINE_HEADER_PRIMARY_HEIGHT + TIMELINE_HEADER_SECONDARY_HEIGHT;

// Left sidebar width
const SIDEBAR_WIDTH = 240;

/**
 * TimelineHeader - Renders the date columns with grid lines and month/week labels
 * Uses a two-row structure:
 * - Primary row: Higher-level grouping (months for day/week view, years for month/quarter view)
 * - Secondary row: Specific date labels (day numbers, week numbers, month names, quarter labels)
 */
interface TimelineHeaderProps {
  zoomLevel: TimelineZoomLevel;
  visibleStartDate: Date;
  visibleEndDate: Date;
  columnWidth: number;
  scrollLeft: number;
}

/**
 * Column data for secondary header row
 */
interface ColumnData {
  date: Date;
  label: string;
  isToday: boolean;
  isWeekend?: boolean;
}

/**
 * Group data for primary header row
 */
interface GroupData {
  label: string;
  startIndex: number;
  columnCount: number;
}

function TimelineHeader({
  zoomLevel,
  visibleStartDate,
  visibleEndDate,
  columnWidth,
  scrollLeft
}: TimelineHeaderProps) {
  const { t } = useTranslation('tasks');

  // Generate date columns based on zoom level
  const columns = useMemo((): ColumnData[] => {
    const cols: ColumnData[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const current = new Date(visibleStartDate);
    current.setHours(0, 0, 0, 0);

    while (current <= visibleEndDate) {
      const isToday =
        current.getFullYear() === today.getFullYear() &&
        current.getMonth() === today.getMonth() &&
        current.getDate() === today.getDate();

      const dayOfWeek = current.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      let label = '';
      switch (zoomLevel) {
        case 'day':
          label = current.toLocaleDateString(undefined, { day: 'numeric', weekday: 'short' });
          break;
        case 'week':
          label = `W${getWeekNumber(current)}`;
          break;
        case 'month':
          label = current.toLocaleDateString(undefined, { month: 'short' });
          break;
        case 'quarter':
          label = `Q${Math.floor(current.getMonth() / 3) + 1}`;
          break;
      }

      cols.push({ date: new Date(current), label, isToday, isWeekend });

      // Advance to next period
      switch (zoomLevel) {
        case 'day':
          current.setDate(current.getDate() + 1);
          break;
        case 'week':
          current.setDate(current.getDate() + 7);
          break;
        case 'month':
          current.setMonth(current.getMonth() + 1);
          break;
        case 'quarter':
          current.setMonth(current.getMonth() + 3);
          break;
      }
    }

    return cols;
  }, [zoomLevel, visibleStartDate, visibleEndDate]);

  // Generate primary header groups (higher-level grouping)
  const groups = useMemo((): GroupData[] => {
    const groupList: GroupData[] = [];
    let currentGroupLabel = '';
    let currentGroupStartIndex = 0;
    let currentGroupCount = 0;

    columns.forEach((col, idx) => {
      let groupLabel = '';
      switch (zoomLevel) {
        case 'day':
        case 'week':
          // Group by month for day/week views
          groupLabel = col.date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
          break;
        case 'month':
        case 'quarter':
          // Group by year for month/quarter views
          groupLabel = col.date.getFullYear().toString();
          break;
      }

      if (groupLabel !== currentGroupLabel) {
        // Save previous group if exists
        if (currentGroupCount > 0) {
          groupList.push({
            label: currentGroupLabel,
            startIndex: currentGroupStartIndex,
            columnCount: currentGroupCount
          });
        }
        // Start new group
        currentGroupLabel = groupLabel;
        currentGroupStartIndex = idx;
        currentGroupCount = 1;
      } else {
        currentGroupCount++;
      }
    });

    // Add final group
    if (currentGroupCount > 0) {
      groupList.push({
        label: currentGroupLabel,
        startIndex: currentGroupStartIndex,
        columnCount: currentGroupCount
      });
    }

    return groupList;
  }, [columns, zoomLevel]);

  // Calculate 'Now' marker position
  const nowPosition = useMemo(() => {
    const now = new Date();
    const startMs = visibleStartDate.getTime();
    const endMs = visibleEndDate.getTime();
    const nowMs = now.getTime();

    if (nowMs < startMs || nowMs > endMs) return null;

    const totalWidth = columns.length * columnWidth;
    const position = ((nowMs - startMs) / (endMs - startMs)) * totalWidth;
    return position;
  }, [columns.length, columnWidth, visibleStartDate, visibleEndDate]);

  const totalWidth = columns.length * columnWidth;

  return (
    <div
      className="relative border-b border-border bg-card/50 flex flex-col"
      style={{ height: TIMELINE_HEADER_HEIGHT }}
    >
      {/* Primary header row - higher-level grouping (months/years) */}
      <div
        className="relative border-b border-border/30 overflow-hidden"
        style={{ height: TIMELINE_HEADER_PRIMARY_HEIGHT }}
      >
        <div
          className="absolute top-0 bottom-0 flex"
          style={{
            width: totalWidth,
            transform: `translateX(-${scrollLeft}px)`
          }}
        >
          {groups.map((group, idx) => (
            <div
              key={idx}
              className="absolute top-0 bottom-0 border-r border-border/50 flex items-center justify-center text-xs font-semibold text-muted-foreground bg-muted/30"
              style={{
                width: group.columnCount * columnWidth,
                left: group.startIndex * columnWidth
              }}
            >
              <span className="truncate px-1">{group.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Secondary header row - specific date labels */}
      <div
        className="relative overflow-hidden"
        style={{ height: TIMELINE_HEADER_SECONDARY_HEIGHT }}
      >
        <div
          className="absolute top-0 bottom-0 flex"
          style={{
            width: totalWidth,
            transform: `translateX(-${scrollLeft}px)`
          }}
        >
          {columns.map((col, idx) => (
            <div
              key={idx}
              className={cn(
                'flex-shrink-0 border-r border-border/40 flex items-center justify-center text-xs font-medium',
                col.isToday && 'bg-primary/15 text-primary font-semibold',
                col.isWeekend && zoomLevel === 'day' && !col.isToday && 'bg-muted/20 text-muted-foreground'
              )}
              style={{ width: columnWidth }}
            >
              <span className="truncate px-0.5">{col.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Now marker - vertical red line with label */}
      {nowPosition !== null && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20 cursor-pointer hover:bg-red-400 transition-colors"
              style={{ left: nowPosition - scrollLeft }}
            >
              {/* Top marker dot */}
              <div className="absolute -top-0.5 -left-1 w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-background shadow-sm" />
              {/* Now label badge */}
              <div className="absolute top-3 -left-4 px-1.5 py-0.5 bg-red-500 text-white text-[10px] font-semibold rounded shadow-sm whitespace-nowrap">
                {t('timeline.today')}
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <span>{new Date().toLocaleDateString(undefined, {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}</span>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * DragColumnHighlight - Highlights the date columns where the task will snap to during drag
 * Shows a semi-transparent overlay on the columns covered by the ghost position
 */
interface DragColumnHighlightProps {
  ghostPosition: TaskBarPosition;
  visibleStartDate: Date;
  visibleEndDate: Date;
  totalWidth: number;
}

function DragColumnHighlight({
  ghostPosition,
  visibleStartDate,
  visibleEndDate,
  totalWidth
}: DragColumnHighlightProps) {
  // Calculate the highlight area based on ghost position
  const highlightLeft = ghostPosition.left;
  const highlightWidth = ghostPosition.width;

  // Don't render if outside visible area
  if (highlightLeft + highlightWidth < 0 || highlightLeft > totalWidth) {
    return null;
  }

  return (
    <div
      className="absolute top-0 bottom-0 bg-primary/10 border-l-2 border-r-2 border-primary/40 pointer-events-none z-5 transition-all duration-75"
      style={{
        left: `${Math.max(0, highlightLeft)}px`,
        width: `${highlightWidth}px`
      }}
    >
      {/* Top edge indicator */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-primary/40" />
      {/* Bottom edge indicator */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary/40" />
    </div>
  );
}

/**
 * DragGhostPreview - Shows a semi-transparent ghost of the task bar at the snapped position
 * This provides a clear preview of where the task will land when dropped
 */
interface DragGhostPreviewProps {
  task: Task;
  ghostPosition: TaskBarPosition;
}

function DragGhostPreview({ task, ghostPosition }: DragGhostPreviewProps) {
  // Get the status-based background color for visual consistency
  const bgColorClass = getStatusGhostColor(task.status);

  return (
    <div
      className={cn(
        'absolute h-6 rounded-md pointer-events-none z-25',
        'border-2 border-dashed border-primary/70',
        bgColorClass,
        'flex items-center justify-center',
        'animate-pulse transition-all duration-75'
      )}
      style={{
        left: `${ghostPosition.left}px`,
        width: `${Math.max(ghostPosition.width, 8)}px`,
        top: '50%',
        transform: 'translateY(-50%)'
      }}
    >
      {/* Task title preview (truncated) */}
      {ghostPosition.width > 50 && (
        <span className="text-xs font-medium text-primary/80 truncate px-2">
          {task.title}
        </span>
      )}
    </div>
  );
}

/**
 * Get ghost color class based on task status - uses lighter versions of status colors
 */
function getStatusGhostColor(status: Task['status']): string {
  switch (status) {
    case 'backlog':
      return 'bg-muted-foreground/20';
    case 'in_progress':
      return 'bg-blue-500/20';
    case 'ai_review':
      return 'bg-amber-500/20';
    case 'human_review':
      return 'bg-purple-500/20';
    case 'pr_created':
      return 'bg-emerald-500/20';
    case 'done':
      return 'bg-green-500/20';
    default:
      return 'bg-muted-foreground/20';
  }
}

/**
 * DragPreviewTooltip - Floating tooltip that follows the cursor during drag
 * Shows the proposed new dates after snapping
 */
interface DragPreviewTooltipProps {
  task: Task;
  snappedStartDate: Date;
  snappedEndDate: Date;
  zoomLevel: TimelineZoomLevel;
}

function DragPreviewTooltip({
  task,
  snappedStartDate,
  snappedEndDate,
  zoomLevel
}: DragPreviewTooltipProps) {
  const { t } = useTranslation('tasks');

  // Format dates for display
  const formatDate = (date: Date): string => {
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const startDateStr = formatDate(snappedStartDate);
  const endDateStr = formatDate(snappedEndDate);

  // Get snap unit description for display
  const snapConfig = getSnapGridConfig(zoomLevel);
  const snapUnitLabel = snapConfig.unit === 'day' ? 'day'
    : snapConfig.unit === 'week' ? 'week'
    : 'month';

  return (
    <div className="flex flex-col gap-1 px-3 py-2 bg-popover border border-border rounded-lg shadow-lg text-sm pointer-events-none min-w-[200px]">
      {/* Task title */}
      <div className="font-semibold text-foreground truncate max-w-[180px]">
        {task.title}
      </div>

      {/* New dates */}
      <div className="flex items-center gap-1 text-primary font-medium">
        <Calendar className="h-3.5 w-3.5" />
        <span>
          {t('timeline.dragFeedback.newDates', {
            startDate: startDateStr,
            endDate: endDateStr
          })}
        </span>
      </div>

      {/* Snap indicator */}
      <div className="text-xs text-muted-foreground">
        {t('timeline.dragFeedback.snapTo', { unit: snapUnitLabel })}
      </div>

      {/* Drop hint */}
      <div className="text-xs text-primary/70 mt-0.5 border-t border-border/50 pt-1">
        {t('timeline.dragFeedback.dropHere')}
      </div>
    </div>
  );
}

/**
 * TimelineTaskSidebar - Left sidebar showing task list
 */
interface TimelineTaskSidebarProps {
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  selectedTaskId?: string;
}

function TimelineTaskSidebar({ tasks, onTaskClick, selectedTaskId }: TimelineTaskSidebarProps) {
  const { t } = useTranslation('tasks');

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <Inbox className="h-8 w-8 text-muted-foreground/50 mb-2" />
        <span className="text-sm text-muted-foreground">{t('empty.title')}</span>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-2">
        {tasks.map((task) => (
          <button
            key={task.id}
            className={cn(
              'w-full text-left px-3 py-2 rounded-md text-sm transition-colors truncate',
              'hover:bg-accent hover:text-accent-foreground',
              selectedTaskId === task.id && 'bg-accent text-accent-foreground'
            )}
            style={{ height: TASK_ROW_HEIGHT }}
            onClick={() => onTaskClick(task)}
          >
            {task.title}
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}

/**
 * TimelineGrid - Main scrollable timeline area with task bars
 */
/** Drag preview state passed from TimelineView to TimelineGrid */
interface DragPreviewState {
  task: Task;
  deltaX: number;
  newStartDate: Date;
  newEndDate: Date;
  snappedStartDate: Date;
  snappedEndDate: Date;
  ghostPosition: TaskBarPosition;
}

interface TimelineGridProps {
  tasks: Task[];
  zoomLevel: TimelineZoomLevel;
  visibleStartDate: Date;
  visibleEndDate: Date;
  columnWidth: number;
  onTaskClick: (task: Task) => void;
  onScroll: (scrollLeft: number) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  commits: TimelineGitCommit[];
  tags: TimelineGitTag[];
  milestones: TimelineMilestone[];
  selectedTaskId?: string;
  hoveredTaskId?: string;
  onTaskHover?: (task: Task | null) => void;
  /** Commit hashes to highlight (from hovered task's linkedCommits) */
  highlightedCommits?: string[];
  /** Tag names to highlight (from hovered task's linkedTags) */
  highlightedTags?: string[];
  /** Set of task specIds involved in dependency cycles (for warning styling) */
  cyclicTaskIds?: Set<string>;
  /** ID of the task currently being dragged (for DragOverlay coordination) */
  draggingTaskId?: string;
  /** Drag preview state for rendering ghost and column highlight */
  dragPreview?: DragPreviewState | null;
}

function TimelineGrid({
  tasks,
  zoomLevel,
  visibleStartDate,
  visibleEndDate,
  columnWidth,
  onTaskClick,
  onScroll,
  scrollRef,
  commits,
  tags,
  milestones,
  selectedTaskId,
  hoveredTaskId,
  onTaskHover,
  highlightedCommits,
  highlightedTags,
  cyclicTaskIds,
  draggingTaskId,
  dragPreview
}: TimelineGridProps) {
  // Calculate total width based on date range and zoom
  const totalColumns = useMemo(() => {
    let count = 0;
    const current = new Date(visibleStartDate);
    while (current <= visibleEndDate) {
      count++;
      switch (zoomLevel) {
        case 'day':
          current.setDate(current.getDate() + 1);
          break;
        case 'week':
          current.setDate(current.getDate() + 7);
          break;
        case 'month':
          current.setMonth(current.getMonth() + 1);
          break;
        case 'quarter':
          current.setMonth(current.getMonth() + 3);
          break;
      }
    }
    return count;
  }, [zoomLevel, visibleStartDate, visibleEndDate]);

  const totalWidth = totalColumns * columnWidth;

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      onScroll((e.target as HTMLDivElement).scrollLeft);
    },
    [onScroll]
  );

  // Calculate 'Now' marker position
  const nowPosition = useMemo(() => {
    const now = new Date();
    const startMs = visibleStartDate.getTime();
    const endMs = visibleEndDate.getTime();
    const nowMs = now.getTime();

    if (nowMs < startMs || nowMs > endMs) return null;

    const position = ((nowMs - startMs) / (endMs - startMs)) * totalWidth;
    return position;
  }, [visibleStartDate, visibleEndDate, totalWidth]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-auto"
      onScroll={handleScroll}
    >
      <div className="relative" style={{ width: totalWidth, minHeight: '100%' }}>
        {/* Grid lines */}
        <div className="absolute inset-0 flex">
          {Array.from({ length: totalColumns }).map((_, idx) => (
            <div
              key={idx}
              className="flex-shrink-0 border-r border-border/30"
              style={{ width: columnWidth }}
            />
          ))}
        </div>

        {/* Column highlight during drag - shows where the task will snap to */}
        {dragPreview && (
          <DragColumnHighlight
            ghostPosition={dragPreview.ghostPosition}
            visibleStartDate={visibleStartDate}
            visibleEndDate={visibleEndDate}
            totalWidth={totalWidth}
          />
        )}

        {/* Tag/release markers - vertical dashed lines */}
        <TagMarkers
          tags={tags}
          milestones={milestones}
          zoomLevel={zoomLevel}
          visibleStartDate={visibleStartDate}
          visibleEndDate={visibleEndDate}
          totalWidth={totalWidth}
          highlightedTags={highlightedTags}
        />

        {/* Commit markers - dots at bottom */}
        <CommitMarkers
          commits={commits}
          zoomLevel={zoomLevel}
          visibleStartDate={visibleStartDate}
          visibleEndDate={visibleEndDate}
          totalWidth={totalWidth}
          highlightedCommits={highlightedCommits}
        />

        {/* Now marker */}
        {nowPosition !== null && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500/50 z-15 pointer-events-none"
            style={{ left: nowPosition }}
          />
        )}

        {/* Task rows with positioned task bars */}
        <div className="relative z-20">
          {tasks.map((task) => {
            // Calculate task bar position based on dates and timeline scale
            const position = calculateTaskBarPosition(
              task,
              visibleStartDate,
              visibleEndDate,
              totalWidth
            );

            // Check if task bar is visible in the timeline viewport
            const isVisible = isTaskBarVisible(position, totalWidth);

            // Check if this task is in a dependency cycle
            const isInCycle = cyclicTaskIds?.has(task.specId) ?? false;

            // Check if this is the task being dragged (for ghost preview)
            const isBeingDragged = draggingTaskId === task.id;

            return (
              <div
                key={task.id}
                className="relative border-b border-border/20"
                style={{ height: TASK_ROW_HEIGHT }}
              >
                {/* Only render task bar if it's visible in the viewport */}
                {isVisible && (
                  <TimelineTaskBar
                    task={task}
                    left={position.left}
                    width={position.width}
                    isSelected={selectedTaskId === task.id}
                    isHovered={hoveredTaskId === task.id}
                    isInCycle={isInCycle}
                    isDraggable={true}
                    isDragging={isBeingDragged}
                    onClick={onTaskClick}
                    onHover={onTaskHover}
                  />
                )}

                {/* Ghost preview - shows where the task will land after snap */}
                {isBeingDragged && dragPreview && (
                  <DragGhostPreview
                    task={dragPreview.task}
                    ghostPosition={dragPreview.ghostPosition}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Dependency arrows overlay - renders SVG bezier curves between dependent tasks */}
        <DependencyArrows
          tasks={tasks}
          visibleStartDate={visibleStartDate}
          visibleEndDate={visibleEndDate}
          totalWidth={totalWidth}
          rowHeight={TASK_ROW_HEIGHT}
          selectedTaskId={selectedTaskId}
          hoveredTaskId={hoveredTaskId}
          cyclicTaskIds={cyclicTaskIds}
        />
      </div>
    </div>
  );
}

/**
 * TimelineStatusBar - Bottom status bar showing current date range and task count
 */
interface TimelineStatusBarProps {
  taskCount: number;
  visibleStartDate: Date;
  visibleEndDate: Date;
}

function TimelineStatusBar({ taskCount, visibleStartDate, visibleEndDate }: TimelineStatusBarProps) {
  const { t } = useTranslation(['tasks', 'common']);

  const dateRange = useMemo(() => {
    const start = visibleStartDate.toLocaleDateString(undefined, {
      month: 'short',
      year: 'numeric'
    });
    const end = visibleEndDate.toLocaleDateString(undefined, {
      month: 'short',
      year: 'numeric'
    });
    return `${start} - ${end}`;
  }, [visibleStartDate, visibleEndDate]);

  return (
    <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-card/50 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <Calendar className="h-3.5 w-3.5" />
        <span>{dateRange}</span>
      </div>
      <div className="flex items-center gap-2">
        <span>
          {taskCount} {taskCount === 1 ? 'task' : 'tasks'}
        </span>
      </div>
    </div>
  );
}

/**
 * Clustered commit data for coarse zoom levels
 */
interface CommitCluster {
  startDate: Date;
  endDate: Date;
  commits: TimelineGitCommit[];
  position: number;
}

/**
 * CommitMarkers - Renders commit dots on the timeline grid
 * Clusters commits at coarse zoom levels (quarter/month) to avoid visual clutter
 */
interface CommitMarkersProps {
  commits: TimelineGitCommit[];
  zoomLevel: TimelineZoomLevel;
  visibleStartDate: Date;
  visibleEndDate: Date;
  totalWidth: number;
  /** Commit hashes to highlight (glow effect) when a task is hovered */
  highlightedCommits?: string[];
}

function CommitMarkers({
  commits,
  zoomLevel,
  visibleStartDate,
  visibleEndDate,
  totalWidth,
  highlightedCommits
}: CommitMarkersProps) {
  const { t } = useTranslation('tasks');

  // Create a Set for O(1) lookup of highlighted commit hashes
  const highlightedSet = useMemo(() => {
    if (!highlightedCommits || highlightedCommits.length === 0) return null;
    return new Set(highlightedCommits);
  }, [highlightedCommits]);

  // Helper to check if a commit is highlighted (matches by hash prefix or full hash)
  const isCommitHighlighted = useCallback((commit: TimelineGitCommit): boolean => {
    if (!highlightedSet) return false;
    // Check both short hash and full hash for matches
    return highlightedSet.has(commit.hash) || (commit.fullHash ? highlightedSet.has(commit.fullHash) : false);
  }, [highlightedSet]);

  // Helper to check if any commit in a cluster is highlighted
  const isClusterHighlighted = useCallback((clusterCommits: TimelineGitCommit[]): boolean => {
    if (!highlightedSet) return false;
    return clusterCommits.some(commit => isCommitHighlighted(commit));
  }, [highlightedSet, isCommitHighlighted]);

  // Calculate position for a date
  const getDatePosition = useCallback((date: Date): number => {
    const startMs = visibleStartDate.getTime();
    const endMs = visibleEndDate.getTime();
    const dateMs = date.getTime();
    return ((dateMs - startMs) / (endMs - startMs)) * totalWidth;
  }, [visibleStartDate, visibleEndDate, totalWidth]);

  // Filter commits within visible range
  const visibleCommits = useMemo(() => {
    return commits.filter(commit => {
      const commitDate = new Date(commit.date);
      return commitDate >= visibleStartDate && commitDate <= visibleEndDate;
    });
  }, [commits, visibleStartDate, visibleEndDate]);

  // Cluster commits based on zoom level
  const clusteredData = useMemo((): CommitCluster[] => {
    if (visibleCommits.length === 0) return [];

    // At day/week zoom, show individual commits
    if (zoomLevel === 'day' || zoomLevel === 'week') {
      return visibleCommits.map(commit => ({
        startDate: new Date(commit.date),
        endDate: new Date(commit.date),
        commits: [commit],
        position: getDatePosition(new Date(commit.date))
      }));
    }

    // At month/quarter zoom, cluster commits by time period
    const clusterDuration = zoomLevel === 'month'
      ? 7 * 24 * 60 * 60 * 1000   // 1 week for month view
      : 30 * 24 * 60 * 60 * 1000; // 1 month for quarter view

    const clusters: CommitCluster[] = [];
    let currentCluster: TimelineGitCommit[] = [];
    let clusterStart: Date | null = null;
    let clusterEnd: Date | null = null;

    // Sort commits by date (oldest first for clustering)
    const sortedCommits = [...visibleCommits].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    for (const commit of sortedCommits) {
      const commitDate = new Date(commit.date);

      if (currentCluster.length === 0) {
        // Start new cluster
        currentCluster = [commit];
        clusterStart = commitDate;
        clusterEnd = commitDate;
      } else if (clusterEnd && commitDate.getTime() - clusterEnd.getTime() <= clusterDuration) {
        // Add to current cluster
        currentCluster.push(commit);
        clusterEnd = commitDate;
      } else {
        // Save current cluster and start new one
        if (clusterStart && clusterEnd) {
          const midDate = new Date((clusterStart.getTime() + clusterEnd.getTime()) / 2);
          clusters.push({
            startDate: clusterStart,
            endDate: clusterEnd,
            commits: currentCluster,
            position: getDatePosition(midDate)
          });
        }
        currentCluster = [commit];
        clusterStart = commitDate;
        clusterEnd = commitDate;
      }
    }

    // Don't forget the last cluster
    if (currentCluster.length > 0 && clusterStart && clusterEnd) {
      const midDate = new Date((clusterStart.getTime() + clusterEnd.getTime()) / 2);
      clusters.push({
        startDate: clusterStart,
        endDate: clusterEnd,
        commits: currentCluster,
        position: getDatePosition(midDate)
      });
    }

    return clusters;
  }, [visibleCommits, zoomLevel, getDatePosition]);

  // Determine dot size based on zoom level and cluster size
  const getDotSize = (commitCount: number): string => {
    if (zoomLevel === 'day') return 'w-2 h-2';
    if (zoomLevel === 'week') return 'w-2.5 h-2.5';
    if (commitCount > 10) return 'w-4 h-4';
    if (commitCount > 5) return 'w-3.5 h-3.5';
    return 'w-3 h-3';
  };

  if (clusteredData.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-5">
      {clusteredData.map((cluster, idx) => {
        const isCluster = cluster.commits.length > 1;
        const firstCommit = cluster.commits[0];
        const dotSize = getDotSize(cluster.commits.length);
        const isHighlighted = isClusterHighlighted(cluster.commits);

        return (
          <Tooltip key={idx}>
            <TooltipTrigger asChild>
              <div
                className={cn(
                  'absolute bottom-2 -translate-x-1/2 pointer-events-auto cursor-pointer transition-all duration-200 hover:scale-125',
                  dotSize,
                  'rounded-full',
                  isCluster
                    ? 'bg-blue-500/80 border border-blue-400'
                    : 'bg-blue-400/70',
                  // Glow effect when highlighted (linked to hovered task)
                  isHighlighted && 'ring-4 ring-blue-400/60 ring-offset-1 ring-offset-background shadow-[0_0_12px_rgba(96,165,250,0.8)] scale-125 z-30'
                )}
                style={{ left: cluster.position }}
              >
                {/* Show count badge for clusters with many commits */}
                {cluster.commits.length > 3 && (
                  <span className={cn(
                    "absolute -top-3 left-1/2 -translate-x-1/2 text-[9px] font-medium whitespace-nowrap",
                    isHighlighted ? "text-blue-300" : "text-blue-400"
                  )}>
                    {cluster.commits.length}
                  </span>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              {isCluster ? (
                <div className="flex flex-col gap-1">
                  <span className="font-semibold">
                    {t('timeline.commits.cluster', { count: cluster.commits.length })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {cluster.startDate.toLocaleDateString()} - {cluster.endDate.toLocaleDateString()}
                  </span>
                  <div className="text-xs max-h-32 overflow-auto">
                    {cluster.commits.slice(0, 5).map((commit, i) => (
                      <div key={i} className="truncate py-0.5 border-t border-border/30 first:border-t-0">
                        <span className="font-mono text-muted-foreground">{commit.hash}</span>{' '}
                        <span>{commit.message}</span>
                      </div>
                    ))}
                    {cluster.commits.length > 5 && (
                      <div className="text-muted-foreground pt-1">
                        +{cluster.commits.length - 5} more...
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-xs text-muted-foreground">{firstCommit?.hash}</span>
                  <span className="font-medium">{firstCommit?.message}</span>
                  <span className="text-xs text-muted-foreground">
                    {t('timeline.commits.by', { author: firstCommit?.author })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(firstCommit?.date ?? '').toLocaleString()}
                  </span>
                </div>
              )}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

/**
 * MilestoneMarkers - Renders milestone markers for tags/releases on the timeline
 *
 * Milestone markers visually represent important points in the project's history,
 * such as version releases and significant tags. Each marker consists of:
 * - A vertical dashed line spanning the full height of the timeline grid
 * - A diamond icon at the top indicating the milestone point
 * - A label showing the version/tag name below the diamond
 *
 * Color coding:
 * - Green: Release milestones (v1.0.0, etc.)
 * - Amber: Regular tags (feature-complete, etc.)
 */
interface MilestoneMarkersProps {
  tags: TimelineGitTag[];
  milestones: TimelineMilestone[];
  zoomLevel: TimelineZoomLevel;
  visibleStartDate: Date;
  visibleEndDate: Date;
  totalWidth: number;
  /** Tag names to highlight (glow effect) when a task is hovered */
  highlightedTags?: string[];
}

function MilestoneMarkers({
  tags,
  milestones,
  zoomLevel,
  visibleStartDate,
  visibleEndDate,
  totalWidth,
  highlightedTags
}: MilestoneMarkersProps) {
  const { t } = useTranslation('tasks');

  // Create a Set for O(1) lookup of highlighted tag names
  const highlightedSet = useMemo(() => {
    if (!highlightedTags || highlightedTags.length === 0) return null;
    return new Set(highlightedTags);
  }, [highlightedTags]);

  // Calculate position for a date on the timeline
  const getDatePosition = useCallback((date: Date): number => {
    const startMs = visibleStartDate.getTime();
    const endMs = visibleEndDate.getTime();
    const dateMs = date.getTime();
    return ((dateMs - startMs) / (endMs - startMs)) * totalWidth;
  }, [visibleStartDate, visibleEndDate, totalWidth]);

  // Filter and position milestones within visible range
  const visibleMilestones = useMemo(() => {
    return milestones
      .filter(milestone => {
        const milestoneDate = new Date(milestone.date);
        return milestoneDate >= visibleStartDate && milestoneDate <= visibleEndDate;
      })
      .map(milestone => ({
        ...milestone,
        position: getDatePosition(new Date(milestone.date))
      }));
  }, [milestones, visibleStartDate, visibleEndDate, getDatePosition]);

  if (visibleMilestones.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-10">
      {visibleMilestones.map((milestone, idx) => {
        const isRelease = milestone.type === 'release';
        const milestoneDate = new Date(milestone.date);
        // Check if this milestone is highlighted (linked to hovered task)
        const isHighlighted = highlightedSet?.has(milestone.tagName || milestone.name) ?? false;

        return (
          <Tooltip key={milestone.id || idx}>
            <TooltipTrigger asChild>
              <div
                className={cn(
                  "absolute top-0 bottom-0 pointer-events-auto cursor-pointer group transition-all duration-200",
                  isHighlighted && "z-30"
                )}
                style={{ left: milestone.position }}
                aria-label={t('timeline.milestoneMarker.ariaLabel', { name: milestone.name })}
              >
                {/* Vertical dashed line - spans full height to indicate milestone point */}
                <div
                  className={cn(
                    'absolute top-0 bottom-0 w-px border-l-2 border-dashed transition-all duration-200',
                    isRelease
                      ? 'border-green-500/70 group-hover:border-green-400'
                      : 'border-amber-500/70 group-hover:border-amber-400',
                    // Enhanced visibility when highlighted
                    isHighlighted && (isRelease
                      ? 'border-green-400 shadow-[0_0_8px_rgba(34,197,94,0.6)]'
                      : 'border-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.6)]')
                  )}
                />
                {/* Diamond icon at top - visual milestone indicator */}
                <div
                  className={cn(
                    'absolute -top-1 -left-2 flex items-center justify-center transition-all duration-200 group-hover:scale-110',
                    // Glow effect when highlighted
                    isHighlighted && 'scale-125',
                    isHighlighted && (isRelease
                      ? 'drop-shadow-[0_0_8px_rgba(34,197,94,0.8)]'
                      : 'drop-shadow-[0_0_8px_rgba(245,158,11,0.8)]')
                  )}
                >
                  <Diamond
                    className={cn(
                      'h-4 w-4 fill-current stroke-current',
                      isRelease
                        ? 'text-green-500 group-hover:text-green-400'
                        : 'text-amber-500 group-hover:text-amber-400',
                      isHighlighted && (isRelease ? 'text-green-400' : 'text-amber-400')
                    )}
                    strokeWidth={1.5}
                  />
                </div>
                {/* Label showing version/tag name */}
                <div
                  className={cn(
                    'absolute top-4 -left-8 w-16 text-center text-[10px] font-semibold truncate transition-all duration-200',
                    isRelease
                      ? 'text-green-500 group-hover:text-green-400'
                      : 'text-amber-500 group-hover:text-amber-400',
                    // Brighter label when highlighted
                    isHighlighted && (isRelease
                      ? 'text-green-400 font-bold'
                      : 'text-amber-400 font-bold')
                  )}
                >
                  {milestone.name}
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <Diamond
                    className={cn(
                      'h-3.5 w-3.5',
                      isRelease ? 'text-green-500' : 'text-amber-500'
                    )}
                    strokeWidth={1.5}
                  />
                  <span className="font-semibold">{milestone.name}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {isRelease ? t('timeline.milestoneMarker.release') : t('timeline.milestoneMarker.tag')}
                </span>
                <span className="text-xs text-muted-foreground">
                  {milestoneDate.toLocaleDateString(undefined, {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })}
                </span>
                {milestone.description && (
                  <span className="text-xs mt-1 border-t border-border pt-1">
                    {milestone.description}
                  </span>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

// Keep TagMarkers as an alias for backward compatibility
const TagMarkers = MilestoneMarkers;

/**
 * Timeline anchor data for jump navigation
 */
interface TimelineAnchor {
  id: 'genesis' | 'firstRelease' | 'now' | 'nextMilestone';
  labelKey: string;
  icon: React.ReactNode;
  date: Date | null;
  description?: string;
}

/**
 * JumpAnchorsBar - Navigation bar with buttons to jump to key timeline positions
 * Buttons: Genesis (earliest commit), First Release, Now, Next Milestone
 */
interface JumpAnchorsBarProps {
  onJumpTo: (anchor: TimelineAnchor) => void;
  genesisDate?: Date;
  firstReleaseDate?: Date;
  nextMilestoneDate?: Date;
  nextMilestoneName?: string;
}

function JumpAnchorsBar({
  onJumpTo,
  genesisDate,
  firstReleaseDate,
  nextMilestoneDate,
  nextMilestoneName
}: JumpAnchorsBarProps) {
  const { t } = useTranslation('tasks');

  // Define the anchor points
  const anchors: TimelineAnchor[] = useMemo(() => [
    {
      id: 'genesis',
      labelKey: 'timeline.genesis',
      icon: <GitBranch className="h-3.5 w-3.5 mr-1.5" />,
      date: genesisDate ?? null,
      description: genesisDate
        ? genesisDate.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
        : undefined
    },
    {
      id: 'firstRelease',
      labelKey: 'timeline.firstRelease',
      icon: <Tag className="h-3.5 w-3.5 mr-1.5" />,
      date: firstReleaseDate ?? null,
      description: firstReleaseDate
        ? firstReleaseDate.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
        : undefined
    },
    {
      id: 'now',
      labelKey: 'timeline.today',
      icon: <Flag className="h-3.5 w-3.5 mr-1.5" />,
      date: new Date(),
      description: new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    },
    {
      id: 'nextMilestone',
      labelKey: 'timeline.nextMilestone',
      icon: <Milestone className="h-3.5 w-3.5 mr-1.5" />,
      date: nextMilestoneDate ?? null,
      description: nextMilestoneName ?? (nextMilestoneDate
        ? nextMilestoneDate.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
        : undefined)
    }
  ], [genesisDate, firstReleaseDate, nextMilestoneDate, nextMilestoneName]);

  return (
    <div className="flex items-center gap-1">
      {anchors.map((anchor) => (
        <Tooltip key={anchor.id}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onJumpTo(anchor)}
              disabled={anchor.date === null}
              className={cn(
                'text-xs h-7 px-2',
                anchor.date === null && 'opacity-50 cursor-not-allowed'
              )}
            >
              {anchor.icon}
              {t(anchor.labelKey)}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <div className="flex flex-col gap-0.5">
              <span>
                {t('timeline.jumpTo')} {t(anchor.labelKey)}
              </span>
              {anchor.description && (
                <span className="text-xs text-muted-foreground">{anchor.description}</span>
              )}
              {anchor.date === null && (
                <span className="text-xs text-yellow-500">Not available yet</span>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

/**
 * ShallowHistoryIndicator - Shows a warning when git history may be incomplete
 */
interface ShallowHistoryIndicatorProps {
  isShallow: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
}

function ShallowHistoryIndicator({
  isShallow,
  hasMore,
  isLoadingMore,
  onLoadMore
}: ShallowHistoryIndicatorProps) {
  const { t } = useTranslation('tasks');

  if (!isShallow) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-t border-amber-500/20">
      <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
          {t('timeline.shallowHistory.title')}
        </span>
        <span className="text-xs text-amber-600/70 dark:text-amber-400/70 ml-2">
          {t('timeline.shallowHistory.description')}
        </span>
      </div>
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onLoadMore}
          disabled={isLoadingMore}
          className="h-6 px-2 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-500/20"
        >
          {isLoadingMore ? (
            <span className="animate-pulse">{t('timeline.shallowHistory.loadMore')}...</span>
          ) : (
            <>
              <ChevronDown className="h-3 w-3 mr-1" />
              {t('timeline.shallowHistory.loadMore')}
            </>
          )}
        </Button>
      )}
    </div>
  );
}

/**
 * Helper function to get week number
 */
function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * TimelineView - Main timeline/Gantt view component
 */
export function TimelineView({ tasks, onTaskClick, onNewTaskClick, onTaskScheduleChange }: TimelineViewProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const { showArchived } = useViewState();

  // Git history hook
  const {
    commits,
    tags,
    milestones,
    genesisDate: gitGenesisDate,
    firstReleaseTag,
    isLoading: isLoadingGit,
    isShallowHistory,
    hasMore,
    loadMore,
    isLoadingMore
  } = useGitHistory({ autoFetch: true });

  // State
  const [zoomLevel, setZoomLevel] = useState<TimelineZoomLevel>('month');
  const [scrollLeft, setScrollLeft] = useState(0);
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>();
  const [hoveredTaskId, setHoveredTaskId] = useState<string | undefined>();
  // Drag state - tracks which task is being dragged
  const [draggingTaskId, setDraggingTaskId] = useState<string | undefined>();
  // Drag preview state - tracks the current drag offset and calculated new dates
  const [dragPreview, setDragPreview] = useState<{
    task: Task;
    deltaX: number;
    newStartDate: Date;
    newEndDate: Date;
    snappedStartDate: Date;
    snappedEndDate: Date;
    ghostPosition: TaskBarPosition;
  } | null>(null);

  // Refs
  const gridScrollRef = useRef<HTMLDivElement>(null);

  // Configure @dnd-kit sensors for horizontal dragging
  // Using PointerSensor with a small activation distance to distinguish clicks from drags
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        // Require 5px movement before starting drag (prevents accidental drags on click)
        distance: 5
      }
    })
  );

  // Filter tasks based on archive status
  const filteredTasks = useMemo(() => {
    if (showArchived) {
      return tasks;
    }
    return tasks.filter((t) => !t.metadata?.archivedAt);
  }, [tasks, showArchived]);

  // Calculate visible date range - extends back to git genesis if available
  const { visibleStartDate, visibleEndDate } = useMemo(() => {
    const today = new Date();

    // Default start: 6 months before today
    let start = new Date(today);
    start.setMonth(start.getMonth() - 6);
    start.setDate(1); // Start of month

    // Extend back to git genesis if it's earlier
    if (gitGenesisDate && gitGenesisDate < start) {
      start = new Date(gitGenesisDate);
      start.setDate(1); // Start of month
    }

    // Default end: 6 months after today
    const end = new Date(today);
    end.setMonth(end.getMonth() + 6);
    end.setDate(0); // End of month

    return { visibleStartDate: start, visibleEndDate: end };
  }, [gitGenesisDate]);

  // Get current column width based on zoom level
  const columnWidth = ZOOM_COLUMN_WIDTHS[zoomLevel];

  // Handlers
  const handleTaskClick = useCallback(
    (task: Task) => {
      setSelectedTaskId(task.id);
      onTaskClick(task);
    },
    [onTaskClick]
  );

  const handleScroll = useCallback((newScrollLeft: number) => {
    setScrollLeft(newScrollLeft);
  }, []);

  const handleTaskHover = useCallback((task: Task | null) => {
    setHoveredTaskId(task?.id);
  }, []);

  // Compute highlighted artifacts from the hovered task
  const { highlightedCommits, highlightedTags } = useMemo(() => {
    if (!hoveredTaskId) {
      return { highlightedCommits: undefined, highlightedTags: undefined };
    }
    const hoveredTask = filteredTasks.find((t) => t.id === hoveredTaskId);
    if (!hoveredTask?.metadata) {
      return { highlightedCommits: undefined, highlightedTags: undefined };
    }
    return {
      highlightedCommits: hoveredTask.metadata.linkedCommits,
      highlightedTags: hoveredTask.metadata.linkedTags
    };
  }, [hoveredTaskId, filteredTasks]);

  // Detect dependency cycles among tasks
  const cyclicTaskIds = useMemo(() => {
    const result = detectDependencyCycles(filteredTasks);
    return result.cyclicTaskIdSet;
  }, [filteredTasks]);

  const handleZoomIn = useCallback(() => {
    const levels: TimelineZoomLevel[] = ['quarter', 'month', 'week', 'day'];
    const currentIdx = levels.indexOf(zoomLevel);
    if (currentIdx < levels.length - 1) {
      setZoomLevel(levels[currentIdx + 1]);
    }
  }, [zoomLevel]);

  const handleZoomOut = useCallback(() => {
    const levels: TimelineZoomLevel[] = ['quarter', 'month', 'week', 'day'];
    const currentIdx = levels.indexOf(zoomLevel);
    if (currentIdx > 0) {
      setZoomLevel(levels[currentIdx - 1]);
    }
  }, [zoomLevel]);

  /**
   * Scroll to a specific date with smooth animation
   * Centers the date in the viewport
   */
  const scrollToDate = useCallback((targetDate: Date, smooth = true) => {
    if (!gridScrollRef.current) return;

    const startMs = visibleStartDate.getTime();
    const endMs = visibleEndDate.getTime();
    const targetMs = targetDate.getTime();

    // If target is outside visible range, scroll to nearest edge
    const clampedTargetMs = Math.max(startMs, Math.min(endMs, targetMs));

    // Calculate total width
    let totalColumns = 0;
    const current = new Date(visibleStartDate);
    while (current <= visibleEndDate) {
      totalColumns++;
      switch (zoomLevel) {
        case 'day':
          current.setDate(current.getDate() + 1);
          break;
        case 'week':
          current.setDate(current.getDate() + 7);
          break;
        case 'month':
          current.setMonth(current.getMonth() + 1);
          break;
        case 'quarter':
          current.setMonth(current.getMonth() + 3);
          break;
      }
    }

    const totalWidth = totalColumns * columnWidth;
    const position = ((clampedTargetMs - startMs) / (endMs - startMs)) * totalWidth;

    // Center the position in the viewport with smooth animation
    const viewportWidth = gridScrollRef.current.clientWidth;
    const targetScrollLeft = Math.max(0, position - viewportWidth / 2);

    gridScrollRef.current.scrollTo({
      left: targetScrollLeft,
      behavior: smooth ? 'smooth' : 'auto'
    });
  }, [visibleStartDate, visibleEndDate, zoomLevel, columnWidth]);

  /**
   * Handle jump to anchor navigation
   */
  const handleJumpTo = useCallback((anchor: TimelineAnchor) => {
    if (!anchor.date) return;
    scrollToDate(anchor.date, true);
  }, [scrollToDate]);

  /**
   * Calculate new dates based on pixel offset from drag
   * Converts horizontal drag distance to date offset
   */
  const calculateNewDatesFromDragOffset = useCallback((
    task: Task,
    pixelOffset: number,
    visibleStart: Date,
    visibleEnd: Date,
    totalWidth: number
  ): { newStartDate: Date; newEndDate: Date } => {
    // Calculate the time per pixel
    const totalMs = visibleEnd.getTime() - visibleStart.getTime();
    const msPerPixel = totalMs / totalWidth;

    // Calculate the milliseconds offset
    const msOffset = pixelOffset * msPerPixel;

    // Get current start and end dates
    const currentStart = task.metadata?.scheduledStartDate
      ? new Date(task.metadata.scheduledStartDate)
      : new Date(task.createdAt);

    const currentEnd = task.metadata?.scheduledEndDate
      ? new Date(task.metadata.scheduledEndDate)
      : (() => {
          // Calculate default end based on duration
          const duration = 3; // Default 3 days - same as timeline-utils.ts DEFAULT_DURATION_DAYS
          const end = new Date(currentStart);
          end.setDate(end.getDate() + duration);
          return end;
        })();

    // Calculate new dates by applying the offset (maintaining duration)
    const newStartDate = new Date(currentStart.getTime() + msOffset);
    const newEndDate = new Date(currentEnd.getTime() + msOffset);

    return { newStartDate, newEndDate };
  }, []);

  /**
   * Calculate total width of the timeline grid based on visible date range and zoom level
   */
  const calculateTotalWidth = useCallback(() => {
    let totalColumns = 0;
    const current = new Date(visibleStartDate);
    while (current <= visibleEndDate) {
      totalColumns++;
      switch (zoomLevel) {
        case 'day':
          current.setDate(current.getDate() + 1);
          break;
        case 'week':
          current.setDate(current.getDate() + 7);
          break;
        case 'month':
          current.setMonth(current.getMonth() + 1);
          break;
        case 'quarter':
          current.setMonth(current.getMonth() + 3);
          break;
      }
    }
    return totalColumns * columnWidth;
  }, [visibleStartDate, visibleEndDate, zoomLevel, columnWidth]);

  /**
   * Handle drag start - track which task is being dragged
   */
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    // Extract task ID from draggable ID (format: 'timeline-task-{taskId}')
    const taskId = String(active.id).replace('timeline-task-', '');
    setDraggingTaskId(taskId);
    // Clear any existing preview (will be set in handleDragMove)
    setDragPreview(null);
  }, []);

  /**
   * Handle drag move - update the drag preview with current position and calculated dates
   * This provides real-time visual feedback showing where the task will land
   */
  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const { active, delta } = event;

    if (!active || delta.x === 0) return;

    // Extract task ID from draggable ID
    const taskId = String(active.id).replace('timeline-task-', '');
    const task = filteredTasks.find(t => t.id === taskId);

    if (!task) return;

    // Calculate total width for date conversion
    const totalWidth = calculateTotalWidth();

    // Calculate new dates from drag offset
    const { newStartDate, newEndDate } = calculateNewDatesFromDragOffset(
      task,
      delta.x,
      visibleStartDate,
      visibleEndDate,
      totalWidth
    );

    // Apply snap-to-grid based on current zoom level
    const { snappedStartDate, snappedEndDate } = snapDatesToGrid(
      newStartDate,
      newEndDate,
      zoomLevel
    );

    // Calculate ghost position using snapped dates
    const snappedLeft = getDatePixelPosition(snappedStartDate, visibleStartDate, visibleEndDate, totalWidth);
    const snappedRight = getDatePixelPosition(snappedEndDate, visibleStartDate, visibleEndDate, totalWidth);
    const snappedWidth = Math.max(snappedRight - snappedLeft, 8);

    // Get original position for reference
    const originalPosition = calculateTaskBarPosition(task, visibleStartDate, visibleEndDate, totalWidth);

    const ghostPosition: TaskBarPosition = {
      left: snappedLeft,
      width: snappedWidth,
      taskId: task.id,
      startDate: snappedStartDate,
      endDate: snappedEndDate
    };

    setDragPreview({
      task,
      deltaX: delta.x,
      newStartDate,
      newEndDate,
      snappedStartDate,
      snappedEndDate,
      ghostPosition
    });
  }, [filteredTasks, visibleStartDate, visibleEndDate, zoomLevel, calculateTotalWidth, calculateNewDatesFromDragOffset]);

  /**
   * Handle drag end - calculate new dates based on drag offset, apply snap-to-grid,
   * and call schedule change callback
   *
   * Snap behavior varies by zoom level:
   * - Day/Week views: snap to day boundaries
   * - Month view: snap to week boundaries (Monday)
   * - Quarter view: snap to month boundaries (1st)
   */
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, delta } = event;

    if (!active || !delta) {
      setDraggingTaskId(undefined);
      return;
    }

    // Extract task ID from draggable ID
    const taskId = String(active.id).replace('timeline-task-', '');
    const task = filteredTasks.find(t => t.id === taskId);

    if (!task || delta.x === 0) {
      setDraggingTaskId(undefined);
      return;
    }

    // Calculate total width for date conversion
    let totalColumns = 0;
    const current = new Date(visibleStartDate);
    while (current <= visibleEndDate) {
      totalColumns++;
      switch (zoomLevel) {
        case 'day':
          current.setDate(current.getDate() + 1);
          break;
        case 'week':
          current.setDate(current.getDate() + 7);
          break;
        case 'month':
          current.setMonth(current.getMonth() + 1);
          break;
        case 'quarter':
          current.setMonth(current.getMonth() + 3);
          break;
      }
    }
    const totalWidth = totalColumns * columnWidth;

    // Calculate new dates from drag offset (before snapping)
    const { newStartDate, newEndDate } = calculateNewDatesFromDragOffset(
      task,
      delta.x,
      visibleStartDate,
      visibleEndDate,
      totalWidth
    );

    // Apply snap-to-grid based on current zoom level
    // This ensures dates align to appropriate boundaries:
    // - day/week views: day boundaries
    // - month view: week boundaries (Monday)
    // - quarter view: month boundaries (1st of month)
    const { snappedStartDate, snappedEndDate } = snapDatesToGrid(
      newStartDate,
      newEndDate,
      zoomLevel
    );

    // Call the schedule change callback with snapped dates
    if (onTaskScheduleChange) {
      onTaskScheduleChange(taskId, snappedStartDate, snappedEndDate);
    }

    // Clear dragging state and preview
    setDraggingTaskId(undefined);
    setDragPreview(null);
  }, [filteredTasks, visibleStartDate, visibleEndDate, zoomLevel, columnWidth, calculateNewDatesFromDragOffset, onTaskScheduleChange]);

  /**
   * Keyboard shortcuts for timeline navigation and zoom
   * - +/= for zoom in (= is + without shift on most keyboards)
   * - - for zoom out
   * - Arrow Left/Right for scrolling the timeline
   * - G for jumping to Genesis (earliest commit)
   * - N for jumping to Now (today)
   * - M for jumping to next Milestone
   *
   * Note: G, N, M overlap with global navigation shortcuts in Sidebar, but when
   * the timeline is active these take precedence for timeline-specific navigation.
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      // Skip if any modifier keys are pressed (Ctrl/Cmd/Alt)
      // Allow Shift for + key (Shift + =)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key;

      // Zoom controls: + (or =) for zoom in, - for zoom out
      if (key === '+' || key === '=') {
        e.preventDefault();
        handleZoomIn();
        return;
      }

      if (key === '-' || key === '_') {
        e.preventDefault();
        handleZoomOut();
        return;
      }

      // Arrow keys for scrolling the timeline
      if (key === 'ArrowLeft') {
        e.preventDefault();
        if (gridScrollRef.current) {
          // Scroll left by one column width
          gridScrollRef.current.scrollBy({
            left: -columnWidth,
            behavior: 'smooth'
          });
        }
        return;
      }

      if (key === 'ArrowRight') {
        e.preventDefault();
        if (gridScrollRef.current) {
          // Scroll right by one column width
          gridScrollRef.current.scrollBy({
            left: columnWidth,
            behavior: 'smooth'
          });
        }
        return;
      }

      // Jump anchors: G for Genesis, N for Now, M for next Milestone
      // These only work when there's no Shift key (to avoid conflicts)
      if (!e.shiftKey) {
        const upperKey = key.toUpperCase();

        if (upperKey === 'G' && gitGenesisDate) {
          e.preventDefault();
          e.stopPropagation(); // Prevent Sidebar's navigation shortcut
          scrollToDate(gitGenesisDate, true);
          return;
        }

        if (upperKey === 'N') {
          e.preventDefault();
          e.stopPropagation(); // Prevent Sidebar's navigation shortcut
          scrollToDate(new Date(), true);
          return;
        }

        if (upperKey === 'M') {
          e.preventDefault();
          e.stopPropagation(); // Prevent Sidebar's navigation shortcut
          // Find next milestone date
          const now = new Date();
          const futureMilestones = milestones
            .filter(m => new Date(m.date) > now)
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

          if (futureMilestones.length > 0) {
            scrollToDate(new Date(futureMilestones[0].date), true);
          } else {
            // Fallback to 1 month from now if no future milestones
            const fallbackDate = new Date();
            fallbackDate.setMonth(fallbackDate.getMonth() + 1);
            scrollToDate(fallbackDate, true);
          }
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true); // Use capture phase to intercept before Sidebar
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [handleZoomIn, handleZoomOut, columnWidth, gitGenesisDate, milestones, scrollToDate]);

  // Compute anchor dates from git history and milestones
  const { genesisDate, firstReleaseDate, nextMilestoneDate, nextMilestoneName } = useMemo(() => {
    // Genesis date from git history (earliest commit)
    const genesis = gitGenesisDate ?? undefined;

    // First release date from git tags
    let firstRelease: Date | undefined;
    if (firstReleaseTag) {
      firstRelease = new Date(firstReleaseTag.date);
    }

    // Find next milestone (first future milestone/tag)
    const now = new Date();
    let nextMilestone: Date | undefined;
    let nextName: string | undefined;

    // Look for future milestones from tags
    const futureMilestones = milestones
      .filter(m => new Date(m.date) > now)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (futureMilestones.length > 0) {
      nextMilestone = new Date(futureMilestones[0].date);
      nextName = futureMilestones[0].name;
    } else {
      // Fallback: 1 month from now as placeholder
      nextMilestone = new Date();
      nextMilestone.setMonth(nextMilestone.getMonth() + 1);
    }

    return {
      genesisDate: genesis,
      firstReleaseDate: firstRelease,
      nextMilestoneDate: nextMilestone,
      nextMilestoneName: nextName
    };
  }, [gitGenesisDate, firstReleaseTag, milestones]);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header with controls */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">{t('tasks:timeline.title')}</h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Jump anchors bar */}
          <JumpAnchorsBar
            onJumpTo={handleJumpTo}
            genesisDate={genesisDate}
            firstReleaseDate={firstReleaseDate}
            nextMilestoneDate={nextMilestoneDate}
            nextMilestoneName={nextMilestoneName}
          />

          <Separator orientation="vertical" className="h-6" />

          {/* Zoom controls */}
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleZoomOut}
                  disabled={zoomLevel === 'quarter'}
                  className="h-8 w-8"
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Zoom out</TooltipContent>
            </Tooltip>

            <div className="flex items-center gap-0.5">
              {(['quarter', 'month', 'week', 'day'] as TimelineZoomLevel[]).map((level) => (
                <Button
                  key={level}
                  variant={zoomLevel === level ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setZoomLevel(level)}
                  className="text-xs h-7 px-2"
                >
                  {t(`tasks:timeline.zoomLevels.${level}`)}
                </Button>
              ))}
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleZoomIn}
                  disabled={zoomLevel === 'day'}
                  className="h-8 w-8"
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Zoom in</TooltipContent>
            </Tooltip>
          </div>

          <Separator orientation="vertical" className="h-6" />

          {/* Add task button */}
          {onNewTaskClick && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={onNewTaskClick} className="h-8 w-8">
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('common:buttons.add')}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar - task list */}
        <div
          className="border-r border-border bg-card/30 flex-shrink-0"
          style={{ width: SIDEBAR_WIDTH }}
        >
          <div
            className="flex items-center px-3 border-b border-border font-medium text-sm text-muted-foreground"
            style={{ height: TIMELINE_HEADER_HEIGHT }}
          >
            <Clock className="h-4 w-4 mr-2" />
            Tasks
          </div>
          <div style={{ height: `calc(100% - ${TIMELINE_HEADER_HEIGHT}px)` }}>
            <TimelineTaskSidebar
              tasks={filteredTasks}
              onTaskClick={handleTaskClick}
              selectedTaskId={selectedTaskId}
            />
          </div>
        </div>

        {/* Timeline area - wrapped with DndContext for drag-to-schedule */}
        {/* Note: Horizontal axis restriction is handled in TimelineTaskBar's dragStyle (y: 0) */}
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
        >
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Timeline header */}
            <TimelineHeader
              zoomLevel={zoomLevel}
              visibleStartDate={visibleStartDate}
              visibleEndDate={visibleEndDate}
              columnWidth={columnWidth}
              scrollLeft={scrollLeft}
            />

            {/* Timeline grid */}
            <TimelineGrid
              tasks={filteredTasks}
              zoomLevel={zoomLevel}
              visibleStartDate={visibleStartDate}
              visibleEndDate={visibleEndDate}
              columnWidth={columnWidth}
              onTaskClick={handleTaskClick}
              onScroll={handleScroll}
              scrollRef={gridScrollRef}
              commits={commits}
              tags={tags}
              milestones={milestones}
              selectedTaskId={selectedTaskId}
              hoveredTaskId={hoveredTaskId}
              onTaskHover={handleTaskHover}
              highlightedCommits={highlightedCommits}
              highlightedTags={highlightedTags}
              cyclicTaskIds={cyclicTaskIds}
              draggingTaskId={draggingTaskId}
              dragPreview={dragPreview}
            />
          </div>

          {/* DragOverlay - renders ghost preview during drag with date tooltip */}
          <DragOverlay dropAnimation={null}>
            {dragPreview && (
              <DragPreviewTooltip
                task={dragPreview.task}
                snappedStartDate={dragPreview.snappedStartDate}
                snappedEndDate={dragPreview.snappedEndDate}
                zoomLevel={zoomLevel}
              />
            )}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Shallow history indicator */}
      <ShallowHistoryIndicator
        isShallow={isShallowHistory}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        onLoadMore={loadMore}
      />

      {/* Bottom status bar */}
      <TimelineStatusBar
        taskCount={filteredTasks.length}
        visibleStartDate={visibleStartDate}
        visibleEndDate={visibleEndDate}
      />
    </div>
  );
}
