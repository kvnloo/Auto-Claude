/**
 * Parser metrics module for tracking parsing performance and statistics
 *
 * This module provides:
 * - Recording individual parse operations with timing and metadata
 * - Aggregated statistics by parser backend and language
 * - Performance monitoring and rate calculations
 */

import type { ParserBackend, ParserLanguage } from './types';

/**
 * Single parse operation metric
 */
export interface ParseMetric {
  /** File path that was parsed */
  filePath: string;
  /** Parser backend used (oxc or tree-sitter) */
  parser: ParserBackend;
  /** Programming language */
  language: ParserLanguage;
  /** Time taken to parse in milliseconds */
  parseTimeMs: number;
  /** Number of symbols extracted */
  symbolCount: number;
  /** Number of imports found */
  importCount: number;
  /** Lines of code in the file */
  loc: number;
  /** Unix timestamp when parse occurred */
  timestamp: number;
}

/**
 * Aggregated statistics about parser performance
 */
export interface ParserStats {
  /** Total number of files parsed */
  totalFiles: number;
  /** Total time spent parsing in milliseconds */
  totalTimeMs: number;
  /** Statistics by parser backend */
  byParser: {
    oxc: { files: number; timeMs: number; avgTimeMs: number };
    treeSitter: { files: number; timeMs: number; avgTimeMs: number };
  };
  /** Statistics by language */
  byLanguage: Record<ParserLanguage, { files: number; timeMs: number }>;
  /** Parsing rate (files per second) */
  filesPerSecond: number;
}

/**
 * Parser metrics tracker
 *
 * Singleton instance for tracking parsing performance across the application.
 */
export class ParserMetrics {
  private metrics: ParseMetric[] = [];

  /**
   * Record a parse operation
   */
  record(metric: ParseMetric): void {
    this.metrics.push(metric);
  }

  /**
   * Get all recorded metrics
   */
  getAll(): ParseMetric[] {
    return [...this.metrics];
  }

  /**
   * Get aggregated statistics
   */
  getStats(): ParserStats {
    const totalFiles = this.metrics.length;
    const totalTimeMs = this.metrics.reduce((sum, m) => sum + m.parseTimeMs, 0);

    // Stats by parser
    const oxcMetrics = this.metrics.filter((m) => m.parser === 'oxc');
    const treeSitterMetrics = this.metrics.filter((m) => m.parser === 'tree-sitter');

    const oxcTimeMs = oxcMetrics.reduce((sum, m) => sum + m.parseTimeMs, 0);
    const treeSitterTimeMs = treeSitterMetrics.reduce((sum, m) => sum + m.parseTimeMs, 0);

    // Stats by language
    const byLanguage: Record<ParserLanguage, { files: number; timeMs: number }> = {
      typescript: { files: 0, timeMs: 0 },
      javascript: { files: 0, timeMs: 0 },
      python: { files: 0, timeMs: 0 },
    };

    for (const metric of this.metrics) {
      byLanguage[metric.language].files++;
      byLanguage[metric.language].timeMs += metric.parseTimeMs;
    }

    // Calculate parsing rate
    const filesPerSecond = totalTimeMs > 0 ? (totalFiles / totalTimeMs) * 1000 : 0;

    return {
      totalFiles,
      totalTimeMs,
      byParser: {
        oxc: {
          files: oxcMetrics.length,
          timeMs: oxcTimeMs,
          avgTimeMs: oxcMetrics.length > 0 ? oxcTimeMs / oxcMetrics.length : 0,
        },
        treeSitter: {
          files: treeSitterMetrics.length,
          timeMs: treeSitterTimeMs,
          avgTimeMs: treeSitterMetrics.length > 0 ? treeSitterTimeMs / treeSitterMetrics.length : 0,
        },
      },
      byLanguage,
      filesPerSecond,
    };
  }

  /**
   * Get stats for a specific parser backend
   */
  getParserStats(parser: ParserBackend): { files: number; timeMs: number; avgTimeMs: number } {
    const parserMetrics = this.metrics.filter((m) => m.parser === parser);
    const timeMs = parserMetrics.reduce((sum, m) => sum + m.parseTimeMs, 0);
    const files = parserMetrics.length;
    const avgTimeMs = files > 0 ? timeMs / files : 0;

    return { files, timeMs, avgTimeMs };
  }

  /**
   * Clear all recorded metrics
   */
  clear(): void {
    this.metrics = [];
  }

  /**
   * Get recent metrics (last N operations)
   */
  getRecent(count: number): ParseMetric[] {
    const startIndex = Math.max(0, this.metrics.length - count);
    return this.metrics.slice(startIndex);
  }

  /**
   * Calculate current parsing rate (files per second)
   */
  getParsingRate(): number {
    const totalTimeMs = this.metrics.reduce((sum, m) => sum + m.parseTimeMs, 0);
    return totalTimeMs > 0 ? (this.metrics.length / totalTimeMs) * 1000 : 0;
  }
}

/**
 * Singleton instance for global metrics tracking
 */
export const parserMetrics = new ParserMetrics();

/**
 * Helper to measure parse time for an async operation
 *
 * @param fn - Async function to measure
 * @returns Promise with result and time taken
 *
 * @example
 * ```ts
 * const { result, timeMs } = await measureParseTime(() => parseFile(path));
 * console.log(`Parsed in ${timeMs}ms`);
 * ```
 */
export async function measureParseTime<T>(fn: () => Promise<T>): Promise<{ result: T; timeMs: number }> {
  const startTime = performance.now();
  const result = await fn();
  const timeMs = performance.now() - startTime;
  return { result, timeMs };
}
