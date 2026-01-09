import { useState, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useViewState } from '../contexts/ViewStateContext';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Inbox,
  Plus,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { Separator } from './ui/separator';
import { cn } from '../lib/utils';
import type { Task } from '../../shared/types';

// Zoom level type
export type TimelineZoomLevel = 'quarter' | 'month' | 'week' | 'day';

interface TimelineViewProps {
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onNewTaskClick?: () => void;
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

// Header height for timeline header
const TIMELINE_HEADER_HEIGHT = 48;

// Left sidebar width
const SIDEBAR_WIDTH = 240;

/**
 * TimelineHeader - Renders the date columns with grid lines and month/week labels
 */
interface TimelineHeaderProps {
  zoomLevel: TimelineZoomLevel;
  visibleStartDate: Date;
  visibleEndDate: Date;
  columnWidth: number;
  scrollLeft: number;
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
  const columns = useMemo(() => {
    const cols: { date: Date; label: string; isToday: boolean }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const current = new Date(visibleStartDate);
    current.setHours(0, 0, 0, 0);

    while (current <= visibleEndDate) {
      const isToday =
        current.getFullYear() === today.getFullYear() &&
        current.getMonth() === today.getMonth() &&
        current.getDate() === today.getDate();

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
          label = `Q${Math.floor(current.getMonth() / 3) + 1} ${current.getFullYear()}`;
          break;
      }

      cols.push({ date: new Date(current), label, isToday });

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

  return (
    <div
      className="relative border-b border-border bg-card/50"
      style={{ height: TIMELINE_HEADER_HEIGHT }}
    >
      {/* Date columns */}
      <div
        className="flex h-full"
        style={{ transform: `translateX(-${scrollLeft}px)` }}
      >
        {columns.map((col, idx) => (
          <div
            key={idx}
            className={cn(
              'flex-shrink-0 border-r border-border/50 flex items-center justify-center text-xs font-medium',
              col.isToday && 'bg-primary/10 text-primary'
            )}
            style={{ width: columnWidth }}
          >
            {col.label}
          </div>
        ))}
      </div>

      {/* Now marker */}
      {nowPosition !== null && (
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
          style={{ left: nowPosition - scrollLeft }}
        >
          <div className="absolute -top-1 -left-1.5 w-3 h-3 rounded-full bg-red-500" />
        </div>
      )}
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
interface TimelineGridProps {
  tasks: Task[];
  zoomLevel: TimelineZoomLevel;
  visibleStartDate: Date;
  visibleEndDate: Date;
  columnWidth: number;
  onTaskClick: (task: Task) => void;
  onScroll: (scrollLeft: number) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

function TimelineGrid({
  tasks,
  zoomLevel,
  visibleStartDate,
  visibleEndDate,
  columnWidth,
  onTaskClick,
  onScroll,
  scrollRef
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

        {/* Now marker */}
        {nowPosition !== null && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500/50 z-10 pointer-events-none"
            style={{ left: nowPosition }}
          />
        )}

        {/* Task rows (placeholder - actual bars implemented in later subtask) */}
        <div className="relative">
          {tasks.map((task, idx) => (
            <div
              key={task.id}
              className="border-b border-border/20"
              style={{ height: TASK_ROW_HEIGHT }}
            >
              {/* Task bar placeholder - to be implemented in subtask 4.1 */}
            </div>
          ))}
        </div>
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
export function TimelineView({ tasks, onTaskClick, onNewTaskClick }: TimelineViewProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const { showArchived } = useViewState();

  // State
  const [zoomLevel, setZoomLevel] = useState<TimelineZoomLevel>('month');
  const [scrollLeft, setScrollLeft] = useState(0);
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>();

  // Refs
  const gridScrollRef = useRef<HTMLDivElement>(null);

  // Filter tasks based on archive status
  const filteredTasks = useMemo(() => {
    if (showArchived) {
      return tasks;
    }
    return tasks.filter((t) => !t.metadata?.archivedAt);
  }, [tasks, showArchived]);

  // Calculate visible date range (default: 6 months before and after today)
  const { visibleStartDate, visibleEndDate } = useMemo(() => {
    const today = new Date();
    const start = new Date(today);
    start.setMonth(start.getMonth() - 6);
    start.setDate(1); // Start of month

    const end = new Date(today);
    end.setMonth(end.getMonth() + 6);
    end.setDate(0); // End of month

    return { visibleStartDate: start, visibleEndDate: end };
  }, []);

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

  const scrollToNow = useCallback(() => {
    if (!gridScrollRef.current) return;

    const now = new Date();
    const startMs = visibleStartDate.getTime();
    const endMs = visibleEndDate.getTime();
    const nowMs = now.getTime();

    if (nowMs < startMs || nowMs > endMs) return;

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
    const position = ((nowMs - startMs) / (endMs - startMs)) * totalWidth;

    // Center the 'Now' position in the viewport
    const viewportWidth = gridScrollRef.current.clientWidth;
    gridScrollRef.current.scrollLeft = Math.max(0, position - viewportWidth / 2);
  }, [visibleStartDate, visibleEndDate, zoomLevel, columnWidth]);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header with controls */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">{t('tasks:timeline.title')}</h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Jump anchors */}
          <div className="flex items-center gap-1 mr-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={scrollToNow}
                  className="text-xs"
                >
                  {t('tasks:timeline.today')}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('tasks:timeline.jumpTo')} {t('tasks:timeline.today')}</TooltipContent>
            </Tooltip>
          </div>

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

        {/* Timeline area */}
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
          />
        </div>
      </div>

      {/* Bottom status bar */}
      <TimelineStatusBar
        taskCount={filteredTasks.length}
        visibleStartDate={visibleStartDate}
        visibleEndDate={visibleEndDate}
      />
    </div>
  );
}
