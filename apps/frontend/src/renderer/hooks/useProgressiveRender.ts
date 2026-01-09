import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

/**
 * Options for the useProgressiveRender hook
 */
export interface UseProgressiveRenderOptions<T> {
  /** Array of items to progressively render */
  items: T[];
  /** Initial batch size to render immediately (default: 20) */
  initialBatchSize?: number;
  /** Batch size for subsequent renders (default: 10) */
  batchSize?: number;
  /** Delay between batches in ms (default: 16 - ~60fps) */
  batchDelay?: number;
  /** Threshold above which progressive rendering is enabled (default: 30) */
  threshold?: number;
  /** Whether progressive rendering is enabled (default: true) */
  enabled?: boolean;
}

/**
 * Return type for the useProgressiveRender hook
 */
export interface UseProgressiveRenderReturn<T> {
  /** Currently rendered items (grows progressively) */
  renderedItems: T[];
  /** Number of items currently rendered */
  renderedCount: number;
  /** Total number of items */
  totalCount: number;
  /** Whether rendering is complete */
  isComplete: boolean;
  /** Whether progressive rendering is active (above threshold) */
  isProgressive: boolean;
  /** Render progress (0-1) */
  progress: number;
  /** Force render all items immediately */
  renderAll: () => void;
  /** Reset rendering (useful after items change) */
  reset: () => void;
}

/**
 * Hook for progressively rendering large lists of items to maintain UI responsiveness.
 *
 * When the number of items exceeds the threshold, this hook will render them in batches
 * using requestAnimationFrame to avoid blocking the main thread.
 *
 * @example
 * ```tsx
 * const { renderedItems, isComplete, progress } = useProgressiveRender({
 *   items: tasks,
 *   initialBatchSize: 20,
 *   batchSize: 10,
 *   threshold: 30
 * });
 *
 * return (
 *   <>
 *     {!isComplete && <ProgressIndicator progress={progress} />}
 *     {renderedItems.map(task => <TaskItem key={task.id} task={task} />)}
 *   </>
 * );
 * ```
 */
export function useProgressiveRender<T>({
  items,
  initialBatchSize = 20,
  batchSize = 10,
  batchDelay = 16,
  threshold = 30,
  enabled = true
}: UseProgressiveRenderOptions<T>): UseProgressiveRenderReturn<T> {
  const [renderedCount, setRenderedCount] = useState(0);
  const [forceComplete, setForceComplete] = useState(false);
  const rafRef = useRef<number | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const totalCount = items.length;
  const isProgressive = enabled && totalCount > threshold;

  // Reset rendered count when items change significantly
  const itemsKey = useMemo(() => {
    // Create a simple key based on length and first/last item identity
    // This helps detect when the list has actually changed
    if (items.length === 0) return 'empty';
    const firstId = (items[0] as unknown as { id?: string })?.id || '0';
    const lastId = (items[items.length - 1] as unknown as { id?: string })?.id || String(items.length);
    return `${items.length}-${firstId}-${lastId}`;
  }, [items]);

  // Reset when items change
  useEffect(() => {
    setForceComplete(false);
    if (isProgressive) {
      setRenderedCount(Math.min(initialBatchSize, totalCount));
    } else {
      setRenderedCount(totalCount);
    }
  }, [itemsKey, isProgressive, initialBatchSize, totalCount]);

  // Progressive rendering effect
  useEffect(() => {
    if (!isProgressive || forceComplete || renderedCount >= totalCount) {
      return;
    }

    // Schedule next batch render
    const scheduleNextBatch = () => {
      timeoutRef.current = setTimeout(() => {
        rafRef.current = requestAnimationFrame(() => {
          setRenderedCount((prev) => Math.min(prev + batchSize, totalCount));
        });
      }, batchDelay);
    };

    scheduleNextBatch();

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isProgressive, forceComplete, renderedCount, totalCount, batchSize, batchDelay]);

  // Compute rendered items
  const renderedItems = useMemo(() => {
    if (!isProgressive || forceComplete) {
      return items;
    }
    return items.slice(0, renderedCount);
  }, [items, isProgressive, forceComplete, renderedCount]);

  const isComplete = !isProgressive || forceComplete || renderedCount >= totalCount;
  const progress = totalCount > 0 ? renderedCount / totalCount : 1;

  const renderAll = useCallback(() => {
    setForceComplete(true);
    setRenderedCount(totalCount);
  }, [totalCount]);

  const reset = useCallback(() => {
    setForceComplete(false);
    if (isProgressive) {
      setRenderedCount(Math.min(initialBatchSize, totalCount));
    } else {
      setRenderedCount(totalCount);
    }
  }, [isProgressive, initialBatchSize, totalCount]);

  return {
    renderedItems,
    renderedCount: isComplete ? totalCount : renderedCount,
    totalCount,
    isComplete,
    isProgressive,
    progress,
    renderAll,
    reset
  };
}
