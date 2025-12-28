/**
 * SigmaGraph Component
 *
 * WebGL-accelerated graph visualization using Sigma.js v3.
 * Renders large graphs (100K+ edges) with GPU acceleration.
 * Follows Oscura Midnight dark-mode-first design language.
 */

import React, { useEffect, useCallback, useMemo } from 'react';
import { Loader2, RotateCcw, Maximize2, Layers, ZoomIn, ZoomOut } from 'lucide-react';
import type { GraphData } from '../../../shared/types/explorer';
import type { GraphologyNodeAttributes } from '../../../shared/types/graphology';
import { useSigmaGraph } from './hooks/useSigmaGraph';
import { getGraphStats } from './adapters/graphology-adapter';
import { UI_COLORS, DURATION } from './design-tokens';

// ============================================
// Types
// ============================================

interface SigmaGraphProps {
  /** Graph data to visualize */
  data: GraphData | null;
  /** Current depth level (1-5) */
  depth: number;
  /** Callback when depth changes */
  onDepthChange: (depth: number) => void;
  /** Callback when node is selected */
  onNodeSelect?: (nodeId: string | null, attributes: GraphologyNodeAttributes | null) => void;
  /** Callback when node is hovered */
  onNodeHover?: (nodeId: string | null, attributes: GraphologyNodeAttributes | null) => void;
  /** Whether graph is currently loading */
  isLoading?: boolean;
  /** Class name for container */
  className?: string;
}

// ============================================
// Sub-components
// ============================================

/**
 * Layout progress indicator
 */
const LayoutProgress: React.FC<{ progress: number; isRunning: boolean }> = ({
  progress,
  isRunning,
}) => {
  if (!isRunning) return null;

  const percentage = Math.round(progress * 100);

  return (
    <div className="absolute bottom-4 left-4 flex items-center gap-3 px-4 py-2 bg-[rgb(18,18,22)] border border-[rgb(35,35,35)] rounded-lg shadow-lg z-20">
      <Loader2 className="h-4 w-4 animate-spin text-[rgb(214,216,118)]" />
      <div className="flex flex-col gap-1">
        <span className="text-xs text-[rgb(230,230,230)]">
          Optimizing layout...
        </span>
        <div className="w-32 h-1.5 bg-[rgb(35,35,35)] rounded-full overflow-hidden">
          <div
            className="h-full bg-[rgb(214,216,118)] transition-all duration-200"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
      <span className="text-xs text-[rgb(148,163,184)]">{percentage}%</span>
    </div>
  );
};

/**
 * Graph statistics display
 */
const GraphStats: React.FC<{
  nodeCount: number;
  edgeCount: number;
  visibleNodes: number;
  visibleEdges: number;
}> = ({ nodeCount, edgeCount, visibleNodes, visibleEdges }) => {
  return (
    <div className="absolute top-4 right-4 px-3 py-2 bg-[rgb(18,18,22)]/90 border border-[rgb(35,35,35)] rounded-lg text-xs z-20">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-[rgb(59,130,246)]" />
          <span className="text-[rgb(148,163,184)]">
            {visibleNodes.toLocaleString()}/{nodeCount.toLocaleString()} nodes
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-[rgb(148,163,184)]" />
          <span className="text-[rgb(148,163,184)]">
            {visibleEdges.toLocaleString()}/{edgeCount.toLocaleString()} edges
          </span>
        </div>
      </div>
    </div>
  );
};

/**
 * Graph controls toolbar
 */
const GraphControls: React.FC<{
  onResetCamera: () => void;
  onStartLayout: () => void;
  onRunNoverlap: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  isLayoutRunning: boolean;
}> = ({
  onResetCamera,
  onStartLayout,
  onRunNoverlap,
  onZoomIn,
  onZoomOut,
  isLayoutRunning,
}) => {
  return (
    <div className="absolute bottom-4 right-4 flex items-center gap-1 p-1 bg-[rgb(18,18,22)] border border-[rgb(35,35,35)] rounded-lg z-20">
      <button
        onClick={onZoomIn}
        className="p-2 hover:bg-[rgb(35,35,35)] rounded transition-colors"
        title="Zoom in"
      >
        <ZoomIn className="h-4 w-4 text-[rgb(148,163,184)]" />
      </button>
      <button
        onClick={onZoomOut}
        className="p-2 hover:bg-[rgb(35,35,35)] rounded transition-colors"
        title="Zoom out"
      >
        <ZoomOut className="h-4 w-4 text-[rgb(148,163,184)]" />
      </button>
      <div className="w-px h-4 bg-[rgb(35,35,35)]" />
      <button
        onClick={onResetCamera}
        className="p-2 hover:bg-[rgb(35,35,35)] rounded transition-colors"
        title="Reset view"
      >
        <Maximize2 className="h-4 w-4 text-[rgb(148,163,184)]" />
      </button>
      <button
        onClick={onStartLayout}
        disabled={isLayoutRunning}
        className="p-2 hover:bg-[rgb(35,35,35)] rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title="Re-run layout"
      >
        <RotateCcw className={`h-4 w-4 text-[rgb(148,163,184)] ${isLayoutRunning ? 'animate-spin' : ''}`} />
      </button>
      <button
        onClick={onRunNoverlap}
        disabled={isLayoutRunning}
        className="p-2 hover:bg-[rgb(35,35,35)] rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title="Remove overlaps"
      >
        <Layers className="h-4 w-4 text-[rgb(148,163,184)]" />
      </button>
    </div>
  );
};

/**
 * Loading overlay
 */
const LoadingOverlay: React.FC = () => {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[rgb(11,11,15)]/80 z-30">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-[rgb(214,216,118)]" />
        <span className="text-sm text-[rgb(148,163,184)]">Loading graph...</span>
      </div>
    </div>
  );
};

// ============================================
// Main Component
// ============================================

export const SigmaGraph: React.FC<SigmaGraphProps> = ({
  data,
  depth,
  onDepthChange,
  onNodeSelect,
  onNodeHover,
  isLoading = false,
  className = '',
}) => {
  // Initialize Sigma graph hook
  const {
    containerRef,
    graph,
    sigma,
    isLoaded,
    isLayoutRunning,
    layoutProgress,
    selectedNodeId,
    loadGraph,
    setDepth,
    startLayout,
    stopLayout,
    runNoverlap,
    resetCamera,
  } = useSigmaGraph({
    initialDepth: depth,
    autoLayout: true,
    onNodeClick: useCallback((nodeId: string, attrs: GraphologyNodeAttributes) => {
      onNodeSelect?.(nodeId, attrs);
    }, [onNodeSelect]),
    onNodeHover: useCallback((nodeId: string | null, attrs: GraphologyNodeAttributes | null) => {
      onNodeHover?.(nodeId, attrs);
    }, [onNodeHover]),
    onBackgroundClick: useCallback(() => {
      onNodeSelect?.(null, null);
    }, [onNodeSelect]),
    onLayoutComplete: useCallback((duration: number) => {
      console.log(`[SigmaGraph] Layout completed in ${duration.toFixed(0)}ms`);
    }, []),
  });

  // Load graph when data changes
  useEffect(() => {
    if (data) {
      loadGraph(data);
    }
  }, [data, loadGraph]);

  // Sync depth with external state
  useEffect(() => {
    setDepth(depth);
  }, [depth, setDepth]);

  // Get graph statistics
  const stats = useMemo(() => {
    if (!graph) {
      return { nodeCount: 0, edgeCount: 0, visibleNodes: 0, visibleEdges: 0, nodesByType: {}, edgesByType: {} };
    }
    return getGraphStats(graph);
  }, [graph, depth, isLoaded]);

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    if (sigma) {
      const camera = sigma.getCamera();
      camera.animatedZoom({ duration: DURATION.normal });
    }
  }, [sigma]);

  const handleZoomOut = useCallback(() => {
    if (sigma) {
      const camera = sigma.getCamera();
      camera.animatedUnzoom({ duration: DURATION.normal });
    }
  }, [sigma]);

  return (
    <div
      className={`relative w-full h-full bg-[rgb(11,11,15)] overflow-hidden ${className}`}
      style={{ minHeight: '400px' }}
    >
      {/* Main graph container */}
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{
          backgroundColor: UI_COLORS.background,
          cursor: 'grab',
        }}
      />

      {/* Loading overlay */}
      {isLoading && <LoadingOverlay />}

      {/* Graph statistics */}
      {isLoaded && (
        <GraphStats
          nodeCount={stats.nodeCount}
          edgeCount={stats.edgeCount}
          visibleNodes={stats.visibleNodes}
          visibleEdges={stats.visibleEdges}
        />
      )}

      {/* Layout progress */}
      <LayoutProgress progress={layoutProgress} isRunning={isLayoutRunning} />

      {/* Graph controls */}
      {isLoaded && (
        <GraphControls
          onResetCamera={resetCamera}
          onStartLayout={startLayout}
          onRunNoverlap={runNoverlap}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          isLayoutRunning={isLayoutRunning}
        />
      )}

      {/* Empty state */}
      {!isLoading && !data && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <Layers className="h-12 w-12 mx-auto mb-3 text-[rgb(100,116,139)]" />
            <p className="text-sm text-[rgb(148,163,184)]">
              No graph data available
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default SigmaGraph;
