import { useRef, useEffect, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import type {
  GraphNode,
  GraphEdge,
  GraphData,
  DepthLevel,
  GraphViewport,
  NodeType,
  EdgeType
} from '../../../../shared/types/explorer';
import {
  DEFAULT_GRAPH_COLORS as GRAPH_COLORS,
  DEFAULT_NODE_SIZES as NODE_SIZES
} from '../../../../shared/types/explorer';

// ============================================
// Types
// ============================================

/**
 * Simulation node with D3-added position properties
 */
export interface SimulationNode extends GraphNode {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

/**
 * Simulation link with resolved source/target
 */
export interface SimulationLink extends Omit<GraphEdge, 'source' | 'target'> {
  source: SimulationNode;
  target: SimulationNode;
}

/**
 * Configuration options for the force simulation
 */
export interface ForceConfig {
  /** Strength of the charge force (repulsion between nodes) */
  chargeStrength: number;
  /** Distance for link force */
  linkDistance: number;
  /** Collision radius multiplier */
  collisionRadiusMultiplier: number;
  /** Alpha decay rate (how quickly simulation cools down) */
  alphaDecay: number;
  /** Velocity decay (friction) */
  velocityDecay: number;
  /** Center force strength */
  centerStrength: number;
}

/**
 * Configuration for the useGraphLayout hook
 */
export interface UseGraphLayoutOptions {
  /** Current depth level (1-5) to filter nodes */
  depthLevel: DepthLevel;
  /** SVG element width */
  width: number;
  /** SVG element height */
  height: number;
  /** Optional force configuration overrides */
  forceConfig?: Partial<ForceConfig>;
  /** Callback when node is clicked */
  onNodeClick?: (node: GraphNode) => void;
  /** Callback when node is hovered */
  onNodeHover?: (node: GraphNode | null) => void;
  /** Callback when simulation tick occurs */
  onTick?: () => void;
  /** Callback when simulation ends */
  onSimulationEnd?: () => void;
  /** Callback when viewport changes (zoom/pan) */
  onViewportChange?: (viewport: GraphViewport) => void;
  /** Initial viewport state */
  initialViewport?: GraphViewport;
  /** Whether to enable zoom/pan */
  enableZoom?: boolean;
  /** Whether to enable node dragging */
  enableDrag?: boolean;
}

/**
 * Result returned by useGraphLayout hook
 */
export interface UseGraphLayoutResult {
  /** Ref to attach to the SVG element */
  svgRef: React.RefObject<SVGSVGElement | null>;
  /** Ref to the container group for transform */
  containerRef: React.RefObject<SVGGElement | null>;
  /** Filtered nodes based on depth level */
  filteredNodes: SimulationNode[];
  /** Filtered edges based on depth level */
  filteredEdges: SimulationLink[];
  /** Current viewport state */
  viewport: GraphViewport;
  /** Whether simulation is actively running */
  isSimulating: boolean;
  /** Restart the simulation with current data */
  restartSimulation: () => void;
  /** Stop the simulation */
  stopSimulation: () => void;
  /** Reset zoom to default */
  resetZoom: () => void;
  /** Zoom to fit all nodes */
  zoomToFit: (padding?: number) => void;
  /** Center on a specific node */
  centerOnNode: (nodeId: string) => void;
  /** Get node color based on type */
  getNodeColor: (type: NodeType) => string;
  /** Get node radius based on type */
  getNodeRadius: (type: NodeType) => number;
  /** Get edge color based on type */
  getEdgeColor: (type: EdgeType) => string;
}

// ============================================
// Default Configuration
// ============================================

const DEFAULT_FORCE_CONFIG: ForceConfig = {
  chargeStrength: -300,
  linkDistance: 100,
  collisionRadiusMultiplier: 1.5,
  alphaDecay: 0.02,
  velocityDecay: 0.4,
  centerStrength: 0.1
};

// ============================================
// Hook Implementation
// ============================================

/**
 * Custom hook for D3 force simulation setup and management
 *
 * Provides a complete solution for rendering interactive force-directed graphs:
 * - Force simulation with configurable forces
 * - Zoom and pan support
 * - Node dragging
 * - Depth-level filtering
 * - Performance-optimized updates
 *
 * @param graphData - The full graph data to visualize
 * @param options - Configuration options for the layout
 */
export function useGraphLayout(
  graphData: GraphData | null,
  options: UseGraphLayoutOptions
): UseGraphLayoutResult {
  const {
    depthLevel,
    width,
    height,
    forceConfig: userForceConfig,
    onNodeClick,
    onNodeHover,
    onTick,
    onSimulationEnd,
    onViewportChange,
    initialViewport,
    enableZoom = true,
    enableDrag = true
  } = options;

  // Merge user config with defaults
  const forceConfig = useMemo(
    () => ({ ...DEFAULT_FORCE_CONFIG, ...userForceConfig }),
    [userForceConfig]
  );

  // Refs for DOM elements
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<SVGGElement>(null);

  // Refs for D3 objects (preserved across renders)
  const simulationRef = useRef<d3.Simulation<SimulationNode, SimulationLink> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // State refs (to avoid closure issues in D3 callbacks)
  const viewportRef = useRef<GraphViewport>(initialViewport || {
    zoom: 1,
    translateX: 0,
    translateY: 0
  });
  const isSimulatingRef = useRef(false);
  const filteredNodesRef = useRef<SimulationNode[]>([]);
  const filteredEdgesRef = useRef<SimulationLink[]>([]);

  // ============================================
  // Node/Edge Filtering
  // ============================================

  /**
   * Filter nodes based on current depth level
   */
  const filterNodes = useCallback(
    (nodes: GraphNode[]): SimulationNode[] => {
      return nodes
        .filter((node) => node.depth <= depthLevel)
        .map((node) => ({
          ...node,
          x: node.x ?? width / 2 + (Math.random() - 0.5) * 100,
          y: node.y ?? height / 2 + (Math.random() - 0.5) * 100
        }));
    },
    [depthLevel, width, height]
  );

  /**
   * Filter edges to only include those between visible nodes
   */
  const filterEdges = useCallback(
    (edges: GraphEdge[], nodes: SimulationNode[]): SimulationLink[] => {
      const nodeIds = new Set(nodes.map((n) => n.id));
      return edges
        .filter((edge) => {
          const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
          const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
          return nodeIds.has(sourceId) && nodeIds.has(targetId);
        })
        .map((edge) => {
          const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
          const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
          return {
            ...edge,
            source: nodes.find((n) => n.id === sourceId)!,
            target: nodes.find((n) => n.id === targetId)!
          };
        });
    },
    []
  );

  // ============================================
  // Color and Size Helpers
  // ============================================

  const getNodeColor = useCallback((type: NodeType): string => {
    return GRAPH_COLORS.nodes[type] || GRAPH_COLORS.nodes.file;
  }, []);

  const getNodeRadius = useCallback((type: NodeType): number => {
    return NODE_SIZES[type] || NODE_SIZES.file;
  }, []);

  const getEdgeColor = useCallback((type: EdgeType): string => {
    return GRAPH_COLORS.edges[type] || GRAPH_COLORS.edges.imports;
  }, []);

  // ============================================
  // Filtered Data (Memoized)
  // ============================================

  const { filteredNodes, filteredEdges } = useMemo(() => {
    if (!graphData) {
      return { filteredNodes: [], filteredEdges: [] };
    }
    const nodes = filterNodes(graphData.nodes);
    const edges = filterEdges(graphData.edges, nodes);
    filteredNodesRef.current = nodes;
    filteredEdgesRef.current = edges;
    return { filteredNodes: nodes, filteredEdges: edges };
  }, [graphData, filterNodes, filterEdges]);

  // ============================================
  // Simulation Setup
  // ============================================

  /**
   * Create and configure the force simulation
   */
  const createSimulation = useCallback(() => {
    if (filteredNodes.length === 0) return null;

    const simulation = d3
      .forceSimulation<SimulationNode>(filteredNodes)
      .force(
        'link',
        d3
          .forceLink<SimulationNode, SimulationLink>(filteredEdges)
          .id((d) => d.id)
          .distance(forceConfig.linkDistance)
      )
      .force(
        'charge',
        d3.forceManyBody<SimulationNode>().strength(forceConfig.chargeStrength)
      )
      .force(
        'center',
        d3
          .forceCenter<SimulationNode>(width / 2, height / 2)
          .strength(forceConfig.centerStrength)
      )
      .force(
        'collision',
        d3
          .forceCollide<SimulationNode>()
          .radius((d) => getNodeRadius(d.type) * forceConfig.collisionRadiusMultiplier)
      )
      .alphaDecay(forceConfig.alphaDecay)
      .velocityDecay(forceConfig.velocityDecay);

    simulation.on('tick', () => {
      isSimulatingRef.current = true;
      onTick?.();
    });

    simulation.on('end', () => {
      isSimulatingRef.current = false;
      onSimulationEnd?.();
    });

    return simulation;
  }, [
    filteredNodes,
    filteredEdges,
    width,
    height,
    forceConfig,
    getNodeRadius,
    onTick,
    onSimulationEnd
  ]);

  // ============================================
  // Drag Behavior
  // ============================================

  /**
   * Create drag behavior for nodes
   */
  const createDragBehavior = useCallback(
    (simulation: d3.Simulation<SimulationNode, SimulationLink>) => {
      function dragStarted(event: d3.D3DragEvent<SVGCircleElement, SimulationNode, SimulationNode>) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
      }

      function dragged(event: d3.D3DragEvent<SVGCircleElement, SimulationNode, SimulationNode>) {
        event.subject.fx = event.x;
        event.subject.fy = event.y;
      }

      function dragEnded(event: d3.D3DragEvent<SVGCircleElement, SimulationNode, SimulationNode>) {
        if (!event.active) simulation.alphaTarget(0);
        event.subject.fx = null;
        event.subject.fy = null;
      }

      return d3
        .drag<SVGCircleElement, SimulationNode>()
        .on('start', dragStarted)
        .on('drag', dragged)
        .on('end', dragEnded);
    },
    []
  );

  // ============================================
  // Zoom Behavior
  // ============================================

  /**
   * Create zoom behavior for the SVG
   */
  const createZoomBehavior = useCallback(() => {
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        const { x, y, k } = event.transform;
        viewportRef.current = {
          zoom: k,
          translateX: x,
          translateY: y
        };

        if (containerRef.current) {
          d3.select(containerRef.current).attr(
            'transform',
            `translate(${x},${y}) scale(${k})`
          );
        }

        onViewportChange?.(viewportRef.current);
      });

    return zoom;
  }, [onViewportChange]);

  // ============================================
  // Simulation Control Methods
  // ============================================

  const restartSimulation = useCallback(() => {
    if (simulationRef.current) {
      simulationRef.current.alpha(1).restart();
    }
  }, []);

  const stopSimulation = useCallback(() => {
    if (simulationRef.current) {
      simulationRef.current.stop();
      isSimulatingRef.current = false;
    }
  }, []);

  // ============================================
  // Zoom Control Methods
  // ============================================

  const resetZoom = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;

    d3.select(svgRef.current)
      .transition()
      .duration(750)
      .call(zoomRef.current.transform, d3.zoomIdentity);
  }, []);

  const zoomToFit = useCallback(
    (padding = 40) => {
      if (!svgRef.current || !zoomRef.current || filteredNodes.length === 0) return;

      // Calculate bounds
      const xExtent = d3.extent(filteredNodes, (d) => d.x) as [number, number];
      const yExtent = d3.extent(filteredNodes, (d) => d.y) as [number, number];

      const boundsWidth = xExtent[1] - xExtent[0];
      const boundsHeight = yExtent[1] - yExtent[0];

      const scale = Math.min(
        (width - padding * 2) / boundsWidth,
        (height - padding * 2) / boundsHeight,
        2 // Max scale
      );

      const translateX = width / 2 - (xExtent[0] + boundsWidth / 2) * scale;
      const translateY = height / 2 - (yExtent[0] + boundsHeight / 2) * scale;

      d3.select(svgRef.current)
        .transition()
        .duration(750)
        .call(
          zoomRef.current.transform,
          d3.zoomIdentity.translate(translateX, translateY).scale(scale)
        );
    },
    [filteredNodes, width, height]
  );

  const centerOnNode = useCallback(
    (nodeId: string) => {
      if (!svgRef.current || !zoomRef.current) return;

      const node = filteredNodes.find((n) => n.id === nodeId);
      if (!node) return;

      const scale = viewportRef.current.zoom;
      const translateX = width / 2 - node.x * scale;
      const translateY = height / 2 - node.y * scale;

      d3.select(svgRef.current)
        .transition()
        .duration(500)
        .call(
          zoomRef.current.transform,
          d3.zoomIdentity.translate(translateX, translateY).scale(scale)
        );
    },
    [filteredNodes, width, height]
  );

  // ============================================
  // Effect: Initialize Simulation and Zoom
  // ============================================

  useEffect(() => {
    // Clean up previous simulation
    if (simulationRef.current) {
      simulationRef.current.stop();
      simulationRef.current = null;
    }

    // Create new simulation
    const simulation = createSimulation();
    if (simulation) {
      simulationRef.current = simulation;
    }

    // Create zoom behavior
    if (svgRef.current && enableZoom) {
      const zoom = createZoomBehavior();
      zoomRef.current = zoom;
      d3.select(svgRef.current).call(zoom);

      // Apply initial viewport if provided
      if (initialViewport) {
        d3.select(svgRef.current).call(
          zoom.transform,
          d3.zoomIdentity
            .translate(initialViewport.translateX, initialViewport.translateY)
            .scale(initialViewport.zoom)
        );
      }
    }

    // Cleanup on unmount
    return () => {
      if (simulationRef.current) {
        simulationRef.current.stop();
        simulationRef.current = null;
      }
    };
  }, [createSimulation, createZoomBehavior, enableZoom, initialViewport]);

  // ============================================
  // Return Value
  // ============================================

  return {
    svgRef,
    containerRef,
    filteredNodes,
    filteredEdges,
    viewport: viewportRef.current,
    isSimulating: isSimulatingRef.current,
    restartSimulation,
    stopSimulation,
    resetZoom,
    zoomToFit,
    centerOnNode,
    getNodeColor,
    getNodeRadius,
    getEdgeColor
  };
}

/**
 * Export the drag behavior creator for use in DependencyGraph component
 */
export { DEFAULT_FORCE_CONFIG };
