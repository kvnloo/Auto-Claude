import { useState, useMemo, useCallback, useRef, RefObject } from 'react';
import type { Task } from '../../shared/types';

/**
 * Timeline zoom levels - from coarse to fine
 */
export type TimelineZoomLevel = 'quarter' | 'month' | 'week' | 'day';

/**
 * Column widths in pixels for each zoom level
 */
const ZOOM_COLUMN_WIDTHS: Record<TimelineZoomLevel, number> = {
  quarter: 120,
  month: 80,
  week: 60,
  day: 40
};

/**
 * Ordered list of zoom levels from coarse to fine
 */
const ZOOM_LEVELS: TimelineZoomLevel[] = ['quarter', 'month', 'week', 'day'];

/**
 * Options for initializing the timeline scale hook
 */
export interface UseTimelineScaleOptions {
  /** Initial zoom level */
  initialZoom?: TimelineZoomLevel;
  /** Initial months to show before today */
  monthsBefore?: number;
  /** Initial months to show after today */
  monthsAfter?: number;
  /** Tasks to consider for date range calculation */
  tasks?: Task[];
  /** Genesis date (earliest commit) if known */
  genesisDate?: Date;
}

/**
 * Date range with start and end dates
 */
export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * Result of calculating position for a date
 */
export interface DatePosition {
  /** Position in pixels from start of timeline */
  position: number;
  /** Whether the date is within the visible range */
  isVisible: boolean;
}

/**
 * Return type for the useTimelineScale hook
 */
export interface UseTimelineScaleReturn {
  // Scale state
  zoomLevel: TimelineZoomLevel;
  setZoomLevel: (level: TimelineZoomLevel) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;

  // Date range
  visibleRange: DateRange;
  setVisibleRange: (range: DateRange) => void;
  extendRange: (direction: 'past' | 'future', amount?: number) => void;

  // Column calculations
  columnWidth: number;
  columnCount: number;
  totalWidth: number;

  // Scroll state
  scrollLeft: number;
  setScrollLeft: (value: number) => void;
  handleScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  scrollTo: (position: number, smooth?: boolean) => void;
  scrollToDate: (date: Date, smooth?: boolean) => void;
  scrollToNow: (smooth?: boolean) => void;

  // Position calculations
  getDatePosition: (date: Date) => DatePosition;
  getNowPosition: () => DatePosition;
  getColumnBoundaries: () => Array<{ date: Date; position: number }>;

  // Date formatting utilities
  formatColumnLabel: (date: Date) => string;
  formatDateRange: (start: Date, end: Date) => string;
  getWeekNumber: (date: Date) => number;
  getQuarter: (date: Date) => number;

  // Snap utilities
  snapToGrid: (position: number) => number;
  positionToDate: (position: number) => Date;
}

/**
 * Get the week number for a date (ISO week)
 */
export function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Get the quarter for a date (1-4)
 */
export function getQuarter(date: Date): number {
  return Math.floor(date.getMonth() / 3) + 1;
}

/**
 * Calculate the number of columns between two dates for a given zoom level
 */
function calculateColumnCount(
  start: Date,
  end: Date,
  zoomLevel: TimelineZoomLevel
): number {
  let count = 0;
  const current = new Date(start);
  current.setHours(0, 0, 0, 0);

  while (current <= end) {
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
}

/**
 * Advance a date by one unit based on zoom level
 */
function advanceDate(date: Date, zoomLevel: TimelineZoomLevel): Date {
  const result = new Date(date);
  switch (zoomLevel) {
    case 'day':
      result.setDate(result.getDate() + 1);
      break;
    case 'week':
      result.setDate(result.getDate() + 7);
      break;
    case 'month':
      result.setMonth(result.getMonth() + 1);
      break;
    case 'quarter':
      result.setMonth(result.getMonth() + 3);
      break;
  }
  return result;
}

/**
 * Get unit duration in milliseconds for a zoom level
 */
function getUnitDuration(zoomLevel: TimelineZoomLevel): number {
  const MS_PER_DAY = 86400000;
  switch (zoomLevel) {
    case 'day':
      return MS_PER_DAY;
    case 'week':
      return MS_PER_DAY * 7;
    case 'month':
      return MS_PER_DAY * 30; // Approximate
    case 'quarter':
      return MS_PER_DAY * 91; // Approximate
  }
}

/**
 * Hook to manage timeline scale, date range, and scroll position
 *
 * @example
 * ```tsx
 * const {
 *   zoomLevel,
 *   zoomIn,
 *   zoomOut,
 *   visibleRange,
 *   columnWidth,
 *   scrollToNow,
 *   formatColumnLabel
 * } = useTimelineScale({
 *   initialZoom: 'month',
 *   monthsBefore: 6,
 *   monthsAfter: 6
 * });
 * ```
 */
export function useTimelineScale(
  options: UseTimelineScaleOptions = {}
): UseTimelineScaleReturn {
  const {
    initialZoom = 'month',
    monthsBefore = 6,
    monthsAfter = 6,
    tasks = [],
    genesisDate
  } = options;

  // Refs
  const scrollRef = useRef<HTMLDivElement>(null);

  // Zoom level state
  const [zoomLevel, setZoomLevel] = useState<TimelineZoomLevel>(initialZoom);

  // Scroll position state
  const [scrollLeft, setScrollLeft] = useState(0);

  // Calculate default date range
  const defaultRange = useMemo((): DateRange => {
    const today = new Date();
    const start = new Date(today);
    start.setMonth(start.getMonth() - monthsBefore);
    start.setDate(1); // Start of month
    start.setHours(0, 0, 0, 0);

    const end = new Date(today);
    end.setMonth(end.getMonth() + monthsAfter + 1);
    end.setDate(0); // End of month (last day of previous month)
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }, [monthsBefore, monthsAfter]);

  // Visible range state
  const [visibleRange, setVisibleRangeState] = useState<DateRange>(defaultRange);

  // Extend range based on tasks and genesis date
  const adjustedRange = useMemo((): DateRange => {
    let { start, end } = visibleRange;

    // Extend to include genesis date if provided
    if (genesisDate && genesisDate < start) {
      start = new Date(genesisDate);
      start.setDate(1); // Start of month
    }

    // Extend to include all task dates
    for (const task of tasks) {
      const createdAt = new Date(task.createdAt);
      if (createdAt < start) {
        start = new Date(createdAt);
        start.setDate(1);
      }
      if (createdAt > end) {
        end = new Date(createdAt);
        end.setMonth(end.getMonth() + 1);
        end.setDate(0);
      }

      // Check scheduled dates in metadata
      const metadata = task.metadata;
      if (metadata) {
        // Type assertion for potential future fields
        const taskMeta = metadata as Record<string, unknown>;
        if (typeof taskMeta.scheduledStartDate === 'string') {
          const scheduledStart = new Date(taskMeta.scheduledStartDate);
          if (scheduledStart < start) {
            start = new Date(scheduledStart);
            start.setDate(1);
          }
        }
        if (typeof taskMeta.scheduledEndDate === 'string') {
          const scheduledEnd = new Date(taskMeta.scheduledEndDate);
          if (scheduledEnd > end) {
            end = new Date(scheduledEnd);
            end.setMonth(end.getMonth() + 1);
            end.setDate(0);
          }
        }
      }
    }

    return { start, end };
  }, [visibleRange, tasks, genesisDate]);

  // Column width based on zoom level
  const columnWidth = ZOOM_COLUMN_WIDTHS[zoomLevel];

  // Calculate column count
  const columnCount = useMemo(
    () => calculateColumnCount(adjustedRange.start, adjustedRange.end, zoomLevel),
    [adjustedRange, zoomLevel]
  );

  // Total width of timeline
  const totalWidth = columnCount * columnWidth;

  // Zoom handlers
  const canZoomIn = zoomLevel !== 'day';
  const canZoomOut = zoomLevel !== 'quarter';

  const zoomIn = useCallback(() => {
    const currentIdx = ZOOM_LEVELS.indexOf(zoomLevel);
    if (currentIdx < ZOOM_LEVELS.length - 1) {
      setZoomLevel(ZOOM_LEVELS[currentIdx + 1]);
    }
  }, [zoomLevel]);

  const zoomOut = useCallback(() => {
    const currentIdx = ZOOM_LEVELS.indexOf(zoomLevel);
    if (currentIdx > 0) {
      setZoomLevel(ZOOM_LEVELS[currentIdx - 1]);
    }
  }, [zoomLevel]);

  // Range manipulation
  const setVisibleRange = useCallback((range: DateRange) => {
    setVisibleRangeState(range);
  }, []);

  const extendRange = useCallback((direction: 'past' | 'future', amount = 3) => {
    setVisibleRangeState((prev) => {
      const newRange = { ...prev };
      if (direction === 'past') {
        newRange.start = new Date(prev.start);
        newRange.start.setMonth(newRange.start.getMonth() - amount);
      } else {
        newRange.end = new Date(prev.end);
        newRange.end.setMonth(newRange.end.getMonth() + amount);
      }
      return newRange;
    });
  }, []);

  // Scroll handlers
  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const target = event.target as HTMLDivElement;
    setScrollLeft(target.scrollLeft);
  }, []);

  const scrollTo = useCallback((position: number, smooth = true) => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        left: Math.max(0, position),
        behavior: smooth ? 'smooth' : 'auto'
      });
    }
  }, []);

  // Position calculations
  const getDatePosition = useCallback(
    (date: Date): DatePosition => {
      const dateMs = date.getTime();
      const startMs = adjustedRange.start.getTime();
      const endMs = adjustedRange.end.getTime();

      const isVisible = dateMs >= startMs && dateMs <= endMs;
      const position = ((dateMs - startMs) / (endMs - startMs)) * totalWidth;

      return { position, isVisible };
    },
    [adjustedRange, totalWidth]
  );

  const getNowPosition = useCallback((): DatePosition => {
    return getDatePosition(new Date());
  }, [getDatePosition]);

  // Scroll to date
  const scrollToDate = useCallback(
    (date: Date, smooth = true) => {
      const { position, isVisible } = getDatePosition(date);
      if (!isVisible) return;

      // Center the date in the viewport
      const viewportWidth = scrollRef.current?.clientWidth ?? 0;
      scrollTo(position - viewportWidth / 2, smooth);
    },
    [getDatePosition, scrollTo]
  );

  const scrollToNow = useCallback(
    (smooth = true) => {
      scrollToDate(new Date(), smooth);
    },
    [scrollToDate]
  );

  // Get column boundaries for rendering
  const getColumnBoundaries = useCallback((): Array<{ date: Date; position: number }> => {
    const boundaries: Array<{ date: Date; position: number }> = [];
    const current = new Date(adjustedRange.start);
    current.setHours(0, 0, 0, 0);
    let position = 0;

    while (current <= adjustedRange.end) {
      boundaries.push({
        date: new Date(current),
        position
      });
      position += columnWidth;

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

    return boundaries;
  }, [adjustedRange, columnWidth, zoomLevel]);

  // Date formatting utilities
  const formatColumnLabel = useCallback(
    (date: Date): string => {
      switch (zoomLevel) {
        case 'day':
          return date.toLocaleDateString(undefined, {
            day: 'numeric',
            weekday: 'short'
          });
        case 'week':
          return `W${getWeekNumber(date)}`;
        case 'month':
          return date.toLocaleDateString(undefined, { month: 'short' });
        case 'quarter':
          return `Q${getQuarter(date)} ${date.getFullYear()}`;
        default:
          return date.toLocaleDateString();
      }
    },
    [zoomLevel]
  );

  const formatDateRange = useCallback((start: Date, end: Date): string => {
    const startStr = start.toLocaleDateString(undefined, {
      month: 'short',
      year: 'numeric'
    });
    const endStr = end.toLocaleDateString(undefined, {
      month: 'short',
      year: 'numeric'
    });
    return `${startStr} - ${endStr}`;
  }, []);

  // Snap to grid utilities
  const snapToGrid = useCallback(
    (position: number): number => {
      return Math.round(position / columnWidth) * columnWidth;
    },
    [columnWidth]
  );

  const positionToDate = useCallback(
    (position: number): Date => {
      const startMs = adjustedRange.start.getTime();
      const endMs = adjustedRange.end.getTime();
      const ratio = position / totalWidth;
      const dateMs = startMs + ratio * (endMs - startMs);
      return new Date(dateMs);
    },
    [adjustedRange, totalWidth]
  );

  return {
    // Scale state
    zoomLevel,
    setZoomLevel,
    zoomIn,
    zoomOut,
    canZoomIn,
    canZoomOut,

    // Date range
    visibleRange: adjustedRange,
    setVisibleRange,
    extendRange,

    // Column calculations
    columnWidth,
    columnCount,
    totalWidth,

    // Scroll state
    scrollLeft,
    setScrollLeft,
    handleScroll,
    scrollRef,
    scrollTo,
    scrollToDate,
    scrollToNow,

    // Position calculations
    getDatePosition,
    getNowPosition,
    getColumnBoundaries,

    // Date formatting utilities
    formatColumnLabel,
    formatDateRange,
    getWeekNumber,
    getQuarter
  };
}
