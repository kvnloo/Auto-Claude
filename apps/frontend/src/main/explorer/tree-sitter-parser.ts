/**
 * Tree-sitter WASM Parser Service
 *
 * Provides language parsing capabilities using Tree-sitter WASM for
 * Python, TypeScript, and JavaScript source code.
 *
 * Key features:
 * - Singleton initialization of Tree-sitter (expensive, done once)
 * - Parser caching per language
 * - Support for .ts, .tsx, .js, .jsx, .py files
 * - Error handling for missing WASM files
 */

import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import type { ParserLanguage } from '../../shared/types';

// ============================================
// Tree-sitter Types (from web-tree-sitter)
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
  parse(input: string | ((index: number, position?: { row: number; column: number }) => string | null), oldTree?: TreeSitterTree): TreeSitterTree;
  setLanguage(language: TreeSitterLanguage): void;
  getLanguage(): TreeSitterLanguage | null;
  delete(): void;
}

/**
 * Tree-sitter parser class with static methods
 */
interface TreeSitterParserClass {
  new(): TreeSitterParser;
  init(options?: { locateFile?: (scriptName: string, scriptDirectory?: string) => string }): Promise<void>;
  Language: {
    load(path: string): Promise<TreeSitterLanguage>;
  };
}

// ============================================
// Types
// ============================================

/**
 * Result from parsing a file
 */
export interface ParseResult {
  /** The parsed AST tree */
  tree: TreeSitterTree;
  /** Language used for parsing */
  language: ParserLanguage;
  /** File path that was parsed */
  filePath: string;
  /** Time taken to parse in milliseconds */
  parseTimeMs: number;
}

/**
 * Error thrown when parsing fails
 */
export class ParserError extends Error {
  constructor(
    message: string,
    public readonly filePath?: string,
    public readonly language?: ParserLanguage,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ParserError';
  }
}

// ============================================
// Module State (Singleton Pattern)
// ============================================

/** Whether Tree-sitter has been initialized */
let parserInitialized = false;

/** Cached parsers per language */
const parsers: Map<ParserLanguage, TreeSitterParser> = new Map();

/** Cached language instances */
const languages: Map<ParserLanguage, TreeSitterLanguage> = new Map();

/** Promise for ongoing initialization (prevents race conditions) */
let initPromise: Promise<void> | null = null;

/** The Parser class from web-tree-sitter (loaded dynamically) */
let ParserClass: TreeSitterParserClass | null = null;

// ============================================
// Path Resolution
// ============================================

/**
 * Get the path to Tree-sitter WASM files
 * Handles both development and production environments
 */
function getWasmBasePath(): string {
  // In production, WASM files are in resources/wasm
  // In development, they're in node_modules/web-tree-sitter or a local wasm folder
  const isDev = !app.isPackaged;

  if (isDev) {
    // Development: check for local wasm folder first, then node_modules
    const localWasmPath = path.join(app.getAppPath(), 'resources', 'wasm');
    if (fs.existsSync(localWasmPath)) {
      return localWasmPath;
    }
    // Fall back to node_modules for the core tree-sitter.wasm
    return path.join(app.getAppPath(), 'node_modules', 'web-tree-sitter');
  } else {
    // Production: look in resources
    return path.join(process.resourcesPath, 'wasm');
  }
}

/**
 * Get the WASM file path for a specific language grammar
 */
function getLanguageWasmPath(language: ParserLanguage): string {
  const basePath = getWasmBasePath();

  // Map language to WASM file name
  // Use TSX for TypeScript to support React/JSX syntax
  const wasmFileName = language === 'typescript'
    ? 'tree-sitter-tsx.wasm'
    : `tree-sitter-${language}.wasm`;

  return path.join(basePath, wasmFileName);
}

/**
 * Get the core Tree-sitter WASM path
 */
function getCoreWasmPath(): string {
  const isDev = !app.isPackaged;

  if (isDev) {
    // In development, use the one from node_modules
    return path.join(app.getAppPath(), 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm');
  } else {
    // In production, it should be bundled in resources
    return path.join(process.resourcesPath, 'wasm', 'tree-sitter.wasm');
  }
}

// ============================================
// Initialization
// ============================================

/**
 * Initialize the Tree-sitter WASM parser
 *
 * This is expensive and should only be called once.
 * Multiple calls are safe - subsequent calls return immediately.
 *
 * @throws ParserError if initialization fails
 */
export async function initTreeSitter(): Promise<void> {
  // Already initialized
  if (parserInitialized) {
    return;
  }

  // Initialization in progress - wait for it
  if (initPromise) {
    return initPromise;
  }

  // Start initialization
  initPromise = (async () => {
    try {
      // Dynamic import of web-tree-sitter
      // The module exports Parser as default
      const TreeSitterModule = await import('web-tree-sitter');
      // Handle both ESM default export and CJS module.exports
      ParserClass = (TreeSitterModule as { default?: TreeSitterParserClass }).default
        ?? (TreeSitterModule as unknown as TreeSitterParserClass);

      // Verify core WASM exists
      const coreWasmPath = getCoreWasmPath();
      if (!fs.existsSync(coreWasmPath)) {
        throw new ParserError(
          `Tree-sitter core WASM not found at: ${coreWasmPath}. ` +
          `Please ensure tree-sitter.wasm is available.`
        );
      }

      // Initialize with the WASM location
      await ParserClass.init({
        locateFile: (scriptName: string) => {
          if (scriptName === 'tree-sitter.wasm') {
            return coreWasmPath;
          }
          // For language-specific WASM files
          return path.join(getWasmBasePath(), scriptName);
        }
      });

      parserInitialized = true;
    } catch (error) {
      initPromise = null;
      throw new ParserError(
        'Failed to initialize Tree-sitter',
        undefined,
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  })();

  return initPromise;
}

/**
 * Check if Tree-sitter has been initialized
 */
export function isInitialized(): boolean {
  return parserInitialized;
}

// ============================================
// Parser Management
// ============================================

/**
 * Get a parser for a specific language
 *
 * Parsers are cached and reused. The first call for each language
 * will load the WASM grammar.
 *
 * @param language - The language to get a parser for
 * @returns A configured parser instance
 * @throws ParserError if the language WASM is not available
 */
export async function getParser(language: ParserLanguage): Promise<TreeSitterParser> {
  // Check cache first
  const cached = parsers.get(language);
  if (cached) {
    return cached;
  }

  // Ensure Tree-sitter is initialized
  await initTreeSitter();

  if (!ParserClass) {
    throw new ParserError('Tree-sitter not initialized');
  }

  // Load the language grammar
  const lang = await loadLanguage(language);

  // Create and configure parser
  const parser = new ParserClass();
  parser.setLanguage(lang);

  // Cache for reuse
  parsers.set(language, parser);

  return parser;
}

/**
 * Load a language grammar WASM file
 *
 * @param language - The language to load
 * @returns The language instance
 * @throws ParserError if the WASM file doesn't exist
 */
async function loadLanguage(language: ParserLanguage): Promise<TreeSitterLanguage> {
  // Check cache
  const cached = languages.get(language);
  if (cached) {
    return cached;
  }

  if (!ParserClass) {
    throw new ParserError('Tree-sitter not initialized');
  }

  const wasmPath = getLanguageWasmPath(language);

  // Check if WASM file exists
  if (!fs.existsSync(wasmPath)) {
    throw new ParserError(
      `Language WASM not found for ${language} at: ${wasmPath}. ` +
      `Please ensure tree-sitter-${language === 'typescript' ? 'tsx' : language}.wasm is available.`,
      undefined,
      language
    );
  }

  try {
    const lang = await ParserClass.Language.load(wasmPath);
    languages.set(language, lang);
    return lang;
  } catch (error) {
    throw new ParserError(
      `Failed to load language grammar for ${language}`,
      undefined,
      language,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

// ============================================
// File Parsing
// ============================================

/**
 * Parse source code string with a given parser
 *
 * @param parser - The parser to use
 * @param code - The source code to parse
 * @returns The parsed AST tree
 */
export function parseCode(parser: TreeSitterParser, code: string): TreeSitterTree {
  return parser.parse(code);
}

/**
 * Parse a file by path
 *
 * Automatically detects the language from file extension.
 *
 * @param filePath - Path to the file to parse
 * @returns Parse result with tree and metadata
 * @throws ParserError if file can't be read or parsed
 */
export async function parseFile(filePath: string): Promise<ParseResult> {
  const startTime = Date.now();

  // Detect language from extension
  const language = detectLanguage(filePath);
  if (!language) {
    throw new ParserError(
      `Unsupported file type: ${path.extname(filePath)}`,
      filePath
    );
  }

  // Read file content
  let code: string;
  try {
    code = fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    throw new ParserError(
      `Failed to read file: ${filePath}`,
      filePath,
      language,
      error instanceof Error ? error : new Error(String(error))
    );
  }

  // Get parser and parse
  const parser = await getParser(language);
  const tree = parseCode(parser, code);

  return {
    tree,
    language,
    filePath,
    parseTimeMs: Date.now() - startTime
  };
}

/**
 * Parse multiple files in batch
 *
 * Continues parsing even if some files fail, collecting errors.
 *
 * @param filePaths - Array of file paths to parse
 * @returns Object with successful results and errors
 */
export async function parseFiles(filePaths: string[]): Promise<{
  results: ParseResult[];
  errors: { filePath: string; error: string }[];
}> {
  const results: ParseResult[] = [];
  const errors: { filePath: string; error: string }[] = [];

  for (const filePath of filePaths) {
    try {
      const result = await parseFile(filePath);
      results.push(result);
    } catch (error) {
      errors.push({
        filePath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { results, errors };
}

// ============================================
// Language Detection
// ============================================

/**
 * File extension to language mapping
 */
const EXTENSION_MAP: Record<string, ParserLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyi': 'python'
};

/**
 * Detect language from file path extension
 *
 * @param filePath - Path to check
 * @returns The detected language or null if unsupported
 */
export function detectLanguage(filePath: string): ParserLanguage | null {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_MAP[ext] || null;
}

/**
 * Check if a file can be parsed
 *
 * @param filePath - Path to check
 * @returns true if the file extension is supported
 */
export function isParseableFile(filePath: string): boolean {
  return detectLanguage(filePath) !== null;
}

/**
 * Get all supported file extensions
 */
export function getSupportedExtensions(): string[] {
  return Object.keys(EXTENSION_MAP);
}

// ============================================
// Cleanup
// ============================================

/**
 * Clear all cached parsers and languages
 *
 * Use this when you need to free memory or before app shutdown.
 */
export function clearParsers(): void {
  // Delete trees and parsers
  // Use Array.from() to iterate over Map values
  const parserInstances = Array.from(parsers.values());
  for (const parser of parserInstances) {
    parser.delete();
  }
  parsers.clear();
  languages.clear();
}

/**
 * Get parser cache statistics
 */
export function getParserStats(): {
  initialized: boolean;
  cachedLanguages: ParserLanguage[];
  supportedExtensions: string[];
} {
  return {
    initialized: parserInitialized,
    cachedLanguages: Array.from(parsers.keys()),
    supportedExtensions: getSupportedExtensions()
  };
}
