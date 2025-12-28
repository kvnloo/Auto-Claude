/**
 * Explorer backend types for Tree-sitter parsing and graph building
 *
 * This module consolidates types used in the main process explorer functionality:
 * - Tree-sitter parsing types
 * - Unified parser types (OXC and Tree-sitter)
 * - File analysis types
 * - Graph building types
 *
 * Frontend-facing types (GraphNode, GraphEdge, etc.) are in shared/types/explorer.ts
 *
 * @module types
 */

import type { ParserLanguage, NodeType } from '../../shared/types';

// Re-export shared types for convenience
export type { ParserLanguage, NodeType } from '../../shared/types';

// ============================================
// Parse Result Types
// ============================================

/**
 * Result from parsing a single file with Tree-sitter
 */
export interface ParseResult {
  /** The parsed AST tree */
  tree: TreeSitterTree;
  /** Language used for parsing */
  language: ParserLanguage;
  /** Absolute file path that was parsed */
  filePath: string;
  /** Time taken to parse in milliseconds */
  parseTimeMs: number;
}

/**
 * Result from parsing multiple files
 */
export interface BatchParseResult {
  /** Successfully parsed files */
  results: ParseResult[];
  /** Files that failed to parse */
  errors: FileParseError[];
  /** Total time for batch parsing in milliseconds */
  totalTimeMs: number;
}

/**
 * Error from a failed file parse
 */
export interface FileParseError {
  /** File path that failed */
  filePath: string;
  /** Error message */
  error: string;
  /** Language attempted if known */
  language?: ParserLanguage;
}

// ============================================
// Tree-sitter Types
// ============================================

/**
 * Tree-sitter syntax tree
 */
export interface TreeSitterTree {
  readonly rootNode: TreeSitterNode;
  delete(): void;
}

/**
 * Tree-sitter syntax node
 */
export interface TreeSitterNode {
  readonly type: string;
  readonly text: string;
  readonly startPosition: { row: number; column: number };
  readonly endPosition: { row: number; column: number };
  readonly startIndex: number;
  readonly endIndex: number;
  readonly childCount: number;
  readonly children: TreeSitterNode[];
  readonly namedChildCount: number;
  readonly namedChildren: TreeSitterNode[];
  readonly parent: TreeSitterNode | null;
  readonly firstChild: TreeSitterNode | null;
  readonly lastChild: TreeSitterNode | null;
  readonly nextSibling: TreeSitterNode | null;
  readonly previousSibling: TreeSitterNode | null;
  readonly firstNamedChild: TreeSitterNode | null;
  readonly lastNamedChild: TreeSitterNode | null;
  readonly nextNamedSibling: TreeSitterNode | null;
  readonly previousNamedSibling: TreeSitterNode | null;
  child(index: number): TreeSitterNode | null;
  namedChild(index: number): TreeSitterNode | null;
  childForFieldName(fieldName: string): TreeSitterNode | null;
  descendantForPosition(position: { row: number; column: number }): TreeSitterNode;
}

/**
 * Tree-sitter language grammar
 */
export interface TreeSitterLanguage {
  readonly version: number;
  readonly fieldCount: number;
  readonly nodeTypeCount: number;
  fieldNameForId(fieldId: number): string | null;
  fieldIdForName(fieldName: string): number | null;
}

/**
 * Tree-sitter parser instance
 */
export interface TreeSitterParser {
  parse(
    input: string | ((index: number, position?: { row: number; column: number }) => string | null),
    oldTree?: TreeSitterTree
  ): TreeSitterTree;
  setLanguage(language: TreeSitterLanguage): void;
  getLanguage(): TreeSitterLanguage | null;
  delete(): void;
}

// ============================================
// Unified Parser Types
// ============================================

/**
 * Parser backend identifier
 *
 * - `oxc`: High-performance Rust-based parser for JavaScript/TypeScript (fastest)
 * - `tree-sitter`: Universal parser supporting TypeScript, JavaScript, and Python
 */
export type ParserBackend = 'oxc' | 'tree-sitter';

/**
 * Extracted symbol representation (used by unified parsers)
 *
 * Represents a code symbol (class, function, variable, etc.) extracted during parsing.
 * This is a unified format used by both OXC and Tree-sitter parsers.
 */
export interface ExtractedSymbol {
  /** Symbol name (e.g., "MyClass", "myFunction") */
  name: string;
  /** Type of symbol (class, function, symbol, etc.) */
  type: NodeType;
  /** Starting line number in the source file (1-indexed) */
  startLine: number;
  /** Ending line number in the source file (1-indexed) */
  endLine: number;
  /** Documentation string (JSDoc, docstring, etc.) if present */
  docstring?: string;
  /** Function/method signature if applicable */
  signature?: string;
  /** Function parameter names if applicable */
  parameters?: string[];
  /** Return type annotation if available */
  returnType?: string;
  /** Parent class name for methods */
  parentClass?: string;
  /** Whether this symbol is exported from the module */
  exports: boolean;
  /** Nested symbols (e.g., methods in a class) */
  children: ExtractedSymbol[];
}

/**
 * Extracted import statement (used by unified parsers)
 *
 * Represents an import statement found during parsing.
 * Supports ES6 imports, CommonJS requires, and Python imports.
 */
export interface ExtractedImport {
  /** Module/file being imported from (e.g., "react", "./utils") */
  source: string;
  /** Specific items imported (or ['*'] for star imports) */
  items: string[];
  /** Whether it's a default import (import X from 'y') */
  isDefault?: boolean;
  /** Whether it's a relative import (starts with . or /) */
  isRelative?: boolean;
}

/**
 * Unified parse result from either parser
 *
 * This is the standardized output format from both OXC and Tree-sitter parsers.
 * It contains extracted symbols, imports, and metadata about the parse operation.
 */
export interface UnifiedParseResult {
  /** Extracted symbols (classes, functions, variables, etc.) */
  symbols: ExtractedSymbol[];
  /** Import statements found in the file */
  imports: ExtractedImport[];
  /** Programming language of the parsed file */
  language: ParserLanguage;
  /** Absolute file path that was parsed */
  filePath: string;
  /** Time taken to parse in milliseconds */
  parseTimeMs: number;
  /** Which parser was used (oxc or tree-sitter) */
  parser: ParserBackend;
  /** Total lines of code in the file */
  loc: number;
}

// ============================================
// File Analysis Types
// ============================================

/**
 * Analysis of a single source file
 */
export interface FileAnalysis {
  /** Relative path from project root */
  relativePath: string;
  /** Absolute path to the file */
  absolutePath: string;
  /** Programming language of the file */
  language: ParserLanguage;
  /** Lines of code in the file */
  loc: number;
  /** Symbols defined in the file (classes, functions, etc.) */
  symbols: SymbolInfo[];
  /** Import statements in the file */
  imports: ImportInfo[];
  /** Exports from the file */
  exports: ExportInfo[];
  /** File modification timestamp */
  modifiedAt: number;
  /** Parse time in milliseconds */
  parseTimeMs: number;
}

/**
 * Information about a symbol (class, function, variable) in a file
 */
export interface SymbolInfo {
  /** Symbol name */
  name: string;
  /** Type of symbol */
  type: NodeType;
  /** Starting line number (1-indexed) */
  startLine: number;
  /** Ending line number (1-indexed) */
  endLine: number;
  /** Docstring or comment if present */
  docstring?: string;
  /** Function signature if applicable */
  signature?: string;
  /** Function parameters if applicable */
  parameters?: string[];
  /** Return type if applicable */
  returnType?: string;
  /** Parent class name for methods */
  parentClass?: string;
  /** Whether this symbol is exported */
  isExported: boolean;
  /** Nested symbols (e.g., methods in a class) */
  children: SymbolInfo[];
}

/**
 * Information about an import statement
 */
export interface ImportInfo {
  /** Module or file being imported from */
  source: string;
  /** Specific items imported (or ['*'] for wildcard) */
  items: string[];
  /** Whether it's a default import */
  isDefault: boolean;
  /** Whether it's a relative import (starts with . or /) */
  isRelative: boolean;
  /** Line number of the import statement */
  line: number;
}

/**
 * Information about an export
 */
export interface ExportInfo {
  /** Name of the exported symbol */
  name: string;
  /** Type of the exported symbol */
  type: NodeType;
  /** Whether it's the default export */
  isDefault: boolean;
  /** Line number of the export */
  line: number;
}

// ============================================
// Project Analysis Types
// ============================================

/**
 * Analysis configuration options
 */
export interface AnalysisConfig {
  /** Project root path */
  projectRoot: string;
  /** Project identifier */
  projectId: string;
  /** Include symbols at depth level 5 */
  includeSymbols?: boolean;
  /** Maximum files to process (for large repos) */
  maxFiles?: number;
  /** Paths to exclude from analysis */
  excludePaths?: string[];
  /** Only analyze these file extensions */
  includeExtensions?: string[];
}

/**
 * Statistics about a project analysis
 */
export interface AnalysisStats {
  /** Total files discovered */
  totalFilesDiscovered: number;
  /** Files successfully parsed */
  filesParsed: number;
  /** Files that failed to parse */
  parseFailures: number;
  /** Files skipped (binary, too large, etc.) */
  filesSkipped: number;
  /** Total lines of code */
  totalLoc: number;
  /** Languages found in the project */
  languageBreakdown: Record<ParserLanguage, number>;
  /** Symbol counts by type */
  symbolCounts: Record<NodeType, number>;
  /** Total time taken in milliseconds */
  analysisTimeMs: number;
}

// ============================================
// Parser Configuration Types
// ============================================

/**
 * Status of the parser system
 */
export interface ParserStatus {
  /** Whether Tree-sitter is initialized */
  initialized: boolean;
  /** Languages with loaded parsers */
  loadedLanguages: ParserLanguage[];
  /** Supported file extensions */
  supportedExtensions: string[];
}

/**
 * Mapping of file extensions to languages
 */
export const EXTENSION_TO_LANGUAGE: Record<string, ParserLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyi': 'python',
};

/**
 * Languages supported for parsing
 */
export const SUPPORTED_LANGUAGES: ParserLanguage[] = ['typescript', 'javascript', 'python'];

/**
 * File extensions supported for parsing
 */
export const SUPPORTED_EXTENSIONS: string[] = Object.keys(EXTENSION_TO_LANGUAGE);

// ============================================
// Type Exports Summary
// ============================================

/**
 * This module exports the following type categories:
 *
 * **Graph/Node Types (re-exported from shared):**
 * - ParserLanguage - Programming language identifier
 * - NodeType - Type of code entity (file, class, function, etc.)
 *
 * **Parser Backend Types:**
 * - ParserBackend - Parser identifier ('oxc' | 'tree-sitter')
 * - UnifiedParseResult - Standardized parse output
 * - ExtractedSymbol - Code symbol representation
 * - ExtractedImport - Import statement representation
 *
 * **Tree-sitter Types:**
 * - ParseResult - Single file parse result
 * - BatchParseResult - Multi-file parse result
 * - FileParseError - Parse error information
 * - TreeSitterTree - Tree-sitter AST tree
 * - TreeSitterNode - Tree-sitter AST node
 * - TreeSitterLanguage - Tree-sitter grammar
 * - TreeSitterParser - Tree-sitter parser instance
 *
 * **File Analysis Types:**
 * - FileAnalysis - Complete file analysis result
 * - SymbolInfo - Symbol metadata
 * - ImportInfo - Import metadata
 * - ExportInfo - Export metadata
 *
 * **Project Analysis Types:**
 * - AnalysisConfig - Analysis configuration
 * - AnalysisStats - Analysis statistics
 *
 * **Parser Configuration:**
 * - ParserStatus - Parser system status
 * - EXTENSION_TO_LANGUAGE - Extension to language mapping
 * - SUPPORTED_LANGUAGES - Supported language list
 * - SUPPORTED_EXTENSIONS - Supported extension list
 *
 * Note: ParseMetric and ParserStats are defined in parser-metrics.ts
 */
