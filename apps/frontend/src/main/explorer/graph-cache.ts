/**
 * Graph Cache for Codebase Explorer
 *
 * Provides caching for parse results and built graphs to improve performance
 * and reduce redundant parsing operations.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import type { GraphData } from '../../shared/types';
import type { UnifiedParseResult } from './types';

// ============================================
// Types
// ============================================

/**
 * Cache entry with timestamp and optional file hash
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  fileHash?: string;
}

/**
 * Statistics about cache usage
 */
export interface CacheStats {
  parseEntries: number;
  graphEntries: number;
  totalMemoryBytes: number;
  hitRate: number;
  missRate: number;
}

/**
 * Internal tracking for cache metrics
 */
interface CacheMetrics {
  hits: number;
  misses: number;
}

// ============================================
// Configuration
// ============================================

/**
 * Default cache configuration
 */
const DEFAULT_CONFIG = {
  /** Cache entry TTL in milliseconds (1 hour) */
  ttl: 60 * 60 * 1000,
  /** Maximum number of parse entries to cache */
  maxParseEntries: 1000,
  /** Maximum number of graph entries to cache */
  maxGraphEntries: 10,
  /** Enable file hash validation */
  validateHash: true,
};

// ============================================
// Cache Implementation
// ============================================

/**
 * Graph cache for parse results and built graphs
 *
 * Features:
 * - File-level caching for parse results
 * - Project-level caching for built graphs
 * - Cache invalidation when files change
 * - TTL (time-to-live) for cache entries
 * - Memory-efficient (limit cache size)
 * - File hash validation for accuracy
 */
export class GraphCache {
  private parseCache: Map<string, CacheEntry<UnifiedParseResult>>;
  private graphCache: Map<string, CacheEntry<GraphData>>;
  private metrics: CacheMetrics;
  private config: typeof DEFAULT_CONFIG;

  constructor(config?: Partial<typeof DEFAULT_CONFIG>) {
    this.parseCache = new Map();
    this.graphCache = new Map();
    this.metrics = { hits: 0, misses: 0 };
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ============================================
  // Parse Result Cache
  // ============================================

  /**
   * Get cached parse result if valid
   *
   * @param filePath - Absolute file path
   * @returns Cached parse result or null if not found/invalid
   */
  getParseResult(filePath: string): UnifiedParseResult | null {
    const entry = this.parseCache.get(filePath);

    if (!entry) {
      this.metrics.misses++;
      return null;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > this.config.ttl) {
      this.parseCache.delete(filePath);
      this.metrics.misses++;
      return null;
    }

    // Validate file hash if enabled
    if (this.config.validateHash && entry.fileHash) {
      const currentHash = this.computeFileHash(filePath);
      if (currentHash !== entry.fileHash) {
        this.parseCache.delete(filePath);
        this.metrics.misses++;
        return null;
      }
    }

    this.metrics.hits++;
    return entry.data;
  }

  /**
   * Cache a parse result
   *
   * @param filePath - Absolute file path
   * @param result - Parse result to cache
   */
  setParseResult(filePath: string, result: UnifiedParseResult): void {
    // Enforce size limit by removing oldest entries
    if (this.parseCache.size >= this.config.maxParseEntries) {
      this.evictOldestParseEntry();
    }

    const fileHash = this.config.validateHash
      ? this.computeFileHash(filePath)
      : undefined;

    this.parseCache.set(filePath, {
      data: result,
      timestamp: Date.now(),
      fileHash,
    });
  }

  // ============================================
  // Graph Cache
  // ============================================

  /**
   * Get cached graph for project
   *
   * @param projectId - Unique project identifier
   * @returns Cached graph data or null if not found/invalid
   */
  getGraph(projectId: string): GraphData | null {
    const entry = this.graphCache.get(projectId);

    if (!entry) {
      this.metrics.misses++;
      return null;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > this.config.ttl) {
      this.graphCache.delete(projectId);
      this.metrics.misses++;
      return null;
    }

    this.metrics.hits++;
    return entry.data;
  }

  /**
   * Cache a built graph
   *
   * @param projectId - Unique project identifier
   * @param graph - Graph data to cache
   */
  setGraph(projectId: string, graph: GraphData): void {
    // Enforce size limit by removing oldest entries
    if (this.graphCache.size >= this.config.maxGraphEntries) {
      this.evictOldestGraphEntry();
    }

    this.graphCache.set(projectId, {
      data: graph,
      timestamp: Date.now(),
    });
  }

  // ============================================
  // Invalidation
  // ============================================

  /**
   * Invalidate cache for a file (when file changes)
   *
   * @param filePath - Absolute file path
   */
  invalidateFile(filePath: string): void {
    this.parseCache.delete(filePath);
  }

  /**
   * Invalidate entire project cache
   *
   * @param projectId - Unique project identifier
   */
  invalidateProject(projectId: string): void {
    this.graphCache.delete(projectId);
  }

  /**
   * Clear all caches
   */
  clear(): void {
    this.parseCache.clear();
    this.graphCache.clear();
    this.metrics = { hits: 0, misses: 0 };
  }

  // ============================================
  // Statistics
  // ============================================

  /**
   * Get cache statistics
   *
   * @returns Cache statistics including hit rate and memory usage
   */
  getStats(): CacheStats {
    const totalRequests = this.metrics.hits + this.metrics.misses;
    const hitRate = totalRequests > 0 ? this.metrics.hits / totalRequests : 0;
    const missRate = totalRequests > 0 ? this.metrics.misses / totalRequests : 0;

    // Estimate memory usage
    let totalMemoryBytes = 0;

    // Parse cache memory
    for (const entry of this.parseCache.values()) {
      totalMemoryBytes += this.estimateEntrySize(entry);
    }

    // Graph cache memory
    for (const entry of this.graphCache.values()) {
      totalMemoryBytes += this.estimateEntrySize(entry);
    }

    return {
      parseEntries: this.parseCache.size,
      graphEntries: this.graphCache.size,
      totalMemoryBytes,
      hitRate,
      missRate,
    };
  }

  // ============================================
  // Private Helpers
  // ============================================

  /**
   * Compute SHA256 hash of a file
   *
   * @param filePath - Absolute file path
   * @returns File hash or empty string if file doesn't exist
   */
  private computeFileHash(filePath: string): string {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return crypto.createHash('sha256').update(content).digest('hex');
    } catch {
      return '';
    }
  }

  /**
   * Evict oldest parse cache entry
   */
  private evictOldestParseEntry(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.parseCache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.parseCache.delete(oldestKey);
    }
  }

  /**
   * Evict oldest graph cache entry
   */
  private evictOldestGraphEntry(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.graphCache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.graphCache.delete(oldestKey);
    }
  }

  /**
   * Estimate memory size of a cache entry
   *
   * @param entry - Cache entry to estimate
   * @returns Estimated size in bytes
   */
  private estimateEntrySize(entry: CacheEntry<unknown>): number {
    try {
      // Rough estimate using JSON serialization
      const json = JSON.stringify(entry);
      return json.length * 2; // UTF-16 encoding
    } catch {
      return 1024; // Default estimate if serialization fails
    }
  }
}

// ============================================
// Singleton Instance
// ============================================

/**
 * Global graph cache instance
 */
export const graphCache = new GraphCache();
