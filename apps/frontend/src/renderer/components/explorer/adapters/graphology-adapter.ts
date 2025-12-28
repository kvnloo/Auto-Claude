/**
 * Graphology Adapter
 *
 * Converts the explorer's GraphData format to graphology graph format
 * for use with Sigma.js rendering.
 */

import Graph from 'graphology';
import type { GraphData, GraphNode, GraphEdge } from '../../../../shared/types/explorer';
import type {
  GraphologyNodeAttributes,
  GraphologyEdgeAttributes,
  GraphologyAdapterOptions,
  GraphologyConversionResult,
  ExplorerGraph,
} from '../../../../shared/types/graphology';
import {
  NODE_COLORS,
  NODE_SIZES,
  EDGE_COLORS,
  EDGE_SIZES,
} from '../design-tokens';

// ============================================
// Default Options
// ============================================

const DEFAULT_OPTIONS: GraphologyAdapterOptions = {
  randomizePositions: true,
  width: 1000,
  height: 1000,
  applyColors: true,
  applySizes: true,
};

// ============================================
// Main Adapter Function
// ============================================

/**
 * Convert GraphData to a graphology graph for Sigma.js
 *
 * @param graphData - The explorer's graph data format
 * @param options - Conversion options
 * @returns Converted graphology graph with metadata
 */
export function convertToGraphology(
  graphData: GraphData,
  options: Partial<GraphologyAdapterOptions> = {}
): GraphologyConversionResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const warnings: string[] = [];

  // Create a new directed graph
  const graph = new Graph<
    GraphologyNodeAttributes,
    GraphologyEdgeAttributes
  >({
    type: 'directed',
    multi: false,
    allowSelfLoops: false,
  }) as ExplorerGraph;

  // Set graph attributes
  graph.setAttribute('name', 'Codebase Dependency Graph');
  graph.setAttribute('generatedAt', graphData.generatedAt);
  graph.setAttribute('rootPath', graphData.rootPath);

  // Track added nodes for edge validation
  const nodeIds = new Set<string>();

  // Add nodes
  for (const node of graphData.nodes) {
    try {
      const attrs = convertNodeToAttributes(node, opts);
      graph.addNode(node.id, attrs);
      nodeIds.add(node.id);
    } catch (error) {
      warnings.push(`Failed to add node ${node.id}: ${error}`);
    }
  }

  // Add edges
  let edgeCount = 0;
  for (const edge of graphData.edges) {
    const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
    const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;

    // Validate source and target exist
    if (!nodeIds.has(sourceId)) {
      warnings.push(`Edge source not found: ${sourceId}`);
      continue;
    }
    if (!nodeIds.has(targetId)) {
      warnings.push(`Edge target not found: ${targetId}`);
      continue;
    }

    // Skip self-loops
    if (sourceId === targetId) {
      continue;
    }

    try {
      const attrs = convertEdgeToAttributes(edge, opts);
      const edgeKey = `${sourceId}->${targetId}`;

      // Check for duplicate edges
      if (!graph.hasEdge(edgeKey)) {
        graph.addEdgeWithKey(edgeKey, sourceId, targetId, attrs);
        edgeCount++;
      }
    } catch (error) {
      warnings.push(`Failed to add edge ${sourceId} -> ${targetId}: ${error}`);
    }
  }

  return {
    graph,
    nodeCount: graph.order,
    edgeCount,
    warnings,
  };
}

// ============================================
// Node Conversion
// ============================================

/**
 * Convert a GraphNode to graphology node attributes
 */
function convertNodeToAttributes(
  node: GraphNode,
  options: GraphologyAdapterOptions
): GraphologyNodeAttributes {
  // Calculate initial position
  let x = node.x ?? 0;
  let y = node.y ?? 0;

  if (options.randomizePositions && (x === 0 && y === 0)) {
    // Random position within bounds, clustered by depth
    const depthOffset = (node.depth - 1) * 100;
    x = (Math.random() - 0.5) * (options.width! - depthOffset) + options.width! / 2;
    y = (Math.random() - 0.5) * (options.height! - depthOffset) + options.height! / 2;
  }

  // Get color and size from design tokens
  const color = options.applyColors
    ? NODE_COLORS[node.type] || NODE_COLORS.file
    : '#666666';

  const size = options.applySizes
    ? NODE_SIZES[node.type] || NODE_SIZES.file
    : 6;

  return {
    // Display properties
    label: node.name,
    type: node.type,
    depth: node.depth,
    x,
    y,
    size,
    color,

    // State (initially all false)
    hidden: false,
    highlighted: false,
    selected: false,

    // Metadata from original node
    filePath: node.filePath,
    loc: node.metadata?.loc,
    complexity: node.metadata?.complexity,
    parentClass: node.metadata?.parentClass,
    signature: node.metadata?.signature,
    docstring: node.metadata?.docstring,
    exports: node.metadata?.exports,
  };
}

// ============================================
// Edge Conversion
// ============================================

/**
 * Convert a GraphEdge to graphology edge attributes
 */
function convertEdgeToAttributes(
  edge: GraphEdge,
  options: GraphologyAdapterOptions
): GraphologyEdgeAttributes {
  const color = options.applyColors
    ? EDGE_COLORS[edge.type] || EDGE_COLORS.imports
    : 'rgba(128, 128, 128, 0.5)';

  const size = EDGE_SIZES[edge.type] || EDGE_SIZES.imports;

  return {
    type: edge.type,
    weight: edge.weight ?? 1,
    color,
    size,
    hidden: false,
    highlighted: false,
  };
}

// ============================================
// Update Functions
// ============================================

/**
 * Update node visibility based on depth level
 *
 * @param graph - The graphology graph
 * @param maxDepth - Maximum depth to show (1-5)
 */
export function filterByDepth(graph: ExplorerGraph, maxDepth: number): void {
  const visibleNodes = new Set<string>();

  // First pass: determine which nodes are visible
  graph.forEachNode((nodeId, attrs) => {
    const isVisible = attrs.depth <= maxDepth;
    visibleNodes.add(nodeId);
    graph.setNodeAttribute(nodeId, 'hidden', !isVisible);
  });

  // Second pass: hide edges to/from hidden nodes
  graph.forEachEdge((edgeId, _attrs, source, target) => {
    const sourceHidden = graph.getNodeAttribute(source, 'hidden');
    const targetHidden = graph.getNodeAttribute(target, 'hidden');
    graph.setEdgeAttribute(edgeId, 'hidden', sourceHidden || targetHidden);
  });
}

/**
 * Highlight a node and its connected edges
 *
 * @param graph - The graphology graph
 * @param nodeId - Node to highlight (null to clear)
 */
export function highlightNode(graph: ExplorerGraph, nodeId: string | null): void {
  // Clear all highlights first
  graph.forEachNode((id) => {
    graph.setNodeAttribute(id, 'highlighted', false);
  });
  graph.forEachEdge((id) => {
    graph.setEdgeAttribute(id, 'highlighted', false);
  });

  if (!nodeId || !graph.hasNode(nodeId)) {
    return;
  }

  // Highlight the node
  graph.setNodeAttribute(nodeId, 'highlighted', true);

  // Highlight connected edges and neighbors
  graph.forEachEdge(nodeId, (edgeId, _attrs, source, target) => {
    graph.setEdgeAttribute(edgeId, 'highlighted', true);
    const neighborId = source === nodeId ? target : source;
    graph.setNodeAttribute(neighborId, 'highlighted', true);
  });
}

/**
 * Select a node (different from highlight - persists)
 *
 * @param graph - The graphology graph
 * @param nodeId - Node to select (null to clear)
 */
export function selectNode(graph: ExplorerGraph, nodeId: string | null): void {
  // Clear previous selection
  graph.forEachNode((id) => {
    graph.setNodeAttribute(id, 'selected', false);
  });

  if (nodeId && graph.hasNode(nodeId)) {
    graph.setNodeAttribute(nodeId, 'selected', true);
  }
}

/**
 * Apply node positions from layout algorithm
 *
 * @param graph - The graphology graph
 * @param positions - Map of node ID to { x, y } positions
 */
export function applyPositions(
  graph: ExplorerGraph,
  positions: Record<string, { x: number; y: number }>
): void {
  for (const [nodeId, pos] of Object.entries(positions)) {
    if (graph.hasNode(nodeId)) {
      graph.setNodeAttribute(nodeId, 'x', pos.x);
      graph.setNodeAttribute(nodeId, 'y', pos.y);
    }
  }
}

/**
 * Get graph statistics
 */
export function getGraphStats(graph: ExplorerGraph): {
  nodeCount: number;
  edgeCount: number;
  visibleNodes: number;
  visibleEdges: number;
  nodesByType: Record<string, number>;
  edgesByType: Record<string, number>;
} {
  const nodesByType: Record<string, number> = {};
  const edgesByType: Record<string, number> = {};
  let visibleNodes = 0;
  let visibleEdges = 0;

  graph.forEachNode((_, attrs) => {
    const type = attrs.type;
    nodesByType[type] = (nodesByType[type] || 0) + 1;
    if (!attrs.hidden) visibleNodes++;
  });

  graph.forEachEdge((_, attrs) => {
    const type = attrs.type;
    edgesByType[type] = (edgesByType[type] || 0) + 1;
    if (!attrs.hidden) visibleEdges++;
  });

  return {
    nodeCount: graph.order,
    edgeCount: graph.size,
    visibleNodes,
    visibleEdges,
    nodesByType,
    edgesByType,
  };
}

/**
 * Export graph back to GraphData format
 * (useful for caching or serialization)
 */
export function exportToGraphData(graph: ExplorerGraph): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  graph.forEachNode((id, attrs) => {
    nodes.push({
      id,
      name: attrs.label,
      type: attrs.type,
      depth: attrs.depth,
      filePath: attrs.filePath,
      x: attrs.x,
      y: attrs.y,
      metadata: {
        loc: attrs.loc,
        complexity: attrs.complexity,
        parentClass: attrs.parentClass,
        signature: attrs.signature,
        docstring: attrs.docstring,
        exports: attrs.exports,
      },
    });
  });

  graph.forEachEdge((_, attrs, source, target) => {
    edges.push({
      id: `${source}->${target}`,
      source,
      target,
      type: attrs.type,
      weight: attrs.weight,
    });
  });

  return {
    nodes,
    edges,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      fileCount: nodes.filter((n) => n.type === 'file').length,
      directoryCount: nodes.filter((n) => n.type === 'directory').length,
      parseDurationMs: 0,
    },
    generatedAt: graph.getAttribute('generatedAt') || new Date().toISOString(),
    rootPath: graph.getAttribute('rootPath') || '',
  };
}
