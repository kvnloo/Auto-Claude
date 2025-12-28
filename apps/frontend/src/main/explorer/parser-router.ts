/**
 * Parser Router - Routes files to appropriate parser backend
 *
 * This module provides intelligent routing between OXC (fast JS/TS) and
 * tree-sitter (Python) parsers based on file extensions.
 *
 * Key features:
 * - Extension-based routing
 * - Parallel batch parsing
 * - Error handling and statistics
 * - Parser initialization
 */

import path from 'path';
import type {
  ParserBackend,
  UnifiedParseResult,
  ParserLanguage,
  EXTENSION_TO_LANGUAGE,
} from './types';

// Import parser backends
import { parseFile as parseWithOxc } from './oxc-parser';
import { parseFile as parseWithTreeSitter, initTreeSitter } from './tree-sitter-parser';

// ============================================
// Extension to Parser Mapping
// ============================================

/**
 * Maps file extensions to their parser backend
 */
const PARSER_MAP: Record<string, ParserBackend> = {
  '.ts': 'oxc',
  '.tsx': 'oxc',
  '.js': 'oxc',
  '.jsx': 'oxc',
  '.mjs': 'oxc',
  '.cjs': 'oxc',
  '.py': 'tree-sitter',
  '.pyi': 'tree-sitter',
};

/**
 * Supported extensions (union of all parsers)
 */
const SUPPORTED_EXTENSIONS = Object.keys(PARSER_MAP);

// ============================================
// Parser Selection
// ============================================

/**
 * Get the parser backend for a file based on its extension
 *
 * @param filePath - Absolute or relative path to the file
 * @returns The parser backend to use, or null if unsupported
 */
export function getParserForFile(filePath: string): ParserBackend | null {
  const ext = path.extname(filePath).toLowerCase();
  return PARSER_MAP[ext] ?? null;
}

/**
 * Check if a file is parseable by any available parser
 *
 * @param filePath - Path to the file
 * @returns True if the file can be parsed
 */
export function isParseableFile(filePath: string): boolean {
  return getParserForFile(filePath) !== null;
}

/**
 * Get supported extensions for a specific parser backend
 *
 * @param parser - The parser backend
 * @returns Array of file extensions supported by this parser
 */
export function getExtensionsForParser(parser: ParserBackend): string[] {
  return Object.entries(PARSER_MAP)
    .filter(([_, backend]) => backend === parser)
    .map(([ext, _]) => ext);
}

/**
 * Get all supported file extensions across all parsers
 *
 * @returns Array of supported extensions
 */
export function getSupportedExtensions(): string[] {
  return [...SUPPORTED_EXTENSIONS];
}

// ============================================
// Single File Parsing
// ============================================

/**
 * Parse a single file using the appropriate parser backend
 *
 * @param filePath - Absolute path to the file
 * @returns Unified parse result, or null if file type is unsupported
 * @throws Error if parsing fails (caller should handle)
 */
export async function parseFile(filePath: string): Promise<UnifiedParseResult | null> {
  const parser = getParserForFile(filePath);

  if (!parser) {
    return null;
  }

  try {
    switch (parser) {
      case 'oxc':
        return await parseWithOxc(filePath);
      case 'tree-sitter':
        return await parseWithTreeSitter(filePath);
      default:
        // TypeScript exhaustiveness check
        const _exhaustive: never = parser;
        throw new Error(`Unknown parser: ${_exhaustive}`);
    }
  } catch (error) {
    throw new Error(
      `Failed to parse ${filePath} with ${parser}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ============================================
// Batch File Parsing
// ============================================

/**
 * Statistics from batch parsing
 */
export interface BatchParseStats {
  /** Number of files parsed with OXC */
  oxcCount: number;
  /** Number of files parsed with tree-sitter */
  treeSitterCount: number;
  /** Total parsing time in milliseconds */
  totalTimeMs: number;
}

/**
 * Result from batch parsing multiple files
 */
export interface BatchParseResult {
  /** Successfully parsed files */
  results: UnifiedParseResult[];
  /** Files that failed to parse */
  errors: Array<{ filePath: string; error: string }>;
  /** Parsing statistics */
  stats: BatchParseStats;
}

/**
 * Parse multiple files in parallel, routing to correct parsers
 *
 * This function:
 * - Routes each file to the appropriate parser
 * - Parses files in parallel for performance
 * - Collects errors without failing the batch
 * - Provides statistics on parser usage
 *
 * @param filePaths - Array of absolute file paths
 * @returns Batch parse result with results, errors, and statistics
 */
export async function parseFiles(filePaths: string[]): Promise<BatchParseResult> {
  const startTime = performance.now();

  const results: UnifiedParseResult[] = [];
  const errors: Array<{ filePath: string; error: string }> = [];

  let oxcCount = 0;
  let treeSitterCount = 0;

  // Parse all files in parallel
  const parsePromises = filePaths.map(async (filePath) => {
    try {
      const result = await parseFile(filePath);

      if (result) {
        results.push(result);

        // Track which parser was used
        if (result.parser === 'oxc') {
          oxcCount++;
        } else if (result.parser === 'tree-sitter') {
          treeSitterCount++;
        }
      } else {
        // File type not supported
        errors.push({
          filePath,
          error: 'Unsupported file type',
        });
      }
    } catch (error) {
      errors.push({
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Wait for all parses to complete
  await Promise.all(parsePromises);

  const totalTimeMs = performance.now() - startTime;

  return {
    results,
    errors,
    stats: {
      oxcCount,
      treeSitterCount,
      totalTimeMs,
    },
  };
}

// ============================================
// Parser Initialization
// ============================================

/**
 * Initialize all parser backends
 *
 * This should be called once on application startup to prepare
 * all parsers for use.
 *
 * @throws Error if any parser fails to initialize
 */
export async function initializeParsers(): Promise<void> {
  console.log('[Parser Router] Initializing all parsers...');

  try {
    // OXC parser doesn't require initialization (native bindings)
    // Only tree-sitter needs initialization
    await initTreeSitter();

    console.log('[Parser Router] All parsers initialized successfully');
  } catch (error) {
    throw new Error(
      `Failed to initialize parsers: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
