/**
 * Graphology Type Definitions for Explorer
 *
 * Type definitions for integrating graphology graph library
 * with the CodebaseExplorer's existing type system.
 */

import type { NodeType, EdgeType, DepthLevel } from './explorer';

// ============================================
// Node Attributes
// ============================================

/**
 * Attributes stored on each node in the graphology graph
 */
export interface GraphologyNodeAttributes {
  /** Display label */
  label: string;
  /** Node type for styling */
  type: NodeType;
  /** Depth level (1-5) for filtering */
  depth: DepthLevel;
  /** X position (set by layout) */
  x: number;
  /** Y position (set by layout) */
  y: number;
  /** Node size (radius) */
  size: number;
  /** Node color (hex or rgb) */
  color: string;
  /** Whether node is hidden */
  hidden?: boolean;
  /** Whether node is highlighted */
  highlighted?: boolean;
  /** Whether node is selected */
  selected?: boolean;
  /** Original file path */
  filePath?: string;
  /** Lines of code */
  loc?: number;
  /** Complexity rating */
  complexity?: 'low' | 'medium' | 'high';
  /** Parent class name (for methods) */
  parentClass?: string;
  /** Function signature */
  signature?: string;
  /** Docstring/JSDoc */
  docstring?: string;
  /** Whether symbol is exported */
  exports?: boolean;
  /** Forceatlas2 fixed position */
  fx?: number | null;
  fy?: number | null;
}

// ============================================
// Edge Attributes
// ============================================

/**
 * Attributes stored on each edge in the graphology graph
 */
export interface GraphologyEdgeAttributes {
  /** Edge type for styling */
  type: EdgeType;
  /** Edge weight (affects layout) */
  weight?: number;
  /** Edge color (hex or rgb) */
  color?: string;
  /** Edge size (thickness) */
  size?: number;
  /** Whether edge is hidden */
  hidden?: boolean;
  /** Whether edge is highlighted */
  highlighted?: boolean;
  /** Edge label (optional) */
  label?: string;
}

// ============================================
// Graph Types
// ============================================

/**
 * Graph-level attributes
 */
export interface GraphologyGraphAttributes {
  /** Graph name/title */
  name?: string;
  /** When the graph was generated */
  generatedAt?: string;
  /** Root directory path */
  rootPath?: string;
}

/**
 * Typed graphology graph for the explorer
 */
export type ExplorerGraph = import('graphology').default<
  GraphologyNodeAttributes,
  GraphologyEdgeAttributes,
  GraphologyGraphAttributes
>;

// ============================================
// Layout Types
// ============================================

/**
 * ForceAtlas2 layout settings
 */
export interface ForceAtlas2Settings {
  /** Number of iterations to run */
  iterations?: number;
  /** Gravity strength (pulls nodes to center) */
  gravity?: number;
  /** Scaling ratio for the layout */
  scalingRatio?: number;
  /** Use Barnes-Hut optimization (O(n log n)) */
  barnesHutOptimize?: boolean;
  /** Barnes-Hut theta parameter */
  barnesHutTheta?: number;
  /** Strong gravity mode */
  strongGravityMode?: boolean;
  /** Slow down factor */
  slowDown?: number;
  /** Outbound attraction distribution */
  outboundAttractionDistribution?: boolean;
  /** LinLog mode */
  linLogMode?: boolean;
  /** Adjust sizes (prevent overlap) */
  adjustSizes?: boolean;
  /** Edge weight influence */
  edgeWeightInfluence?: number;
}

/**
 * Noverlap layout settings (prevent node overlap)
 */
export interface NoverlapSettings {
  /** Maximum iterations */
  maxIterations?: number;
  /** Node margin */
  margin?: number;
  /** Expansion ratio */
  ratio?: number;
  /** Speed factor */
  speed?: number;
}

/**
 * Layout algorithm options
 */
export type LayoutAlgorithm = 'forceAtlas2' | 'noverlap' | 'circular' | 'random';

/**
 * Layout worker message types
 */
export interface LayoutWorkerMessage {
  type: 'start' | 'stop' | 'update-settings';
  nodes?: Array<{ id: string; x: number; y: number }>;
  edges?: Array<{ source: string; target: string; weight?: number }>;
  settings?: ForceAtlas2Settings;
}

/**
 * Layout worker response types
 */
export interface LayoutWorkerResponse {
  type: 'positions' | 'progress' | 'complete' | 'error';
  positions?: Record<string, { x: number; y: number }>;
  progress?: number;
  error?: string;
}

// ============================================
// Sigma.js Types
// ============================================

/**
 * Sigma.js camera state
 */
export interface SigmaCameraState {
  x: number;
  y: number;
  ratio: number;
  angle: number;
}

/**
 * Sigma.js renderer settings
 */
export interface SigmaSettings {
  /** Hide edges when moving camera */
  hideEdgesOnMove?: boolean;
  /** Hide labels when moving camera */
  hideLabelsOnMove?: boolean;
  /** Render edge labels */
  renderEdgeLabels?: boolean;
  /** Label rendered size threshold */
  labelRenderedSizeThreshold?: number;
  /** Default node color */
  defaultNodeColor?: string;
  /** Default edge color */
  defaultEdgeColor?: string;
  /** Default node type (for node program) */
  defaultNodeType?: string;
  /** Default edge type (for edge program) */
  defaultEdgeType?: string;
  /** Enable edge events (hover/click) */
  enableEdgeEvents?: boolean;
  /** Label font */
  labelFont?: string;
  /** Label size */
  labelSize?: number;
  /** Label weight */
  labelWeight?: string;
  /** Label color */
  labelColor?: { color: string };
  /** Edge label font */
  edgeLabelFont?: string;
  /** Edge label size */
  edgeLabelSize?: number;
  /** Z-index for nodes */
  zIndex?: boolean;
  /** Min camera ratio (zoom out limit) */
  minCameraRatio?: number;
  /** Max camera ratio (zoom in limit) */
  maxCameraRatio?: number;
}

/**
 * Node display data (returned by reducers)
 */
export interface NodeDisplayData {
  x: number;
  y: number;
  size: number;
  color: string;
  label?: string;
  hidden?: boolean;
  highlighted?: boolean;
  forceLabel?: boolean;
  type?: string;
  zIndex?: number;
}

/**
 * Edge display data (returned by reducers)
 */
export interface EdgeDisplayData {
  size?: number;
  color?: string;
  label?: string;
  hidden?: boolean;
  type?: string;
  zIndex?: number;
}

// ============================================
// Event Types
// ============================================

/**
 * Node event payload
 */
export interface NodeEventPayload {
  node: string;
  event: MouseEvent;
}

/**
 * Edge event payload
 */
export interface EdgeEventPayload {
  edge: string;
  event: MouseEvent;
}

/**
 * Stage event payload (click on background)
 */
export interface StageEventPayload {
  event: MouseEvent;
}

// ============================================
// Adapter Types
// ============================================

/**
 * Options for converting GraphData to graphology
 */
export interface GraphologyAdapterOptions {
  /** Apply initial random positions */
  randomizePositions?: boolean;
  /** Width for random positions */
  width?: number;
  /** Height for random positions */
  height?: number;
  /** Apply node colors based on type */
  applyColors?: boolean;
  /** Apply node sizes based on type */
  applySizes?: boolean;
}

/**
 * Result of graph conversion
 */
export interface GraphologyConversionResult {
  /** The converted graphology graph */
  graph: ExplorerGraph;
  /** Number of nodes added */
  nodeCount: number;
  /** Number of edges added */
  edgeCount: number;
  /** Any conversion warnings */
  warnings: string[];
}
