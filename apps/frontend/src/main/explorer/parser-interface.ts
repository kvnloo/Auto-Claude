/**
 * Unified Parser Interface
 *
 * Provides a common interface for both OXC and Tree-sitter parsers using the Adapter pattern.
 * This allows seamless switching between parser backends and easy addition of new parsers.
 *
 * Usage:
 *   const parser = new OxcParserAdapter();
 *   await parser.initialize();
 *   const result = await parser.parseFile('src/index.ts');
 */

import type {
  UnifiedParseResult,
  ExtractedSymbol,
  ExtractedImport,
  ParserLanguage,
  ParserBackend,
} from './types';
import fs from 'fs/promises';
import path from 'path';

// ============================================
// Parser Interface
// ============================================

/**
 * Common interface that all parser adapters must implement.
 * Ensures consistent API across different parser backends.
 */
export interface IParser {
  /** Parser backend identifier */
  readonly name: ParserBackend;

  /** Languages this parser can handle */
  readonly supportedLanguages: ParserLanguage[];

  /**
   * Initialize the parser (load WASM, grammars, etc.)
   * Must be called before using parse methods.
   */
  initialize(): Promise<void>;

  /**
   * Check if this parser supports a given language
   * @param language - Language to check
   * @returns true if supported
   */
  supports(language: ParserLanguage): boolean;

  /**
   * Parse a file from disk
   * @param filePath - Absolute path to file
   * @returns Unified parse result
   */
  parseFile(filePath: string): Promise<UnifiedParseResult>;

  /**
   * Parse content directly (useful for testing)
   * @param content - Source code to parse
   * @param language - Language of the content
   * @returns Unified parse result
   */
  parseContent(content: string, language: ParserLanguage): Promise<UnifiedParseResult>;
}

// ============================================
// OXC Parser Adapter
// ============================================

/**
 * Adapter for OXC (Oxidation Compiler) parser.
 * Optimized for JavaScript/TypeScript with Rust-based performance.
 *
 * @see https://oxc.rs/
 */
export class OxcParserAdapter implements IParser {
  readonly name: ParserBackend = 'oxc';
  readonly supportedLanguages: ParserLanguage[] = ['javascript', 'typescript'];

  private initialized = false;

  /**
   * Initialize OXC parser (load WASM module)
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // TODO: Load OXC WASM module
    // const oxc = await import('oxc-parser');
    // await oxc.init();

    this.initialized = true;
  }

  /**
   * Check if OXC supports the given language
   */
  supports(language: ParserLanguage): boolean {
    return this.supportedLanguages.includes(language);
  }

  /**
   * Parse a JavaScript/TypeScript file using OXC
   */
  async parseFile(filePath: string): Promise<UnifiedParseResult> {
    if (!this.initialized) {
      throw new Error('OXC parser not initialized. Call initialize() first.');
    }

    const startTime = performance.now();
    const content = await fs.readFile(filePath, 'utf-8');
    const ext = path.extname(filePath);
    const language: ParserLanguage = ext === '.ts' || ext === '.tsx' ? 'typescript' : 'javascript';

    return this.parseContent(content, language);
  }

  /**
   * Parse JavaScript/TypeScript content using OXC
   */
  async parseContent(content: string, language: ParserLanguage): Promise<UnifiedParseResult> {
    if (!this.initialized) {
      throw new Error('OXC parser not initialized. Call initialize() first.');
    }

    if (!this.supports(language)) {
      throw new Error(`OXC does not support language: ${language}`);
    }

    const startTime = performance.now();

    // TODO: Implement actual OXC parsing
    // const ast = oxc.parse(content, { sourceType: language === 'typescript' ? 'ts' : 'js' });
    // const symbols = this.extractSymbols(ast);
    // const imports = this.extractImports(ast);

    // Stub implementation for now
    const symbols: ExtractedSymbol[] = [];
    const imports: ExtractedImport[] = [];
    const loc = content.split('\n').length;

    const parseTimeMs = performance.now() - startTime;

    return {
      symbols,
      imports,
      language,
      filePath: '<content>',
      parseTimeMs,
      parser: 'oxc',
      loc,
    };
  }

  /**
   * Extract symbols from OXC AST
   * @private
   */
  private extractSymbols(ast: any): ExtractedSymbol[] {
    // TODO: Implement symbol extraction from OXC AST
    // - Walk AST nodes
    // - Identify classes, functions, variables
    // - Extract metadata (docstrings, parameters, return types)
    return [];
  }

  /**
   * Extract imports from OXC AST
   * @private
   */
  private extractImports(ast: any): ExtractedImport[] {
    // TODO: Implement import extraction from OXC AST
    // - Find import declarations
    // - Extract source, items, default/named status
    return [];
  }
}

// ============================================
// Tree-sitter Parser Adapter
// ============================================

/**
 * Adapter for Tree-sitter parser.
 * General-purpose incremental parser with multi-language support.
 *
 * @see https://tree-sitter.github.io/tree-sitter/
 */
export class TreeSitterParserAdapter implements IParser {
  readonly name: ParserBackend = 'tree-sitter';
  readonly supportedLanguages: ParserLanguage[] = ['python', 'javascript', 'typescript'];

  private initialized = false;

  /**
   * Initialize Tree-sitter parser (load grammars)
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // TODO: Load Tree-sitter WASM and language grammars
    // const Parser = await import('web-tree-sitter');
    // await Parser.init();
    // this.parser = new Parser();
    // Load grammars for Python, JavaScript, TypeScript

    this.initialized = true;
  }

  /**
   * Check if Tree-sitter supports the given language
   */
  supports(language: ParserLanguage): boolean {
    return this.supportedLanguages.includes(language);
  }

  /**
   * Parse a file using Tree-sitter
   */
  async parseFile(filePath: string): Promise<UnifiedParseResult> {
    if (!this.initialized) {
      throw new Error('Tree-sitter parser not initialized. Call initialize() first.');
    }

    const startTime = performance.now();
    const content = await fs.readFile(filePath, 'utf-8');
    const language = this.detectLanguage(filePath);

    return this.parseContent(content, language);
  }

  /**
   * Parse content using Tree-sitter
   */
  async parseContent(content: string, language: ParserLanguage): Promise<UnifiedParseResult> {
    if (!this.initialized) {
      throw new Error('Tree-sitter parser not initialized. Call initialize() first.');
    }

    if (!this.supports(language)) {
      throw new Error(`Tree-sitter does not support language: ${language}`);
    }

    const startTime = performance.now();

    // TODO: Implement actual Tree-sitter parsing
    // this.parser.setLanguage(this.getLanguageGrammar(language));
    // const tree = this.parser.parse(content);
    // const symbols = this.extractSymbols(tree.rootNode, language);
    // const imports = this.extractImports(tree.rootNode, language);

    // Stub implementation for now
    const symbols: ExtractedSymbol[] = [];
    const imports: ExtractedImport[] = [];
    const loc = content.split('\n').length;

    const parseTimeMs = performance.now() - startTime;

    return {
      symbols,
      imports,
      language,
      filePath: '<content>',
      parseTimeMs,
      parser: 'tree-sitter',
      loc,
    };
  }

  /**
   * Detect language from file path
   * @private
   */
  private detectLanguage(filePath: string): ParserLanguage {
    const ext = path.extname(filePath);
    switch (ext) {
      case '.py':
      case '.pyi':
        return 'python';
      case '.ts':
      case '.tsx':
        return 'typescript';
      case '.js':
      case '.jsx':
      case '.mjs':
      case '.cjs':
        return 'javascript';
      default:
        throw new Error(`Unsupported file extension: ${ext}`);
    }
  }

  /**
   * Extract symbols from Tree-sitter AST
   * @private
   */
  private extractSymbols(node: any, language: ParserLanguage): ExtractedSymbol[] {
    // TODO: Implement symbol extraction from Tree-sitter AST
    // - Walk syntax tree
    // - Language-specific queries for classes, functions, etc.
    // - Extract metadata based on node types
    return [];
  }

  /**
   * Extract imports from Tree-sitter AST
   * @private
   */
  private extractImports(node: any, language: ParserLanguage): ExtractedImport[] {
    // TODO: Implement import extraction from Tree-sitter AST
    // - Language-specific import patterns
    // - Python: import/from...import
    // - JS/TS: import/require
    return [];
  }
}

// ============================================
// Parser Factory
// ============================================

/**
 * Create a parser instance for a given language.
 * Automatically selects the best parser backend.
 *
 * @param language - Language to parse
 * @returns Initialized parser instance
 */
export async function createParser(language: ParserLanguage): Promise<IParser> {
  let parser: IParser;

  // Prefer OXC for JavaScript/TypeScript (faster)
  if (language === 'javascript' || language === 'typescript') {
    parser = new OxcParserAdapter();
  } else {
    parser = new TreeSitterParserAdapter();
  }

  await parser.initialize();
  return parser;
}

/**
 * Create a parser instance with explicit backend selection.
 *
 * @param backend - Parser backend to use
 * @returns Initialized parser instance
 */
export async function createParserWithBackend(backend: ParserBackend): Promise<IParser> {
  const parser = backend === 'oxc' ? new OxcParserAdapter() : new TreeSitterParserAdapter();
  await parser.initialize();
  return parser;
}
