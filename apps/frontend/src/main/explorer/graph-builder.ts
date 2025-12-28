/**
 * Graph Builder for Codebase Explorer
 *
 * Converts parsed results from unified parser interface (OXC or Tree-sitter)
 * into a knowledge graph with nodes (directories, files, classes, functions, symbols)
 * and edges (imports, calls, inherits, contains).
 */

import * as path from 'path';
import type {
  GraphData,
  GraphNode,
  GraphEdge,
  GraphStats,
  NodeType,
  EdgeType,
  DepthLevel,
  NodeMetadata,
  ComplexityRating,
  ParserLanguage,
  ParseError
} from '../../shared/types';
import type { UnifiedParseResult, ExtractedSymbol, ExtractedImport, ParserBackend } from './types';
import { parserMetrics, type ParserStats } from './parser-metrics';
import { graphCache } from './graph-cache';

// ============================================
// Types
// ============================================

/**
 * Configuration for graph building
 */
export interface GraphBuilderConfig {
  /** Project root path for relative path calculation */
  projectRoot: string;
  /** Project ID */
  projectId: string;
  /** Whether to include symbols (depth level 5) */
  includeSymbols?: boolean;
  /** Maximum depth for class/function nesting */
  maxNestingDepth?: number;
}
/**
 * Comprehensive statistics about graph building operation
 */
export interface GraphBuildStats {
  // Parser stats
  /** Parser performance metrics */
  parserStats: ParserStats;

  // Graph stats
  /** Total number of nodes in graph */
  totalNodes: number;
  /** Total number of edges in graph */
  totalEdges: number;
  /** Node counts by type */
  nodesByType: Record<NodeType, number>;
  /** Edge counts by type */
  edgesByType: Record<EdgeType, number>;

  // Files stats
  /** Number of files parsed */
  filesParsed: number;
  /** Number of files that had errors */
  filesWithErrors: number;

  // Timing
  /** Time spent parsing files in milliseconds */
  parseTimeMs: number;
  /** Time spent building graph structure in milliseconds */
  graphBuildTimeMs: number;
  /** Total operation time in milliseconds */
  totalTimeMs: number;

  // Parser backend usage
  /** Number of files parsed with each backend */
  parserUsage: {
    oxc: number;
    treeSitter: number;
  };
}

/**
 * Result from extracting a single file
 *
 * This is now a thin wrapper around UnifiedParseResult with relative path calculation
 */
interface FileExtractionResult {
  filePath: string;
  relativePath: string;
  language: ParserLanguage;
  symbols: ExtractedSymbol[];
  imports: ExtractedImport[];
  loc: number;
  parser: ParserBackend;
  parseTimeMs: number;
}


// ============================================
// Main Graph Building Functions
// ============================================

/**
 * Build a complete knowledge graph from unified parser results
 *
 * @param parseResults - Array of parse results from unified parser interface (OXC or Tree-sitter)
 * @param config - Graph builder configuration
 * @returns Complete graph data structure
 */
export function buildGraph(
  parseResults: UnifiedParseResult[],
  config: GraphBuilderConfig
): GraphData {
  // Check cache first for complete graph
  const cachedGraph = graphCache.getGraph(config.projectId);
  if (cachedGraph) {
    return cachedGraph;
  }

  const startTime = Date.now();

  // Convert unified results to extraction format
  const extractions: FileExtractionResult[] = [];
  const parseErrors: ParseError[] = [];

  for (const result of parseResults) {
    try {
      const extraction = convertToExtraction(result, config.projectRoot);
      extractions.push(extraction);
    } catch (error) {
      parseErrors.push({
        filePath: result.filePath,
        error: error instanceof Error ? error.message : String(error),
        language: result.language
      });
    }
  }

  // Build nodes from extractions
  const nodes = extractNodes(extractions, config);

  // Build edges from extractions and nodes
  const edges = extractEdges(extractions, nodes, config);

  // Calculate statistics
  const stats = calculateStats(nodes, edges, extractions, Date.now() - startTime);

  const graph: GraphData = {
    nodes,
    edges,
    generatedAt: new Date(),
    projectId: config.projectId,
    rootPath: config.projectRoot,
    stats,
    parseErrors: parseErrors.length > 0 ? parseErrors : undefined
  };

  // Cache the built graph
  graphCache.setGraph(config.projectId, graph);

  return graph;
}

/**
 * Build graph and collect comprehensive statistics
 *
 * This is an enhanced version of buildGraph that returns detailed statistics
 * about the graph building process, including parser metrics and timing breakdowns.
 *
 * @param parseResults - Array of parse results from unified parser interface
 * @param config - Graph builder configuration
 * @returns Object containing the graph and comprehensive statistics
 */
export async function buildGraphWithStats(
  parseResults: UnifiedParseResult[],
  config: GraphBuilderConfig
): Promise<{ graph: GraphData; stats: GraphBuildStats }> {
  const totalStartTime = Date.now();

  // Convert unified results to extraction format (includes parse time tracking)
  const extractions: FileExtractionResult[] = [];
  const parseErrors: ParseError[] = [];

  for (const result of parseResults) {
    try {
      const extraction = convertToExtraction(result, config.projectRoot);
      extractions.push(extraction);

      // Record metrics for this parse operation
      parserMetrics.record({
        filePath: result.filePath,
        parser: result.parser,
        language: result.language,
        parseTimeMs: result.parseTimeMs,
        symbolCount: result.symbols.length,
        importCount: result.imports.length,
        loc: result.loc,
        timestamp: Date.now()
      });
    } catch (error) {
      parseErrors.push({
        filePath: result.filePath,
        error: error instanceof Error ? error.message : String(error),
        language: result.language
      });
    }
  }

  // Track graph building time separately
  const graphBuildStartTime = Date.now();

  // Build nodes from extractions
  const nodes = extractNodes(extractions, config);

  // Build edges from extractions and nodes
  const edges = extractEdges(extractions, nodes, config);

  const graphBuildTimeMs = Date.now() - graphBuildStartTime;
  const totalTimeMs = Date.now() - totalStartTime;

  // Calculate parse time from parser metrics
  const parserStats = parserMetrics.getStats();
  const parseTimeMs = parserStats.totalTimeMs;

  // Count nodes and edges by type
  const nodesByType: Record<NodeType, number> = {
    directory: 0,
    file: 0,
    class: 0,
    function: 0,
    symbol: 0
  };

  const edgesByType: Record<EdgeType, number> = {
    imports: 0,
    calls: 0,
    inherits: 0,
    contains: 0
  };

  for (const node of nodes) {
    nodesByType[node.type]++;
  }

  for (const edge of edges) {
    edgesByType[edge.type]++;
  }

  // Count parser backend usage
  const parserUsage = {
    oxc: extractions.filter(e => e.parser === 'oxc').length,
    treeSitter: extractions.filter(e => e.parser === 'tree-sitter').length
  };

  // Build comprehensive stats
  const buildStats: GraphBuildStats = {
    parserStats,
    totalNodes: nodes.length,
    totalEdges: edges.length,
    nodesByType,
    edgesByType,
    filesParsed: extractions.length,
    filesWithErrors: parseErrors.length,
    parseTimeMs,
    graphBuildTimeMs,
    totalTimeMs,
    parserUsage
  };

  // Build the graph object (using existing GraphStats format for compatibility)
  const graphStats = calculateStats(nodes, edges, extractions, parseTimeMs);
  
  const graph: GraphData = {
    nodes,
    edges,
    generatedAt: new Date(),
    projectId: config.projectId,
    rootPath: config.projectRoot,
    stats: graphStats,
    parseErrors: parseErrors.length > 0 ? parseErrors : undefined
  };

  return { graph, stats: buildStats };
}

/**
 * Convert UnifiedParseResult to FileExtractionResult
 *
 * This is a simple transformation that adds relative path calculation
 * and preserves all the extracted data from the parser
 */
function convertToExtraction(
  parseResult: UnifiedParseResult,
  projectRoot: string
): FileExtractionResult {
  const { language, filePath, symbols, imports, loc, parser, parseTimeMs } = parseResult;
  const relativePath = path.relative(projectRoot, filePath);

  return {
    filePath,
    relativePath,
    language,
    symbols,
    imports,
    loc,
    parser,
    parseTimeMs
  };
}

// ============================================
// Node Building
// ============================================

/**
 * Build graph nodes from file extraction results
 */
export function extractNodes(
  extractions: FileExtractionResult[],
  config: GraphBuilderConfig
): GraphNode[] {
  const nodes: GraphNode[] = [];
  const nodeIds = new Set<string>();

  // Build directory structure
  const directories = buildDirectoryNodes(extractions, config);
  for (const dir of directories) {
    if (!nodeIds.has(dir.id)) {
      nodes.push(dir);
      nodeIds.add(dir.id);
    }
  }

  // Build file and symbol nodes
  for (const extraction of extractions) {
    // File node
    const fileNode = createFileNode(extraction);
    if (!nodeIds.has(fileNode.id)) {
      nodes.push(fileNode);
      nodeIds.add(fileNode.id);
    }

    // Symbol nodes (classes, functions, variables)
    const symbolNodes = createSymbolNodes(extraction, config.includeSymbols ?? true);
    for (const symNode of symbolNodes) {
      if (!nodeIds.has(symNode.id)) {
        nodes.push(symNode);
        nodeIds.add(symNode.id);
      }
    }
  }

  return nodes;
}

/**
 * Build directory nodes from file paths
 */
function buildDirectoryNodes(
  extractions: FileExtractionResult[],
  config: GraphBuilderConfig
): GraphNode[] {
  const dirPaths = new Set<string>();

  // Collect all unique directory paths
  for (const extraction of extractions) {
    let dirPath = path.dirname(extraction.relativePath);
    while (dirPath && dirPath !== '.') {
      dirPaths.add(dirPath);
      dirPath = path.dirname(dirPath);
    }
  }

  // Create directory nodes
  return Array.from(dirPaths).map(dirPath => ({
    id: `dir:${dirPath}`,
    name: path.basename(dirPath),
    type: 'directory' as NodeType,
    filePath: dirPath,
    depth: 1 as DepthLevel,
    metadata: {}
  }));
}

/**
 * Create a file node from extraction result
 */
function createFileNode(extraction: FileExtractionResult): GraphNode {
  const exports = extraction.symbols
    .filter(s => s.exports)
    .map(s => s.name);

  return {
    id: `file:${extraction.relativePath}`,
    name: path.basename(extraction.relativePath),
    type: 'file',
    filePath: extraction.relativePath,
    depth: 2,
    metadata: {
      loc: extraction.loc,
      language: extraction.language,
      exports: exports.length > 0 ? exports : undefined,
      complexity: calculateComplexity(extraction.loc)
    }
  };
}

/**
 * Create symbol nodes (classes, functions, variables) from extraction
 */
function createSymbolNodes(
  extraction: FileExtractionResult,
  includeSymbols: boolean
): GraphNode[] {
  const nodes: GraphNode[] = [];

  const createNodesRecursive = (
    symbols: ExtractedSymbol[],
    parentPath: string
  ): void => {
    for (const symbol of symbols) {
      const id = `${symbol.type}:${parentPath}:${symbol.name}`;
      const depth = getDepthForType(symbol.type);

      // Skip symbols (depth 5) if not included
      if (symbol.type === 'symbol' && !includeSymbols) {
        continue;
      }

      const node: GraphNode = {
        id,
        name: symbol.name,
        type: symbol.type,
        filePath: extraction.relativePath,
        depth,
        metadata: {
          startLine: symbol.startLine,
          endLine: symbol.endLine,
          loc: symbol.endLine - symbol.startLine + 1,
          docstring: symbol.docstring,
          signature: symbol.signature,
          parameters: symbol.parameters,
          returnType: symbol.returnType,
          parentClass: symbol.parentClass,
          language: extraction.language
        }
      };

      nodes.push(node);

      // Recursively create nodes for children (methods in classes)
      if (symbol.children.length > 0) {
        createNodesRecursive(symbol.children, `${parentPath}:${symbol.name}`);
      }
    }
  };

  createNodesRecursive(extraction.symbols, extraction.relativePath);
  return nodes;
}

// ============================================
// Edge Building
// ============================================

/**
 * Build graph edges from extractions and nodes
 */
export function extractEdges(
  extractions: FileExtractionResult[],
  nodes: GraphNode[],
  config: GraphBuilderConfig
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const edgeIds = new Set<string>();
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Build containment edges (directory contains file, file contains class, etc.)
  for (const node of nodes) {
    const containsEdge = createContainsEdge(node, nodes);
    if (containsEdge && !edgeIds.has(containsEdge.id)) {
      edges.push(containsEdge);
      edgeIds.add(containsEdge.id);
    }
  }

  // Build import edges using the new unified approach
  const importEdges = buildImportEdges(extractions, nodeMap, config.projectRoot);
  for (const edge of importEdges) {
    if (!edgeIds.has(edge.id)) {
      edges.push(edge);
      edgeIds.add(edge.id);
    }
  }

  // Build inheritance edges (class extends)
  for (const extraction of extractions) {
    const inheritEdges = extractInheritanceEdges(extraction, nodes);
    for (const edge of inheritEdges) {
      if (!edgeIds.has(edge.id)) {
        edges.push(edge);
        edgeIds.add(edge.id);
      }
    }
  }

  return edges;
}

/**
 * Create a "contains" edge from a node to its parent
 */
function createContainsEdge(
  node: GraphNode,
  allNodes: GraphNode[]
): GraphEdge | null {
  let parentId: string | null = null;

  if (node.type === 'file') {
    // File is contained by its directory
    const dirPath = path.dirname(node.filePath);
    if (dirPath && dirPath !== '.') {
      parentId = `dir:${dirPath}`;
    }
  } else if (node.type === 'class' || node.type === 'function' || node.type === 'symbol') {
    // Class/function/symbol is contained by its file
    parentId = `file:${node.filePath}`;

    // Or contained by a parent class if it's a method
    if (node.metadata.parentClass) {
      parentId = `class:${node.filePath}:${node.metadata.parentClass}`;
    }
  }

  if (parentId) {
    // Verify parent exists
    const parentExists = allNodes.some(n => n.id === parentId);
    if (parentExists) {
      return {
        id: `edge:contains:${parentId}:${node.id}`,
        source: parentId,
        target: node.id,
        type: 'contains'
      };
    }
  }

  return null;
}

/**
 * Build dependency edges from imports
 *
 * @param parseResults - Array of file extraction results
 * @param nodeMap - Map of node IDs to GraphNode objects
 * @param projectPath - Absolute path to the project root
 * @returns Array of dependency edges
 */
function buildImportEdges(
  parseResults: FileExtractionResult[],
  nodeMap: Map<string, GraphNode>,
  projectPath: string
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const edgeIds = new Set<string>();

  for (const extraction of parseResults) {
    const sourceNodeId = `file:${extraction.relativePath}`;
    const sourceNode = nodeMap.get(sourceNodeId);
    if (!sourceNode) continue;

    for (const importInfo of extraction.imports) {
      // Skip external (non-relative) imports
      if (!importInfo.isRelative) {
        continue;
      }

      // Resolve import path to actual file
      const targetFilePath = resolveImportPath(
        importInfo.source,
        extraction.relativePath,
        projectPath
      );

      if (!targetFilePath) continue;

      // Try to find the target node with various extensions
      let targetNode: GraphNode | undefined;

      // Try exact match first
      targetNode = nodeMap.get(`file:${targetFilePath}`);

      // Try with common extensions
      if (!targetNode) {
        for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.py']) {
          targetNode = nodeMap.get(`file:${targetFilePath}${ext}`);
          if (targetNode) break;
        }
      }

      // Try index files
      if (!targetNode) {
        for (const indexFile of ['/index.ts', '/index.tsx', '/index.js', '/index.jsx']) {
          targetNode = nodeMap.get(`file:${targetFilePath}${indexFile}`);
          if (targetNode) break;
        }
      }

      if (targetNode) {
        const edge = createDependencyEdge(sourceNode, targetNode, importInfo);
        if (!edgeIds.has(edge.id)) {
          edges.push(edge);
          edgeIds.add(edge.id);
        }
      }
    }
  }

  return edges;
}

/**
 * Resolve import path to actual file
 *
 * Handles:
 * - Relative imports (./foo, ../bar)
 * - Index file resolution (./dir → ./dir/index)
 * - Extension resolution (.ts, .tsx, .js, etc.)
 *
 * @param importSource - The import source string (e.g., "./utils", "../components/Button")
 * @param fromFilePath - The relative path of the file containing the import
 * @param projectPath - The absolute project root path
 * @returns Relative path to the resolved file, or null if not found
 */
function resolveImportPath(
  importSource: string,
  fromFilePath: string,
  projectPath: string
): string | null {
  // Get the directory containing the source file
  const sourceDir = path.dirname(fromFilePath);

  // Resolve the import path relative to the source file
  let resolvedPath = path.normalize(path.join(sourceDir, importSource));

  // Remove leading ./ if present
  if (resolvedPath.startsWith('./')) {
    resolvedPath = resolvedPath.substring(2);
  }

  // Return the normalized path - the caller will check if it exists in nodeMap
  // with various extensions and index file patterns
  return resolvedPath;
}

/**
 * Create edge between source and target nodes
 *
 * @param sourceNode - The node that contains the import statement
 * @param targetNode - The node being imported
 * @param importInfo - Information about the import
 * @returns A GraphEdge representing the dependency
 */
function createDependencyEdge(
  sourceNode: GraphNode,
  targetNode: GraphNode,
  importInfo: ExtractedImport
): GraphEdge {
  // Create a descriptive label based on what's being imported
  let label: string;

  if (importInfo.items.includes('*')) {
    // Namespace import or wildcard import
    label = importInfo.isDefault ? 'default' : '*';
  } else if (importInfo.items.length > 3) {
    // Truncate long import lists
    label = `${importInfo.items.slice(0, 3).join(', ')}, ...`;
  } else {
    // Show all imported items
    label = importInfo.items.join(', ');
  }

  return {
    id: `edge:imports:${sourceNode.id}:${targetNode.id}`,
    source: sourceNode.id,
    target: targetNode.id,
    type: 'imports',
    label,
  };
}

/**
 * Extract inheritance edges (class extends)
 */
function extractInheritanceEdges(
  extraction: FileExtractionResult,
  nodes: GraphNode[]
): GraphEdge[] {
  const edges: GraphEdge[] = [];

  // This would require deeper AST analysis to find "extends" clauses
  // For now, return empty - can be enhanced later
  return edges;
}

// ============================================
// OXC/Unified Parser Support
// ============================================

/**
 * Extract function nodes from unified parse results (OXC or Tree-sitter)
 *
 * Converts ExtractedSymbol objects with type='function' into GraphNode objects
 * suitable for the dependency graph visualization.
 *
 * @param parseResult - Unified parse result containing extracted symbols
 * @param projectPath - Project root path for relative path calculation
 * @returns Array of GraphNode objects representing functions
 */
export function extractFunctionNodes(
  parseResult: UnifiedParseResult,
  projectPath: string
): GraphNode[] {
  const nodes: GraphNode[] = [];
  const relativePath = path.relative(projectPath, parseResult.filePath);

  // Recursive function to extract function nodes from symbols
  const extractFromSymbols = (symbols: ExtractedSymbol[], parentPath: string): void => {
    for (const symbol of symbols) {
      // Process function symbols
      if (symbol.type === 'function') {
        const functionType = getFunctionType(symbol);
        const id = `function:${parentPath}:${symbol.name}`;

        const node: GraphNode = {
          id,
          name: symbol.name,
          type: 'function',
          filePath: relativePath,
          depth: 4 as DepthLevel,
          metadata: {
            startLine: symbol.startLine,
            endLine: symbol.endLine,
            loc: symbol.endLine - symbol.startLine + 1,
            docstring: symbol.docstring,
            signature: symbol.signature,
            parameters: symbol.parameters,
            returnType: symbol.returnType,
            parentClass: symbol.parentClass,
            language: parseResult.language,
            functionType
          }
        };

        nodes.push(node);
      }

      // Recursively process children (e.g., methods in classes)
      if (symbol.children && symbol.children.length > 0) {
        const childPath = symbol.type === 'class'
          ? `${parentPath}:${symbol.name}`
          : parentPath;
        extractFromSymbols(symbol.children, childPath);
      }
    }
  };

  extractFromSymbols(parseResult.symbols, relativePath);
  return nodes;
}

/**
 * Determine the specific function type from an extracted symbol
 *
 * Handles different function variations:
 * - Regular functions (function foo() {})
 * - Arrow functions (const foo = () => {})
 * - Async functions (async function foo() {})
 * - Generator functions (function* foo() {})
 * - Methods (within classes)
 *
 * @param symbol - Extracted symbol with type='function'
 * @returns Specific function type string for metadata
 */
export function getFunctionType(symbol: ExtractedSymbol): string {
  // If part of a class, it's a method
  if (symbol.parentClass) {
    // Check for async method
    if (symbol.signature && symbol.signature.includes('async')) {
      return 'async_method';
    }
    return 'method';
  }

  // Check signature for function characteristics
  const sig = symbol.signature || '';

  // Generator function (has * in signature)
  if (sig.includes('*')) {
    return 'generator';
  }

  // Async function
  if (sig.includes('async')) {
    return 'async_function';
  }

  // Arrow function (signature contains =>)
  if (sig.includes('=>')) {
    return 'arrow_function';
  }

  // Check if it's exported
  if (symbol.exports) {
    return 'exported_function';
  }

  // Default: regular function
  return 'function';
}

// ============================================
// Helper Functions
// ============================================

/**
 * Get depth level for a node type
 */
function getDepthForType(type: NodeType): DepthLevel {
  switch (type) {
    case 'directory': return 1;
    case 'file': return 2;
    case 'class': return 3;
    case 'function': return 4;
    case 'symbol': return 5;
  }
}

/**
 * Calculate complexity rating based on LOC
 */
function calculateComplexity(loc: number): ComplexityRating {
  if (loc < 100) return 'low';
  if (loc < 500) return 'medium';
  return 'high';
}

/**
 * Calculate graph statistics
 */
function calculateStats(
  nodes: GraphNode[],
  edges: GraphEdge[],
  extractions: FileExtractionResult[],
  parseDurationMs: number
): GraphStats {
  const nodesByType: Record<NodeType, number> = {
    directory: 0,
    file: 0,
    class: 0,
    function: 0,
    symbol: 0
  };

  const edgesByType: Record<EdgeType, number> = {
    imports: 0,
    calls: 0,
    inherits: 0,
    contains: 0
  };

  for (const node of nodes) {
    nodesByType[node.type]++;
  }

  for (const edge of edges) {
    edgesByType[edge.type]++;
  }

  const totalLoc = extractions.reduce((sum, e) => sum + e.loc, 0);
  const languages = Array.from(new Set(extractions.map(e => e.language)));

  return {
    totalNodes: nodes.length,
    nodesByType,
    edgesByType,
    filesParsed: extractions.length,
    totalLoc,
    languages,
    parseDurationMs
  };
}

// ============================================
// Incremental Update Support
// ============================================

/**
 * Update graph with changes to specific files
 * (For future use with file watching)
 */
export function updateGraph(
  existingGraph: GraphData,
  changedFiles: UnifiedParseResult[],
  removedFiles: string[],
  config: GraphBuilderConfig
): GraphData {
  // Remove nodes for deleted/changed files
  const filesToRemove = new Set([
    ...removedFiles,
    ...changedFiles.map(f => f.filePath)
  ]);

  const remainingNodes = existingGraph.nodes.filter(
    node => !filesToRemove.has(node.filePath)
  );

  const remainingEdges = existingGraph.edges.filter(edge => {
    const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
    const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
    const sourceNode = existingGraph.nodes.find(n => n.id === sourceId);
    const targetNode = existingGraph.nodes.find(n => n.id === targetId);
    return (
      sourceNode && targetNode &&
      !filesToRemove.has(sourceNode.filePath) &&
      !filesToRemove.has(targetNode.filePath)
    );
  });

  // Extract data from changed files
  const extractions: FileExtractionResult[] = [];
  for (const result of changedFiles) {
    try {
      const extraction = convertToExtraction(result, config.projectRoot);
      extractions.push(extraction);
    } catch {
      // Skip files that fail to extract
    }
  }

  // Build new nodes and edges for changed files
  const newNodes = extractNodes(extractions, config);
  const allNodes = [...remainingNodes, ...newNodes];
  const newEdges = extractEdges(extractions, allNodes, config);

  // Merge
  const nodes = allNodes;
  const edges = [...remainingEdges, ...newEdges];

  // Recalculate stats
  const stats = calculateStats(
    nodes,
    edges,
    extractions,
    existingGraph.stats.parseDurationMs // Keep original parse time
  );

  return {
    ...existingGraph,
    nodes,
    edges,
    stats,
    generatedAt: new Date()
  };
}

// ============================================
// OXC Symbol Extraction Functions
// ============================================

/**
 * Extract class nodes from unified parse results
 *
 * Processes ExtractedSymbol objects from OXC parser and converts
 * class symbols to GraphNode objects with proper hierarchy.
 *
 * @param parseResult - Unified parse result from OXC or Tree-sitter
 * @param projectPath - Project root path for relative path calculation
 * @returns Array of class GraphNode objects
 */
export function extractClassNodes(
  parseResult: UnifiedParseResult,
  projectPath: string
): GraphNode[] {
  const nodes: GraphNode[] = [];
  const relativePath = path.relative(projectPath, parseResult.filePath);

  // Filter for class symbols
  const classSymbols = parseResult.symbols.filter(s => s.type === 'class');

  for (const symbol of classSymbols) {
    const node = symbolToNode(symbol, relativePath, projectPath);
    nodes.push(node);

    // Process nested classes recursively
    if (symbol.children.length > 0) {
      const nestedClasses = symbol.children.filter(c => c.type === 'class');
      for (const nested of nestedClasses) {
        const nestedNode = symbolToNode(nested, relativePath, projectPath);
        nodes.push(nestedNode);
      }
    }
  }

  return nodes;
}

/**
 * Extract interface nodes from unified parse results (TypeScript)
 *
 * Processes ExtractedSymbol objects from OXC parser and converts
 * interface/type alias symbols to GraphNode objects.
 *
 * Note: Interfaces are represented as 'symbol' type with depth 5 in the graph.
 *
 * @param parseResult - Unified parse result from OXC or Tree-sitter
 * @param projectPath - Project root path for relative path calculation
 * @returns Array of interface/type GraphNode objects
 */
export function extractInterfaceNodes(
  parseResult: UnifiedParseResult,
  projectPath: string
): GraphNode[] {
  const nodes: GraphNode[] = [];
  const relativePath = path.relative(projectPath, parseResult.filePath);

  // Only process TypeScript files (interfaces don't exist in JS/Python)
  if (parseResult.language !== 'typescript') {
    return nodes;
  }

  // Filter for interface and type symbols
  // Note: OXC parser marks interfaces/types as 'symbol' type
  const interfaceSymbols = parseResult.symbols.filter(s => {
    // Interface/type symbols are identified by having specific signature patterns
    // or by checking docstrings/comments
    return s.type === 'symbol' && (
      s.signature?.includes('interface') ||
      s.signature?.includes('type ') ||
      s.docstring?.toLowerCase().includes('interface') ||
      s.docstring?.toLowerCase().includes('type alias')
    );
  });

  for (const symbol of interfaceSymbols) {
    const node = symbolToNode(symbol, relativePath, projectPath);
    nodes.push(node);

    // Process generic type parameters if present
    // Type parameters are typically represented as children
    if (symbol.children.length > 0) {
      for (const child of symbol.children) {
        const childNode = symbolToNode(child, relativePath, projectPath);
        nodes.push(childNode);
      }
    }
  }

  return nodes;
}

/**
 * Convert ExtractedSymbol to GraphNode
 *
 * Maps OXC parser's ExtractedSymbol format to the internal GraphNode format
 * used by the knowledge graph. Handles all symbol types (class, function, symbol).
 *
 * @param symbol - Extracted symbol from OXC parser
 * @param filePath - Relative file path from project root
 * @param projectPath - Project root path
 * @returns GraphNode representation of the symbol
 */
export function symbolToNode(
  symbol: ExtractedSymbol,
  filePath: string,
  projectPath: string
): GraphNode {
  // Generate unique ID based on symbol type, file path, and name
  const id = `${symbol.type}:${filePath}:${symbol.name}`;

  // Determine depth level based on symbol type
  const depth = getDepthForType(symbol.type);

  // Calculate lines of code for this symbol
  const loc = symbol.endLine - symbol.startLine + 1;

  // Build metadata object with all available symbol information
  const metadata: NodeMetadata = {
    startLine: symbol.startLine,
    endLine: symbol.endLine,
    loc,
    docstring: symbol.docstring,
    signature: symbol.signature,
    parameters: symbol.parameters,
    returnType: symbol.returnType,
    parentClass: symbol.parentClass,
    complexity: calculateComplexity(loc)
  };

  // Create and return the GraphNode
  return {
    id,
    name: symbol.name,
    type: symbol.type,
    filePath,
    depth,
    metadata
  };
}

// ============================================
// Cache Exports
// ============================================

/**
 * Export the global graph cache instance for external use
 */
export { graphCache };
