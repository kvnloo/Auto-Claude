/**
 * Parser Module - Central export point for all parser-related functionality
 *
 * This module provides a clean, organized interface for working with code parsers.
 * It re-exports all parser types, implementations, utilities, and metrics from their
 * respective modules.
 *
 * Usage:
 * ```typescript
 * // Simple usage - just parse files
 * import { parseFile, parseFiles } from './explorer/parser';
 *
 * // Advanced usage - with types and metrics
 * import { parseFiles, ParserStats, parserMetrics } from './explorer/parser';
 *
 * // Custom parser implementation
 * import { IParser, ParserFactory } from './explorer/parser';
 * ```
 */

// ============================================
// Core Types
// ============================================

/**
 * Re-export shared types from the main types module.
 * These are the fundamental types used across all parsers.
 */
export type {
  // Parser identification and results
  ParserBackend,
  UnifiedParseResult,

  // Extracted data structures
  ExtractedSymbol,
  ExtractedImport,

  // Language and file information
  ParserLanguage,
} from '../types';

// ============================================
// Main Entry Point - Parser Router
// ============================================

/**
 * The parser router is the recommended way to parse files.
 * It automatically selects the appropriate parser backend based on file extension.
 *
 * Use these functions for most parsing needs:
 * - parseFile() - Parse a single file
 * - parseFiles() - Parse multiple files in parallel
 * - initializeParsers() - Initialize all parsers (optional, happens automatically)
 * - isParseableFile() - Check if a file can be parsed
 * - getParserForFile() - Get the parser backend for a file
 */
export {
  // Core parsing functions
  parseFile,
  parseFiles,
  initializeParsers,

  // Utility functions
  isParseableFile,
  getParserForFile,
  getExtensionsForParser,
  getSupportedExtensions,
} from '../parser-router';

/**
 * Batch parsing result types
 */
export type { BatchParseStats, BatchParseResult } from '../parser-router';

// ============================================
// Parser Implementations (Direct Access)
// ============================================

/**
 * Direct access to parser implementations.
 * Use these when you need backend-specific functionality or want to bypass routing.
 *
 * OXC Parser (JavaScript/TypeScript):
 * - Fast, native JavaScript/TypeScript parser
 * - Supports .js, .jsx, .ts, .tsx, .mjs, .cjs files
 *
 * Tree-sitter Parser (Python):
 * - Universal parser with Python support
 * - Supports .py, .pyi files
 */
export * as oxcParser from '../oxc-parser';
export * as treeSitterParser from '../tree-sitter-parser';

// ============================================
// Parser Factory (Advanced)
// ============================================

/**
 * Parser factory for managing parser instances with lazy initialization.
 *
 * Use this for:
 * - Custom parser lifecycle management
 * - Testing scenarios requiring parser isolation
 * - Advanced use cases needing explicit initialization control
 */
export { ParserFactory, parserFactory } from '../parser-factory';

// ============================================
// Parser Interface (For Custom Parsers)
// ============================================

/**
 * Common interface for all parser adapters.
 * Implement this interface to create custom parser backends.
 *
 * Included adapters:
 * - OxcParserAdapter - Wraps the OXC parser
 * - TreeSitterParserAdapter - Wraps tree-sitter parsers
 */
export type { IParser } from '../parser-interface';
export {
  OxcParserAdapter,
  TreeSitterParserAdapter,
  createParser,
  createParserWithBackend,
} from '../parser-interface';

// ============================================
// Error Types
// ============================================

/**
 * Structured error types for parser failures.
 *
 * All parser errors extend ParserError and include:
 * - Specific error context (file path, parser backend, language)
 * - Original error cause for debugging
 * - Helpful error messages
 */
export {
  // Base error class
  ParserError,

  // Specific error types
  ParseError,
  ParserInitializationError,
  UnsupportedLanguageError,
  WasmLoadError,

  // Error utilities
  wrapError,
} from '../parser-errors';

// ============================================
// Metrics & Performance Monitoring
// ============================================

/**
 * Parser performance tracking and statistics.
 *
 * Use the singleton `parserMetrics` instance to:
 * - Track parsing performance across the application
 * - Get aggregated statistics by parser and language
 * - Monitor parsing rates and identify bottlenecks
 *
 * The `measureParseTime` helper simplifies timing async operations.
 */
export { ParserMetrics, parserMetrics, measureParseTime } from '../parser-metrics';

/**
 * Metrics types for parse operations and aggregated statistics
 */
export type { ParseMetric, ParserStats } from '../parser-metrics';

// ============================================
// Usage Examples
// ============================================

/**
 * Example 1: Parse a single file
 * ```typescript
 * import { parseFile } from './explorer/parser';
 *
 * const result = await parseFile('/path/to/file.ts');
 * if (result) {
 *   console.log('Symbols:', result.symbols);
 *   console.log('Imports:', result.imports);
 * }
 * ```
 *
 * Example 2: Parse multiple files with metrics
 * ```typescript
 * import { parseFiles, parserMetrics } from './explorer/parser';
 *
 * const { results, errors, stats } = await parseFiles([
 *   '/path/to/file1.ts',
 *   '/path/to/file2.py',
 * ]);
 *
 * console.log('Parsed:', results.length);
 * console.log('Failed:', errors.length);
 * console.log('Stats:', parserMetrics.getStats());
 * ```
 *
 * Example 3: Custom parser usage
 * ```typescript
 * import { createParser, IParser } from './explorer/parser';
 *
 * const parser: IParser = await createParser('typescript');
 * await parser.initialize();
 * const result = await parser.parseFile('/path/to/file.ts');
 * ```
 *
 * Example 4: Error handling
 * ```typescript
 * import { parseFile, ParseError, UnsupportedLanguageError } from './explorer/parser';
 *
 * try {
 *   const result = await parseFile(filePath);
 * } catch (error) {
 *   if (error instanceof UnsupportedLanguageError) {
 *     console.log('File type not supported');
 *   } else if (error instanceof ParseError) {
 *     console.log('Parse failed:', error.message);
 *   }
 * }
 * ```
 */
