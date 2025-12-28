import { useEffect, useRef, useState, useCallback, memo } from 'react';
import * as d3 from 'd3';
import { ZoomIn, ZoomOut, Maximize2, Focus, Move } from 'lucide-react';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { cn } from '../../lib/utils';
import type {
  GraphData,
  GraphNode,
  DepthLevel,
  NodeType,
  EdgeType
} from '../../../shared/types/explorer';
import {
  useGraphLayout,
  type SimulationNode,
  type SimulationLink
} from './hooks/useGraphLayout';

// ============================================
// Types
// ============================================

interface DependencyGraphProps {
  /** The graph data to render */
  graph: GraphData | null;
  /** Current depth level (1-5) */
  depthLevel: DepthLevel;
  /** Currently selected node ID */
  selectedNodeId?: string | null;
  /** Callback when a node is selected */
  onSelectNode?: (node: GraphNode | null) => void;
  /** Callback when a node is hovered */
  onHoverNode?: (node: GraphNode | null) => void;
  /** Additional CSS classes */
  className?: string;
}

interface NodeTooltipData {
  node: GraphNode;
  x: number;
  y: number;
}

// ============================================
// Constants
// ============================================

const TOOLTIP_OFFSET = 10;
const LINK_OPACITY = 0.6;
const LINK_WIDTH_BY_TYPE: Record<EdgeType, number> = {
  imports: 2,
  calls: 1.5,
  inherits: 2.5,
  contains: 1
};

// Edge styles for different relationship types
const EDGE_DASHARRAY: Record<EdgeType, string> = {
  imports: 'none',
  calls: 'none',
  inherits: '5,3',
  contains: '2,2'
};

// ============================================
// Helper Functions
// ============================================

/**
 * Get a readable label for the node type
 */
function getNodeTypeLabel(type: NodeType): string {
  const labels: Record<NodeType, string> = {
    directory: 'Directory',
    file: 'File',
    class: 'Class',
    function: 'Function',
    symbol: 'Symbol'
  };
  return labels[type] || type;
}

/**
 * Format LOC for display
 */
function formatLoc(loc: number | undefined): string {
  if (loc === undefined) return 'N/A';
  return loc.toLocaleString() + ' lines';
}

// ============================================
// Sub-Components
// ============================================

/**
 * Toolbar with zoom and navigation controls
 */
interface GraphToolbarProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToScreen: () => void;
  onResetZoom: () => void;
}

const GraphToolbar = memo(function GraphToolbar({
  onZoomIn,
  onZoomOut,
  onFitToScreen,
  onResetZoom
}: GraphToolbarProps) {
  return (
    <div className="absolute top-3 right-3 flex flex-col gap-1 z-10">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            size="icon"
            className="h-8 w-8"
            onClick={onZoomIn}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">Zoom In</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            size="icon"
            className="h-8 w-8"
            onClick={onZoomOut}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">Zoom Out</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            size="icon"
            className="h-8 w-8"
            onClick={onFitToScreen}
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">Fit to Screen</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            size="icon"
            className="h-8 w-8"
            onClick={onResetZoom}
          >
            <Focus className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">Reset View</TooltipContent>
      </Tooltip>
    </div>
  );
});

/**
 * Tooltip component for node hover state
 */
interface NodeTooltipProps {
  data: NodeTooltipData | null;
}

const NodeTooltip = memo(function NodeTooltip({ data }: NodeTooltipProps) {
  if (!data) return null;

  return (
    <div
      className="absolute z-20 px-3 py-2 bg-popover border border-border rounded-lg shadow-lg pointer-events-none"
      style={{
        left: data.x + TOOLTIP_OFFSET,
        top: data.y + TOOLTIP_OFFSET,
        maxWidth: 280
      }}
    >
      <div className="font-medium text-sm truncate">{data.node.name}</div>
      <div className="text-xs text-muted-foreground mt-1">
        <span className="font-medium">{getNodeTypeLabel(data.node.type)}</span>
        {data.node.metadata.loc !== undefined && (
          <span className="ml-2">{formatLoc(data.node.metadata.loc)}</span>
        )}
      </div>
      {data.node.filePath && (
        <div className="text-xs text-muted-foreground mt-0.5 font-mono truncate">
          {data.node.filePath}
        </div>
      )}
    </div>
  );
});

/**
 * Empty state component when no graph data
 */
const EmptyGraphState = memo(function EmptyGraphState() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="text-center text-muted-foreground">
        <Move className="h-12 w-12 mx-auto mb-3 opacity-50" />
        <p className="text-sm">No graph data to display</p>
        <p className="text-xs mt-1">Parse a project to visualize dependencies</p>
      </div>
    </div>
  );
});

// ============================================
// Main Component
// ============================================

/**
 * DependencyGraph - Interactive force-directed graph visualization
 *
 * Renders a D3.js force-directed graph with:
 * - SVG-based rendering
 * - Zoom and pan support
 * - Node selection and hover
 * - Color-coded nodes and edges
 * - Depth-level filtering
 */
export function DependencyGraph({
  graph,
  depthLevel,
  selectedNodeId,
  onSelectNode,
  onHoverNode,
  className
}: DependencyGraphProps) {
  // Container ref for measuring dimensions
  const containerRef = useRef<HTMLDivElement>(null);

  // State for dimensions
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // State for hover tooltip
  const [tooltipData, setTooltipData] = useState<NodeTooltipData | null>(null);

  // Use the graph layout hook
  const {
    svgRef,
    containerRef: graphContainerRef,
    filteredNodes,
    filteredEdges,
    resetZoom,
    zoomToFit,
    getNodeColor,
    getNodeRadius,
    getEdgeColor
  } = useGraphLayout(graph, {
    depthLevel,
    width: dimensions.width,
    height: dimensions.height,
    onNodeClick: (node) => onSelectNode?.(node),
    onNodeHover: (node) => {
      onHoverNode?.(node);
      if (!node) {
        setTooltipData(null);
      }
    },
    enableZoom: true,
    enableDrag: true
  });

  // ============================================
  // Effects
  // ============================================

  // Measure container dimensions
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        setDimensions({ width, height });
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => resizeObserver.disconnect();
  }, []);

  // Render graph with D3
  useEffect(() => {
    if (!svgRef.current || !graphContainerRef.current) return;
    if (filteredNodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    const container = d3.select(graphContainerRef.current);

    // Clear previous content
    container.selectAll('*').remove();

    // Create arrow markers for directed edges
    const defs = svg.select('defs');
    if (defs.empty()) {
      const newDefs = svg.append('defs');

      // Create markers for each edge type
      (['imports', 'calls', 'inherits', 'contains'] as EdgeType[]).forEach((type) => {
        newDefs
          .append('marker')
          .attr('id', `arrow-${type}`)
          .attr('viewBox', '0 -5 10 10')
          .attr('refX', 20)
          .attr('refY', 0)
          .attr('markerWidth', 6)
          .attr('markerHeight', 6)
          .attr('orient', 'auto')
          .append('path')
          .attr('d', 'M0,-5L10,0L0,5')
          .attr('fill', getEdgeColor(type));
      });
    }

    // Create edges group (rendered first, below nodes)
    const linksGroup = container.append('g').attr('class', 'links');

    // Render edges
    const links = linksGroup
      .selectAll<SVGLineElement, SimulationLink>('line')
      .data(filteredEdges)
      .join('line')
      .attr('class', 'link')
      .attr('stroke', (d) => getEdgeColor(d.type))
      .attr('stroke-width', (d) => LINK_WIDTH_BY_TYPE[d.type] || 1)
      .attr('stroke-opacity', LINK_OPACITY)
      .attr('stroke-dasharray', (d) => EDGE_DASHARRAY[d.type])
      .attr('marker-end', (d) => `url(#arrow-${d.type})`)
      .attr('x1', (d) => d.source.x)
      .attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x)
      .attr('y2', (d) => d.target.y);

    // Create nodes group
    const nodesGroup = container.append('g').attr('class', 'nodes');

    // Render nodes
    const nodes = nodesGroup
      .selectAll<SVGGElement, SimulationNode>('g')
      .data(filteredNodes)
      .join('g')
      .attr('class', 'node')
      .attr('transform', (d) => `translate(${d.x},${d.y})`)
      .style('cursor', 'pointer');

    // Add circles for nodes
    nodes
      .append('circle')
      .attr('r', (d) => getNodeRadius(d.type))
      .attr('fill', (d) => {
        if (selectedNodeId === d.id) {
          return '#ef4444'; // Selected node color (red)
        }
        return getNodeColor(d.type);
      })
      .attr('stroke', (d) => {
        if (selectedNodeId === d.id) {
          return '#dc2626';
        }
        return d3.color(getNodeColor(d.type))?.darker(0.5)?.toString() || '#000';
      })
      .attr('stroke-width', (d) => (selectedNodeId === d.id ? 3 : 1.5));

    // Add labels for nodes (only for larger nodes or at closer zoom)
    nodes
      .append('text')
      .attr('class', 'node-label')
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => getNodeRadius(d.type) + 12)
      .attr('font-size', '10px')
      .attr('fill', 'currentColor')
      .attr('opacity', 0.7)
      .text((d) => {
        // Truncate long names
        const maxLength = 15;
        if (d.name.length > maxLength) {
          return d.name.slice(0, maxLength - 1) + '...';
        }
        return d.name;
      });

    // Add interaction handlers
    nodes
      .on('click', (event: MouseEvent, d) => {
        event.stopPropagation();
        onSelectNode?.(d);
      })
      .on('mouseenter', (event: MouseEvent, d) => {
        // Get position relative to container
        const containerBounds = containerRef.current?.getBoundingClientRect();
        if (containerBounds) {
          setTooltipData({
            node: d,
            x: event.clientX - containerBounds.left,
            y: event.clientY - containerBounds.top
          });
        }
        onHoverNode?.(d);
      })
      .on('mousemove', (event: MouseEvent, d) => {
        const containerBounds = containerRef.current?.getBoundingClientRect();
        if (containerBounds) {
          setTooltipData({
            node: d,
            x: event.clientX - containerBounds.left,
            y: event.clientY - containerBounds.top
          });
        }
      })
      .on('mouseleave', () => {
        setTooltipData(null);
        onHoverNode?.(null);
      });

    // Setup drag behavior
    const drag = d3
      .drag<SVGGElement, SimulationNode>()
      .on('start', (event, d) => {
        if (!event.active) {
          // Restart simulation on drag
        }
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
        // Update position immediately
        d3.select(event.sourceEvent.target.parentNode as SVGGElement)
          .attr('transform', `translate(${event.x},${event.y})`);
        // Update connected edges
        links
          .filter((l) => l.source.id === d.id || l.target.id === d.id)
          .attr('x1', (l) => l.source.x)
          .attr('y1', (l) => l.source.y)
          .attr('x2', (l) => l.target.x)
          .attr('y2', (l) => l.target.y);
      })
      .on('end', (_event, d) => {
        d.fx = null;
        d.fy = null;
      });

    nodes.call(drag);

    // Click on SVG background to deselect
    svg.on('click', () => {
      onSelectNode?.(null);
    });

  }, [
    filteredNodes,
    filteredEdges,
    selectedNodeId,
    svgRef,
    graphContainerRef,
    getNodeColor,
    getNodeRadius,
    getEdgeColor,
    onSelectNode,
    onHoverNode
  ]);

  // Update positions on simulation tick
  useEffect(() => {
    if (!graphContainerRef.current) return;

    const container = d3.select(graphContainerRef.current);

    // Update node positions
    container
      .selectAll<SVGGElement, SimulationNode>('.node')
      .attr('transform', (d) => `translate(${d.x},${d.y})`);

    // Update edge positions
    container
      .selectAll<SVGLineElement, SimulationLink>('.link')
      .attr('x1', (d) => d.source.x)
      .attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x)
      .attr('y2', (d) => d.target.y);
  }, [filteredNodes, filteredEdges, graphContainerRef]);

  // ============================================
  // Handlers
  // ============================================

  const handleZoomIn = useCallback(() => {
    if (!svgRef.current) return;
    d3.select(svgRef.current)
      .transition()
      .duration(300)
      .call(
        d3.zoom<SVGSVGElement, unknown>().scaleBy as any,
        1.3
      );
  }, [svgRef]);

  const handleZoomOut = useCallback(() => {
    if (!svgRef.current) return;
    d3.select(svgRef.current)
      .transition()
      .duration(300)
      .call(
        d3.zoom<SVGSVGElement, unknown>().scaleBy as any,
        0.7
      );
  }, [svgRef]);

  const handleFitToScreen = useCallback(() => {
    zoomToFit(50);
  }, [zoomToFit]);

  const handleResetZoom = useCallback(() => {
    resetZoom();
  }, [resetZoom]);

  // ============================================
  // Render
  // ============================================

  const isEmpty = !graph || filteredNodes.length === 0;

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative w-full h-full bg-background/50 rounded-lg overflow-hidden',
        className
      )}
    >
      {isEmpty ? (
        <EmptyGraphState />
      ) : (
        <>
          {/* SVG Graph */}
          <svg
            ref={svgRef}
            width={dimensions.width}
            height={dimensions.height}
            className="w-full h-full"
          >
            <defs>
              {/* Arrow markers defined in useEffect */}
            </defs>
            <g ref={graphContainerRef} />
          </svg>

          {/* Toolbar */}
          <GraphToolbar
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onFitToScreen={handleFitToScreen}
            onResetZoom={handleResetZoom}
          />

          {/* Node Tooltip */}
          <NodeTooltip data={tooltipData} />

          {/* Stats overlay */}
          <div className="absolute bottom-3 left-3 px-2 py-1 bg-background/80 border border-border rounded text-xs text-muted-foreground">
            {filteredNodes.length} nodes &middot; {filteredEdges.length} edges
          </div>
        </>
      )}
    </div>
  );
}

export default DependencyGraph;
