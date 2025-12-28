/**
 * useSigmaGraph Hook
 *
 * Manages the Sigma.js graph visualization lifecycle.
 * Provides graph mounting, camera controls, event handling,
 * and integration with the ForceAtlas2 layout worker.
 */

import { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import Sigma from 'sigma';
import type { SigmaNodeEventPayload, SigmaStageEventPayload } from 'sigma/types';
import type { ExplorerGraph, GraphologyNodeAttributes } from '../../../../shared/types/graphology';
import type { GraphData } from '../../../../shared/types/explorer';
import { convertToGraphology, filterByDepth, highlightNode, selectNode, applyPositions } from '../adapters/graphology-adapter';
import { useForceLayout } from './useForceLayout';
import { SIGMA_SETTINGS, UI_COLORS } from '../design-tokens';

// ============================================
// Types
// ============================================

interface UseSigmaGraphOptions {
  /** Initial depth level (1-5) */
  initialDepth?: number;
  /** Auto-run layout on graph load */
  autoLayout?: boolean;
  /** Callback when node is clicked */
  onNodeClick?: (nodeId: string, attributes: GraphologyNodeAttributes) => void;
  /** Callback when node is hovered */
  onNodeHover?: (nodeId: string | null, attributes: GraphologyNodeAttributes | null) => void;
  /** Callback when background is clicked */
  onBackgroundClick?: () => void;
  /** Callback when layout completes */
  onLayoutComplete?: (duration: number) => void;
}

interface UseSigmaGraphResult {
  /** Ref to attach to container element */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Current graph instance */
  graph: ExplorerGraph | null;
  /** Current Sigma instance */
  sigma: Sigma | null;
  /** Whether graph is loaded */
  isLoaded: boolean;
  /** Whether layout is running */
  isLayoutRunning: boolean;
  /** Layout progress (0-1) */
  layoutProgress: number;
  /** Current depth level */
  depth: number;
  /** Currently selected node ID */
  selectedNodeId: string | null;
  /** Currently hovered node ID */
  hoveredNodeId: string | null;
  /** Load graph data */
  loadGraph: (data: GraphData) => void;
  /** Set depth level */
  setDepth: (depth: number) => void;
  /** Start layout algorithm */
  startLayout: () => void;
  /** Stop layout algorithm */
  stopLayout: () => void;
  /** Run noverlap to remove overlaps */
  runNoverlap: () => void;
  /** Reset camera to fit graph */
  resetCamera: () => void;
  /** Zoom to specific node */
  zoomToNode: (nodeId: string) => void;
  /** Clear selection */
  clearSelection: () => void;
}

// ============================================
// Hook Implementation
// ============================================

export function useSigmaGraph(options: UseSigmaGraphOptions = {}): UseSigmaGraphResult {
  const {
    initialDepth = 2,
    autoLayout = true,
    onNodeClick,
    onNodeHover,
    onBackgroundClick,
    onLayoutComplete,
  } = options;

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<ExplorerGraph | null>(null);

  // State
  const [isLoaded, setIsLoaded] = useState(false);
  const [depth, setDepthState] = useState(initialDepth);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // Layout hook
  const {
    progress: layoutProgress,
    startLayout: startLayoutWorker,
    stopLayout: stopLayoutWorker,
    runNoverlap: runNoverlapWorker,
    isReady: isLayoutReady,
  } = useForceLayout({
    onPositionsUpdate: useCallback((positions: Record<string, { x: number; y: number }>) => {
      if (graphRef.current) {
        applyPositions(graphRef.current, positions);
        sigmaRef.current?.refresh();
      }
    }, []),
    onComplete: useCallback((duration: number) => {
      onLayoutComplete?.(duration);
    }, [onLayoutComplete]),
    onError: useCallback((error: string) => {
      console.error('[useSigmaGraph] Layout error:', error);
    }, []),
  });

  // Sigma settings with app theme
  const sigmaSettings = useMemo(() => ({
    ...SIGMA_SETTINGS,
    // Node reducer for dynamic styling
    nodeReducer: (node: string, data: GraphologyNodeAttributes) => {
      const res: GraphologyNodeAttributes & { zIndex?: number } = { ...data };

      // Apply hover/selection states
      if (hoveredNodeId === node || selectedNodeId === node) {
        res.highlighted = true;
        res.zIndex = 1;
      }

      // Dim non-highlighted nodes when something is hovered
      if (hoveredNodeId && hoveredNodeId !== node) {
        const graph = graphRef.current;
        if (graph && !graph.areNeighbors(hoveredNodeId, node)) {
          res.color = UI_COLORS.textDim;
        }
      }

      return res;
    },
    // Edge reducer for dynamic styling
    edgeReducer: (edge: string, data: Record<string, unknown>) => {
      const res = { ...data };

      // Dim edges not connected to hovered node
      if (hoveredNodeId) {
        const graph = graphRef.current;
        if (graph) {
          const [source, target] = graph.extremities(edge);
          if (source !== hoveredNodeId && target !== hoveredNodeId) {
            res.hidden = true;
          }
        }
      }

      return res;
    },
  }), [hoveredNodeId, selectedNodeId]);

  // Initialize Sigma when container is available
  useEffect(() => {
    if (!containerRef.current || sigmaRef.current) return;

    // We'll initialize Sigma when graph is loaded
    return () => {
      if (sigmaRef.current) {
        sigmaRef.current.kill();
        sigmaRef.current = null;
      }
    };
  }, []);

  // Load graph data
  const loadGraph = useCallback((data: GraphData) => {
    // Clean up existing instance
    if (sigmaRef.current) {
      sigmaRef.current.kill();
      sigmaRef.current = null;
    }

    // Convert to graphology format
    const result = convertToGraphology(data, {
      randomizePositions: true,
      applyColors: true,
      applySizes: true,
    });

    graphRef.current = result.graph;

    // Log warnings if any
    if (result.warnings.length > 0) {
      console.warn('[useSigmaGraph] Conversion warnings:', result.warnings);
    }

    // Apply initial depth filter
    filterByDepth(result.graph, depth);

    // Create Sigma instance
    if (containerRef.current) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sigmaRef.current = new Sigma(result.graph as any, containerRef.current, sigmaSettings as any) as any;
        const sigma = sigmaRef.current;
        if (!sigma) return;

        // Set up event handlers
        sigma.on('clickNode', (event: SigmaNodeEventPayload) => {
          const nodeId = event.node;
          const attrs = result.graph.getNodeAttributes(nodeId);
          setSelectedNodeId(nodeId);
          selectNode(result.graph, nodeId);
          onNodeClick?.(nodeId, attrs);
          sigma.refresh();
        });

        sigma.on('enterNode', (event: SigmaNodeEventPayload) => {
          const nodeId = event.node;
          const attrs = result.graph.getNodeAttributes(nodeId);
          setHoveredNodeId(nodeId);
          highlightNode(result.graph, nodeId);
          onNodeHover?.(nodeId, attrs);
          sigma.refresh();
        });

        sigma.on('leaveNode', () => {
          setHoveredNodeId(null);
          highlightNode(result.graph, null);
          onNodeHover?.(null, null);
          sigma.refresh();
        });

        sigma.on('clickStage', (_event: SigmaStageEventPayload) => {
          setSelectedNodeId(null);
          selectNode(result.graph, null);
          onBackgroundClick?.();
          sigma.refresh();
        });

        setIsLoaded(true);

        // Auto-run layout if enabled
        if (autoLayout && isLayoutReady) {
          startLayoutWorker(result.graph);
        }
      } catch (error) {
        console.error('[useSigmaGraph] Failed to create Sigma instance:', error);
      }
    }
  }, [depth, sigmaSettings, autoLayout, isLayoutReady, startLayoutWorker, onNodeClick, onNodeHover, onBackgroundClick]);

  // Update depth filter
  const setDepth = useCallback((newDepth: number) => {
    setDepthState(newDepth);

    if (graphRef.current) {
      filterByDepth(graphRef.current, newDepth);
      sigmaRef.current?.refresh();

      // Re-run layout for new visible nodes
      if (autoLayout && isLayoutReady) {
        startLayoutWorker(graphRef.current);
      }
    }
  }, [autoLayout, isLayoutReady, startLayoutWorker]);

  // Start layout
  const startLayout = useCallback(() => {
    if (graphRef.current && isLayoutReady) {
      startLayoutWorker(graphRef.current);
    }
  }, [isLayoutReady, startLayoutWorker]);

  // Stop layout
  const stopLayout = useCallback(() => {
    stopLayoutWorker();
  }, [stopLayoutWorker]);

  // Run noverlap
  const runNoverlap = useCallback(() => {
    runNoverlapWorker();
    sigmaRef.current?.refresh();
  }, [runNoverlapWorker]);

  // Reset camera
  const resetCamera = useCallback(() => {
    if (sigmaRef.current) {
      sigmaRef.current.getCamera().animatedReset({ duration: 300 });
    }
  }, []);

  // Zoom to node
  const zoomToNode = useCallback((nodeId: string) => {
    if (!sigmaRef.current || !graphRef.current) return;

    const graph = graphRef.current;
    if (!graph.hasNode(nodeId)) return;

    const attrs = graph.getNodeAttributes(nodeId);
    const camera = sigmaRef.current.getCamera();

    camera.animate(
      { x: attrs.x, y: attrs.y, ratio: 0.3 },
      { duration: 300 }
    );

    // Also select the node
    setSelectedNodeId(nodeId);
    selectNode(graph, nodeId);
    sigmaRef.current.refresh();
  }, []);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedNodeId(null);
    if (graphRef.current) {
      selectNode(graphRef.current, null);
      sigmaRef.current?.refresh();
    }
  }, []);

  return {
    containerRef,
    graph: graphRef.current,
    sigma: sigmaRef.current,
    isLoaded,
    isLayoutRunning: layoutProgress.isRunning,
    layoutProgress: layoutProgress.progress,
    depth,
    selectedNodeId,
    hoveredNodeId,
    loadGraph,
    setDepth,
    startLayout,
    stopLayout,
    runNoverlap,
    resetCamera,
    zoomToNode,
    clearSelection,
  };
}

export default useSigmaGraph;
