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
// Symbol Extraction
// ============================================

/**
 * Recursively extract symbols from an AST node
 */
function extractSymbolsFromNode(
  node: TreeSitterNode,
  language: ParserLanguage,
  parentClass: string | null
): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];
  const classTypes = CLASS_NODE_TYPES[language];
  const functionTypes = FUNCTION_NODE_TYPES[language];
  const symbolTypes = SYMBOL_NODE_TYPES[language];

  for (const child of node.children) {
    // Check if this is a class
    if (classTypes.includes(child.type)) {
      const classSymbol = extractClassSymbol(child, language);
      if (classSymbol) {
        symbols.push(classSymbol);
      }
      continue;
    }

    // Check if this is a function/method
    if (functionTypes.includes(child.type)) {
      const funcSymbol = extractFunctionSymbol(child, language, parentClass);
      if (funcSymbol) {
        symbols.push(funcSymbol);
      }
      continue;
    }

    // Check if this is a variable/symbol declaration (depth 5)
    if (symbolTypes.includes(child.type)) {
      const varSymbols = extractVariableSymbols(child, language);
      symbols.push(...varSymbols);
      continue;
    }

    // Check for exported declarations (TypeScript/JavaScript)
    if (child.type === 'export_statement' || child.type === 'export_declaration') {
      const exportedSymbols = extractExportedSymbols(child, language, parentClass);
      symbols.push(...exportedSymbols);
      continue;
    }

    // Recurse into statement blocks
    if (shouldRecurseInto(child.type)) {
      const nestedSymbols = extractSymbolsFromNode(child, language, parentClass);
      symbols.push(...nestedSymbols);
    }
  }

  return symbols;
}

/**
 * Extract class symbol with its methods
 */
function extractClassSymbol(
  node: TreeSitterNode,
  language: ParserLanguage
): ExtractedSymbol | null {
  const name = getNodeName(node, language);
  if (!name) return null;

  const docstring = getDocstring(node, language);
  const children = extractClassMembers(node, language, name);

  return {
    name,
    type: 'class',
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    docstring,
    exports: false, // Will be updated based on export context
    children
  };
}

/**
 * Extract class members (methods, properties)
 */
function extractClassMembers(
  node: TreeSitterNode,
  language: ParserLanguage,
  className: string
): ExtractedSymbol[] {
  const members: ExtractedSymbol[] = [];

  // Find the class body
  const body = findChildByType(node, ['class_body', 'block']);
  if (!body) return members;

  const functionTypes = FUNCTION_NODE_TYPES[language];

  for (const child of body.children) {
    if (functionTypes.includes(child.type)) {
      const method = extractFunctionSymbol(child, language, className);
      if (method) {
        members.push(method);
      }
    }
  }

  return members;
}

/**
 * Extract function/method symbol
 */
function extractFunctionSymbol(
  node: TreeSitterNode,
  language: ParserLanguage,
  parentClass: string | null
): ExtractedSymbol | null {
  const name = getNodeName(node, language);
  if (!name) return null;

  const docstring = getDocstring(node, language);
  const signature = getFunctionSignature(node, language);
  const parameters = getFunctionParameters(node, language);
  const returnType = getReturnType(node, language);

  return {
    name,
    type: 'function',
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    docstring,
    signature,
    parameters,
    returnType,
    parentClass: parentClass || undefined,
    exports: false,
    children: []
  };
}

/**
 * Extract variable declarations as symbols
 */
function extractVariableSymbols(
  node: TreeSitterNode,
  language: ParserLanguage
): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];

  // For TypeScript/JavaScript variable declarations
  if (language === 'typescript' || language === 'javascript') {
    const declarators = findChildrenByType(node, ['variable_declarator']);
    for (const decl of declarators) {
      const nameNode = findChildByType(decl, ['identifier']);
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          type: 'symbol',
          startLine: decl.startPosition.row + 1,
          endLine: decl.endPosition.row + 1,
          exports: false,
          children: []
        });
      }
    }
  }

  // For Python assignments at module level
  if (language === 'python') {
    const leftSide = node.children[0];
    if (leftSide && leftSide.type === 'identifier') {
      symbols.push({
        name: leftSide.text,
        type: 'symbol',
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        exports: true, // Python module-level = exported
        children: []
      });
    }
  }

  return symbols;
}

/**
 * Extract exported declarations (handles export statements)
 */
function extractExportedSymbols(
  node: TreeSitterNode,
  language: ParserLanguage,
  parentClass: string | null
): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];

  // Find the declaration inside the export
  for (const child of node.children) {
    const nestedSymbols = extractSymbolsFromNode(child, language, parentClass);
    for (const sym of nestedSymbols) {
      sym.exports = true;
      symbols.push(sym);
    }
  }

  return symbols;
}

// ============================================
// Import Extraction
// ============================================

/**
 * Extract import statements from an AST node
 */
function extractImportsFromNode(
  node: TreeSitterNode,
  language: ParserLanguage
): ExtractedImport[] {
  const imports: ExtractedImport[] = [];
  const importTypes = IMPORT_NODE_TYPES[language];

  for (const child of node.children) {
    if (importTypes.includes(child.type)) {
      const extracted = extractSingleImport(child, language);
      if (extracted) {
        imports.push(extracted);
      }
    }
  }

  return imports;
}

/**
 * Extract a single import statement
 */
function extractSingleImport(
  node: TreeSitterNode,
  language: ParserLanguage
): ExtractedImport | null {
  if (language === 'typescript' || language === 'javascript') {
    return extractJSImport(node);
  }
  if (language === 'python') {
    return extractPythonImport(node);
  }
  return null;
}

/**
 * Extract JavaScript/TypeScript import
 */
function extractJSImport(node: TreeSitterNode): ExtractedImport | null {
  // Find the source string
  const sourceNode = findChildByType(node, ['string', 'string_literal']);
  if (!sourceNode) return null;

  // Remove quotes from source
  const source = sourceNode.text.replace(/['"]/g, '');
  const isRelative = source.startsWith('.') || source.startsWith('/');

  // Find imported items
  const items: string[] = [];
  let isDefault = false;

  // Check for named imports { a, b, c }
  const namedImports = findChildByType(node, ['named_imports', 'import_specifier']);
  if (namedImports) {
    const identifiers = findChildrenByType(namedImports, ['identifier', 'import_specifier']);
    for (const id of identifiers) {
      items.push(id.text);
    }
  }

  // Check for default import
  const importClause = findChildByType(node, ['import_clause']);
  if (importClause) {
    const defaultId = findChildByType(importClause, ['identifier']);
    if (defaultId && !items.includes(defaultId.text)) {
      items.push(defaultId.text);
      isDefault = true;
    }
  }

  // Check for namespace import: import * as foo
  const namespaceImport = findChildByType(node, ['namespace_import']);
  if (namespaceImport) {
    items.push('*');
  }

  // If no items found, it might be a side-effect import
  if (items.length === 0) {
    items.push('*');
  }

  return { source, items, isDefault, isRelative };
}

/**
 * Extract Python import
 */
function extractPythonImport(node: TreeSitterNode): ExtractedImport | null {
  const items: string[] = [];
  let source = '';

  if (node.type === 'import_statement') {
    // import foo, bar
    const names = findChildrenByType(node, ['dotted_name', 'aliased_import']);
    for (const nameNode of names) {
      const name = nameNode.text.split(' ')[0]; // Handle "foo as bar"
      items.push(name);
      if (!source) source = name;
    }
  } else if (node.type === 'import_from_statement') {
    // from foo import bar, baz
    const moduleNode = findChildByType(node, ['dotted_name', 'relative_import']);
    if (moduleNode) {
      source = moduleNode.text;
    }

    // Check for wildcard import
    if (node.text.includes('*')) {
      items.push('*');
    } else {
      const importedNames = findChildrenByType(node, ['dotted_name', 'aliased_import']);
      // Skip the first one (it's the module name)
      for (let i = 1; i < importedNames.length; i++) {
        const name = importedNames[i].text.split(' ')[0];
        items.push(name);
      }
    }
  }

  if (!source) return null;

  const isRelative = source.startsWith('.');
  return { source, items, isRelative };
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

  // Build a map of file paths to node IDs
  const fileToNodeId = new Map<string, string>();
  for (const node of nodes) {
    if (node.type === 'file') {
      const baseName = node.filePath.replace(/\.[^.]+$/, '');
      fileToNodeId.set(node.filePath, node.id);
      fileToNodeId.set(baseName, node.id);
    }
  }

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
 * Resolve an import statement to a target node ID
 */
function resolveImportTarget(
  imp: ExtractedImport,
  extraction: FileExtractionResult,
  fileToNodeId: Map<string, string>,
  projectRoot: string
): string | null {
  if (!imp.isRelative) {
    // External package - we don't track these
    return null;
  }

  // Resolve relative import path
  const sourceDir = path.dirname(extraction.relativePath);
  let targetPath = path.normalize(path.join(sourceDir, imp.source));

  // Remove leading ./ if present
  if (targetPath.startsWith('./')) {
    targetPath = targetPath.substring(2);
  }

  // Try to find the target file
  // First, try exact match
  let targetId = fileToNodeId.get(targetPath);
  if (targetId) return targetId;

  // Try with common extensions
  for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.py', '/index.ts', '/index.js']) {
    targetId = fileToNodeId.get(targetPath + ext);
    if (targetId) return targetId;
  }

  // Try resolving as a directory with index file
  targetId = fileToNodeId.get(`${targetPath}/index`);
  if (targetId) return targetId;

  return null;
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
 * Get the name identifier from a node
 */
function getNodeName(
  node: TreeSitterNode,
  language: ParserLanguage
): string | null {
  // Look for common name patterns
  const nameTypes = ['identifier', 'name', 'property_identifier', 'type_identifier'];

  for (const child of node.children) {
    if (nameTypes.includes(child.type)) {
      return child.text;
    }
  }

  return null;
}

/**
 * Get docstring/JSDoc for a node
 */
function getDocstring(
  node: TreeSitterNode,
  language: ParserLanguage
): string | undefined {
  // Check previous sibling for comment
  const prev = node.previousNamedSibling;
  if (prev) {
    if (prev.type === 'comment' || prev.type === 'string' || prev.type === 'expression_statement') {
      const text = prev.text.trim();
      // Check if it looks like a docstring
      if (text.startsWith('/**') || text.startsWith('"""') || text.startsWith("'''") || text.startsWith('//')) {
        return cleanDocstring(text);
      }
    }
  }
  return undefined;
}

/**
 * Clean up docstring formatting
 */
function cleanDocstring(text: string): string {
  return text
    .replace(/^\/\*\*|\*\/$/g, '') // Remove /** and */
    .replace(/^"""|"""$/g, '')      // Remove Python triple quotes
    .replace(/^'''|'''$/g, '')      // Remove Python single triple quotes
    .replace(/^\s*\*\s?/gm, '')     // Remove leading * from JSDoc lines
    .replace(/^\/\/\s?/gm, '')      // Remove // from comments
    .trim();
}

/**
 * Get function signature
 */
function getFunctionSignature(
  node: TreeSitterNode,
  language: ParserLanguage
): string | undefined {
  const params = findChildByType(node, ['formal_parameters', 'parameters']);
  if (params) {
    return params.text;
  }
  return undefined;
}

/**
 * Get function parameters
 */
function getFunctionParameters(
  node: TreeSitterNode,
  language: ParserLanguage
): string[] | undefined {
  const params = findChildByType(node, ['formal_parameters', 'parameters']);
  if (!params) return undefined;

  const paramList: string[] = [];
  const paramTypes = ['identifier', 'required_parameter', 'optional_parameter', 'typed_parameter', 'default_parameter'];

  for (const child of params.children) {
    if (paramTypes.includes(child.type)) {
      const idNode = findChildByType(child, ['identifier']) || child;
      if (idNode.type === 'identifier') {
        paramList.push(idNode.text);
      }
    }
  }

  return paramList.length > 0 ? paramList : undefined;
}

/**
 * Get return type annotation
 */
function getReturnType(
  node: TreeSitterNode,
  language: ParserLanguage
): string | undefined {
  const returnType = findChildByType(node, ['type_annotation', 'return_type']);
  if (returnType) {
    return returnType.text.replace(/^:\s*/, '');
  }
  return undefined;
}

/**
 * Find child node by type
 */
function findChildByType(
  node: TreeSitterNode,
  types: string[]
): TreeSitterNode | null {
  for (const child of node.children) {
    if (types.includes(child.type)) {
      return child;
    }
  }
  return null;
}

/**
 * Find all children of given types
 */
function findChildrenByType(
  node: TreeSitterNode,
  types: string[]
): TreeSitterNode[] {
  const results: TreeSitterNode[] = [];

  const searchRecursive = (n: TreeSitterNode): void => {
    for (const child of n.children) {
      if (types.includes(child.type)) {
        results.push(child);
      }
      searchRecursive(child);
    }
  };

  searchRecursive(node);
  return results;
}

/**
 * Check if we should recurse into a node type
 */
function shouldRecurseInto(nodeType: string): boolean {
  const recurseTypes = [
    'program',
    'module',
    'statement_block',
    'block',
    'decorated_definition',
    'export_statement'
  ];
  return recurseTypes.includes(nodeType);
}

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
  changedFiles: ParseResult[],
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
      const extraction = extractFileData(result, config.projectRoot);
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
