/**
 * Codebase Explorer types for graph visualization
 */

// ============================================
// Node Types
// ============================================

/**
 * Depth levels for the graph granularity slider
 * 1 = directories only
 * 2 = directories + files
 * 3 = + classes
 * 4 = + functions
 * 5 = all symbols (variables, constants, etc.)
 */
export type DepthLevel = 1 | 2 | 3 | 4 | 5;

/**
 * Types of nodes in the dependency graph
 */
export type NodeType = 'directory' | 'file' | 'class' | 'function' | 'symbol';

/**
 * Types of edges/relationships between nodes
 */
export type EdgeType = 'imports' | 'calls' | 'inherits' | 'contains';

/**
 * Supported programming languages for parsing
 */
export type ParserLanguage = 'typescript' | 'javascript' | 'python';

// ============================================
// Graph Node Types
// ============================================

/**
 * Complexity rating for code entities
 */
export type ComplexityRating = 'low' | 'medium' | 'high';

/**
 * Metadata for a graph node
 */
export interface NodeMetadata {
  /** Lines of code */
  loc?: number;
  /** Cyclomatic complexity rating */
  complexity?: ComplexityRating;
  /** List of exports (for files/modules) */
  exports?: string[];
  /** Docstring or JSDoc comment */
  docstring?: string;
  /** Programming language of the file */
  language?: ParserLanguage;
  /** Start line number in the source file */
  startLine?: number;
  /** End line number in the source file */
  endLine?: number;
  /** Signature for functions/methods */
  signature?: string;
  /** Parent class for methods */
  parentClass?: string;
  /** Return type if available */
  returnType?: string;
  /** Parameters for functions */
  parameters?: string[];
  /** Specific function type (function, arrow_function, async_function, etc.) */
  functionType?: string;
}

/**
 * A node in the dependency graph
 */
export interface GraphNode {
  /** Unique identifier for the node */
  id: string;
  /** Display name */
  name: string;
  /** Type of node determines depth level visibility */
  type: NodeType;
  /** Relative file path from project root */
  filePath: string;
  /** Depth level this node appears at (1-5) */
  depth: DepthLevel;
  /** Additional metadata about the node */
  metadata: NodeMetadata;
  /** IDs of nodes that use/call this node */
  usedBy?: string[];
  /** IDs of nodes that this node uses/calls */
  uses?: string[];

  // D3.js force simulation properties (added at runtime)
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

/**
 * An edge/link between two nodes in the graph
 */
export interface GraphEdge {
  /** Unique identifier for the edge */
  id: string;
  /** Source node ID */
  source: string | GraphNode;
  /** Target node ID */
  target: string | GraphNode;
  /** Type of relationship */
  type: EdgeType;
  /** Optional label for the edge */
  label?: string;
}

/**
 * Complete graph data structure
 */
export interface GraphData {
  /** All nodes in the graph */
  nodes: GraphNode[];
  /** All edges/links in the graph */
  edges: GraphEdge[];
  /** Timestamp when the graph was generated */
  generatedAt: Date;
  /** Project ID this graph belongs to */
  projectId: string;
  /** Root directory that was parsed */
  rootPath: string;
  /** Statistics about the graph */
  stats: GraphStats;
  /** Files that failed to parse (with error messages) */
  parseErrors?: ParseError[];
}

// ============================================
// Statistics and Metadata Types
// ============================================

/**
 * Statistics about the parsed graph
 */
export interface GraphStats {
  /** Total number of nodes */
  totalNodes: number;
  /** Node count by type */
  nodesByType: Record<NodeType, number>;
  /** Edge count by type */
  edgesByType: Record<EdgeType, number>;
  /** Total number of files parsed */
  filesParsed: number;
  /** Total lines of code across all files */
  totalLoc: number;
  /** Languages detected in the project */
  languages: ParserLanguage[];
  /** Parse duration in milliseconds */
  parseDurationMs: number;
  /** Number of files parsed with OXC parser */
  oxcFilesCount?: number;
  /** Number of files parsed with Tree-sitter parser */
  treeSitterFilesCount?: number;
}

/**
 * Record of a file that failed to parse
 */
export interface ParseError {
  /** File path that failed */
  filePath: string;
  /** Error message */
  error: string;
  /** Language that was attempted */
  language?: ParserLanguage;
}

// ============================================
// Explorer State Types
// ============================================

/**
 * Loading phases for the explorer
 */
export type ExplorerLoadingPhase =
  | 'idle'
  | 'loading-cache'
  | 'scanning-files'
  | 'parsing'
  | 'building-graph'
  | 'complete'
  | 'error';

/**
 * Status information during graph loading
 */
export interface ExplorerLoadingStatus {
  phase: ExplorerLoadingPhase;
  /** Current file being parsed (during 'parsing' phase) */
  currentFile?: string;
  /** Progress percentage (0-100) */
  progress: number;
  /** Total files to parse */
  totalFiles?: number;
  /** Files parsed so far */
  filesParsed?: number;
  /** User-friendly message */
  message: string;
  /** Error message if phase is 'error' */
  error?: string;
}

/**
 * Filter options for the graph display
 */
export interface GraphFilterOptions {
  /** Current depth level (1-5) */
  depthLevel: DepthLevel;
  /** Filter to specific node types */
  nodeTypes?: NodeType[];
  /** Filter to specific edge types */
  edgeTypes?: EdgeType[];
  /** Search query for filtering nodes by name */
  searchQuery?: string;
  /** Show only nodes connected to selected node */
  showConnectedOnly?: boolean;
}

/**
 * Viewport state for the graph visualization
 */
export interface GraphViewport {
  /** Current zoom level */
  zoom: number;
  /** X translation */
  translateX: number;
  /** Y translation */
  translateY: number;
}

// ============================================
// Graph Cache Types
// ============================================

/**
 * Cached graph data stored in .auto-claude/explorer/graph.json
 */
export interface GraphCache {
  /** The cached graph data */
  graph: GraphData;
  /** Version of the cache format */
  version: number;
  /** File modification timestamps at time of parsing */
  fileTimestamps: Record<string, number>;
}

// ============================================
// Node Selection Types
// ============================================

/**
 * Information about a selected node for the info panel
 */
export interface SelectedNodeInfo {
  /** The selected node */
  node: GraphNode;
  /** Nodes that import/call/use this node */
  incomingEdges: GraphEdge[];
  /** Nodes that this node imports/calls/uses */
  outgoingEdges: GraphEdge[];
  /** Direct parent node (containing directory/class) */
  parent?: GraphNode;
  /** Direct children nodes (contained items) */
  children: GraphNode[];
}

// ============================================
// Color Scheme Types
// ============================================

/**
 * Color configuration for graph rendering
 */
export interface GraphColors {
  /** Colors for each node type */
  nodes: Record<NodeType, string>;
  /** Colors for each edge type */
  edges: Record<EdgeType, string>;
  /** Color for selected node */
  selectedNode: string;
  /** Color for highlighted nodes */
  highlightedNode: string;
}

/**
 * Default color scheme for the graph
 */
export const DEFAULT_GRAPH_COLORS: GraphColors = {
  nodes: {
    directory: '#6366f1', // indigo
    file: '#3b82f6',      // blue
    class: '#8b5cf6',     // purple
    function: '#22c55e',  // green
    symbol: '#f59e0b',    // amber
  },
  edges: {
    imports: '#3b82f6',   // blue
    calls: '#22c55e',     // green
    inherits: '#8b5cf6',  // purple
    contains: '#6b7280',  // gray
  },
  selectedNode: '#ef4444', // red
  highlightedNode: '#f97316', // orange
};

/**
 * Default node sizes for each type
 */
export const DEFAULT_NODE_SIZES: Record<NodeType, number> = {
  directory: 20,
  file: 15,
  class: 12,
  function: 10,
  symbol: 8,
};
