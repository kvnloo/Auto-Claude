import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import { GitBranch, Loader2 } from 'lucide-react';

// Constants matching TimelineView.tsx
const TASK_ROW_HEIGHT = 36;
const TIMELINE_HEADER_PRIMARY_HEIGHT = 24;
const TIMELINE_HEADER_SECONDARY_HEIGHT = 28;
const TIMELINE_HEADER_HEIGHT = TIMELINE_HEADER_PRIMARY_HEIGHT + TIMELINE_HEADER_SECONDARY_HEIGHT;
const SIDEBAR_WIDTH = 240;

/**
 * TimelineSidebarSkeleton - Skeleton loader for the task sidebar
 * Shows placeholder task rows with animated pulse
 */
interface TimelineSidebarSkeletonProps {
  rowCount?: number;
}

export function TimelineSidebarSkeleton({ rowCount = 6 }: TimelineSidebarSkeletonProps) {
  return (
    <div className="animate-pulse p-2 space-y-1">
      {Array.from({ length: rowCount }).map((_, idx) => (
        <div
          key={idx}
          className="flex items-center gap-2 px-3 py-2 rounded-md"
          style={{ height: TASK_ROW_HEIGHT }}
        >
          {/* Task title skeleton */}
          <div
            className={cn(
              'h-4 bg-muted rounded',
              // Vary widths for visual interest
              idx % 3 === 0 ? 'w-3/4' : idx % 3 === 1 ? 'w-2/3' : 'w-5/6'
            )}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * TimelineHeaderSkeleton - Skeleton loader for the timeline header
 * Shows placeholder columns with animated pulse
 */
interface TimelineHeaderSkeletonProps {
  columnCount?: number;
  columnWidth?: number;
}

export function TimelineHeaderSkeleton({
  columnCount = 12,
  columnWidth = 80
}: TimelineHeaderSkeletonProps) {
  const totalWidth = columnCount * columnWidth;

  return (
    <div
      className="relative border-b border-border bg-card/50 flex flex-col animate-pulse"
      style={{ height: TIMELINE_HEADER_HEIGHT }}
    >
      {/* Primary header row skeleton */}
      <div
        className="relative border-b border-border/30 overflow-hidden"
        style={{ height: TIMELINE_HEADER_PRIMARY_HEIGHT }}
      >
        <div className="absolute top-0 bottom-0 flex" style={{ width: totalWidth }}>
          {/* Group header placeholders - 3-4 columns each */}
          {Array.from({ length: Math.ceil(columnCount / 4) }).map((_, idx) => (
            <div
              key={idx}
              className="border-r border-border/50 flex items-center justify-center"
              style={{ width: columnWidth * 4 }}
            >
              <div className="h-3 w-20 bg-muted rounded" />
            </div>
          ))}
        </div>
      </div>

      {/* Secondary header row skeleton */}
      <div
        className="relative overflow-hidden"
        style={{ height: TIMELINE_HEADER_SECONDARY_HEIGHT }}
      >
        <div className="absolute top-0 bottom-0 flex" style={{ width: totalWidth }}>
          {Array.from({ length: columnCount }).map((_, idx) => (
            <div
              key={idx}
              className="flex-shrink-0 border-r border-border/40 flex items-center justify-center"
              style={{ width: columnWidth }}
            >
              <div className="h-3 w-8 bg-muted rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * TimelineTaskBarSkeleton - Skeleton loader for a single task bar in the grid
 */
interface TimelineTaskBarSkeletonProps {
  left: number;
  width: number;
}

export function TimelineTaskBarSkeleton({ left, width }: TimelineTaskBarSkeletonProps) {
  return (
    <div
      className="absolute top-1/2 -translate-y-1/2 h-6 bg-muted rounded-md animate-pulse"
      style={{ left, width: Math.max(width, 40) }}
    >
      {/* Task title placeholder */}
      {width > 80 && (
        <div className="absolute inset-y-0 left-2 right-2 flex items-center">
          <div className="h-3 w-2/3 bg-muted-foreground/20 rounded" />
        </div>
      )}
    </div>
  );
}

/**
 * TimelineGridSkeleton - Skeleton loader for the main timeline grid
 * Shows placeholder task rows with task bar skeletons
 */
interface TimelineGridSkeletonProps {
  rowCount?: number;
  columnCount?: number;
  columnWidth?: number;
}

export function TimelineGridSkeleton({
  rowCount = 6,
  columnCount = 12,
  columnWidth = 80
}: TimelineGridSkeletonProps) {
  const totalWidth = columnCount * columnWidth;

  // Generate semi-random task bar positions for visual interest
  const taskBarPositions = useMemo(() => {
    return Array.from({ length: rowCount }).map((_, idx) => {
      // Vary positions and widths based on index
      const baseOffset = (idx * 37) % 60; // Pseudo-random offset
      const offsetPercent = 10 + baseOffset;
      const widthPercent = 20 + ((idx * 23) % 40);

      const left = (offsetPercent / 100) * totalWidth;
      const width = (widthPercent / 100) * totalWidth;

      return { left, width: Math.min(width, totalWidth - left - 20) };
    });
  }, [rowCount, totalWidth]);

  return (
    <div className="flex-1 overflow-hidden">
      <div className="relative animate-pulse" style={{ width: totalWidth, minHeight: '100%' }}>
        {/* Grid lines skeleton */}
        <div className="absolute inset-0 flex">
          {Array.from({ length: columnCount }).map((_, idx) => (
            <div
              key={idx}
              className="flex-shrink-0 border-r border-border/20"
              style={{ width: columnWidth }}
            />
          ))}
        </div>

        {/* Task row skeletons */}
        <div className="relative z-20">
          {taskBarPositions.map((position, idx) => (
            <div
              key={idx}
              className="relative border-b border-border/10"
              style={{ height: TASK_ROW_HEIGHT }}
            >
              <TimelineTaskBarSkeleton left={position.left} width={position.width} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * GitHistoryLoadingSkeleton - Skeleton for commit/tag markers loading state
 * Shows placeholder dots along the bottom of the grid
 */
interface GitHistoryLoadingSkeletonProps {
  markerCount?: number;
  totalWidth?: number;
}

export function GitHistoryLoadingSkeleton({
  markerCount = 8,
  totalWidth = 960
}: GitHistoryLoadingSkeletonProps) {
  // Generate semi-random positions for marker placeholders
  const markerPositions = useMemo(() => {
    return Array.from({ length: markerCount }).map((_, idx) => {
      // Distribute markers across the width with some variation
      const basePosition = (idx / markerCount) * totalWidth;
      const variation = ((idx * 31) % 50) - 25; // -25 to +25 variation
      return Math.max(20, Math.min(totalWidth - 20, basePosition + variation));
    });
  }, [markerCount, totalWidth]);

  return (
    <div className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none animate-pulse">
      {markerPositions.map((position, idx) => (
        <div
          key={idx}
          className="absolute bottom-2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-muted"
          style={{ left: position }}
        />
      ))}
    </div>
  );
}

/**
 * TimelineLoadingOverlay - Full overlay shown during initial loading
 */
interface TimelineLoadingOverlayProps {
  message?: string;
}

export function TimelineLoadingOverlay({ message }: TimelineLoadingOverlayProps) {
  const { t } = useTranslation('tasks');
  const displayMessage = message ?? t('timeline.loading.initializing');

  return (
    <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">{displayMessage}</span>
      </div>
    </div>
  );
}

/**
 * GitHistoryLoadingIndicator - Inline loading indicator for git history
 * Shows in the status bar or header area
 */
export function GitHistoryLoadingIndicator() {
  const { t } = useTranslation('tasks');

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <GitBranch className="h-3.5 w-3.5 animate-pulse" />
      <span>{t('timeline.loading.gitHistory')}</span>
      <Loader2 className="h-3 w-3 animate-spin" />
    </div>
  );
}

/**
 * ProgressiveRenderingIndicator - Shows progress when rendering many tasks
 */
interface ProgressiveRenderingIndicatorProps {
  renderedCount: number;
  totalCount: number;
}

export function ProgressiveRenderingIndicator({
  renderedCount,
  totalCount
}: ProgressiveRenderingIndicatorProps) {
  const { t } = useTranslation('tasks');
  const percent = Math.round((renderedCount / totalCount) * 100);

  if (renderedCount >= totalCount) return null;

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>
        {t('timeline.loading.progressiveRender', {
          rendered: renderedCount,
          total: totalCount
        })}
      </span>
      <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/**
 * TimelineFullSkeleton - Complete skeleton for the entire timeline view
 * Used during initial load before any data is available
 */
interface TimelineFullSkeletonProps {
  taskRowCount?: number;
  columnCount?: number;
  columnWidth?: number;
}

export function TimelineFullSkeleton({
  taskRowCount = 6,
  columnCount = 12,
  columnWidth = 80
}: TimelineFullSkeletonProps) {
  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header skeleton */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="animate-pulse h-6 w-40 bg-muted rounded" />
        <div className="flex items-center gap-2 animate-pulse">
          {/* Jump anchors placeholder */}
          <div className="flex gap-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-7 w-20 bg-muted rounded" />
            ))}
          </div>
          <div className="w-px h-6 bg-border mx-1" />
          {/* Zoom controls placeholder */}
          <div className="flex gap-0.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-7 w-16 bg-muted rounded" />
            ))}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar skeleton */}
        <div
          className="border-r border-border bg-card/30 flex-shrink-0"
          style={{ width: SIDEBAR_WIDTH }}
        >
          <div
            className="flex items-center px-3 border-b border-border animate-pulse"
            style={{ height: TIMELINE_HEADER_HEIGHT }}
          >
            <div className="h-4 w-16 bg-muted rounded" />
          </div>
          <div style={{ height: `calc(100% - ${TIMELINE_HEADER_HEIGHT}px)` }}>
            <TimelineSidebarSkeleton rowCount={taskRowCount} />
          </div>
        </div>

        {/* Timeline area skeleton */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <TimelineHeaderSkeleton columnCount={columnCount} columnWidth={columnWidth} />
          <TimelineGridSkeleton
            rowCount={taskRowCount}
            columnCount={columnCount}
            columnWidth={columnWidth}
          />
        </div>
      </div>

      {/* Status bar skeleton */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-card/50 animate-pulse">
        <div className="h-3 w-32 bg-muted rounded" />
        <div className="h-3 w-20 bg-muted rounded" />
      </div>
    </div>
  );
}
