/**
 * Explorer Service - Orchestrates codebase parsing and graph building
 *
 * This service coordinates between multiple specialized modules:
 * - TreeSitterParser: Handles WASM-based AST parsing
 * - GraphBuilder: Converts parsed ASTs to knowledge graph
 * - Filesystem: Discovers parseable files and manages cache
 *
 * Key features:
 * - Async project parsing with progress events
 * - Graph caching to .auto-claude/explorer/graph.json
 * - Cancellation support for long-running parses
 * - Cache validation via file timestamps
 * - User-friendly error messages for parse failures
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import type {
  GraphData,
  GraphCache,
  ExplorerLoadingStatus,
  GraphNode,
  SelectedNodeInfo
} from '../../shared/types';
import {
  initTreeSitter,
  parseFiles,
  isParseableFile,
  getSupportedExtensions,
  clearParsers,
  ParserError,
  type ParseResult
} from './tree-sitter-parser';
import { buildGraph, type GraphBuilderConfig } from './graph-builder';

// ============================================
// Error Types
// ============================================

/**
 * Types of errors that can occur during exploration
 */
export type ExplorerErrorType =
  | 'initialization'
  | 'file-access'
  | 'parse'
  | 'cache'
  | 'cancelled'
  | 'unknown';

/**
 * Structured error for explorer operations with user-friendly messages
 */
export class ExplorerError extends Error {
  /** Type of error for categorization */
  readonly type: ExplorerErrorType;
  /** User-friendly title for the error */
  readonly title: string;
  /** Detailed user-friendly description */
  readonly description: string;
  /** Suggested actions to resolve the issue */
  readonly suggestions: string[];
  /** Technical details for debugging */
  readonly technicalDetails?: string;
  /** Original error that caused this */
  readonly cause?: Error;

  constructor(options: {
    type: ExplorerErrorType;
    message: string;
    title: string;
    description: string;
    suggestions?: string[];
    technicalDetails?: string;
    cause?: Error;
  }) {
    super(options.message);
    this.name = 'ExplorerError';
    this.type = options.type;
    this.title = options.title;
    this.description = options.description;
    this.suggestions = options.suggestions ?? [];
    this.technicalDetails = options.technicalDetails;
    this.cause = options.cause;
  }

  /**
   * Create an error from a raw error, inferring the type and providing
   * appropriate user-friendly messages
   */
  static fromError(error: unknown, context?: string): ExplorerError {
    if (error instanceof ExplorerError) {
      return error;
    }

    const rawMessage = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error ? error : undefined;

    // Cancelled operation
    if (rawMessage === 'Parse cancelled') {
      return new ExplorerError({
        type: 'cancelled',
        message: rawMessage,
        title: 'Operation Cancelled',
        description: 'The parsing operation was cancelled.',
        suggestions: ['Click "Refresh" to start parsing again'],
        cause
      });
    }

    // Parser initialization errors
    if (error instanceof ParserError || rawMessage.includes('Tree-sitter')) {
      return ExplorerError.createInitializationError(rawMessage, cause);
    }

    // File access errors
    if (
      rawMessage.includes('ENOENT') ||
      rawMessage.includes('EACCES') ||
      rawMessage.includes('EPERM') ||
      rawMessage.includes('Failed to read')
    ) {
      return ExplorerError.createFileAccessError(rawMessage, context, cause);
    }

    // Parse-specific errors
    if (
      rawMessage.includes('parse') ||
      rawMessage.includes('syntax') ||
      rawMessage.includes('Unsupported file type')
    ) {
      return ExplorerError.createParseError(rawMessage, context, cause);
    }

    // Cache errors
    if (rawMessage.includes('cache') || rawMessage.includes('JSON')) {
      return ExplorerError.createCacheError(rawMessage, cause);
    }

    // Unknown/generic errors
    return new ExplorerError({
      type: 'unknown',
      message: rawMessage,
      title: 'Unexpected Error',
      description:
        'An unexpected error occurred while processing the codebase.',
      suggestions: [
        'Try refreshing the graph',
        'Check that the project directory is accessible',
        'If the problem persists, try restarting the application'
      ],
      technicalDetails: rawMessage,
      cause
    });
  }

  /**
   * Create an initialization error with helpful guidance
   */
  private static createInitializationError(
    message: string,
    cause?: Error
  ): ExplorerError {
    const isWasmMissing = message.includes('WASM not found');

    return new ExplorerError({
      type: 'initialization',
      message,
      title: 'Parser Initialization Failed',
      description: isWasmMissing
        ? 'The code parser could not find required language files.'
        : 'The code parser failed to initialize properly.',
      suggestions: isWasmMissing
        ? [
            'Ensure Tree-sitter WASM files are installed',
            'Try reinstalling the application',
            'Check that resources/wasm directory exists'
          ]
        : [
            'Try refreshing the graph',
            'Restart the application',
            'Check system memory availability'
          ],
      technicalDetails: message,
      cause
    });
  }

  /**
   * Create a file access error with relevant suggestions
   */
  private static createFileAccessError(
    message: string,
    context?: string,
    cause?: Error
  ): ExplorerError {
    const isPermission =
      message.includes('EACCES') || message.includes('EPERM');

    return new ExplorerError({
      type: 'file-access',
      message,
      title: isPermission ? 'Permission Denied' : 'File Not Found',
      description: isPermission
        ? 'Cannot read some files due to permission restrictions.'
        : `Unable to access file${context ? `: ${context}` : 's'}.`,
      suggestions: isPermission
        ? [
            'Check file permissions in your project',
            'Ensure the application has read access',
            'Some files may be locked by other processes'
          ]
        : [
            'Verify the project path is correct',
            'Check that files have not been moved or deleted',
            'Try refreshing the graph'
          ],
      technicalDetails: message,
      cause
    });
  }

  /**
   * Create a parse error with language-specific guidance
   */
  private static createParseError(
    message: string,
    context?: string,
    cause?: Error
  ): ExplorerError {
    const isUnsupportedType = message.includes('Unsupported file type');

    return new ExplorerError({
      type: 'parse',
      message,
      title: isUnsupportedType ? 'Unsupported File Type' : 'Parse Error',
      description: isUnsupportedType
        ? 'Some files use a language that is not currently supported.'
        : `Failed to parse source code${context ? ` in ${context}` : ''}.`,
      suggestions: isUnsupportedType
        ? [
            'Currently supported: TypeScript, JavaScript, Python',
            'Unsupported files will be skipped',
            'The graph will still include supported files'
          ]
        : [
            'The file may contain syntax errors',
            'Try fixing any syntax issues in the source code',
            'Parsing will continue with other files'
          ],
      technicalDetails: message,
      cause
    });
  }

  /**
   * Create a cache error
   */
  private static createCacheError(
    message: string,
    cause?: Error
  ): ExplorerError {
    return new ExplorerError({
      type: 'cache',
      message,
      title: 'Cache Error',
      description:
        'There was a problem reading or writing the cached graph data.',
      suggestions: [
        'Try clicking "Refresh" to regenerate the graph',
        'Clear the .auto-claude/explorer folder if issues persist',
        'Check available disk space'
      ],
      technicalDetails: message,
      cause
    });
  }

  /**
   * Serialize error for IPC transport
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      type: this.type,
      message: this.message,
      title: this.title,
      description: this.description,
      suggestions: this.suggestions,
      technicalDetails: this.technicalDetails
    };
  }
}

/**
 * Get a user-friendly error message from any error
 */
export function getUserFriendlyErrorMessage(error: unknown): string {
  const explorerError = ExplorerError.fromError(error);
  return explorerError.description;
}

// ============================================
// Constants
// ============================================

/** Current cache format version */
const CACHE_VERSION = 1;

/** Cache file name */
const CACHE_FILENAME = 'graph.json';

/** Cache directory within .auto-claude */
const CACHE_DIR = 'explorer';

/** Maximum files to parse before showing warning */
const MAX_FILES_WARNING = 5000;

/** Files and directories to skip during traversal */
const SKIP_PATTERNS = [
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.venv',
  'venv',
  'env',
  '.env',
  '.auto-claude'
];

// ============================================
// Types
// ============================================

/**
 * Options for parsing a project
 */
interface ParseOptions {
  /** Force re-parse even if cache exists */
  force?: boolean;
  /** Include symbols at depth level 5 */
  includeSymbols?: boolean;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Result from parsing a project
 */
interface ParseProjectResult {
  graph: GraphData;
  fromCache: boolean;
}

// ============================================
// Explorer Service
// ============================================

/**
 * Service for parsing codebases and building knowledge graphs
 */
export class ExplorerService extends EventEmitter {
  /** Active parse operations by project ID */
  private activeParses: Map<string, AbortController> = new Map();

  /** Cached graphs in memory */
  private graphCache: Map<string, GraphData> = new Map();

  /** Whether Tree-sitter has been initialized */
  private initialized = false;

  constructor() {
    super();
  }

  // ============================================
  // Public API
  // ============================================

  /**
   * Parse a project and build the knowledge graph
   *
   * @param projectId - Unique project identifier
   * @param projectPath - Absolute path to project root
   * @param options - Parse options
   * @returns The built graph data
   */
  async parseProject(
    projectId: string,
    projectPath: string,
    options: ParseOptions = {}
  ): Promise<ParseProjectResult> {
    // Cancel any existing parse for this project
    this.cancelParse(projectId);

    // Create abort controller for this parse
    const abortController = new AbortController();
    this.activeParses.set(projectId, abortController);
    const signal = options.signal ?? abortController.signal;

    try {
      // Check cache first (unless force is true)
      if (!options.force) {
        this.emitStatus(projectId, {
          phase: 'loading-cache',
          progress: 0,
          message: 'Checking cache...'
        });

        const cached = await this.loadGraphCache(projectPath);
        if (cached) {
          // Validate cache freshness
          const isValid = await this.validateCache(cached, projectPath);
          if (isValid) {
            this.graphCache.set(projectId, cached.graph);
            this.emitStatus(projectId, {
              phase: 'complete',
              progress: 100,
              message: 'Loaded from cache'
            });
            return { graph: cached.graph, fromCache: true };
          }
        }
      }

      // Initialize Tree-sitter if needed
      if (!this.initialized) {
        this.emitStatus(projectId, {
          phase: 'scanning-files',
          progress: 5,
          message: 'Initializing parser...'
        });
        console.warn('[ExplorerService] Initializing Tree-sitter...');
        try {
          await initTreeSitter();
          this.initialized = true;
          console.warn('[ExplorerService] Tree-sitter initialized successfully');
        } catch (error) {
          console.warn('[ExplorerService] Tree-sitter initialization failed:', error);
          throw error;
        }
      } else {
        console.warn('[ExplorerService] Tree-sitter already initialized');
      }

      // Check for abort
      if (signal.aborted) {
        throw new Error('Parse cancelled');
      }

      // Scan for parseable files
      this.emitStatus(projectId, {
        phase: 'scanning-files',
        progress: 10,
        message: 'Scanning for source files...'
      });

      console.warn('[ExplorerService] Discovering files in:', projectPath);
      const files = await this.discoverFiles(projectPath);
      console.warn('[ExplorerService] Discovered files:', files.length);
      if (files.length > 0 && files.length <= 20) {
        console.warn('[ExplorerService] Files found:', files);
      } else if (files.length > 20) {
        console.warn('[ExplorerService] First 10 files:', files.slice(0, 10));
      }

      if (files.length === 0) {
        const emptyGraph: GraphData = {
          nodes: [],
          edges: [],
          generatedAt: new Date(),
          projectId,
          rootPath: projectPath,
          stats: {
            totalNodes: 0,
            nodesByType: { directory: 0, file: 0, class: 0, function: 0, symbol: 0 },
            edgesByType: { imports: 0, calls: 0, inherits: 0, contains: 0 },
            filesParsed: 0,
            totalLoc: 0,
            languages: [],
            parseDurationMs: 0
          }
        };
        this.graphCache.set(projectId, emptyGraph);
        await this.saveGraphCache(projectPath, emptyGraph, {});
        this.emitStatus(projectId, {
          phase: 'complete',
          progress: 100,
          message: 'No parseable files found'
        });
        return { graph: emptyGraph, fromCache: false };
      }

      // Warn about large repos
      if (files.length > MAX_FILES_WARNING) {
        this.emit('warning', projectId, `Large repository: ${files.length} files to parse`);
      }

      // Check for abort
      if (signal.aborted) {
        throw new Error('Parse cancelled');
      }

      // Parse files with progress updates
      this.emitStatus(projectId, {
        phase: 'parsing',
        progress: 20,
        totalFiles: files.length,
        filesParsed: 0,
        message: `Parsing ${files.length} files...`
      });

      const parseResults = await this.parseFilesWithProgress(
        projectId,
        files,
        signal
      );

      // Check for abort
      if (signal.aborted) {
        throw new Error('Parse cancelled');
      }

      // Build graph from parse results
      this.emitStatus(projectId, {
        phase: 'building-graph',
        progress: 90,
        message: 'Building knowledge graph...'
      });

      const config: GraphBuilderConfig = {
        projectRoot: projectPath,
        projectId,
        includeSymbols: options.includeSymbols ?? true
      };

      const graph = buildGraph(parseResults.results, config);

      // Save to cache
      const fileTimestamps = await this.getFileTimestamps(files);
      await this.saveGraphCache(projectPath, graph, fileTimestamps);

      // Store in memory cache
      this.graphCache.set(projectId, graph);

      // Emit completion
      this.emitStatus(projectId, {
        phase: 'complete',
        progress: 100,
        message: `Parsed ${graph.stats.filesParsed} files`
      });

      this.emit('parse-complete', projectId, graph);

      return { graph, fromCache: false };
    } catch (error) {
      // Convert to ExplorerError for user-friendly messages
      const explorerError = ExplorerError.fromError(error);

      // Don't emit error status for cancellations
      if (explorerError.type !== 'cancelled') {
        this.emitStatus(projectId, {
          phase: 'error',
          progress: 0,
          message: explorerError.title,
          error: explorerError.description
        });
        // Emit structured error for IPC handlers
        this.emit('parse-error', projectId, explorerError.toJSON());
      }

      throw explorerError;
    } finally {
      this.activeParses.delete(projectId);
    }
  }

  /**
   * Get the cached graph for a project
   *
   * @param projectId - Unique project identifier
   * @param projectPath - Absolute path to project root
   * @returns The cached graph or null if not available
   */
  async getProjectGraph(
    projectId: string,
    projectPath: string
  ): Promise<GraphData | null> {
    // Check memory cache first
    const memCached = this.graphCache.get(projectId);
    if (memCached) {
      return memCached;
    }

    // Check disk cache
    const diskCached = await this.loadGraphCache(projectPath);
    if (diskCached) {
      // Validate cache
      const isValid = await this.validateCache(diskCached, projectPath);
      if (isValid) {
        this.graphCache.set(projectId, diskCached.graph);
        return diskCached.graph;
      }
    }

    return null;
  }

  /**
   * Force refresh the graph for a project
   *
   * @param projectId - Unique project identifier
   * @param projectPath - Absolute path to project root
   * @returns The newly built graph
   */
  async refreshGraph(
    projectId: string,
    projectPath: string
  ): Promise<GraphData> {
    console.warn('[ExplorerService] refreshGraph called:', { projectId, projectPath });
    const result = await this.parseProject(projectId, projectPath, { force: true });
    console.warn('[ExplorerService] refreshGraph result:', {
      fromCache: result.fromCache,
      nodes: result.graph.nodes.length,
      edges: result.graph.edges.length,
      filesParsed: result.graph.stats.filesParsed
    });
    return result.graph;
  }

  /**
   * Cancel an ongoing parse operation
   *
   * @param projectId - Unique project identifier
   */
  cancelParse(projectId: string): void {
    const controller = this.activeParses.get(projectId);
    if (controller) {
      controller.abort();
      this.activeParses.delete(projectId);
      this.emitStatus(projectId, {
        phase: 'idle',
        progress: 0,
        message: 'Parse cancelled'
      });
    }
  }

  /**
   * Clear the cache for a project
   *
   * @param projectPath - Absolute path to project root
   */
  async clearCache(projectPath: string): Promise<void> {
    const cachePath = this.getCachePath(projectPath);
    try {
      if (fs.existsSync(cachePath)) {
        fs.unlinkSync(cachePath);
      }
    } catch {
      // Ignore errors
    }
  }

  /**
   * Get information about a selected node
   *
   * @param projectId - Unique project identifier
   * @param nodeId - ID of the node to get info for
   * @returns Selected node info or null if not found
   */
  getNodeInfo(projectId: string, nodeId: string): SelectedNodeInfo | null {
    const graph = this.graphCache.get(projectId);
    if (!graph) return null;

    const node = graph.nodes.find(n => n.id === nodeId);
    if (!node) return null;

    // Find edges connected to this node
    const incomingEdges = graph.edges.filter(e => {
      const targetId = typeof e.target === 'string' ? e.target : e.target.id;
      return targetId === nodeId;
    });

    const outgoingEdges = graph.edges.filter(e => {
      const sourceId = typeof e.source === 'string' ? e.source : e.source.id;
      return sourceId === nodeId;
    });

    // Find parent (container) node
    const parentEdge = graph.edges.find(e => {
      const targetId = typeof e.target === 'string' ? e.target : e.target.id;
      return e.type === 'contains' && targetId === nodeId;
    });
    const parent = parentEdge
      ? graph.nodes.find(n => {
          const sourceId = typeof parentEdge.source === 'string'
            ? parentEdge.source
            : parentEdge.source.id;
          return n.id === sourceId;
        })
      : undefined;

    // Find children (contained) nodes
    const children = graph.edges
      .filter(e => {
        const sourceId = typeof e.source === 'string' ? e.source : e.source.id;
        return e.type === 'contains' && sourceId === nodeId;
      })
      .map(e => {
        const targetId = typeof e.target === 'string' ? e.target : e.target.id;
        return graph.nodes.find(n => n.id === targetId);
      })
      .filter((n): n is GraphNode => n !== undefined);

    return {
      node,
      incomingEdges,
      outgoingEdges,
      parent,
      children
    };
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    // Cancel all active parses
    const projectIds = Array.from(this.activeParses.keys());
    for (const projectId of projectIds) {
      this.cancelParse(projectId);
    }

    // Clear caches
    this.graphCache.clear();
    clearParsers();
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Emit a status update event
   */
  private emitStatus(projectId: string, status: ExplorerLoadingStatus): void {
    this.emit('status', projectId, status);
  }

  /**
   * Discover all parseable files in a project
   */
  private async discoverFiles(projectPath: string): Promise<string[]> {
    const files: string[] = [];
    const extensions = getSupportedExtensions();

    const walk = (dir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return; // Skip unreadable directories
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Skip symlinks to prevent infinite loops
        if (entry.isSymbolicLink()) {
          continue;
        }

        // Skip ignored patterns
        if (SKIP_PATTERNS.includes(entry.name)) {
          continue;
        }

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && isParseableFile(entry.name)) {
          files.push(fullPath);
        }
      }
    };

    walk(projectPath);
    return files;
  }

  /**
   * Parse files with progress updates
   */
  private async parseFilesWithProgress(
    projectId: string,
    files: string[],
    signal: AbortSignal
  ): Promise<{ results: ParseResult[]; errors: { filePath: string; error: string }[] }> {
    const results: ParseResult[] = [];
    const errors: { filePath: string; error: string }[] = [];

    // Parse files in batches to allow progress updates
    const batchSize = 50;
    const totalBatches = Math.ceil(files.length / batchSize);

    for (let i = 0; i < totalBatches; i++) {
      if (signal.aborted) {
        throw new Error('Parse cancelled');
      }

      const start = i * batchSize;
      const end = Math.min(start + batchSize, files.length);
      const batch = files.slice(start, end);

      const batchResult = await parseFiles(batch);
      results.push(...batchResult.results);
      errors.push(...batchResult.errors);

      // Calculate progress (20-90 range for parsing phase)
      const progress = 20 + Math.round(((i + 1) / totalBatches) * 70);

      this.emitStatus(projectId, {
        phase: 'parsing',
        progress,
        totalFiles: files.length,
        filesParsed: end,
        currentFile: batch[batch.length - 1],
        message: `Parsed ${end} of ${files.length} files`
      });
    }

    return { results, errors };
  }

  /**
   * Get the cache file path for a project
   */
  private getCachePath(projectPath: string): string {
    return path.join(projectPath, '.auto-claude', CACHE_DIR, CACHE_FILENAME);
  }

  /**
   * Load graph cache from disk
   */
  private async loadGraphCache(projectPath: string): Promise<GraphCache | null> {
    const cachePath = this.getCachePath(projectPath);

    try {
      if (!fs.existsSync(cachePath)) {
        return null;
      }

      const content = fs.readFileSync(cachePath, 'utf-8');
      const cache = JSON.parse(content) as GraphCache;

      // Check version
      if (cache.version !== CACHE_VERSION) {
        return null;
      }

      // Restore Date objects
      cache.graph.generatedAt = new Date(cache.graph.generatedAt);

      return cache;
    } catch {
      return null;
    }
  }

  /**
   * Save graph cache to disk
   */
  private async saveGraphCache(
    projectPath: string,
    graph: GraphData,
    fileTimestamps: Record<string, number>
  ): Promise<void> {
    const cachePath = this.getCachePath(projectPath);
    const cacheDir = path.dirname(cachePath);

    try {
      // Ensure cache directory exists
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }

      const cache: GraphCache = {
        graph,
        version: CACHE_VERSION,
        fileTimestamps
      };

      fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
    } catch {
      // Ignore cache write errors
    }
  }

  /**
   * Validate cache by checking file timestamps
   */
  private async validateCache(
    cache: GraphCache,
    projectPath: string
  ): Promise<boolean> {
    try {
      // Quick validation: check a sample of files
      const timestamps = cache.fileTimestamps;
      const filePaths = Object.keys(timestamps);

      // If no timestamps recorded, cache is invalid
      if (filePaths.length === 0) {
        return false;
      }

      // Check up to 10 random files for changes
      const sampleSize = Math.min(10, filePaths.length);
      const sample = filePaths.sort(() => Math.random() - 0.5).slice(0, sampleSize);

      for (const filePath of sample) {
        const fullPath = path.isAbsolute(filePath)
          ? filePath
          : path.join(projectPath, filePath);

        try {
          const stats = fs.statSync(fullPath);
          const currentMtime = stats.mtimeMs;
          const cachedMtime = timestamps[filePath];

          if (currentMtime > cachedMtime) {
            return false; // File has been modified
          }
        } catch {
          // File was deleted - cache is stale
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get file modification timestamps
   */
  private async getFileTimestamps(
    files: string[]
  ): Promise<Record<string, number>> {
    const timestamps: Record<string, number> = {};

    for (const filePath of files) {
      try {
        const stats = fs.statSync(filePath);
        timestamps[filePath] = stats.mtimeMs;
      } catch {
        // Skip files that can't be read
      }
    }

    return timestamps;
  }
}

// ============================================
// Singleton Instance
// ============================================

/** Singleton explorer service instance */
export const explorerService = new ExplorerService();
