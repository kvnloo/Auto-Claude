import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { AlertCircle, Network } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import type { DependencyNode, DependencyEdge, DependencyGraph } from '../../../shared/types/project';

// ============================================
// TypeScript Types
// ============================================

interface DependencyGraphVisualizationProps {
  data: DependencyGraph | null;
  isLoading?: boolean;
  error?: string | null;
  onReset?: () => void;
}

// D3 simulation types
interface SimulationNode extends DependencyNode, d3.SimulationNodeDatum {
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface SimulationLink extends d3.SimulationLinkDatum<SimulationNode> {
  source: SimulationNode | string;
  target: SimulationNode | string;
  type?: string;
}

// ============================================
// Component
// ============================================

export function DependencyGraphVisualization({
  data,
  isLoading = false,
  error = null,
  onReset
}: DependencyGraphVisualizationProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [selectedNode, setSelectedNode] = useState<DependencyNode | null>(null);

  // Update dimensions on resize
  useEffect(() => {
    if (!containerRef.current) return;

    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: rect.width || 800,
          height: rect.height || 600
        });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Render D3 force-directed graph
  useEffect(() => {
    if (!svgRef.current || !data || isLoading || error) return;
    if (!data.nodes || data.nodes.length === 0) return;

    const { width, height } = dimensions;
    const svg = d3.select(svgRef.current);

    // Clear previous content
    svg.selectAll('*').remove();

    // Create container group for zoom/pan
    const g = svg.append('g');

    // Setup zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Clone data to avoid mutating props
    const nodes: SimulationNode[] = data.nodes.map(d => ({ ...d }));
    const links: SimulationLink[] = data.edges.map(d => ({
      source: d.source,
      target: d.target,
      type: d.type
    }));

    // Create force simulation
    const simulation = d3.forceSimulation<SimulationNode>(nodes)
      .force('link', d3.forceLink<SimulationNode, SimulationLink>(links)
        .id(d => d.id)
        .distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(30));

    // Color scale for node types
    const colorScale = d3.scaleOrdinal<string>()
      .domain(['direct', 'dev', 'peer', 'optional'])
      .range(['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b']);

    // Create arrow markers for directed edges
    svg.append('defs').selectAll('marker')
      .data(['end'])
      .enter().append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#64748b');

    // Create links
    const link = g.append('g')
      .selectAll('line')
      .data(links)
      .enter().append('line')
      .attr('stroke', '#64748b')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', 1.5)
      .attr('marker-end', 'url(#arrow)');

    // Create nodes
    const node = g.append('g')
      .selectAll('g')
      .data(nodes)
      .enter().append('g')
      .call(d3.drag<SVGGElement, SimulationNode>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }));

    // Add circles to nodes
    node.append('circle')
      .attr('r', 8)
      .attr('fill', d => colorScale(d.type))
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        event.stopPropagation();
        setSelectedNode(d);
      })
      .on('mouseover', function() {
        d3.select(this)
          .transition()
          .duration(200)
          .attr('r', 12);
      })
      .on('mouseout', function() {
        d3.select(this)
          .transition()
          .duration(200)
          .attr('r', 8);
      });

    // Add labels to nodes
    node.append('text')
      .text(d => d.name)
      .attr('x', 12)
      .attr('y', 3)
      .attr('font-size', '10px')
      .attr('fill', 'currentColor')
      .style('pointer-events', 'none');

    // Update positions on simulation tick
    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as SimulationNode).x || 0)
        .attr('y1', d => (d.source as SimulationNode).y || 0)
        .attr('x2', d => (d.target as SimulationNode).x || 0)
        .attr('y2', d => (d.target as SimulationNode).y || 0);

      node.attr('transform', d => `translate(${d.x || 0},${d.y || 0})`);
    });

    // Reset zoom on double-click
    svg.on('dblclick.zoom', () => {
      svg.transition()
        .duration(750)
        .call(zoom.transform, d3.zoomIdentity);
    });

    // Cleanup
    return () => {
      simulation.stop();
    };
  }, [data, dimensions, isLoading, error]);

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <Card className="max-w-md">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 text-destructive">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <div>
                <p className="font-medium">Failed to load dependency graph</p>
                <p className="text-sm opacity-80 mt-1">{error}</p>
              </div>
            </div>
            {onReset && (
              <Button onClick={onReset} variant="outline" className="mt-4 w-full">
                Try Again
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Empty state
  if (!data || !data.nodes || data.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <Network className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium text-foreground">No Dependencies Found</h3>
        <p className="text-sm text-muted-foreground mt-2 max-w-sm">
          This project doesn't have any detected dependencies or the dependency files couldn't be parsed.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full flex flex-col">
      {/* Header with controls */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Network className="h-5 w-5 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {data.projectName ? `${data.projectName} Dependencies` : 'Dependency Graph'}
            </h3>
            <p className="text-xs text-muted-foreground">
              {data.nodes.length} package{data.nodes.length !== 1 ? 's' : ''}, {data.edges.length} relationship{data.edges.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1.5">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-xs">Direct</span>
          </Badge>
          <Badge variant="outline" className="gap-1.5">
            <div className="w-2 h-2 rounded-full bg-purple-500" />
            <span className="text-xs">Dev</span>
          </Badge>
          <Badge variant="outline" className="gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-xs">Peer</span>
          </Badge>
          <Badge variant="outline" className="gap-1.5">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-xs">Optional</span>
          </Badge>
        </div>
      </div>

      {/* Graph container */}
      <div ref={containerRef} className="flex-1 relative bg-muted/20">
        <svg
          ref={svgRef}
          width={dimensions.width}
          height={dimensions.height}
          className="w-full h-full"
        />

        {/* Instructions overlay */}
        <div className="absolute bottom-4 left-4 bg-background/90 backdrop-blur-sm border border-border rounded-lg p-3 text-xs text-muted-foreground max-w-xs">
          <p className="font-semibold mb-1">Controls:</p>
          <ul className="space-y-1">
            <li>• <span className="font-medium">Drag</span> nodes to reposition</li>
            <li>• <span className="font-medium">Scroll</span> to zoom in/out</li>
            <li>• <span className="font-medium">Double-click</span> to reset view</li>
            <li>• <span className="font-medium">Click</span> node for details</li>
          </ul>
        </div>

        {/* Selected node info */}
        {selectedNode && (
          <div className="absolute top-4 right-4 bg-background border border-border rounded-lg p-4 shadow-lg max-w-xs">
            <div className="flex items-start justify-between mb-2">
              <h4 className="font-semibold text-foreground">{selectedNode.name}</h4>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setSelectedNode(null)}
              >
                ×
              </Button>
            </div>
            {selectedNode.version && (
              <p className="text-sm text-muted-foreground mb-2">
                Version: <span className="font-mono">{selectedNode.version}</span>
              </p>
            )}
            <Badge
              variant="outline"
              className={cn(
                'capitalize',
                selectedNode.type === 'direct' && 'bg-blue-500/10 text-blue-500 border-blue-500/30',
                selectedNode.type === 'dev' && 'bg-purple-500/10 text-purple-500 border-purple-500/30',
                selectedNode.type === 'peer' && 'bg-green-500/10 text-green-500 border-green-500/30',
                selectedNode.type === 'optional' && 'bg-amber-500/10 text-amber-500 border-amber-500/30'
              )}
            >
              {selectedNode.type}
            </Badge>
          </div>
        )}
      </div>
    </div>
  );
}
