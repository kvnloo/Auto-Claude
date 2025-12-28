/**
 * useForceLayout Hook
 *
 * Manages the WebWorker-based ForceAtlas2 layout algorithm.
 * Provides progress tracking, start/stop controls, and position updates.
 */

import { useRef, useCallback, useState, useEffect } from 'react';
import type { ExplorerGraph, ForceAtlas2Settings } from '../../../../shared/types/graphology';
import { FORCE_ATLAS_SETTINGS } from '../design-tokens';

// ============================================
// Types
// ============================================

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  size?: number;
}

interface LayoutEdge {
  source: string;
  target: string;
  weight?: number;
}

interface LayoutProgress {
  isRunning: boolean;
  progress: number;
  iteration: number;
}

interface UseForceLayoutOptions {
  /** Initial settings for ForceAtlas2 */
  settings?: Partial<ForceAtlas2Settings>;
  /** Callback when positions are updated */
  onPositionsUpdate?: (positions: Record<string, { x: number; y: number }>) => void;
  /** Callback when layout completes */
  onComplete?: (duration: number) => void;
  /** Callback on error */
  onError?: (error: string) => void;
  /** Auto-start layout when graph changes */
  autoStart?: boolean;
}

interface UseForceLayoutResult {
  /** Current layout progress */
  progress: LayoutProgress;
  /** Start the layout algorithm */
  startLayout: (graph: ExplorerGraph) => void;
  /** Stop the current layout */
  stopLayout: () => void;
  /** Run noverlap to remove overlaps */
  runNoverlap: () => void;
  /** Update layout settings */
  updateSettings: (settings: Partial<ForceAtlas2Settings>) => void;
  /** Whether the worker is ready */
  isReady: boolean;
}

// ============================================
// Hook Implementation
// ============================================

export function useForceLayout(options: UseForceLayoutOptions = {}): UseForceLayoutResult {
  const {
    settings: initialSettings = {},
    onPositionsUpdate,
    onComplete,
    onError,
  } = options;

  // Worker reference
  const workerRef = useRef<Worker | null>(null);

  // Settings reference (to avoid stale closures)
  const settingsRef = useRef<Partial<ForceAtlas2Settings>>({
    ...FORCE_ATLAS_SETTINGS,
    ...initialSettings,
  });

  // State
  const [isReady, setIsReady] = useState(false);
  const [progress, setProgress] = useState<LayoutProgress>({
    isRunning: false,
    progress: 0,
    iteration: 0,
  });

  // Initialize worker
  useEffect(() => {
    try {
      // Create worker from the layout worker file
      workerRef.current = new Worker(
        new URL('../workers/layout.worker.ts', import.meta.url),
        { type: 'module' }
      );

      // Set up message handler
      workerRef.current.onmessage = (event) => {
        const message = event.data;

        switch (message.type) {
          case 'positions':
            onPositionsUpdate?.(message.positions);
            break;

          case 'progress':
            setProgress({
              isRunning: true,
              progress: message.progress,
              iteration: message.iteration,
            });
            break;

          case 'complete':
            setProgress({
              isRunning: false,
              progress: 1,
              iteration: settingsRef.current.iterations || 100,
            });
            onPositionsUpdate?.(message.positions);
            onComplete?.(message.duration);
            break;

          case 'error':
            setProgress((prev) => ({ ...prev, isRunning: false }));
            onError?.(message.error);
            break;
        }
      };

      workerRef.current.onerror = (error) => {
        onError?.(error.message);
        setProgress((prev) => ({ ...prev, isRunning: false }));
      };

      setIsReady(true);
    } catch (error) {
      console.error('[useForceLayout] Failed to create worker:', error);
      onError?.(error instanceof Error ? error.message : 'Failed to create layout worker');
    }

    // Cleanup
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [onPositionsUpdate, onComplete, onError]);

  // Start layout
  const startLayout = useCallback((graph: ExplorerGraph) => {
    if (!workerRef.current) {
      onError?.('Layout worker not ready');
      return;
    }

    // Extract nodes and edges from graph
    const nodes: LayoutNode[] = [];
    const edges: LayoutEdge[] = [];

    graph.forEachNode((id, attrs) => {
      if (!attrs.hidden) {
        nodes.push({
          id,
          x: attrs.x,
          y: attrs.y,
          size: attrs.size,
        });
      }
    });

    graph.forEachEdge((_, attrs, source, target) => {
      if (!attrs.hidden) {
        edges.push({
          source,
          target,
          weight: attrs.weight,
        });
      }
    });

    // Reset progress
    setProgress({
      isRunning: true,
      progress: 0,
      iteration: 0,
    });

    // Send to worker
    workerRef.current.postMessage({
      type: 'start',
      nodes,
      edges,
      settings: settingsRef.current,
    });
  }, [onError]);

  // Stop layout
  const stopLayout = useCallback(() => {
    if (!workerRef.current) return;

    workerRef.current.postMessage({ type: 'stop' });
    setProgress((prev) => ({ ...prev, isRunning: false }));
  }, []);

  // Run noverlap
  const runNoverlap = useCallback(() => {
    if (!workerRef.current) return;

    workerRef.current.postMessage({ type: 'noverlap' });
  }, []);

  // Update settings
  const updateSettings = useCallback((newSettings: Partial<ForceAtlas2Settings>) => {
    settingsRef.current = { ...settingsRef.current, ...newSettings };

    if (workerRef.current && progress.isRunning) {
      workerRef.current.postMessage({
        type: 'update-settings',
        settings: newSettings,
      });
    }
  }, [progress.isRunning]);

  return {
    progress,
    startLayout,
    stopLayout,
    runNoverlap,
    updateSettings,
    isReady,
  };
}

export default useForceLayout;
