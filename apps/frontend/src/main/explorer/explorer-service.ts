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
  type ParseResult
} from './tree-sitter-parser';
import { buildGraph, type GraphBuilderConfig } from './graph-builder';

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
        await initTreeSitter();
        this.initialized = true;
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

      const files = await this.discoverFiles(projectPath);

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
      const message = error instanceof Error ? error.message : String(error);

      if (message !== 'Parse cancelled') {
        this.emitStatus(projectId, {
          phase: 'error',
          progress: 0,
          message: 'Parse failed',
          error: message
        });
        this.emit('parse-error', projectId, message);
      }

      throw error;
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
    const result = await this.parseProject(projectId, projectPath, { force: true });
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
